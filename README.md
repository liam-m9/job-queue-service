# Job Queue (Postgres)

A durable background job queue built on Postgres alone, no Redis, no external queue library. Multiple worker processes can safely claim jobs from the same table at the same time using `SELECT ... FOR UPDATE SKIP LOCKED`, with automatic retries, linear backoff, dead-lettering after too many failures, and crash recovery via a visibility timeout.

I built this because I kept hearing it was a genuinely good project for learning backend concurrency and how a real database handles it under load, so I wanted to see it for myself. I picked Postgres over Redis on purpose, not because it's the harder path, but because I wanted to learn the fundamentals with plain SQL first, no framework in the way, and that decision ended up teaching me a lot about how SQL queries and ORMs actually work underneath.

## Architecture

```mermaid
flowchart LR
    P[Producer<br/>enqueue()] -->|INSERT| J[(jobs table<br/>Postgres)]
    W1[Worker 1] -->|SKIP LOCKED claim| J
    W2[Worker 2] -->|SKIP LOCKED claim| J
    W3[Worker 3] -->|SKIP LOCKED claim| J
```

Producers just insert a row and move on. Workers independently poll the same table, each claiming a batch of jobs at a time. `SKIP LOCKED` guarantees two workers never walk away thinking they own the same job, even if they query at the exact same instant.

## Schema

Single `jobs` table:

| Column | Purpose |
|---|---|
| `id` | Primary key |
| `type` | Which handler should run this job (`reliableTask`, `flakyTask`) |
| `payload` | `jsonb`, data the handler needs |
| `status` | `pending` / `active` / `completed` / `dead` |
| `attempts` / `max_attempts` | Retry counter and limit |
| `run_at` | When this job is eligible to be claimed. Also doubles as the crash-recovery marker once a job is `active` |
| `last_error` | Most recent failure message, for debugging |
| `created_at` | For observability |

A partial index on `run_at WHERE status = 'pending'` keeps the claim query fast, since that's the one running constantly.

## Setup

```bash
docker compose up -d --wait
npm install
cp .env.example .env
docker compose exec -T postgres psql -U jobqueue -d jobqueue < db.sql
```

## Demo

```bash
# seed some jobs (mix of reliable and flaky)
node enqueue-demo.js 50

# in 2-3 separate terminals, start a worker each:
node run-worker.js --id=1
node run-worker.js --id=2
node run-worker.js --id=3

# check on progress at any time:
node queue-stats.js
```

Workers shut down gracefully on Ctrl+C (`SIGINT`) or `SIGTERM`. They stop claiming new batches and let whatever's currently in-flight finish before exiting, rather than dying mid-job.

`queue-stats.js` shows a count of jobs by status, plus the `id`/`type`/`last_error` of any `dead` jobs, so you can see why something ultimately failed instead of just that it did.

## Testing

```bash
npm test
```

`concurrency.test.js` seeds 150 jobs and runs three `claimJobs(15)` calls concurrently (not sequentially, genuinely overlapping in time), then asserts every claimed id is unique across all three calls and that the full 45 requested jobs were actually claimed. This is the concrete proof that `SKIP LOCKED` prevents double-processing under real concurrency, not just in theory.

## Performance

A single worker processed 300 seeded jobs at ~700 jobs/sec on a local Postgres instance (verified end-to-end, not estimated: table confirmed empty before seeding, confirmed fully `completed` after). This is a local, single-worker, deterministic-handler number, not a distributed-scale claim, but it's real.

## Design tradeoffs

**Why `SELECT ... FOR UPDATE SKIP LOCKED` instead of an application-level lock (e.g. a mutex)?** A mutex works by making a thread hold onto it before entering a critical section, locking that section off from other threads until it's released, but it's a piece of shared memory, so it only works between threads/processes on the same machine. It has no way to coordinate workers running on genuinely separate machines with no shared memory at all. `SKIP LOCKED` is coordinated by Postgres itself over the network, so it works the same whether workers are on one machine or spread across many. It also behaves differently when something's already locked: a mutex makes other threads block and wait for it to free up, while `SKIP LOCKED` lets a worker keep going immediately, it just skips whatever's already claimed and picks up something else instead of waiting on it.

**Why does `processJob` do its own `SELECT` to fetch full job details, instead of getting them for free from `claimJobs`'s `UPDATE ... RETURNING`?** This does mean one extra round-trip to the database per job. It was a deliberate simplicity tradeoff: `processJob` stays self-contained and testable given just an id, decoupled from exactly how it was claimed. At this project's scale the extra round-trips are irrelevant. At high throughput, batching the fetch (via `RETURNING` or one combined `SELECT`) would be the right call instead.

**Why does the retry backoff grow with each attempt instead of retrying immediately?** Retrying instantly assumes the failure was a one-off, but many real failures (a downstream service being overloaded, a transient network issue) get *worse* if you hammer them immediately. Growing the delay gives the underlying problem time to resolve, and avoids one repeatedly-failing job monopolising a worker's attention while other, healthy jobs are waiting.

## Known limitations

- **At-least-once delivery, not exactly-once.** If a worker crashes after doing the real work but before marking a job `completed`, the visibility timeout will eventually let another worker re-claim and redo it. Handlers should be idempotent for full correctness. This implementation doesn't enforce that itself.
- No job priority or recurring/scheduled jobs beyond the one-time `run_at`.
- `processJob` fetches full job details with its own per-job `SELECT` rather than batching, a deliberate simplicity tradeoff explained above, not free at high throughput.
- A job whose worker keeps crashing while processing it (not just a handler throwing, but the whole process dying) gets reclaimed via the visibility timeout, but `attempts` is never incremented during a crash-based reclaim, only a handler failure increments it. So a job that reliably crashes its worker would cycle between `active` and reclaimed indefinitely, never reaching `max_attempts`, never going `dead`. Fixing this properly means deciding whether a crash-reclaim should count as a failed attempt the same way a handler throwing does, which has its own tradeoff: a genuinely slow but healthy job could get unfairly penalized if reclaimed once due to a tight visibility timeout.

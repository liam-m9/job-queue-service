# Job Queue Service — Bug Fixes Plan

This document outlines the bug fixes, concurrency improvements, and technical updates for the Postgres-backed job queue service.

---

## Workflow & Documentation Model

- **`bug-fixes-plan.md`** (this file) is the reference plan: prioritized bugs, problem statements, fix approaches, and core concepts.
- **`bug-fixes-log.md`** contains the completed engineering decisions and defensible interview records per fix.

---

## Claims & Guarantees — Maintain These Contracts

1. `SELECT ... FOR UPDATE SKIP LOCKED` for disjoint concurrent batch claiming.
2. The concurrency test shape: **150 seeded jobs, 3 overlapping `claimJobs(15)` calls, all 45 claimed IDs unique**.
3. **Linear** backoff (`attempts * BACKOFF_DELAY`) for retries.
4. **60-second visibility timeout** reclaiming crashed worker jobs.
5. Single-worker throughput benchmark (~700 jobs/sec end-to-end).
6. At-least-once delivery semantics (not exactly-once).
7. Pure PostgreSQL implementation (no Redis, no external queue libraries).

---

## Bug Fixes Backlog

Legend: **P0** correctness / data durability, **P1** robustness & ownership, **P2** scale & operations, **P3** code quality & pool safety.

### [P0] Overlapping worker ticks + shutdown signal loss
- **Where:** `run-worker.ts`
- **Problem:** `setInterval(2000)` fires on wall-clock time without awaiting async callbacks. Slow job batches outlive 2s, causing ticks to stack up. `currentTick` handle is overwritten every fire, so `SIGINT`/`SIGTERM` only awaits the latest tick promise, stranding earlier overlapping ticks mid-`UPDATE`.
- **Fix approach:** Replace `setInterval` with a self-scheduling `while (!stopped)` loop using `setTimeout`. Await tick completion before scheduling the next delay. Maintain a single `loopPromise` and set `stopped = true` on process signal handlers to ensure in-flight work drains cleanly before `process.exit()`.
- **Concept:** Event loop execution order; single-process concurrency; graceful shutdown drain.
- **Branch:** `fix/worker-no-overlap`
- **Status:** done

### [P0] Structural failures burn retries as if they were transient
- **Where:** `worker.ts`, `processJob`
- **Problem:** When a job arrives with an unknown or renamed `type`, `runTasks[type]` is `undefined`. Invoking it throws a `TypeError`, which the catch block treats as a transient failure, retrying on backoff up to `max_attempts`. If the job row is missing entirely (`rows[0]` undefined), an unhandled `TypeError` inside the catch crashes the worker process mid-batch.
- **Fix approach:** Validate job row existence and handler registration before the `try` block. If the handler is missing, transition the job immediately to `dead` with a descriptive `last_error` and `continue`.
- **Concept:** Transient vs structural failure classification; poison-pill message handling.
- **Branch:** `fix/structural-failure-fast-dead`
- **Status:** todo

### [P1] Unguarded write-back after visibility timeout expires
- **Where:** `worker.ts`, `processJob`
- **Problem:** A worker that exceeds the 60s visibility timeout continues processing. Another worker can reclaim the job once `run_at` expires. The slow worker's completion/failure `UPDATE` statements run unconditionally by `id`, overwriting the state of a job currently being processed by worker 2.
- **Fix approach:** Fencing the `UPDATE` queries with conditional checks (`WHERE id = $1 AND status = 'active' AND run_at > now()`) or adding a `claim_epoch` (fencing token) column incremented on claim.
- **Concept:** Fencing tokens; concurrency lease validation; state machine integrity.
- **Branch:** `fix/guarded-writeback`
- **Status:** todo

### [P1] Crash-reclaim never counts an attempt
- **Where:** `worker.ts`, `claimJobs`
- **Problem:** A job whose worker crashes during processing gets reclaimed when `run_at <= now()`, but its `attempts` count is never incremented. It cycles active-to-reclaimed indefinitely without ever reaching `max_attempts` or transitioning to `dead`.
- **Fix approach:** Increment `attempts` in the claim `UPDATE` query whenever claiming an expired `active` job (SQS `ApproximateReceiveCount` pattern). Update README disclosures to reflect the receive-count behavior.
- **Concept:** SQS receive count & DLQ redrive policies; visibility timeout reclaim semantics.
- **Branch:** `fix/reclaim-counts-attempt`
- **Status:** todo

### [P2] Per-job re-SELECT instead of claiming with RETURNING
- **Where:** `worker.ts`, `claimJobs` + `processJob`
- **Problem:** The claim `UPDATE` executes `RETURNING id` but throws away the rest of the row. `processJob` then re-executes `SELECT` for every claimed job individually, adding redundant database round-trips.
- **Fix approach:** Update claim query to `RETURNING id, type, payload, attempts, max_attempts`, and pass full job objects to `processJob`.
- **Concept:** Database round-trip minimization; `UPDATE ... RETURNING` batch fetching.
- **Branch:** `perf/claim-returning-batch`
- **Status:** todo

### [P2] Reclaim path is unindexed and terminal rows accumulate forever
- **Where:** `db.sql`
- **Problem:** The partial index covers `run_at WHERE status = 'pending'`. The crash-recovery scan (`status = 'active' AND run_at <= now()`) cannot utilize the index, degrading to sequential scans as table size grows. `completed` and `dead` rows accumulate indefinitely.
- **Fix approach:** Add a second partial index `ON jobs (run_at) WHERE status = 'active'`. Implement a retention cleanup policy for `completed` jobs.
- **Concept:** PostgreSQL partial index predicate matching; table bloat & vacuum behavior.
- **Branch:** `feat/reclaim-index-retention`
- **Status:** todo

### [P3] pg Pool has no error handler
- **Where:** `db.ts`, `queue-stats.ts`, `enqueue-demo.ts`
- **Problem:** Idle client network errors emit unhandled `'error'` events on `pg.Pool`, crashing the process. Script files do not call `pool.end()`, remaining open until idle timeout.
- **Fix approach:** Attach `pool.on("error", ...)` handler and invoke `await pool.end()` in CLI utility scripts.
- **Concept:** `pg.Pool` event lifecycle; connection pool termination.
- **Branch:** `fix/pool-error-handler`
- **Status:** todo

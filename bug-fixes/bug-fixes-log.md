# Job Queue Service — Bug Fixes Log

This document records the architectural decisions, bug fixes, and concurrency fixes implemented for the Postgres-backed job queue service. Each section details the technical root cause, the chosen implementation, trade-offs, and verification.

---

## Completed Bug Fixes

### [P0] Overlapping worker ticks + shutdown signal loss
- **Branch:** `fix/worker-no-overlap`
- **File:** `run-worker.ts`
- **Root Cause:** `setInterval(..., 2000)` fires on fixed wall-clock time without awaiting async callbacks. If a batch takes longer than 2 seconds, ticks stack up concurrently inside the single process. Storing promises in a single `currentTick` variable continuously overwrote previous handles, so `SIGINT`/`SIGTERM` handlers only awaited the latest tick promise before calling `process.exit()`, stranding earlier ticks mid-query.
- **Implementation:** Replaced `setInterval` with an async `while (!stopped)` loop. Stored `const loopPromise = loop()` at startup. On `SIGINT`/`SIGTERM`, set `stopped = true` and `await loopPromise` before exiting.
- **Trade-Offs:** Replaced fixed-interval polling with dynamic backpressure (2-second pause occurs *after* batch completion). Total cycle time becomes `processing_time + 2000ms`, protecting PostgreSQL under heavy load.
- **Verification:** Clean TypeScript compilation (`npx tsc --noEmit`) and passing concurrency test suite (`npm test`).
- **Core rationale:** I replaced fixed-interval polling with a controlled async loop and shutdown flag to guarantee zero tick overlap and ensure all in-flight database operations drain completely before process exit.

### [P0] Structural failures burn retries as if they were transient
- **Branch:** `fix/structural-failure-fast-dead`
- **File:** `worker.ts`
- **Root Cause:** Missing job rows caused `undefined.type` and `undefined.attempts` accesses in `processJob`, throwing a secondary `TypeError` inside the `catch` block that crashed the worker process. Unregistered job types (`runTasks[type] == null`) threw `TypeError`, which the `catch` block treated as a transient error, burning 5 retries over several minutes before marking the job `dead`.
- **Implementation:** Added early guards before entering `try`: checked `!currentJob.rows || currentJob.rows.length === 0` to log and exit cleanly on missing rows; checked `!runTasks[jobData.type]` to transition unregistered task types immediately to `status = 'dead'` with `last_error = Unknown job type: ${jobData.type}` on attempt 1 without retrying.
- **Trade-Offs:** Failing fast on structural errors avoids unneeded database retries and queue bloat, while preserving standard linear backoff retries inside `try/catch` for genuine transient execution failures.
- **Verification:** Clean TypeScript compilation (`npm run typecheck`).
- **Core rationale:** I separated structural errors (missing rows or unregistered code handlers) from transient failures. Structural errors fail fast to `dead` on attempt 1 without burning retries, while early row checking prevents secondary `TypeError` crashes inside the catch block.

### [P1] Unguarded write-back after visibility timeout expires
- **Branch:** `fix/guarded-writeback`
- **File:** `worker.ts`
- **Root Cause:** If a worker process took longer than the 60s visibility timeout (`run_at <= now()`), another worker could re-claim the active job. The slow worker's completion or failure `UPDATE` statements executed unconditionally by `WHERE id = $1`, overwriting the state of a job currently being processed by worker 2.
- **Implementation:** Added lease ownership fencing to terminal `UPDATE` queries (`WHERE id = $1 AND status = 'active' AND run_at > now()`). If `result.rowCount === 0`, logged a warning that write-back was ignored due to an expired claim/lost ownership, preventing stale state overwrites.
- **Trade-Offs:** Fencing the `UPDATE` query guarantees state machine integrity with zero database schema changes or extra locking overhead.
- **Verification:** Clean TypeScript compilation (`npm run typecheck`).
- **Core rationale:** I fenced terminal state updates with lease ownership checks (`status = 'active' AND run_at > now()`). If a worker exceeds its visibility timeout, its late write-back becomes a no-op, preventing dead men's hands from overwriting active job state.

### [P1] Crash-reclaim never counts an attempt
- **Branch:** `fix/reclaim-counts-attempt`
- **File:** `worker.ts`, `claimJobs` UPDATE query; `README.md`
- **Root Cause:** Expired active jobs claimed during crash recovery previously retained their `attempts` count without incrementing. A job that repeatedly crashed its worker process cycled `active` -> reclaimed -> `active` indefinitely without reaching `max_attempts` or transitioning to `dead`.
- **Implementation:** Updated the `claimJobs` `UPDATE` query with a `CASE` statement: `WHEN status = 'active' THEN attempts + 1 ELSE attempts END`. This increments `attempts` when claiming an expired active job (modeling AWS SQS `ApproximateReceiveCount` / DLQ redrive semantics). Updated `README.md` to document the receive-count mechanism and the requirement that `VISIBILITY_TIMEOUT` exceed worst-case handler duration.
- **Trade-Offs:** Incrementing attempt count on crash reclaim guarantees that poison-pill jobs crashing workers move to `dead`. A tight visibility timeout on a slow but healthy job could cost one false attempt, which is mitigated by tuning `VISIBILITY_TIMEOUT`.
- **Verification:** Clean TypeScript compilation (`npm run typecheck`).
- **Core rationale:** I implemented SQS ApproximateReceiveCount semantics by incrementing `attempts` during crash reclaims in `claimJobs`. This stops crashing poison pills from cycling endlessly in `active` state and ensures they eventually reach `dead`.

---

## Future Bug Fixes Backlog

### [P2] Per-job re-SELECT instead of claiming with RETURNING (branch: `perf/claim-returning-batch`)
- **Learn first:** Database round-trip minimization; `UPDATE ... RETURNING` batch fetching.
- **Status:** todo

### [P2] Reclaim path is unindexed and terminal rows accumulate forever (branch: `feat/reclaim-index-retention`)
- **Learn first:** PostgreSQL partial index predicate matching; table bloat & vacuum behavior.
- **Status:** todo

### [P3] pg Pool has no error handler (branch: `fix/pool-error-handler`)
- **Learn first:** `pg.Pool` event lifecycle; connection pool termination.
- **Status:** todo

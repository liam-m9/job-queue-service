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
- **Defensible Defense:** "We replaced fixed-interval polling with a controlled async loop and shutdown flag to guarantee zero tick overlap and ensure all in-flight database operations drain completely before process exit."

### [P0] Structural failures burn retries as if they were transient
- **Branch:** `fix/structural-failure-fast-dead`
- **File:** `worker.ts`
- **Root Cause:** Missing job rows caused `undefined.type` and `undefined.attempts` accesses in `processJob`, throwing a secondary `TypeError` inside the `catch` block that crashed the worker process. Unregistered job types (`runTasks[type] == null`) threw `TypeError`, which the `catch` block treated as a transient error, burning 5 retries over several minutes before marking the job `dead`.
- **Implementation:** Added early guards before entering `try`: checked `!currentJob.rows || currentJob.rows.length === 0` to log and exit cleanly on missing rows; checked `!runTasks[jobData.type]` to transition unregistered task types immediately to `status = 'dead'` with `last_error = Unknown job type: ${jobData.type}` on attempt 1 without retrying.
- **Trade-Offs:** Failing fast on structural errors avoids unneeded database retries and queue bloat, while preserving standard linear backoff retries inside `try/catch` for genuine transient execution failures.
- **Verification:** Clean TypeScript compilation (`npm run typecheck`).
- **Defensible Defense:** "We separated structural errors (missing rows or unregistered code handlers) from transient failures. Structural errors fail fast to `dead` on attempt 1 without burning retries, while early row checking prevents secondary `TypeError` crashes inside the catch block."

---

## Future Bug Fixes Backlog

### [P1] Unguarded write-back after visibility timeout expires (branch: `fix/guarded-writeback`)
- **Learn first:** Fencing tokens; concurrency lease validation; state machine integrity.
- **Status:** todo

### [P1] Crash-reclaim never counts an attempt (branch: `fix/reclaim-counts-attempt`)
- **Learn first:** SQS receive count & DLQ redrive policies; visibility timeout reclaim semantics.
- **Status:** todo

### [P2] Per-job re-SELECT instead of claiming with RETURNING (branch: `perf/claim-returning-batch`)
- **Learn first:** Database round-trip minimization; `UPDATE ... RETURNING` batch fetching.
- **Status:** todo

### [P2] Reclaim path is unindexed and terminal rows accumulate forever (branch: `feat/reclaim-index-retention`)
- **Learn first:** PostgreSQL partial index predicate matching; table bloat & vacuum behavior.
- **Status:** todo

### [P3] pg Pool has no error handler (branch: `fix/pool-error-handler`)
- **Learn first:** `pg.Pool` event lifecycle; connection pool termination.
- **Status:** todo

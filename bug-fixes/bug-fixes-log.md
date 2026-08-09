# Job Queue Service — Bug Fixes Log

This document records the architectural decisions, bug fixes, and concurrency fixes implemented for the Postgres-backed job queue service. Each section details the technical root cause, the chosen implementation, trade-offs, and verification.

---

## Future Bug Fixes Backlog

### [P0] Overlapping worker ticks + shutdown signal loss (branch: `fix/worker-no-overlap`)
- **Learn first:** Event loop execution order; single-process concurrency; graceful shutdown drain.
- **Status:** todo

### [P0] Structural failures burn retries as if they were transient (branch: `fix/structural-failure-fast-dead`)
- **Learn first:** Transient vs structural failure classification; poison-pill message handling.
- **Status:** todo

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

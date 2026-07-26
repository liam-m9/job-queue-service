CREATE TABLE jobs (
    id              SERIAL PRIMARY KEY, 
    type            TEXT NOT NULL, 
    payload         JSONB NOT NULL,
    status          TEXT DEFAULT 'pending', 
    attempts        INT DEFAULT 0, 
    max_attempts    INT DEFAULT 5, 
    run_at          TIMESTAMPTZ DEFAULT now(),
    last_error      TEXT, 
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX currentJobs ON Jobs (run_at) WHERE status = 'pending';

-- run at: when its good to be picked up: doubles as crash recovery
-- last_error: nullable cuz might not have errors 
-- status: (pending) (active) (completed) (dead)

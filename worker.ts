import pool from "./db.ts";
import { runTasks } from "./jobHandlers.ts";

const VISIBILITY_TIMEOUT = 60;
const BACKOFF_DELAY = 10;

export interface JobRow {
  id: number;
  type: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
}

async function claimJobs(batchSize: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selectIds = await client.query<{ id: number }>(
      `
        SELECT * 
        FROM jobs
            WHERE run_at <= now()
            AND (status = 'pending' OR status = 'active')
        ORDER BY id ASC 
        LIMIT $1 
        FOR UPDATE SKIP LOCKED
        `,
      [batchSize],
    );
    const jobIds = selectIds.rows.map((row) => row.id);

    await client.query(
      `
        UPDATE jobs 
        SET status = 'active',
            run_at = now() + (interval '1 second' * $2) 
            WHERE id = ANY($1)
        RETURNING id
        `,
      [jobIds, VISIBILITY_TIMEOUT],
    );
    await client.query("COMMIT");
    return jobIds;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function processClaimedJobs(): Promise<void> {
  let jobs = await claimJobs(5);
  for (let i = 0; i < jobs.length; i++) {
    await processJob(jobs[i]);
  }
}

async function processJob(jobId: number): Promise<void> {
  const currentJob = await pool.query<JobRow>(
    `
    SELECT id, type, payload, status, attempts, max_attempts, run_at
    FROM jobs 
    WHERE id = $1
    `,
    [jobId],
  );

  try {
    const handler = runTasks[currentJob.rows[0].type];
    await handler(currentJob.rows[0].payload);
    await pool.query(
      `
        UPDATE jobs 
        SET status = 'completed'
        WHERE id = $1
        `,
      [currentJob.rows[0].id],
    );
  } catch (e: any) {
    let currentDelay = currentJob.rows[0].attempts * BACKOFF_DELAY;
    await pool.query(
      `
        UPDATE jobs 
        SET status = CASE 
                WHEN attempts + 1 < max_attempts THEN 'pending'
                ELSE 'dead'
            END,
            run_at = CASE 
                WHEN attempts + 1 < max_attempts THEN now() + (interval '1 second' * ($2::int + $3::int)) 
                ELSE now()
            END,
            last_error = $4,
            attempts = attempts + 1
        WHERE id = $1
        `,
      [currentJob.rows[0].id, VISIBILITY_TIMEOUT, currentDelay, e.message],
    );
  }
}

export { claimJobs, processJob, processClaimedJobs };

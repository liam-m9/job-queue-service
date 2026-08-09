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
        SET attempts = CASE 
                WHEN status = 'active' THEN attempts + 1 
                ELSE attempts 
            END,
            status = 'active',
            run_at = now() + (interval '1 second' * $2) 
        WHERE id = ANY($1)
        RETURNING id
        `,
      [jobIds, VISIBILITY_TIMEOUT],
    );
    await client.query("COMMIT");
    return jobIds;
  } catch (error: any) {
    await client.query("ROLLBACK");
    throw error;
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

async function processJob(job: number): Promise<void> {
  const currentJob = await pool.query<JobRow>(
    `
    SELECT id, type, payload, status, attempts, max_attempts, run_at
    FROM jobs 
    WHERE id = $1
    `,
    [job],
  );

  // guard for the not job existing 
  if (!currentJob.rows || currentJob.rows.length === 0) {
    console.error(`Job: ${job}, not found`)
    return
  }

  const jobData = currentJob.rows[0]

  // guard for undefined job type 
  if (!runTasks[jobData.type]) {
    await pool.query(
      `UPDATE jobs SET status = 'dead', last_error = $2 WHERE id = $1`,
      [jobData.id, `Unknown job type: ${jobData.type}`]
    );
    console.error(`Job ${jobData.id} marked dead: unknown job type '${jobData.type}'`);
    return;
  }

  try {
    const handler = runTasks[jobData.type];
    await handler(jobData.payload);
    const result = await pool.query(
      `
        UPDATE jobs 
        SET status = 'completed'
        WHERE id = $1 AND status = 'active' AND run_at > now()
        `,
      [jobData.id],
    );
    if (result.rowCount === 0) {
      console.warn(
        `Job ${jobData.id} completion write-back ignored: lease expired or lost ownership`,
      );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let currentDelay = jobData.attempts * BACKOFF_DELAY;
    const result = await pool.query(
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
        WHERE id = $1 AND status = 'active' AND run_at > now()
        `,
      [jobData.id, VISIBILITY_TIMEOUT, currentDelay, errorMessage],
    );
    if (result.rowCount === 0) {
      console.warn(
        `Job ${jobData.id} failure write-back ignored: lease expired or lost ownership`,
      );
    }
  }
}

export { claimJobs, processJob, processClaimedJobs };

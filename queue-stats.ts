import pool from "./db.ts";

async function displayStats(): Promise<void> {
  const getJobCount = await pool.query(
    `SELECT status, COUNT(*) FROM jobs GROUP BY status`,
  );

  const getDeadJobs = await pool.query(
    `SELECT id, type, last_error FROM jobs WHERE status = 'dead'`,
  );

  console.table(getJobCount.rows);
  console.table(getDeadJobs.rows);
}

await displayStats();

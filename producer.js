import pool from "./db.js";

export async function enqueue(type, payload) {
  const result  = await pool.query(
    "INSERT INTO jobs (type, payload) VALUES ($1, $2) RETURNING id",
    [type, payload],
  );
  return result.rows[0].id
}

import pool from "./db.ts";

export async function enqueue(type: string, payload: unknown): Promise<number> {
  const result = await pool.query<{ id: number }>(
    "INSERT INTO jobs (type, payload) VALUES ($1, $2) RETURNING id",
    [type, payload],
  );
  return result.rows[0].id;
}

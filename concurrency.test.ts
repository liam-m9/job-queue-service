import { test } from "node:test";
import assert from "node:assert";
import { claimJobs } from "./worker.ts";
import { enqueue } from "./producer.ts";

test("concurrent workers never claim the same job twice", async () => {
  for (let i = 0; i < 150; i++) {
    await enqueue("reliableTask", { n: i });
  }
  const results = await Promise.all([
    claimJobs(15),
    claimJobs(15),
    claimJobs(15),
  ]);
  const uniqueIds = new Set(results.flat());
  assert.strictEqual(uniqueIds.size, results.flat().length);
  assert.strictEqual(results.flat().length, 45);
});

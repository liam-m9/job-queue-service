import { processClaimedJobs } from "./worker.ts";

function getWorkerId(): number {
  const args = process.argv[2];
  if (!args) return 1;

  const parts = args.split("=");
  const id = Number(parts[1]);
  return isNaN(id) ? 1 : id;
}

const id = getWorkerId();

console.log(`Worker ${id} starting, polling every 2s...`);

let stopped = false

async function loop() {
  while (!stopped) {
    try {
      await processClaimedJobs();
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.log(`Worker ${id}: ${error.message}`)
      } else {
        console.log(`Worker ${id}: ${error}`)
      }
    }
    if (!stopped) await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

const loopPromise = loop()

process.on("SIGINT", async () => {
  stopped = true
  await loopPromise
  console.log("Ended process");
  process.exit();
});

process.on("SIGTERM", async () => {
  stopped = true
  await loopPromise
  console.log("Ended process");
  process.exit();
});

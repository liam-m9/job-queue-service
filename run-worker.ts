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

let currentTick: Promise<void> | null = null;

const intervalId = setInterval(async () => {
  try {
    currentTick = processClaimedJobs();
    await currentTick;
  } catch (e: any) {
    console.error(`Worker ${id} error:`, e.message);
  }
}, 2000);

process.on("SIGINT", async () => {
  clearInterval(intervalId);
  await currentTick;
  console.log("Ended process");
  process.exit();
});

process.on("SIGTERM", async () => {
  clearInterval(intervalId);
  await currentTick;
  console.log("Ended process");
  process.exit();
});

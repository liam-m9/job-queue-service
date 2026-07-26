import { processClaimedJobs } from "./worker.js";

function getWorkerId() {
  const args = process.argv[2];
  if (!args) return 1;

  const parts = args.split("=");
  const id = Number(parts[1]);
  return isNaN(id) ? 1 : id;
}

const id = getWorkerId();

console.log(`Worker ${id} starting, polling every 2s...`);

let currentTick = null;

const intervalId = setInterval(async () => {
  try {
    currentTick = processClaimedJobs();
    await currentTick;
  } catch (e) {
    console.error(`Worker ${id} error:`, e.message);
  }
}, 2000);

process.on("SIGINT", async () => {
  clearInterval(intervalId)
  await currentTick
  console.log('Ended process')
  process.exit()
});

process.on("SIGTERM", async () => {
  clearInterval(intervalId);
  await currentTick
  console.log('Ended process')
  process.exit()
});

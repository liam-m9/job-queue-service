import { enqueue } from "./producer.js";

let numberOfJobs = Number(process.argv[2]);

function randomType() {
  const types = ["reliableTask", "flakyTask"];
  let randomOutcome = Math.floor(Math.random() * 2);
  return types[randomOutcome];
}

function randomPayload() {
  const payloads = [
    { to: "example@proton.me", subject: "welcome" },
    { image: "https://example.com/photo.png", width: 800 },
    { endpoint: "https://api.example.com/orders", method: "POST" },
  ];
  let randomOutcome = Math.floor(Math.random() * 3);
  return payloads[randomOutcome];
}

async function enqueueJobs() {
  if (isNaN(numberOfJobs) || numberOfJobs === 0) {
    numberOfJobs = 10;
  }
  for (let i = 0; i < numberOfJobs; i++) {
    await enqueue(randomType(), randomPayload());
  }
}

await enqueueJobs()
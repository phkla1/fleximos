import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { JobRunnerService } from "./job-runner.service.js";

const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
const runner = app.get(JobRunnerService);
const once = process.argv.includes("--once");
const intervalMs = Number(process.env.OPS_WORKER_POLL_MS || 5000);

async function drain() {
  let processed = 0;
  while (await runner.runNext()) processed++;
  return processed;
}

if (once) {
  console.log(`Ops worker processed ${await drain()} queued job(s).`);
  await app.close();
} else {
  console.log(`Ops worker polling every ${intervalMs}ms.`);
  for (;;) {
    await drain();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

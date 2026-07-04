import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { SchedulerService } from "./scheduler.service.js";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const scheduler = app.get(SchedulerService);
  const once = process.argv.includes("--once");
  const tick = async () => {
    const runs = await scheduler.tick();
    if (runs.length) console.log(`[ops-scheduler] enqueued ${runs.length} run(s)`);
  };
  await tick();
  if (once) {
    await app.close();
    return;
  }
  const interval = setInterval(() => tick().catch((error) => console.error("[ops-scheduler]", error)), 60_000);
  const shutdown = async () => {
    clearInterval(interval);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[ops-scheduler] fatal", error);
  process.exit(1);
});

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { JobRunnerService } from "./job-runner.service.js";
import { SchedulerService } from "./scheduler.service.js";

const port = Number(process.env.PORT || 4030);
const host = process.env.HOST || "127.0.0.1";

const app = await NestFactory.create(AppModule, { cors: true });
app.enableCors({
  origin: true,
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
});

const swaggerConfig = new DocumentBuilder()
  .setTitle("Fleximotion Ops API")
  .setDescription("Operational source of truth for roster, platform activity, alerts, and reporting.")
  .setVersion("1.0.0")
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, swaggerConfig);
SwaggerModule.setup("ops/developer", app, document);

await app.listen(port, host);
console.log(`Ops API: http://${host}:${port}`);
console.log(`Ops Swagger: http://${host}:${port}/ops/developer`);

// Embedded jobs mode: the PGlite data directory must only ever be opened by
// one process, so deployments set FLEXI_EMBED_JOBS=true and this process
// hosts the worker drain loop and scheduler tick instead of running
// worker.ts / scheduler.ts as separate processes. Local dev and tests keep
// the flag off and run them separately against their own databases.
if (process.env.FLEXI_EMBED_JOBS === "true") {
  const runner = app.get(JobRunnerService);
  const scheduler = app.get(SchedulerService);
  const workerPollMs = Number(process.env.OPS_WORKER_POLL_MS || 5000);
  let draining = false;
  setInterval(async () => {
    if (draining) return;
    draining = true;
    try {
      while (await runner.runNext()) { /* drain the queue */ }
    } catch (error) {
      console.error("[embedded-worker]", error);
    } finally {
      draining = false;
    }
  }, workerPollMs);
  const tick = () => scheduler.tick()
    .then((runs) => { if (runs.length) console.log(`[embedded-scheduler] enqueued ${runs.length} run(s)`); })
    .catch((error) => console.error("[embedded-scheduler]", error));
  tick();
  setInterval(tick, 60_000);
  console.log(`Embedded jobs: worker polling every ${workerPollMs}ms, scheduler ticking every 60s.`);
}

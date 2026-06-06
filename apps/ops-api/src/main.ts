import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT || 4030);
const host = process.env.HOST || "127.0.0.1";

const app = await NestFactory.create(AppModule, { cors: true });
app.enableCors({
  origin: true,
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Actor-Person-Id"],
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

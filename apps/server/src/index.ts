import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { startReconciliationLoop } from "./jobs/reconcile";
import { ensureBucket } from "./lib/bucket";
import chunksRouter from "./routes/chunks";
import healthRouter from "./routes/health";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
  }),
);

app.get("/", (c) => {
  return c.text("OK");
});

app.route("/api/chunks", chunksRouter);
app.route("/api/health", healthRouter);

async function init() {
  await ensureBucket();
  startReconciliationLoop();
  console.log("Server initialized: bucket ensured, reconciliation started");
}

init().catch(console.error);

export default app;

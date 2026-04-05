import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    MINIO_ENDPOINT: z.string().min(1).default("http://localhost:9000"),
    MINIO_ACCESS_KEY: z.string().min(1).default("minioadmin"),
    MINIO_SECRET_KEY: z.string().min(1).default("minioadmin"),
    MINIO_BUCKET: z.string().min(1).default("recordings"),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

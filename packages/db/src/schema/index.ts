import { integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  status: text("status").default("recording").notNull(),
  totalChunks: integer("total_chunks").default(0),
  totalDuration: real("total_duration").default(0),
  assembledKey: text("assembled_key"),
  createdAt: timestamp("created_at").defaultNow(),
  stoppedAt: timestamp("stopped_at"),
});

export const chunks = pgTable("chunks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id)
    .notNull(),
  index: integer("index").notNull(),
  bucketKey: text("bucket_key").notNull(),
  ackedAt: timestamp("acked_at"),
  missingFromBucket: integer("missing_from_bucket").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id")
    .references(() => sessions.id)
    .notNull(),
  speaker: text("speaker"),
  text: text("text"),
  startTime: real("start_time"),
  endTime: real("end_time"),
  language: text("language"),
  avgLogprob: real("avg_logprob"),
  noSpeechProb: real("no_speech_prob"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

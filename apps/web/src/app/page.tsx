"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  HardDrive,
  Mic,
  Shield,
  Users,
  Waves,
  Zap,
} from "lucide-react";
import { Button } from "@my-better-t-app/ui/components/button";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

interface HealthData {
  chunksAcked: number;
  chunksMissingFromBucket: number;
  sessions: {
    recording: number;
    stopped: number;
    transcribing: number;
    done: number;
    failed: number;
  };
  transcripts: {
    pending: number;
    done: number;
    failed: number;
    silent: number;
  };
  workerQueueDepth: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/50 bg-card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

const FEATURES = [
  {
    icon: HardDrive,
    title: "OPFS Persistence",
    desc: "Audio chunks persist to the browser's Origin Private File System before any network call. If your tab closes, nothing is lost.",
  },
  {
    icon: Waves,
    title: "5s Chunked Upload",
    desc: "Recordings are split into durable 5-second WAV segments and uploaded incrementally. Maximum data loss: 5 seconds.",
  },
  {
    icon: Shield,
    title: "Reconciliation",
    desc: "A server-side cron job flags any chunks missing from storage. The client automatically re-uploads them from OPFS.",
  },
  {
    icon: Users,
    title: "Speaker Diarization",
    desc: "Identifies who spoke when using voice embeddings + spectral clustering. Works for turn-taking conversations.",
  },
  {
    icon: Zap,
    title: "CPU Transcription",
    desc: "Runs Whisper (small, int8) entirely on CPU. No GPU required. Processes 30s of audio in ~30-60 seconds.",
  },
  {
    icon: Cloud,
    title: "S3-Compatible Storage",
    desc: "Chunks stored in MinIO (S3-compatible). Assembled full recordings uploaded back for archival.",
  },
];

export default function Home() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/health`);
        if (res.ok) {
          const data = (await res.json()) as HealthData;
          setHealth(data);
          setServerOk(true);
        } else {
          setServerOk(false);
        }
      } catch {
        setServerOk(false);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const totalSessions = health
    ? health.sessions.recording +
    health.sessions.stopped +
    health.sessions.transcribing +
    health.sessions.done +
    health.sessions.failed
    : 0;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Hero */}
      <section className="flex flex-col items-center gap-6 px-4 pt-16 pb-12 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
          <Mic className="size-8 text-primary-foreground" />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            VoxScribe
          </h1>
          <p className="mx-auto max-w-lg text-lg text-muted-foreground">
            Record, chunk, and transcribe audio with speaker diarization.
            Durable OPFS persistence ensures <strong className="text-foreground">zero data loss</strong>.
          </p>
        </div>
        <Link href="/recorder">
          <Button size="lg" className="gap-2 rounded-full px-6 text-sm">
            <Mic className="size-4" />
            Start Recording
            <ArrowRight className="size-4" />
          </Button>
        </Link>
      </section>

      {/* Pipeline Status */}
      <section className="mx-auto w-full max-w-4xl px-4 pb-10">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Pipeline Status
          </h2>
          {serverOk !== null && (
            <span className={`flex items-center gap-1 text-xs ${serverOk ? "text-emerald-500" : "text-red-400"}`}>
              <span className={`size-1.5 rounded-full ${serverOk ? "bg-emerald-500" : "bg-red-400"}`} />
              {serverOk ? "Online" : "Offline"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Cloud} label="Chunks" value={health?.chunksAcked ?? "—"} sub="uploaded & acked" />
          <StatCard icon={Waves} label="Sessions" value={totalSessions} sub={health ? `${health.sessions.done} completed` : "—"} />
          <StatCard
            icon={CheckCircle2}
            label="Transcripts"
            value={health?.transcripts.done ?? "—"}
            sub={health?.transcripts.pending ? `${health.transcripts.pending} pending` : "all processed"}
          />
          <StatCard icon={Zap} label="Queue" value={health?.workerQueueDepth ?? "—"} sub="jobs waiting" />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-4xl px-4 pb-16">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How It Works
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group flex flex-col gap-2 rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-primary/30 hover:shadow-md"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <f.icon className="size-4" />
              </div>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/50 px-4 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between text-[11px] text-muted-foreground">
          <span>VoxScribe — Swades AI Hackathon 2026</span>
          <span>16kHz · WAV · Whisper · CPU</span>
        </div>
      </footer>
    </div>
  );
}

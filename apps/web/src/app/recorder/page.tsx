"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  FileText,
  HardDrive,
  Loader2,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Shield,
  Square,
  Trash2,
  Upload,
  Users,
  Waves,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { LiveWaveform } from "@/components/ui/live-waveform";
import { useRecorder, type WavChunk } from "@/hooks/use-recorder";
import { getOPFSStorageUsage } from "@/lib/opfs";
import { recoverMissingChunks, recoverOrphanedChunks } from "@/lib/recovery";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`;
}

function formatTimestamp(seconds: number | null) {
  if (seconds === null || seconds === undefined) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SPEAKER_COLORS = [
  { text: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-400" },
  { text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  { text: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20", dot: "bg-violet-400" },
  { text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-400" },
  { text: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", dot: "bg-rose-400" },
  { text: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", dot: "bg-cyan-400" },
];

function getSpeakerColor(speaker: string | null, speakers: string[]) {
  if (!speaker) return SPEAKER_COLORS[0];
  const idx = speakers.indexOf(speaker);
  return SPEAKER_COLORS[idx >= 0 ? idx % SPEAKER_COLORS.length : 0];
}

function StatusDot({ status }: { status: WavChunk["uploadStatus"] }) {
  const cls: Record<string, string> = {
    pending: "bg-muted-foreground/40",
    persisted: "bg-yellow-500",
    uploading: "bg-blue-500 animate-pulse",
    acked: "bg-emerald-500",
    failed: "bg-red-500",
  };
  return <span className={`inline-block size-2 rounded-full ${cls[status] ?? cls.pending}`} />;
}

function ChunkRow({ chunk, index }: { chunk: WavChunk; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      el.currentTime = 0;
      setPlaying(false);
    } else {
      el.play();
      setPlaying(true);
    }
  };

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
      <audio ref={audioRef} src={chunk.url} onEnded={() => setPlaying(false)} preload="none" />
      <StatusDot status={chunk.uploadStatus} />
      <span className="w-6 text-right font-mono text-[11px] text-muted-foreground">{index + 1}</span>
      <span className="font-mono text-[11px] tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className="ml-auto text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {chunk.uploadStatus === "acked" ? "synced" : chunk.uploadStatus}
      </span>
      <Button variant="ghost" size="icon-xs" onClick={toggle} className="opacity-0 group-hover:opacity-100">
        {playing ? <Square className="size-2.5" /> : <Play className="size-2.5" />}
      </Button>
    </div>
  );
}

interface TranscriptSegment {
  id: string;
  sessionId: string;
  speaker: string | null;
  text: string | null;
  startTime: number | null;
  endTime: number | null;
  language: string | null;
  status: string;
}

interface SessionData {
  session: { id: string; status: string; totalChunks: number; totalDuration: number };
  chunks: Array<{ id: string; index: number; ackedAt: string | null; missingFromBucket: number }>;
  transcript: TranscriptSegment[];
}

export default function RecorderPage() {
  const [deviceId] = useState<string | undefined>();
  const { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks, sessionId } =
    useRecorder({ chunkDuration: 5, deviceId });
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [transcribeMessage, setTranscribeMessage] = useState("");
  const [showChunks, setShowChunks] = useState(false);
  const [opfsUsage, setOpfsUsage] = useState({ used: 0, quota: 0 });
  const [online, setOnline] = useState(true);

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isActive = isRecording || isPaused;

  const ackedCount = chunks.filter((c) => c.uploadStatus === "acked").length;
  const failedCount = chunks.filter((c) => c.uploadStatus === "failed").length;
  const pendingCount = chunks.length - ackedCount - failedCount;
  const allSynced = chunks.length > 0 && ackedCount === chunks.length;
  const progress = chunks.length > 0 ? (ackedCount / chunks.length) * 100 : 0;

  // Online status
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // OPFS usage
  useEffect(() => {
    const poll = async () => {
      const usage = await getOPFSStorageUsage();
      setOpfsUsage(usage);
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, []);

  const handlePrimary = useCallback(() => {
    if (isActive) stop();
    else start();
  }, [isActive, stop, start]);

  // Poll session data
  useEffect(() => {
    if (!sessionId || isActive) return;
    const poll = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/chunks/sessions/${sessionId}`);
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean } & SessionData;
          if (data.ok) setSessionData(data);
        }
      } catch { /* retry */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [sessionId, isActive]);

  const handleTranscribe = async () => {
    if (!sessionId) return;
    setTranscribing(true);
    setTranscribeMessage("");
    try {
      const res = await fetch(`${SERVER_URL}/api/chunks/sessions/${sessionId}/transcribe`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      setTranscribeMessage(data.ok ? (data.message ?? "Queued!") : `Error: ${data.error}`);
    } catch (error) {
      setTranscribeMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`);
    } finally {
      setTranscribing(false);
    }
  };

  const handleRecover = async () => {
    if (!sessionId) return;
    setRecovering(true);
    setRecoveryMessage("");
    const [missing, orphaned] = await Promise.all([
      recoverMissingChunks(sessionId),
      recoverOrphanedChunks(sessionId),
    ]);
    const total = missing.total + orphaned.total;
    const recovered = missing.recovered + orphaned.recovered;
    setRecoveryMessage(
      total === 0 ? "All chunks verified ✓" : `Recovered ${recovered}/${total} chunks`,
    );
    setRecovering(false);
  };

  const speakers = sessionData?.transcript
    ? [...new Set(sessionData.transcript.map((s) => s.speaker).filter(Boolean) as string[])]
    : [];
  const sessionStatus = sessionData?.session?.status;
  const isTranscribing = sessionStatus === "transcribing" || transcribing;
  const isDone = sessionStatus === "done";
  const hasTranscript = (sessionData?.transcript?.length ?? 0) > 0 &&
    sessionData?.transcript?.some((s) => s.status === "done");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top Bar — connection + storage indicators */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/20 px-4 py-1.5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px]">
            {online
              ? <><Wifi className="size-3 text-emerald-500" /><span className="text-muted-foreground">Connected</span></>
              : <><WifiOff className="size-3 text-red-500" /><span className="text-red-400">Offline</span></>
            }
          </span>
          <span className="text-border">|</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <HardDrive className="size-3" />
            OPFS: {formatBytes(opfsUsage.used)}
          </span>
        </div>
        {sessionId && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {sessionId.slice(0, 8)}…
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-6">
        <div className="flex w-full max-w-xl flex-col gap-4">

          {/* Main Recorder Card */}
          <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
            {/* Waveform */}
            <div className="relative bg-muted/30 px-4 pt-4 pb-2">
              <LiveWaveform
                active={isRecording}
                processing={isPaused}
                stream={stream}
                height={100}
                barWidth={2}
                barGap={1}
                barRadius={1}
                sensitivity={2}
                smoothingTimeConstant={0.85}
                fadeEdges
                fadeWidth={40}
                mode="static"
                className="text-foreground"
              />
              {isRecording && (
                <span className="absolute top-2 right-3 flex items-center gap-1.5">
                  <span className="size-2 animate-pulse rounded-full bg-red-500" />
                  <span className="text-[10px] font-medium text-red-400">REC</span>
                </span>
              )}
              {isPaused && (
                <span className="absolute top-2 right-3 text-[10px] font-medium text-amber-400">
                  PAUSED
                </span>
              )}
            </div>

            {/* Timer + Controls */}
            <div className="flex flex-col items-center gap-4 px-4 py-5">
              <div className="flex items-baseline gap-1">
                <span className="font-mono text-4xl font-light tabular-nums tracking-tight">
                  {formatTime(elapsed)}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  16kHz · WAV
                </span>
              </div>

              {/* Sync Progress */}
              {chunks.length > 0 && (
                <div className="flex w-full max-w-xs flex-col gap-1">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{ackedCount}/{chunks.length} synced</span>
                    {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
                    {pendingCount > 0 && <span>{pendingCount} pending</span>}
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="flex items-center gap-2">
                <Button
                  size="lg"
                  variant={isActive ? "destructive" : "default"}
                  className="gap-2 rounded-full px-6"
                  onClick={handlePrimary}
                  disabled={status === "requesting"}
                >
                  {isActive ? (
                    <><Square className="size-3.5" />Stop</>
                  ) : (
                    <><Mic className="size-3.5" />{status === "requesting" ? "Starting…" : "Record"}</>
                  )}
                </Button>

                {isActive && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="gap-2 rounded-full"
                    onClick={isPaused ? resume : pause}
                  >
                    {isPaused ? <><Play className="size-3.5" />Resume</> : <><Pause className="size-3.5" />Pause</>}
                  </Button>
                )}
              </div>
            </div>

            {/* Pipeline Status Strip */}
            {(chunks.length > 0 || sessionId) && (
              <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-4 py-2">
                <div className="flex items-center gap-4 text-[10px]">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Waves className="size-3" />
                    {chunks.length} chunks
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Shield className="size-3" />
                    OPFS buffered
                  </span>
                  {allSynced && (
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="size-3" />
                      All synced
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!isActive && sessionId && (
                    <Button variant="ghost" size="icon-xs" onClick={handleRecover} disabled={recovering}>
                      {recovering ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setShowChunks(!showChunks)}
                  >
                    {showChunks ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  </Button>
                </div>
              </div>
            )}

            {/* Expandable Chunk List */}
            {showChunks && chunks.length > 0 && (
              <div className="max-h-48 overflow-y-auto border-t border-border/30 bg-muted/10 px-2 py-1">
                {chunks.map((chunk, i) => (
                  <ChunkRow key={chunk.id} chunk={chunk} index={i} />
                ))}
                <div className="flex justify-end px-2 py-1">
                  <Button variant="ghost" size="xs" className="gap-1 text-destructive" onClick={clearChunks}>
                    <Trash2 className="size-2.5" />Clear
                  </Button>
                </div>
              </div>
            )}

            {recoveryMessage && (
              <div className="border-t border-border/30 bg-muted/10 px-4 py-1.5 text-center text-[10px] text-muted-foreground">
                {recoveryMessage}
              </div>
            )}
          </div>

          {/* Transcribe Card */}
          {!isActive && sessionId && chunks.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Transcription</p>
                    <p className="text-[10px] text-muted-foreground">
                      {isDone ? "Complete" : isTranscribing ? "Processing…" : allSynced ? "Ready" : "Waiting for sync…"}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 rounded-full"
                  onClick={handleTranscribe}
                  disabled={isTranscribing || !allSynced || isDone}
                >
                  {isTranscribing ? (
                    <><Loader2 className="size-3 animate-spin" />Processing…</>
                  ) : isDone ? (
                    <><CheckCircle2 className="size-3" />Done</>
                  ) : (
                    <><Users className="size-3" />Transcribe</>
                  )}
                </Button>
              </div>
              {transcribeMessage && (
                <div className="border-t border-border/30 px-4 py-1.5 text-[10px] text-muted-foreground">
                  {transcribeMessage}
                </div>
              )}
            </div>
          )}

          {/* Transcript Display */}
          {hasTranscript && sessionData?.transcript && (
            <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Transcript</p>
                    <p className="text-[10px] text-muted-foreground">
                      {speakers.length > 0
                        ? `${speakers.length} speaker${speakers.length > 1 ? "s" : ""} detected`
                        : "Processing complete"}
                      {sessionData.session.totalDuration > 0 && ` · ${formatDuration(sessionData.session.totalDuration)}`}
                    </p>
                  </div>
                </div>
                {/* Speaker legend */}
                {speakers.length > 1 && (
                  <div className="flex gap-2">
                    {speakers.map((speaker) => {
                      const color = getSpeakerColor(speaker, speakers);
                      return (
                        <span key={speaker} className="flex items-center gap-1">
                          <span className={`size-2 rounded-full ${color.dot}`} />
                          <span className={`text-[10px] font-medium ${color.text}`}>{speaker}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="divide-y divide-border/20">
                {sessionData.transcript
                  .filter((s) => s.status === "done" || s.status === "silent")
                  .map((seg) => {
                    const color = getSpeakerColor(seg.speaker, speakers);
                    return (
                      <div key={seg.id} className="flex gap-3 px-4 py-3">
                        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                          {seg.speaker && (
                            <span className={`text-[10px] font-semibold ${color.text}`}>
                              {seg.speaker}
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {formatTimestamp(seg.startTime)}
                          </span>
                        </div>
                        <div className={`flex-1 rounded-md px-3 py-2 ${color.bg} border`}>
                          <p className="text-sm leading-relaxed">
                            {seg.status === "done" ? seg.text : seg.status === "silent" ? "(silence)" : "…"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

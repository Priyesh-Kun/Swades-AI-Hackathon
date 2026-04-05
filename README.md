# Reliable Recording Chunking Pipeline

A production-grade audio recording, chunking, and transcription system with speaker diarization. Records audio in the browser, chunks it into 5-second WAV segments, uploads durably via OPFS persistence, and transcribes with speaker identification.

## Architecture

```
Browser (Next.js)                 Server (Hono/Bun)              Worker (Python)
┌─────────────────┐    upload    ┌──────────────────┐   Redis    ┌────────────────┐
│ Record 16kHz WAV├────────────→│ Ack to Postgres  │──────────→│ BRPOP job      │
│ Chunk every 5s  │  base64/JSON│ Store to MinIO   │           │ Download chunks│
│ Persist to OPFS │             │ Session lifecycle│           │ Assemble WAV   │
│ Upload pipeline │←────────────│ Health metrics   │←──────────│ Whisper STT    │
│ Recovery module │   ack/status│ Reconcile cron   │  write DB │ Speaker diariz.│
└─────────────────┘             └──────────────────┘           └────────────────┘
         │                              │                             │
         │     ┌────────┐    ┌──────────┤──────────┐    ┌────────────┘
         └────→│  OPFS  │    │ Postgres │  MinIO   │    │
               │(browser)│   │ (chunks, │ (WAV     │    │
               └─────────┘   │ sessions,│  files)  │    │
                              │ transcr.)│          │    │
                              └──────────┴──────────┘    │
                                    │                    │
                                    │     ┌──────────┐   │
                                    └────→│  Redis   │←──┘
                                          │ (queue)  │
                                          └──────────┘
```

## Quick Start

### Prerequisites
- Node.js 20+ with npm
- Bun runtime (`curl -fsSL https://bun.sh/install | bash`)
- Python 3.12+
- Docker & Docker Compose

### 1. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- **Postgres** on port 5433 (user: `dev`, password: `dev`, db: `recording`)
- **MinIO** on port 9000 (console: 9001, user: `minioadmin`, password: `minioadmin`)
- **Redis** on port 6379

### 2. Configure Environment

```bash
# apps/server/.env
DATABASE_URL=postgres://dev:dev@localhost:5433/recording
CORS_ORIGIN=http://localhost:3001
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=recordings
REDIS_URL=redis://localhost:6379

# apps/web/.env
NEXT_PUBLIC_SERVER_URL=http://localhost:3000

# apps/worker/.env
DATABASE_URL=postgres://dev:dev@localhost:5433/recording
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=recordings
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
ENABLE_DIARIZATION=true
```

### 3. Install Dependencies & Push Schema

```bash
npm install
npm run db:push
```

### 4. Setup Python Worker

```bash
cd apps/worker
python3 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -r requirements.txt
```

### 5. Run Everything

```bash
# Terminal 1: Server + Web
npm run dev

# Terminal 2: Worker
cd apps/worker
source .env && .venv/bin/python worker.py
```

Open **http://localhost:3001/recorder** to record.

## Usage

1. Click **Record** → speak into your microphone
2. Audio is chunked every 5 seconds, each chunk shows upload status (synced ✅)
3. Click **Stop** when done
4. Click **"Transcribe with Speaker Detection"**
5. Wait for the worker to process → transcript appears with speaker labels

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chunks/sessions/create` | Create recording session |
| POST | `/api/chunks/upload` | Upload audio chunk (base64) |
| POST | `/api/chunks/sessions/:id/stop` | Mark session complete |
| POST | `/api/chunks/sessions/:id/transcribe` | Trigger transcription |
| GET | `/api/chunks/sessions/:id` | Get session + transcript |
| GET | `/api/chunks/missing?sessionId=` | Find missing chunks |
| GET | `/api/health` | Pipeline health metrics |

## Data Flow

1. **Record** → 16kHz/16-bit PCM WAV, chunked every 5s
2. **Persist** → OPFS (browser filesystem) before any network call
3. **Upload** → Base64 → Server → MinIO bucket + Postgres ack
4. **Delete** → OPFS entry removed only after server ack
5. **Recover** → On reconnect, re-upload missing chunks from OPFS
6. **Transcribe** → Worker assembles all chunks → Whisper (CPU/int8) → Speaker diarization
7. **Result** → Speaker-attributed transcript segments stored in Postgres

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web | Next.js 16, React 19 |
| Server | Hono, Bun |
| Database | Postgres 16, Drizzle ORM |
| Storage | MinIO (S3-compatible) |
| Queue | Redis |
| Transcription | faster-whisper (CTranslate2, int8) |
| Diarization | resemblyzer + spectral clustering |
| Monorepo | Turborepo |

## Speaker Diarization

The system identifies and labels different speakers in a recording using voice embeddings + spectral clustering:

- **How it works**: Audio is split into 1.5-second windows. Each window gets a speaker embedding (voice fingerprint) via [resemblyzer](https://github.com/resemble-ai/Resemblyzer). Embeddings are clustered using spectral clustering, and the number of speakers is auto-detected using silhouette scoring.
- **Turn-taking conversations**: Works well when speakers take turns — each speaker's segments are correctly labeled (e.g., "Speaker 1", "Speaker 2").
- **Overlapping speech**: When multiple people speak at the same time, the system assigns the window to whichever speaker's voice is dominant. It does **not** separate overlapping voices into distinct channels. This is a fundamental limitation of the single-channel (mono) recording approach.

### Why overlapping speech isn't supported

1. **Single microphone**: The browser captures one mono audio stream. Separating overlapping voices requires either multiple microphones or a neural source separation model (which is computationally expensive and adds significant complexity).
2. **Embedding-based approach**: resemblyzer produces one embedding per window. When two people talk simultaneously, the embedding is a blend of both voices, making clean speaker assignment impossible.
3. **Practical trade-off**: For most use cases (meetings, interviews, presentations), speakers naturally take turns. The system handles this well.

## Known Limitations

| Limitation | Detail |
|---|---|
| **Overlapping speech** | Only the dominant speaker is labeled when multiple people speak simultaneously |
| **Proper noun accuracy** | Names, places, and domain-specific terms may be misspelled (Whisper `small` model limitation — use `medium` or `large-v3` for better accuracy) |
| **CPU transcription speed** | Processing takes ~1-2x real-time on CPU with the `small` model. A 30-second recording takes ~30-60 seconds to transcribe |
| **Single language** | Auto-detected per session. Code-switching (mixing languages mid-sentence) may produce errors |
| **Browser compatibility** | OPFS requires a modern browser (Chrome 86+, Firefox 111+, Safari 15.2+) |


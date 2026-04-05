import json
import os
import tempfile
import traceback
from pathlib import Path

import boto3
import psycopg
import redis

from assemble import assemble_chunks, get_audio_duration
from transcribe import transcribe
from diarize import diarize, assign_speakers

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://dev:dev@localhost:5433/recording")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "recordings")
ENABLE_DIARIZATION = os.environ.get("ENABLE_DIARIZATION", "true").lower() == "true"

QUEUE_NAME = "transcription_jobs"
FAILED_QUEUE = "transcription_jobs_failed"


def get_s3_client():
    """Create S3 client for MinIO."""
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name="us-east-1",
    )


def get_redis():
    """Create Redis connection."""
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)


def download_chunks(s3_client, bucket_keys: list[str], temp_dir: str) -> list[str]:
    """Download chunk files from MinIO to local temp directory."""
    paths = []
    for key in bucket_keys:
        local_path = os.path.join(temp_dir, os.path.basename(key))
        print(f"  Downloading: {key}")
        s3_client.download_file(MINIO_BUCKET, key, local_path)
        paths.append(local_path)
    return paths


def update_session_status(conn, session_id: str, status: str, **kwargs):
    """Update session status in DB."""
    extra_sets = ", ".join(f"{k} = %({k})s" for k in kwargs)
    if extra_sets:
        extra_sets = ", " + extra_sets
    conn.execute(
        f"UPDATE sessions SET status = %(status)s{extra_sets} WHERE id = %(session_id)s",
        {"status": status, "session_id": session_id, **kwargs},
    )
    conn.commit()


def save_transcript_segments(conn, session_id: str, segments: list[dict]):
    """Write transcript segments to DB."""
    for seg in segments:
        conn.execute(
            """
            INSERT INTO transcripts (session_id, speaker, text, start_time, end_time, language, avg_logprob, no_speech_prob, status)
            VALUES (%(session_id)s, %(speaker)s, %(text)s, %(start_time)s, %(end_time)s, %(language)s, %(avg_logprob)s, %(no_speech_prob)s, 'done')
            """,
            {
                "session_id": session_id,
                "speaker": seg.get("speaker"),
                "text": seg.get("text", ""),
                "start_time": seg.get("start"),
                "end_time": seg.get("end"),
                "language": seg.get("language"),
                "avg_logprob": seg.get("avg_logprob"),
                "no_speech_prob": seg.get("no_speech_prob"),
            },
        )
    conn.commit()
    print(f"  Saved {len(segments)} transcript segments to DB")


def process_job(job: dict):
    """
    Process a single transcription job:
    1. Download chunks from MinIO
    2. Assemble into single WAV
    3. Transcribe with Whisper
    4. Diarize for speaker identification
    5. Write results to DB
    """
    session_id = job["sessionId"]
    bucket_keys = job["bucketKeys"]

    print(f"\n{'='*60}")
    print(f"Processing session: {session_id}")
    print(f"  Chunks: {len(bucket_keys)}")

    s3_client = get_s3_client()

    with tempfile.TemporaryDirectory() as temp_dir:
        print("Step 1: Downloading chunks...")
        chunk_paths = download_chunks(s3_client, bucket_keys, temp_dir)

        print("Step 2: Assembling audio...")
        assembled_path = os.path.join(temp_dir, "assembled.wav")
        assemble_chunks(chunk_paths, assembled_path)
        duration = get_audio_duration(assembled_path)

        with psycopg.connect(DATABASE_URL) as conn:
            update_session_status(conn, session_id, "transcribing", total_duration=duration)

            assembled_key = f"recordings/{session_id}/assembled.wav"
            print(f"Step 3: Uploading assembled file ({duration:.1f}s)...")
            s3_client.upload_file(assembled_path, MINIO_BUCKET, assembled_key)
            conn.execute(
                "UPDATE sessions SET assembled_key = %(key)s WHERE id = %(id)s",
                {"key": assembled_key, "id": session_id},
            )
            conn.commit()

            print("Step 4: Transcribing with Whisper...")
            transcript_segments = transcribe(assembled_path)

            if not transcript_segments:
                print("  No speech detected — marking as silent")
                conn.execute(
                    """
                    INSERT INTO transcripts (session_id, text, status)
                    VALUES (%(session_id)s, '', 'silent')
                    """,
                    {"session_id": session_id},
                )
                conn.commit()
                update_session_status(conn, session_id, "done")
                return

            segments_data = [
                {
                    "text": seg.text,
                    "start": seg.start,
                    "end": seg.end,
                    "avg_logprob": seg.avg_logprob,
                    "no_speech_prob": seg.no_speech_prob,
                    "language": seg.language,
                    "speaker": None,
                }
                for seg in transcript_segments
            ]

            if ENABLE_DIARIZATION:
                print("Step 5: Running speaker diarization...")
                try:
                    speaker_segments = diarize(assembled_path)
                    segments_data = assign_speakers(segments_data, speaker_segments)
                    unique_speakers = set(s.get("speaker") for s in segments_data if s.get("speaker"))
                    print(f"  Identified {len(unique_speakers)} speaker(s)")
                except Exception as e:
                    print(f"  Diarization failed (continuing without): {e}")
            else:
                print("Step 5: Diarization disabled, assigning single speaker")
                for seg in segments_data:
                    seg["speaker"] = "Speaker 1"

            print("Step 6: Saving transcript...")
            save_transcript_segments(conn, session_id, segments_data)
            update_session_status(conn, session_id, "done")

    print(f"✅ Session {session_id} completed successfully")


def main():
    """Main worker loop — BRPOP from Redis, process jobs."""
    print("=" * 60)
    print("Transcription Worker Starting")
    print(f"  Redis: {REDIS_URL}")
    print(f"  MinIO: {MINIO_ENDPOINT}")
    print(f"  DB: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    print(f"  Diarization: {'enabled' if ENABLE_DIARIZATION else 'disabled'}")
    print("=" * 60)

    r = get_redis()

    print("\nPre-loading models...")
    from transcribe import get_model
    get_model()
    if ENABLE_DIARIZATION:
        from diarize import get_encoder
        get_encoder()
    print("Models loaded. Waiting for jobs...\n")

    while True:
        try:
            result = r.brpop(QUEUE_NAME, timeout=30)
            if result is None:
                continue

            _, raw = result
            job = json.loads(raw)

            try:
                process_job(job)
            except Exception as e:
                print(f"\nJob failed: {e}")
                traceback.print_exc()

                r.lpush(FAILED_QUEUE, json.dumps({
                    **job,
                    "error": str(e),
                }))

                try:
                    with psycopg.connect(DATABASE_URL) as conn:
                        update_session_status(conn, job.get("sessionId", ""), "failed")
                except Exception:
                    pass

        except KeyboardInterrupt:
            print("\nWorker shutting down...")
            break
        except Exception as e:
            print(f"Worker error: {e}")
            traceback.print_exc()


if __name__ == "__main__":
    main()

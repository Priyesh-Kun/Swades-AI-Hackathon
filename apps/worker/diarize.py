import numpy as np

if not hasattr(np, "bool"):
    np.bool = np.bool_

import soundfile as sf
from dataclasses import dataclass
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.cluster import SpectralClustering
from scipy.spatial.distance import cosine

WINDOW_SIZE = 1.5
WINDOW_STEP = 0.75
MIN_SPEAKERS = 1
MAX_SPEAKERS = 8

_encoder: VoiceEncoder | None = None


def get_encoder() -> VoiceEncoder:
    """Get or create the speaker encoder (singleton)."""
    global _encoder
    if _encoder is None:
        print("Loading speaker encoder...")
        _encoder = VoiceEncoder("cpu")
        print("Speaker encoder loaded")
    return _encoder


@dataclass
class SpeakerSegment:
    """A time range with a speaker label."""
    speaker: str
    start: float
    end: float


def extract_embeddings(audio_path: str) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """
    Extract speaker embeddings from fixed-size windows.

    Returns:
        embeddings: (N, D) array of speaker embeddings
        windows: list of (start, end) time tuples
    """
    wav = preprocess_wav(audio_path)
    encoder = get_encoder()

    duration = len(wav) / 16000
    windows = []
    embeddings = []

    t = 0.0
    while t + WINDOW_SIZE <= duration:
        start_sample = int(t * 16000)
        end_sample = int((t + WINDOW_SIZE) * 16000)
        segment = wav[start_sample:end_sample]

        if len(segment) > 0:
            embed = encoder.embed_utterance(segment)
            embeddings.append(embed)
            windows.append((t, t + WINDOW_SIZE))

        t += WINDOW_STEP

    if not embeddings:
        return np.array([]), []

    return np.array(embeddings), windows


def estimate_num_speakers(embeddings: np.ndarray) -> int:
    """
    Estimate optimal number of speakers using silhouette-like heuristic.
    Simple approach: try different k values and pick the best.
    """
    if len(embeddings) < 2:
        return 1

    from sklearn.metrics import silhouette_score

    best_k = 1
    best_score = -1

    max_k = min(MAX_SPEAKERS, len(embeddings) - 1)

    for k in range(2, max_k + 1):
        try:
            clustering = SpectralClustering(
                n_clusters=k,
                affinity="nearest_neighbors",
                n_neighbors=min(10, len(embeddings) - 1),
                random_state=42,
            )
            labels = clustering.fit_predict(embeddings)

            if len(set(labels)) < 2:
                continue

            score = silhouette_score(embeddings, labels)
            if score > best_score:
                best_score = score
                best_k = k
        except Exception:
            continue

    if best_score < 0.1:
        return 1

    print(f"Estimated {best_k} speakers (silhouette: {best_score:.3f})")
    return best_k


def diarize(audio_path: str, num_speakers: int | None = None) -> list[SpeakerSegment]:
    """
    Perform speaker diarization on an audio file.

    Args:
        audio_path: Path to WAV file (16kHz mono).
        num_speakers: Number of speakers. If None, auto-detected.

    Returns:
        List of speaker segments with time ranges.
    """
    embeddings, windows = extract_embeddings(audio_path)

    if len(embeddings) == 0:
        print("No embeddings extracted — returning single speaker")
        data, sr = sf.read(audio_path)
        duration = len(data) / sr
        return [SpeakerSegment(speaker="Speaker 1", start=0.0, end=duration)]

    if len(embeddings) < 2:
        return [SpeakerSegment(
            speaker="Speaker 1",
            start=windows[0][0],
            end=windows[0][1],
        )]

    if num_speakers is None:
        num_speakers = estimate_num_speakers(embeddings)

    if num_speakers <= 1:
        data, sr = sf.read(audio_path)
        duration = len(data) / sr
        return [SpeakerSegment(speaker="Speaker 1", start=0.0, end=duration)]

    clustering = SpectralClustering(
        n_clusters=num_speakers,
        affinity="nearest_neighbors",
        n_neighbors=min(10, len(embeddings) - 1),
        random_state=42,
    )
    labels = clustering.fit_predict(embeddings)

    segments: list[SpeakerSegment] = []
    current_speaker = None
    current_start = 0.0
    current_end = 0.0

    for i, (start, end) in enumerate(windows):
        speaker_label = f"Speaker {labels[i] + 1}"

        if speaker_label != current_speaker:
            if current_speaker is not None:
                segments.append(SpeakerSegment(
                    speaker=current_speaker,
                    start=current_start,
                    end=current_end,
                ))
            current_speaker = speaker_label
            current_start = start
        current_end = end

    if current_speaker is not None:
        segments.append(SpeakerSegment(
            speaker=current_speaker,
            start=current_start,
            end=current_end,
        ))

    print(f"Diarization: {len(segments)} segments, {num_speakers} speakers")
    return segments


def assign_speakers(
    transcript_segments: list[dict],
    speaker_segments: list[SpeakerSegment],
) -> list[dict]:
    """
    Assign speaker labels to transcript segments based on time overlap.

    Args:
        transcript_segments: List of dicts with 'start' and 'end' keys.
        speaker_segments: Output from diarize().

    Returns:
        transcript_segments with 'speaker' key added.
    """
    for tseg in transcript_segments:
        t_start = tseg["start"]
        t_end = tseg["end"]
        t_mid = (t_start + t_end) / 2

        best_speaker = "Speaker 1"
        best_overlap = 0.0

        for sseg in speaker_segments:
            overlap_start = max(t_start, sseg.start)
            overlap_end = min(t_end, sseg.end)
            overlap = max(0.0, overlap_end - overlap_start)

            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = sseg.speaker

        tseg["speaker"] = best_speaker

    return transcript_segments

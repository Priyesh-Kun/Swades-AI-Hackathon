import os
import struct
import tempfile

import numpy as np
import soundfile as sf


def assemble_chunks(chunk_paths: list[str], output_path: str | None = None) -> str:
    """
    Concatenate multiple WAV chunk files into a single WAV file.

    Args:
        chunk_paths: List of paths to WAV chunk files, in order.
        output_path: Optional output path. If None, creates a temp file.

    Returns:
        Path to the assembled WAV file.
    """
    if not chunk_paths:
        raise ValueError("No chunk paths provided")

    if output_path is None:
        fd, output_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)

    all_samples = []
    sample_rate = None

    for path in chunk_paths:
        data, sr = sf.read(path, dtype="float32")

        if sample_rate is None:
            sample_rate = sr
        elif sr != sample_rate:
            print(f"Warning: sample rate mismatch {sr} != {sample_rate} in {path}")

        if len(data.shape) > 1:
            data = data[:, 0]

        all_samples.append(data)

    if not all_samples or sample_rate is None:
        raise ValueError("No audio data found in chunks")

    combined = np.concatenate(all_samples)
    sf.write(output_path, combined, sample_rate)

    total_duration = len(combined) / sample_rate
    print(f"Assembled {len(chunk_paths)} chunks → {total_duration:.1f}s ({output_path})")

    return output_path


def get_audio_duration(path: str) -> float:
    """Get duration of an audio file in seconds."""
    data, sr = sf.read(path)
    return len(data) / sr

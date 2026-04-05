import os
from dataclasses import dataclass

from faster_whisper import WhisperModel

HALLUCINATION_LOGPROB_THRESHOLD = -1.5
NO_SPEECH_THRESHOLD = 0.7

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

INITIAL_PROMPT = os.environ.get(
    "WHISPER_INITIAL_PROMPT",
    "This is a recording of a conversation or presentation. "
    "Transcribe all speech accurately, including proper nouns, names, "
    "and technical terms."
)

_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    """Get or create the Whisper model (singleton)."""
    global _model
    if _model is None:
        print(f"Loading Whisper model: {WHISPER_MODEL} ({WHISPER_DEVICE}/{WHISPER_COMPUTE_TYPE})")
        _model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)
        print("Model loaded successfully")
    return _model


@dataclass
class TranscriptSegment:
    """A single transcribed segment with timing."""
    text: str
    start: float 
    end: float   
    avg_logprob: float
    no_speech_prob: float
    language: str


def transcribe(audio_path: str) -> list[TranscriptSegment]:
    """
    Transcribe an audio file with VAD filtering and hallucination guards.

    Args:
        audio_path: Path to the WAV file to transcribe.

    Returns:
        List of filtered transcript segments.
    """
    model = get_model()

    segments_iter, info = model.transcribe(
        audio_path,
        vad_filter=True,
        vad_parameters={
            "min_speech_duration_ms": 250,
            "max_speech_duration_s": 30,
        },
        language=None,                       
        beam_size=5,
        best_of=5,
        temperature=[0, 0.2, 0.4, 0.6],     
        condition_on_previous_text=True,     
        word_timestamps=True,                
        initial_prompt=INITIAL_PROMPT,       
        no_speech_threshold=NO_SPEECH_THRESHOLD,
        log_prob_threshold=HALLUCINATION_LOGPROB_THRESHOLD,
    )

    detected_language = info.language
    print(f"Detected language: {detected_language} (prob: {info.language_probability:.2f})")

    result: list[TranscriptSegment] = []

    for seg in segments_iter:
        text = seg.text.strip()
        if not text:
            continue

        if len(result) > 0 and text == result[-1].text and len(text) < 20:
            print(f"  Skipping repeated segment: '{text}'")
            continue

        result.append(TranscriptSegment(
            text=text,
            start=seg.start,
            end=seg.end,
            avg_logprob=seg.avg_logprob,
            no_speech_prob=seg.no_speech_prob,
            language=detected_language,
        ))

    print(f"Transcribed: {len(result)} segments ({sum(len(s.text) for s in result)} chars)")
    return result

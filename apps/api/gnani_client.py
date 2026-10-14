"""Minimal Gnani REST client with a mock mode.

Endpoints (docs.gnani.ai, checked 2026-10-14):
- STT REST:  POST https://api.vachana.ai/stt/v3  (multipart: audio_file, language_code, format, ...)
- TTS REST:  POST https://api.vachana.ai/api/v1/tts/inference  (JSON: text, voice, model, language, audio_config)
Auth header: X-API-Key-ID. A real User-Agent is set because Cloudflare blocks the default Python one.
"""

from __future__ import annotations

import json
import os
import wave
from dataclasses import dataclass
from pathlib import Path

import requests

from .ledger import Ledger

BASE = "https://api.vachana.ai"
USER_AGENT = "sehat-diary/0.1 (+https://github.com/gativarshney/sehat-diary)"


def wav_duration_seconds(path: str | Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


@dataclass
class STTResult:
    transcript: str
    request_id: str | None
    raw: dict
    mock: bool


class GnaniClient:
    def __init__(self, api_key: str | None = None, mode: str | None = None, ledger: Ledger | None = None,
                 mock_transcripts: dict[str, str] | None = None):
        self.mode = (mode or os.getenv("GNANI_MODE", "mock")).lower()
        self.api_key = api_key or os.getenv("GNANI_API_KEY", "")
        self.ledger = ledger or Ledger()
        self.mock_transcripts = mock_transcripts or {}
        if self.mode == "live" and not self.api_key:
            raise RuntimeError("GNANI_MODE=live but GNANI_API_KEY is empty")

    # ---- STT -------------------------------------------------------------
    def transcribe_file(self, path: str | Path, language_code: str = "hi-IN", fmt: str = "transcribe",
                        itn_native_numerals: bool = False, bias_list: list[str] | None = None,
                        bias_score: float | None = None, purpose: str = "stt") -> STTResult:
        path = Path(path)
        seconds = wav_duration_seconds(path) if path.suffix.lower() == ".wav" else 10.0
        if self.mode != "live":
            text = self.mock_transcripts.get(path.stem, f"[mock transcript for {path.name}]")
            return STTResult(text, "mock", {"success": True, "transcript": text, "mock": True}, True)
        self.ledger.reserve("stt_seconds", seconds)
        data = {"language_code": language_code, "format": fmt, "itn_native_numerals": str(itn_native_numerals).lower()}
        if bias_list:
            data["bias_list"] = json.dumps(bias_list)
            data["bias_score"] = str(bias_score if bias_score is not None else 1.0)
        with path.open("rb") as f:
            r = requests.post(
                f"{BASE}/stt/v3",
                headers={"X-API-Key-ID": self.api_key, "User-Agent": USER_AGENT},
                files={"audio_file": (path.name, f, "audio/wav")},
                data=data,
                timeout=60,
            )
        self.ledger.record(purpose, "/stt/v3", "stt_seconds", seconds, note=f"{path.name} status={r.status_code}")
        try:
            body = r.json()
        except ValueError:
            body = {"success": False, "status": r.status_code, "text": r.text[:500]}
        if r.status_code != 200 or not body.get("success", False):
            raise RuntimeError(f"STT failed {r.status_code}: {body}")
        return STTResult(body.get("transcript", ""), body.get("request_id"), body, False)

    # ---- TTS -------------------------------------------------------------
    def synthesize(self, text: str, voice: str = "Nalini", model: str = "timbre-v2.5", language: str = "hi-IN",
                   speed: float = 1.0, sample_rate: int = 16000, purpose: str = "tts") -> bytes:
        if self.mode != "live":
            return b"RIFF-mock-wav:" + text.encode("utf-8")
        self.ledger.reserve("tts_chars", len(text))
        r = requests.post(
            f"{BASE}/api/v1/tts/inference",
            headers={"X-API-Key-ID": self.api_key, "User-Agent": USER_AGENT, "Content-Type": "application/json"},
            json={
                "text": text, "voice": voice, "model": model, "language": language, "speed": speed,
                "audio_config": {"sample_rate": sample_rate, "num_channels": 1, "sample_width": 2,
                                 "encoding": "linear_pcm", "container": "wav"},
            },
            timeout=60,
        )
        self.ledger.record(purpose, "/api/v1/tts/inference", "tts_chars", len(text), note=f"voice={voice} status={r.status_code}")
        if r.status_code != 200:
            raise RuntimeError(f"TTS failed {r.status_code}: {r.text[:300]}")
        return r.content

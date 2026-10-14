"""Sehat Diary API: thin, key-holding proxy in front of Gnani plus the deterministic parser.

Endpoints
  GET  /healthz
  POST /api/stt      multipart audio (wav, <= 25 s) -> {transcript, request_id, mock}
  POST /api/parse    {text} -> parse result (numbers, bp, doubt, reasons, is_correction)
  POST /api/tts      {text, voice?, model?, language?} -> audio/wav (cached on disk by content hash)
  GET  /api/ledger   {cumulative_est_credits, max_credits, mode}

Mock mode (default) never touches the network. In mock mode /api/stt accepts an optional
`mock_text` form field so the UI can be exercised without credits; without it, it returns a
fixed sample transcript.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import wave
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages"))
load_dotenv(ROOT / ".env")

from hinglish_numbers import parse_numbers  # noqa: E402

from .gnani_client import GnaniClient  # noqa: E402
from .ledger import CreditCapExceeded, Ledger  # noqa: E402

MAX_CLIP_SECONDS = 25.0
SAMPLE_MOCK_TRANSCRIPT = "बीपी एक सौ अट्ठाईस बाय बयासी"
CACHE_DIR = Path(os.getenv("SEHAT_CACHE_DIR", ROOT / ".cache" / "tts"))
LEDGER_PATH = Path(os.getenv("SEHAT_LEDGER_PATH", ROOT / ".cache" / "ledger.csv"))


class ParseIn(BaseModel):
    text: str


class TTSIn(BaseModel):
    text: str
    voice: str = os.getenv("SEHAT_TTS_VOICE", "Nalini")
    model: str = os.getenv("SEHAT_TTS_MODEL", "timbre-v2.5")
    language: str = os.getenv("SEHAT_TTS_LANGUAGE", "hi-IN")


def build_app(client: GnaniClient | None = None) -> FastAPI:
    app = FastAPI(title="Sehat Diary API", version="0.1.0")
    origins = [o.strip() for o in os.getenv("SEHAT_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    app.state.client = client or GnaniClient(ledger=Ledger(LEDGER_PATH))

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "mode": app.state.client.mode}

    @app.get("/api/ledger")
    def ledger():
        led = app.state.client.ledger
        return {"cumulative_est_credits": round(led.cumulative, 5), "max_credits": led.max_credits, "mode": app.state.client.mode}

    @app.post("/api/parse")
    def parse(body: ParseIn):
        r = parse_numbers(body.text)
        return {
            "text": body.text,
            "values": r.values(),
            "numbers": [{"value": c.value, "source": c.source, "span": list(c.span)} for c in r.numbers],
            "bp": list(r.bp) if r.bp else None,
            "doubt": r.doubt,
            "reasons": r.reasons,
            "is_correction": r.is_correction,
        }

    @app.post("/api/stt")
    async def stt(audio: UploadFile = File(...), mock_text: str | None = Form(default=None),
                  language_code: str = Form(default="hi-IN")):
        data = await audio.read()
        if len(data) > 2_000_000:
            raise HTTPException(413, "clip too large")
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(data)
            path = Path(tmp.name)
        try:
            try:
                with wave.open(str(path), "rb") as w:
                    seconds = w.getnframes() / float(w.getframerate())
            except wave.Error:
                raise HTTPException(400, "audio must be a WAV file")
            if seconds > MAX_CLIP_SECONDS:
                raise HTTPException(400, f"clip longer than {MAX_CLIP_SECONDS:.0f} s")
            client: GnaniClient = app.state.client
            if client.mode != "live":
                return {"transcript": mock_text or SAMPLE_MOCK_TRANSCRIPT, "request_id": "mock", "mock": True, "seconds": seconds}
            try:
                r = client.transcribe_file(path, language_code=language_code, purpose="api-stt")
            except CreditCapExceeded as e:
                raise HTTPException(402, str(e))
            except RuntimeError as e:
                raise HTTPException(502, str(e))
            return {"transcript": r.transcript, "request_id": r.request_id, "mock": False, "seconds": seconds}
        finally:
            path.unlink(missing_ok=True)

    @app.post("/api/tts")
    def tts(body: TTSIn):
        client: GnaniClient = app.state.client
        key = hashlib.sha256(f"{body.model}|{body.voice}|{body.language}|{body.text}".encode("utf-8")).hexdigest()
        cached = CACHE_DIR / f"{key}.wav"
        if cached.exists():
            return Response(cached.read_bytes(), media_type="audio/wav", headers={"X-Cache": "hit"})
        try:
            audio = client.synthesize(body.text, voice=body.voice, model=body.model, language=body.language, purpose="api-tts")
        except CreditCapExceeded as e:
            raise HTTPException(402, str(e))
        except RuntimeError as e:
            raise HTTPException(502, str(e))
        if client.mode == "live":
            cached.write_bytes(audio)
        return Response(audio, media_type="audio/wav", headers={"X-Cache": "miss", "X-Mock": str(client.mode != "live").lower()})

    return app


app = build_app()

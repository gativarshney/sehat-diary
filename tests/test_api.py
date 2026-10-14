import io
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.gnani_client import GnaniClient  # noqa: E402
from apps.api.ledger import Ledger  # noqa: E402
from apps.api.main import build_app  # noqa: E402


def wav_bytes(seconds: float, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


def make_client(tmp_path):
    app = build_app(GnaniClient(mode="mock", ledger=Ledger(tmp_path / "l.csv")))
    return TestClient(app)


def test_health_and_ledger(tmp_path):
    c = make_client(tmp_path)
    assert c.get("/healthz").json() == {"ok": True, "mode": "mock"}
    led = c.get("/api/ledger").json()
    assert led["cumulative_est_credits"] == 0 and led["mode"] == "mock"


def test_parse_endpoint(tmp_path):
    c = make_client(tmp_path)
    r = c.post("/api/parse", json={"text": "sugar fasting dedh sau"}).json()
    assert r["values"] == [150.0] and r["doubt"] is True and "fraction word" in r["reasons"]
    r2 = c.post("/api/parse", json={"text": "BP ek sau atthais by bayasi"}).json()
    assert r2["bp"] == [128.0, 82.0] and r2["doubt"] is False


def test_stt_mock_uses_mock_text(tmp_path):
    c = make_client(tmp_path)
    r = c.post("/api/stt", files={"audio": ("a.wav", wav_bytes(2.0), "audio/wav")}, data={"mock_text": "शुगर सवा सौ"})
    assert r.status_code == 200
    body = r.json()
    assert body["mock"] is True and body["transcript"] == "शुगर सवा सौ" and abs(body["seconds"] - 2.0) < 0.01


def test_stt_rejects_long_or_non_wav(tmp_path):
    c = make_client(tmp_path)
    r = c.post("/api/stt", files={"audio": ("a.wav", wav_bytes(26.0), "audio/wav")})
    assert r.status_code == 400
    r2 = c.post("/api/stt", files={"audio": ("a.wav", b"not a wav", "audio/wav")})
    assert r2.status_code == 400


def test_tts_mock_returns_audio_without_credits(tmp_path):
    c = make_client(tmp_path)
    r = c.post("/api/tts", json={"text": "नमस्ते"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav")
    assert r.headers["X-Mock"] == "true"
    assert c.get("/api/ledger").json()["cumulative_est_credits"] == 0

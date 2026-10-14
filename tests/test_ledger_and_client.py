import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402

from apps.api.gnani_client import GnaniClient  # noqa: E402
from apps.api.ledger import CreditCapExceeded, Ledger  # noqa: E402


def test_ledger_estimates_and_cap(tmp_path):
    led = Ledger(tmp_path / "l.csv", max_credits=1.0)
    assert led.estimate("stt_seconds", 60) == pytest.approx(0.45)
    assert led.estimate("tts_chars", 370) == pytest.approx(0.999)
    led.record("t", "/stt/v3", "stt_seconds", 60)
    assert led.cumulative == pytest.approx(0.45)
    led.reserve("stt_seconds", 60)  # 0.90 total ok
    with pytest.raises(CreditCapExceeded):
        led.reserve("stt_seconds", 100)
    # persisted and reloaded
    assert Ledger(tmp_path / "l.csv", max_credits=1.0).cumulative == pytest.approx(0.45)


def test_mock_client_makes_no_network_calls(tmp_path, monkeypatch):
    monkeypatch.setattr("requests.post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network call in mock mode")))
    c = GnaniClient(mode="mock", ledger=Ledger(tmp_path / "l.csv"), mock_transcripts={"x": "एक सौ बीस"})
    wav = tmp_path / "x.wav"
    import wave

    with wave.open(str(wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    r = c.transcribe_file(wav)
    assert r.mock and r.transcript == "एक सौ बीस"
    assert c.synthesize("नमस्ते").startswith(b"RIFF-mock")
    assert c.ledger.cumulative == 0.0


def test_live_mode_requires_key(monkeypatch, tmp_path):
    monkeypatch.delenv("GNANI_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        GnaniClient(mode="live", api_key="", ledger=Ledger(tmp_path / "l.csv"))

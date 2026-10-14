"""E-min runner. Mock by default; `--live` requires GNANI_MODE=live and a key, and is capped.

Usage:
  python bench/emin/run_emin.py            # mock: uses the scripted Devanagari text as the 'transcript'
  python bench/emin/run_emin.py --live     # real calls, after explicit approval
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "packages"))

from apps.api.gnani_client import GnaniClient  # noqa: E402
from apps.api.ledger import Ledger  # noqa: E402
from hinglish_numbers import parse_numbers  # noqa: E402

HERE = Path(__file__).resolve().parent


def load_cases() -> tuple[list[dict], dict]:
    data = yaml.safe_load((HERE / "cases.yaml").read_text(encoding="utf-8"))
    cases = [c for c in data if isinstance(c, dict) and "id" in c]
    tts = next((c["tts_checks"] for c in data if isinstance(c, dict) and "tts_checks" in c), {})
    return cases, tts


def score(case: dict, transcript: str) -> dict:
    res = parse_numbers(transcript)
    values = res.values()
    expect = [float(x) for x in case["expect"]]
    kind = case["kind"]
    tier = "unrecoverable"
    if kind == "none":
        tier = "tier1" if not values else "unrecoverable"
    elif kind == "correction":
        tier = "tier1" if res.is_correction and values[:1] == expect else ("tier2" if values[:1] == expect else "unrecoverable")
    elif kind == "bp":
        got = list(res.bp) if res.bp else values[:2]
        if got == expect and not res.doubt:
            tier = "tier1"
        elif got == expect or (set(expect) <= set(values)):
            tier = "tier2"
    else:
        if values[:1] == expect and not res.doubt:
            tier = "tier1"
        elif expect and expect[0] in values:
            tier = "tier2"
    silent_error = tier == "unrecoverable" and bool(values) and not res.doubt and kind != "none"
    return {
        "id": case["id"], "kind": kind, "expect": expect, "transcript": transcript,
        "values": values, "bp": res.bp, "doubt": res.doubt, "reasons": res.reasons,
        "is_correction": res.is_correction, "tier": tier, "silent_error": silent_error,
    }


def main() -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252; Devanagari needs UTF-8
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--max-credits", type=float, default=2.0)
    ap.add_argument("--skip-tts", action="store_true")
    args = ap.parse_args()
    load_dotenv(ROOT / ".env")

    cases, tts = load_cases()
    audio_dir = HERE / "audio"
    results_dir = HERE / "results"
    results_dir.mkdir(exist_ok=True)
    ledger = Ledger(results_dir / "ledger.csv", max_credits=args.max_credits)
    mock = {c["id"]: c["script_dev"] for c in cases}
    client = GnaniClient(mode="live" if args.live else "mock", ledger=ledger, mock_transcripts=mock)

    if args.live:
        missing = [c["id"] for c in cases if not (audio_dir / f"{c['id']}.wav").exists()]
        if missing:
            print("missing recordings:", ", ".join(missing))
            return 2

    rows = []
    for c in cases:
        wav = audio_dir / f"{c['id']}.wav"
        if args.live:
            r = client.transcribe_file(wav, purpose="emin")
            transcript, raw = r.transcript, r.raw
        else:
            transcript, raw = mock[c["id"]], {"mock": True}
        row = score(c, transcript)
        row["raw"] = raw
        rows.append(row)
        print(f"{row['id']:<18} {row['tier']:<14} doubt={row['doubt']!s:<5} values={row['values']} | {transcript}")

    recoverable = sum(1 for r in rows if r["tier"] in ("tier1", "tier2"))
    silent = sum(1 for r in rows if r["silent_error"])
    print(f"\nrecoverable: {recoverable}/12   tier1: {sum(r['tier']=='tier1' for r in rows)}   silent errors: {silent}")
    decision = "proceed" if recoverable >= 9 else ("confirm-all mode" if recoverable >= 6 else "fallback: appointment line")
    print("decision rule ->", decision)

    if args.live and not args.skip_tts and tts:
        for v in tts.get("voices", []):
            audio = client.synthesize(tts["text"], voice=v["voice"], model=v["model"], language=v["language"], purpose="emin-tts")
            out = results_dir / f"tts_{v['voice']}.wav"
            out.write_bytes(audio)
            print(f"tts {v['voice']}: {len(audio)} bytes -> {out.name}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (results_dir / f"emin_{'live' if args.live else 'mock'}_{stamp}.json").write_text(
        json.dumps({"rows": rows, "recoverable": recoverable, "silent_errors": silent, "decision": decision,
                    "ledger_cumulative_est_credits": ledger.cumulative}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

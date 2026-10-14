"""Local credit ledger with a hard cap. Every live Gnani call is recorded here.

Rates default to values derived from the dashboard headline on 2026-10-14
(5,000 credits = ~11,100 STT minutes or ~1,850,000 TTS characters). They are
estimates until confirmed by observed balance deltas.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class CreditCapExceeded(RuntimeError):
    pass


@dataclass
class Rates:
    per_stt_second: float = float(os.getenv("GNANI_CREDITS_PER_STT_SECOND", "0.0075"))
    per_tts_char: float = float(os.getenv("GNANI_CREDITS_PER_TTS_CHAR", "0.0027"))


class Ledger:
    FIELDS = ["ts", "purpose", "endpoint", "units", "unit_kind", "est_credits", "cumulative", "note"]

    def __init__(self, path: str | Path = "ledger.csv", max_credits: float | None = None, rates: Rates | None = None):
        self.path = Path(path)
        self.max_credits = max_credits if max_credits is not None else float(os.getenv("GNANI_MAX_CREDITS", "2"))
        self.rates = rates or Rates()
        self.cumulative = self._load_cumulative()

    def _load_cumulative(self) -> float:
        if not self.path.exists():
            return 0.0
        total = 0.0
        with self.path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                total += float(row.get("est_credits") or 0)
        return total

    def estimate(self, unit_kind: str, units: float) -> float:
        if unit_kind == "stt_seconds":
            return units * self.rates.per_stt_second
        if unit_kind == "tts_chars":
            return units * self.rates.per_tts_char
        raise ValueError(unit_kind)

    def reserve(self, unit_kind: str, units: float) -> float:
        """Check the cap before a call. Raises if the estimate would exceed it."""
        est = self.estimate(unit_kind, units)
        if self.cumulative + est > self.max_credits:
            raise CreditCapExceeded(
                f"estimated {est:.4f} credits would push cumulative {self.cumulative:.4f} past cap {self.max_credits}"
            )
        return est

    def record(self, purpose: str, endpoint: str, unit_kind: str, units: float, note: str = "") -> float:
        est = self.estimate(unit_kind, units)
        self.cumulative += est
        new = not self.path.exists()
        with self.path.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=self.FIELDS)
            if new:
                w.writeheader()
            w.writerow({
                "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "purpose": purpose,
                "endpoint": endpoint,
                "units": f"{units:.3f}",
                "unit_kind": unit_kind,
                "est_credits": f"{est:.5f}",
                "cumulative": f"{self.cumulative:.5f}",
                "note": note,
            })
        return est

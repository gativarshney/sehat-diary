# Evaluation method (public); results are private

Sehat Diary's claim is narrow and testable: **a deterministic Hinglish number parser plus a doubt detector lets the app confirm only the values it is likely to have misheard, so the recorded value is right more often without asking about everything.**

Result numbers are shared with Gnani AI in the challenge submission and are not published here, in line with Gnani's terms on disclosing performance information. Everything needed to reproduce them is in this repository.

## Tiers
1. **E-min (feasibility, 12 utterances).** Pre-registered in `bench/emin/PROTOCOL.md` and `cases.yaml` before any audio was sent. One speaker, quiet room. Decision rule fixed in advance: 9+ recoverable proceed; 6 to 8 confirm-all mode; under 6 switch product. Run once with `npm run emin -- --live`.
2. **Tier A (60 utterances x 4 conditions).** `bench/tier-a/cases.yaml` fixes ground truth before recording. Conditions are generated deterministically from the clean recordings by `bench/impair.ts` (clean; domestic noise at roughly 10 dB SNR; street-like noise at roughly 0 dB; 300 to 3400 Hz narrowband). Transcripts are cached by audio hash so each clip is sent once. `npm run tier-a -- --speaker S1 --live`.
3. **Daily use log.** The author's own household use (synthetic names), reported as counts: entries per day, confirmations, corrections, failures.
4. **Voluntary participants.** Family or friends with written consent, reported only as counts.

## Metrics (per condition)
- **Field accuracy before confirmation:** parsed value equals ground truth exactly.
- **Doubt precision:** of the values the app would ask about, the share that were actually wrong.
- **Doubt recall:** of the wrong values, the share the app flagged.
- **Unnecessary confirmation rate:** right values the app still asked about (friction).
- **Silent error rate:** wrong values the app did not flag (the failure that matters most).
- **Field accuracy after one correction turn:** assumes a flagged value is fixed by one spoken correction; silent errors remain.

## Baseline
A naive digit regex over the raw transcript, with no Hindi number words, no fraction words, and no doubt detection: what a thin API wrapper would do.

## Limitations stated up front
Noida Hindi, one to three adult voices, synthetic noise rather than field recordings, simulated correction turns, no children or very elderly speakers unless they volunteer, no clinical validation, no comparison with other vendors. The doubt detector is a heuristic, not a calibrated probability; it is tuned on E-min and evaluated on Tier A, and that separation is kept.

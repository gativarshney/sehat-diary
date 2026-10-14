# E-min: pre-registered feasibility test for Hinglish numeric capture

**Status:** pre-registered on 2026-10-14. No audio has been sent. This file and `cases.yaml` must be committed before any live call, and must not be edited after results exist (append an "Amendments" section instead).

## Hypothesis
Gnani Prisma v2.5 (`hi-IN`, `format=transcribe`) returns spoken Hinglish health numbers in a form from which a deterministic parser can recover the intended value, directly or via a single confirmation turn, for at least 9 of 12 pre-registered utterances recorded by one adult speaker in a quiet room.

## Cases
Twelve utterances in `cases.yaml`, each with: id, the exact Hinglish script to speak, the expected value(s), the reading type, and whether the case is expected to be ambiguous. Coverage: four blood-pressure forms (by, bata, upar/neeche, bare pair), four fraction words (dedh, dhai, sawa, paune), two spoken decimals (point, dashamlav), one correction phrase, one out-of-domain sentence.

## Recording
- Speaker: Gati, own voice, quiet room, laptop or phone microphone, natural pace.
- Format: WAV, 16 kHz, mono, 16-bit, 3 to 8 seconds, one utterance per file named `<id>.wav` in `bench/emin/audio/` (gitignored).
- Each utterance is read exactly as scripted. If a take is fluffed, re-record before sending; never after seeing a result.

## Calls
- 12 x `POST /stt/v3` with `language_code=hi-IN`, `format=transcribe`, `itn_native_numerals=false`, no bias list.
- 2 x `POST /api/v1/tts/inference` with a fixed read-back sentence (about 60 characters) in two voices, to confirm the TTS path and cost. These do not affect the hypothesis.
- Estimated cost: about 60 s of STT (about 0.45 credits) and about 120 TTS characters (about 0.3 credits) at the dashboard-derived rates. Hard cap for the run: 2 credits.

## Definition of "recoverable" (fixed in advance)
For each case, the raw transcript is saved verbatim, then the committed v0 parser is run.
- **Tier 1, direct:** the parser's first candidate(s) equal the expected value(s) exactly.
- **Tier 2, recoverable via confirmation:** the expected value is among the parser's candidates or the parser flags doubt and the expected value can be obtained by one spoken correction of a single field. For the correction case, "recoverable" means the parser marks the utterance as a correction and extracts 128.
- **Unrecoverable:** the expected value is absent from the candidates, or the parser recovers a different plausible value without flagging doubt (silent error).
- For the out-of-domain case, success means no numeric value is extracted.
A case is "recoverable" if it is Tier 1 or Tier 2.

## Decision rule (fixed in advance)
- 9 to 12 recoverable: proceed with Sehat Diary.
- 6 to 8: proceed, but confirm every value (confirm-all mode) until the parser improves; re-test later.
- 0 to 5: stop; switch to the appointment-line fallback.
Silent errors are reported separately and count against the hypothesis regardless of the tally.

## Reporting
All 12 raw transcripts, parser outputs and tiers are recorded in `bench/emin/results/` (private, gitignored) and summarised in the lab ledger. Results are shared with Gnani in the submission, not published. Failures are reported in full.

## Amendments
(none)

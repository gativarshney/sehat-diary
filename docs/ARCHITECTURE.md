# Architecture and design decisions

## The one idea
Make uncertainty visible. A spoken number in Hinglish becomes a record only after the app has decided whether it is sure; if it is not, it reads the value back in a Hindi voice and takes a one-phrase correction. The original transcript is always shown next to the final record.

## Pipeline
```
browser mic -> AudioWorklet -> 16 kHz PCM -> (optional phone-mode degrade) -> WAV
   -> POST /api/stt (server-side key) -> Gnani Prisma v2.5 (REST /stt/v3, hi-IN, format=transcribe)
   -> transcript -> hinglish-numbers parser (deterministic) -> values + doubt + reasons
   -> doubt ? read back via Gnani Timbre (POST /api/tts, cached) and listen for haan / nahi X : save
   -> IndexedDB (offline-first) -> history, 14-day trend lines, CSV export
```
The daily check-in runs the same loop inside a small state machine (`apps/web/src/lib/checkin.ts`): ask, listen, parse, confirm only if doubtful, next question. Half-duplex by design; the Gnani TTS WebSocket documents no cancel message, so barge-in would be client-side playback stop plus socket close and is left as a stretch goal.

## Why no language model in the core path
A reading is a number. A model that can paraphrase can also hallucinate a digit. The parser is a few hundred lines of rules that can be read in one sitting, tested exhaustively, and explained in an interview. Doubt comes from structure (fraction words, bare pairs, spoken decimals, more than two numbers), not from a confidence score the API does not provide.

## Why REST per turn rather than streaming
Prisma's realtime WebSocket returns one final transcript per VAD segment; it adds latency management and framing constraints without changing what the parser receives for a three-second utterance. REST clips under 25 seconds are simpler, cacheable and cheaper to test. Streaming remains an option behind the same `/api/stt` contract.

## Credit safety on a public URL
Every Gnani call goes through a ledger with a hard cap (`GNANI_MAX_CREDITS`), a per-visitor hourly limit, content-hashed TTS caching, and a mock mode that the public sample path uses so visitors can try the flow without spending anything. The key never leaves the server.

## What is deliberately not here
Thresholds, alerts, advice, colour-coded clinical interpretation. The app records, confirms, corrects and shows history for a family to share with their doctor.

## Evaluation
See `METHOD.md`. Results are private to Gnani AI; method and scripts are public.

## Layout
- `packages/hinglish-numbers`: parser (Devanagari and Roman cardinals, sau/hazaar, dedh/dhai/sawa/paune/aadha, decimals, BP separators, correction prefixes) with tests.
- `apps/api`: Hono on Node; `/api/stt`, `/api/parse`, `/api/tts`, `/api/ledger`, `/healthz`; ledger, rate limiter, WAV header reader, Gnani client with mock mode.
- `apps/web`: Vite + React PWA; recorder, phone mode, capture, check-in, history, trend, recorders for benchmark sets.
- `bench`: pre-registered E-min, Tier A cases, impairment generator, runner and scoring.

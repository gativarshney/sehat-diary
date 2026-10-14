# Sehat Diary

A Hinglish voice record-keeper for an elderly family member's home readings (blood pressure, blood sugar, weight, medicines).

Its one defining behaviour: when it is not sure it heard a number correctly, it says so. It reads back only the doubtful value in a Hindi voice, takes a one-phrase spoken correction, and shows what it heard next to what it recorded. Uncertainty is made visible instead of being silently written into a record.

Built for the Great Indian AI Internship Challenge 2026 on Gnani AI's speech models:

- Gnani Prisma v2.5 speech-to-text (REST `/stt/v3`, `format=transcribe`, word boosting)
- Gnani Timbre text-to-speech (REST `/api/v1/tts/inference`)

## What it is not

It is not a medical device and gives no advice, thresholds or interpretation. It records, confirms, corrects and keeps history for the family to share with their doctor. All demo data is synthetic.

## Layout (TypeScript monorepo, npm workspaces)

```
packages/hinglish-numbers/   Deterministic Hindi/Hinglish number parser with a doubt flag (shared by API and web)
apps/api/                    Hono API on Node: key-holding proxy to Gnani, parse endpoint, cached TTS, credit ledger, mock mode
apps/web/                    Vite + React PWA: push-to-talk capture, doubt-aware read-back, local history, E-min recorder
bench/emin/                  Pre-registered 12-utterance feasibility test (protocol, cases, runner)
```

## Development

```bash
npm install
npm test                 # parser + API tests, no network
npm run dev:api          # http://localhost:8000 (mock mode by default)
npm run dev:web          # http://localhost:5173 (proxies /api to the API)
npm run emin             # E-min runner in mock mode; --live only after approval
```

Copy `.env.example` to `.env` for live mode. Live calls require `GNANI_MODE=live`, a key in `.env`, and an explicit `--live` flag on scripts. Every live call is logged to a local ledger with an estimated credit cost and refused beyond `GNANI_MAX_CREDITS`.

## Evaluation and disclosure

Accuracy and latency measurements are kept private and shared with Gnani AI in the challenge submission, in line with Gnani's terms. The evaluation method and scripts are public; result numbers are not.

Built solo by Gati Varshney. Claude Code was used as a coding and research assistant; all design decisions, integration and testing are the author's.

## Licence

MIT

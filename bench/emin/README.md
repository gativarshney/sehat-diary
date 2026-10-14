# E-min

Pre-registered feasibility test. Read `PROTOCOL.md` first; `cases.yaml` is the canonical case list and `cases.ts` mirrors it for the runner.

## Recording the 12 clips (no credits)

1. Start the web app (`npm run dev:web`) and open `http://localhost:5173/#/record-emin`.
2. Record each line exactly as written, in a quiet room, at a natural pace (3 to 8 seconds).
3. Click "Download all recorded" and move the 12 files into `bench/emin/audio/` (gitignored). File names must match the case ids (`bp_by.wav` and so on).

## Running

```bash
npm run emin                 # mock scoring; no network
npm run emin -- --live       # 12 STT calls + 2 TTS calls, about 1 credit; only after approval
```

Results are written to `bench/emin/results/` (gitignored). Report every result, including failures.

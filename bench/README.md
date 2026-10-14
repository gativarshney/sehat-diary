# Benchmarks

This folder holds the evaluation method and scripts. **Result numbers are not published** in this repository, in line with Gnani's terms on disclosing performance information; they are shared with Gnani AI in the challenge submission.

- `emin/`: pre-registered 12-utterance feasibility test (protocol, cases, runner).
- `impair.ts`: deterministic impairment generator (clean, domestic, street, narrowband) using ffmpeg's seeded noise sources. Usage: `npx tsx bench/impair.ts bench/emin/audio bench/emin/impaired`.
- `tier-a/` (planned): 60-utterance set with pre-registered ground truth, run once per condition and cached.

Everything under `**/audio/`, `**/impaired/`, `**/results/` is gitignored: recordings are personal data and results are private.

/**
 * Impairment generator for the private benchmark (Tier A).
 *
 * Renders each clean WAV into four conditions using ffmpeg, deterministically:
 *   clean      : as recorded (16 kHz mono)
 *   domestic   : synthetic household noise bed mixed at ~10 dB SNR
 *   street     : synthetic street-like noise bed mixed at ~0 dB SNR
 *   narrowband : 8 kHz band-limited (300-3400 Hz) and resampled back to 16 kHz, approximating a phone line
 *
 * Noise beds are synthesised with ffmpeg's anoisesrc (seeded) so the set is reproducible without
 * external recordings. No result numbers are produced here; see bench/README.md for disclosure policy.
 *
 *   npx tsx bench/impair.ts <inDir> <outDir>
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [, , inDir, outDir] = process.argv
if (!inDir || !outDir) {
  console.error('usage: tsx bench/impair.ts <inDir> <outDir>')
  process.exit(2)
}

export const CONDITIONS = ['clean', 'domestic', 'street', 'narrowband'] as const
export type Condition = (typeof CONDITIONS)[number]

/** ffmpeg filter graph per condition; input [0:a] is the clean clip. */
function filterFor(cond: Condition, seed: number): string {
  switch (cond) {
    case 'clean':
      return 'aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono'
    case 'domestic':
      // brown noise, low-passed (fan/fridge/kitchen hum), speech kept ~10 dB above it
      return `[0:a]aresample=16000,volume=1.0[s];anoisesrc=color=brown:seed=${seed}:sample_rate=16000:duration=30,lowpass=f=1500,volume=0.045[n];[s][n]amix=inputs=2:duration=first:dropout_transition=0,aformat=sample_fmts=s16:channel_layouts=mono`
    case 'street':
      // pink noise with mid-band energy (traffic-like), speech ~0 dB relative
      return `[0:a]aresample=16000,volume=1.0[s];anoisesrc=color=pink:seed=${seed}:sample_rate=16000:duration=30,bandpass=f=800:width_type=o:w=2,volume=0.16[n];[s][n]amix=inputs=2:duration=first:dropout_transition=0,aformat=sample_fmts=s16:channel_layouts=mono`
    case 'narrowband':
      return 'aresample=8000,highpass=f=300,lowpass=f=3400,aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono'
  }
}

function render(src: string, dst: string, cond: Condition, seed: number) {
  const filter = filterFor(cond, seed)
  const args = ['-y', '-loglevel', 'error', '-i', src]
  if (cond === 'clean' || cond === 'narrowband') args.push('-af', filter)
  else args.push('-filter_complex', filter)
  args.push('-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst)
  execFileSync('ffmpeg', args, { stdio: 'inherit' })
}

const files = readdirSync(inDir).filter((f) => f.toLowerCase().endsWith('.wav'))
if (!files.length) {
  console.error('no wav files in', inDir)
  process.exit(2)
}
for (const cond of CONDITIONS) {
  const dir = join(outDir, cond)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  files.forEach((f, i) => render(join(inDir, f), join(dir, f), cond, 1000 + i))
  console.log(`${cond}: ${files.length} files`)
}

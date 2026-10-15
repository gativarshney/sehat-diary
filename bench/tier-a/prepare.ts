/**
 * Generate the impaired conditions for a speaker from their clean recordings.
 *   npm run tier-a:prepare -- S1
 * Reads bench/tier-a/audio/<speaker>/clean/*.wav and writes domestic/, street/, narrowband/ beside it
 * (clean/ is re-rendered to 16 kHz mono too). Deterministic; see bench/impair.ts.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const speaker = process.argv[2] ?? 'S1'
const base = resolve(import.meta.dirname, 'audio', speaker)
const clean = join(base, 'clean')
if (!existsSync(clean)) {
  console.error('no clean recordings at', clean)
  process.exit(2)
}
execFileSync('npx', ['tsx', resolve(import.meta.dirname, '..', 'impair.ts'), clean, base], { stdio: 'inherit', shell: process.platform === 'win32' })
console.log('prepared conditions for', speaker)

// Fails if anything that looks like a real key is tracked by git. Run in CI and before commits.
import { execSync } from 'node:child_process'

const files = execSync('git ls-files', { encoding: 'utf-8' }).split('\n').filter(Boolean)
const patterns = [
  /GNANI_API_KEY\s*=\s*['"]?[A-Za-z0-9_-]{16,}/,
  /x-api-key-id['"]?\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
]
let bad = 0
for (const f of files) {
  if (f === '.env.example' || f.endsWith('.lock') || f.endsWith('package-lock.json')) continue
  if (f === 'scripts/check-secrets.mjs') continue
  let text = ''
  try {
    text = execSync(`git show HEAD:"${f}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    continue
  }
  for (const p of patterns) {
    if (p.test(text)) {
      console.error(`possible secret in ${f}: ${p}`)
      bad++
    }
  }
}
if (files.includes('.env')) {
  console.error('.env is tracked by git')
  bad++
}
if (bad) process.exit(1)
console.log(`secret check passed (${files.length} files)`)

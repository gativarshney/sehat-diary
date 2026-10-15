/**
 * Vercel serverless entry for the API (Node.js runtime, Web-standard Request/Response via Hono).
 * Serves /api/* and (through vercel.json rewrites) /healthz. Streaming (/ws/stt) is not available on
 * Vercel's Hobby plan; the web app hides the streaming toggle when /api/healthz reports streaming=false.
 *
 * State on serverless is per-instance and short-lived: the TTS cache and the credit ledger live in
 * the function's temp directory, so the hard cap is per instance rather than global. The dashboard
 * balance and the per-call clip limit remain the real backstops.
 */
import { handle } from 'hono/vercel'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../apps/api/src/app'
import { GnaniClient } from '../apps/api/src/gnani'
import { Ledger } from '../apps/api/src/ledger'

const cacheRoot = join(tmpdir(), 'sehat-diary')
const ledger = new Ledger(join(cacheRoot, 'ledger.csv'), { maxCredits: Number(process.env.GNANI_MAX_CREDITS ?? 50) })
const client = new GnaniClient({ ledger })
const origins = (process.env.SEHAT_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const app = buildApp({
  client,
  cacheDir: join(cacheRoot, 'tts'),
  corsOrigins: origins.length ? origins : ['*'],
  livePerIpPerHour: Number(process.env.SEHAT_LIVE_PER_IP_PER_HOUR ?? 20),
  streaming: false,
})

export default handle(app)

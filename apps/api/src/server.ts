import { serve } from '@hono/node-server'
import { config } from 'dotenv'
import { join, resolve } from 'node:path'
import { buildApp } from './app'
import { GnaniClient } from './gnani'
import { Ledger } from './ledger'
import { RateLimiter } from './ratelimit'
import { attachStreamProxy } from './stream'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
config({ path: join(ROOT, '.env') })

const cacheRoot = process.env.SEHAT_CACHE_DIR ?? join(ROOT, '.cache')
const ledger = new Ledger(join(cacheRoot, 'ledger.csv'))
const client = new GnaniClient({ ledger })
const origins = (process.env.SEHAT_CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean)
const app = buildApp({
  client,
  cacheDir: join(cacheRoot, 'tts'),
  corsOrigins: origins,
  livePerIpPerHour: Number(process.env.SEHAT_LIVE_PER_IP_PER_HOUR ?? 20),
})

const port = Number(process.env.PORT ?? 8000)
const httpServer = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`sehat-diary api listening on :${info.port} mode=${client.mode} cap=${ledger.maxCredits} credits`)
})
const biasList = (process.env.SEHAT_BIAS_LIST ?? '').split(',').map((s) => s.trim()).filter(Boolean)
attachStreamProxy(httpServer as unknown as import('node:http').Server, {
  mode: client.mode,
  apiKey: process.env.GNANI_API_KEY,
  ledger,
  limiter: new RateLimiter(Number(process.env.SEHAT_LIVE_PER_IP_PER_HOUR ?? 20), 60 * 60 * 1000),
  biasList,
})

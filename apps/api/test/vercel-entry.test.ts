import { describe, expect, it } from 'vitest'

describe('vercel entry', () => {
  it('serves health and parse through the serverless handler with streaming disabled', async () => {
    const mod = await import('../../../api/[[...route]]')
    const handler = mod.default as (req: Request) => Promise<Response>
    const h = await (await handler(new Request('http://x/api/healthz'))).json()
    expect(h.ok).toBe(true)
    expect(h.streaming).toBe(false)
    const p = await (
      await handler(new Request('http://x/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'sugar dedh sau' }) }))
    ).json()
    expect(p.values).toEqual([150])
  })
})

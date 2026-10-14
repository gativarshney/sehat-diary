# Deployment (free tiers only, no card)

## API on Render (free web service)
1. Render dashboard: New, Blueprint, connect this repository. `render.yaml` defines the service.
2. Set `GNANI_API_KEY` in the service's Environment tab (marked `sync: false` in the blueprint, so it is never in the repo).
3. Keep `GNANI_MODE=mock` until the first live experiment is approved; switch to `live` afterwards.
4. The free instance sleeps after 15 minutes without traffic and takes about a minute to wake. The web app shows a "waking up" state and retries.
5. Health check: `GET /healthz` returns `{ ok, mode }`.

Limits that protect the credit budget on a public URL:
- `GNANI_MAX_CREDITS`: hard cap on estimated credits this process may spend (ledger, reset on restart).
- `SEHAT_LIVE_PER_IP_PER_HOUR`: per-visitor cap on live STT/TTS calls; the sample path never spends credits.

## Web on Cloudflare Pages
1. Cloudflare dashboard: Workers and Pages, Create, Pages, connect the repository.
2. Build command: `npm ci && npm run build -w apps/web`. Build output directory: `apps/web/dist`. Root directory: `/`.
3. Environment variable: `VITE_API_BASE=https://<your-render-service>.onrender.com`.
4. Add the Pages URL to `SEHAT_CORS_ORIGINS` on Render.

## Local
```
cp .env.example .env     # keep GNANI_MODE=mock unless an experiment is approved
npm install
npm run dev:api
npm run dev:web
```

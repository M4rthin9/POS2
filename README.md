# CIDA POS 2.0 — ระบบขายหน้าร้านสำหรับงาน Events

Rewritten from the Google Apps Script prototype (`H:\Web CIDA\POS`) as a monorepo on Cloudflare.

## Structure

```
apps/api       Hono + D1 + KV Worker (REST API, PIN+JWT auth, atomic stock deduction)
apps/pos       POS PWA — React + Vite + Tailwind (mobile-first, offline queue, PromptPay QR)
apps/admin     Admin dashboard — React + Vite + Tailwind (overview/stats + CRUD for products/events/users/divisions/settings/sales)
packages/shared  Shared types, PromptPay payload generator, API client, Thai locale
```

## Workers & resources

| Resource      | Name          | Notes                                       |
|---------------|---------------|---------------------------------------------|
| API Worker    | `cida-pos-api` | https://cida-pos-api.pongsinbas.workers.dev |
| D1 database   | `pos2-db`      | id `1fefe03c-11e3-4d73-a57c-e5ed45e6cdf8`  |
| KV namespace  | `pos2-cache`   | id `e1ef61302b5e44c48ffe3e22e4d89b84`      |
| Pages         | `cida-pos`     | POS PWA (deploy via `npm run deploy:pos`)   |
| Pages         | `cida-pos-admin` | Admin dashboard (deploy via `npm run deploy:admin`) |

## Seed accounts

| Role    | Username | PIN  |
|---------|----------|------|
| Admin   | `admin`  | `1234` |
| Cashier | `cashier`| `0000` |

## Commands

```bash
npm install
npm run dev:api      # wrangler dev → http://localhost:8787
npm run dev:pos      # Vite → http://localhost:5173
npm run dev:admin    # Vite → http://localhost:5174
npm run build
npm run deploy:api   # wrangler deploy
npm run deploy:pos   # wrangler pages deploy apps/pos/dist
npm run deploy:admin # wrangler pages deploy apps/admin/dist
npm run migrate      # wrangler d1 migrations apply pos2-db
```

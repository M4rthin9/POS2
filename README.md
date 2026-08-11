# CIDA POS 2.0 — ระบบขายหน้าร้านสำหรับงาน Events

Rewritten from the Google Apps Script prototype (`H:\Web CIDA\POS`) as a monorepo on Cloudflare.

## Structure

```
apps/api       Hono + D1 + KV Worker (REST API, PIN+JWT auth, atomic stock deduction)
apps/pos       POS PWA — React + Vite + Tailwind (mobile-first, offline queue, PromptPay QR)
apps/admin     Admin dashboard — React + Vite + Tailwind + recharts (full CRUD + reports)
packages/shared  Shared types, PromptPay payload generator, API client, Thai locale
```

## Workers & resources

| Resource      | Name          | Notes                                       |
|---------------|---------------|---------------------------------------------|
| API Worker    | `cida-pos-api` | https://cida-pos-api.pongsinbas.workers.dev |
| D1 database   | `pos2-db`      | id `8b9b8b49-fb27-4a4e-88fc-e1e2e6e8f99c`  |
| KV namespace  | `pos2-cache`   | id `8ba7d1c1eed34ccfaa91f186041bfc27`      |

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

## Seed accounts

| Role    | Username | PIN |
|---------|----------|-----|
| admin   | admin    | 1234 |
| cashier | cashier  | 0000 |

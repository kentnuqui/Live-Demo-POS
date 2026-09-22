# Live demo deploy

Host the POS UI on **Netlify**, the Express API on **Render** (free), and Postgres on Render’s free database (30-day demo window).

```text
Browser (Netlify)  →  API (Render)  →  Postgres (Render)
```

## Prerequisites

- GitHub account
- [Netlify](https://app.netlify.com) account
- [Render](https://dashboard.render.com) account
- This repo pushed to GitHub

```bash
git init
git add .
git commit -m "Prepare live demo deploy"
# create an empty GitHub repo, then:
git remote add origin https://github.com/YOUR_USER/towns-diner-pos.git
git branch -M main
git push -u origin main
```

Do **not** commit `.env`.

---

## 1. API + database (Render)

1. Open [Render Blueprint](https://dashboard.render.com/select-repo?type=blueprint).
2. Connect the GitHub repo.
3. Apply `render.yaml` (creates `towns-api` + `towns-db`).
4. Choose the **Free** plan for both.
5. For `CLIENT_ORIGIN`, enter a placeholder for now:

   ```text
   http://localhost:5173
   ```

6. Wait until the web service is **Live**. Copy the API URL, e.g. `https://towns-api.onrender.com`.
7. Confirm health:

   ```text
   https://towns-api.onrender.com/api/health
   ```

   You should see `{ "status": "success", "data": { "ok": true } }`.

On first start the service runs schema sync + seed (safe to re-run; seed skips if data exists). Prisma Client is generated only during **build**, not at start (avoids free-tier OOM).

**Note:** Free web services sleep after ~15 minutes idle. The first request after sleep can take ~1 minute.

Also ensure Prisma/esbuild install on Render by keeping this env var (already in `render.yaml`):

| Key | Value |
| --- | --- |
| `NPM_CONFIG_PRODUCTION` | `false` |

---

## 2. Frontend (Netlify)

1. [Add a new site](https://app.netlify.com/start) → Import from Git → this repo.
2. Netlify reads `netlify.toml` automatically:

   | Setting | Value |
   | --- | --- |
   | Build command | `npm run build:web` |
   | Publish directory | `apps/desktop/dist-web` |
   | Node | `22` |

3. Site settings → Environment variables → add:

   | Key | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://towns-api.onrender.com` *(your Render URL, no trailing slash)* |

4. Deploy. Copy the site URL, e.g. `https://towns-pos.netlify.app`.

---

## 3. Wire CORS

Back in Render → `towns-api` → Environment → set:

```text
CLIENT_ORIGIN=https://towns-pos.netlify.app
```

Multiple origins (comma-separated) are supported, e.g.:

```text
CLIENT_ORIGIN=https://towns-pos.netlify.app,http://localhost:5173
```

Manual deploy / restart the API so the new origin is picked up.

---

## 4. Demo login

Open the Netlify URL and sign in:

| Role | Email | Password | PIN |
| --- | --- | --- | --- |
| Manager | manager@towns.test | Towns#Manager1 | 1001 |
| Cashier | cashier@towns.test | Towns#Cash1 | 2001 |
| Waiter | waiter@towns.test | Towns#Waiter1 | 3001 |

More accounts are listed in the root `README.md`.

---

## Local check before you push

```bash
# Web build (what Netlify runs)
VITE_API_URL=https://towns-api.onrender.com npm run build:web

# API build (what Render runs)
npm run build:api
```

---

## Optional: Neon instead of Render Postgres

If you prefer a longer-lived free database:

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the connection string into Render’s `DATABASE_URL` (replace the Blueprint database link).
3. You can delete the Render Postgres instance.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login fails / CORS error | `CLIENT_ORIGIN` must exactly match the Netlify URL (`https://…`) |
| Netlify build can’t reach API types | Ensure `npm run build:shared` runs (included in `build:web`) |
| API crash on boot | Check Render logs for missing `DATABASE_URL` / JWT secrets |
| Cold start feels stuck | Wait ~60s after free-tier sleep, then refresh |
| Empty menu / no staff | In Render Shell: `npm run db:deploy -w @towns/server` |

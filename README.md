# Towns

A restaurant POS with a quiet, Japanese-inspired floor. Phases 1–3 are in this repository: sign-in and house settings, the table room, and orders.

## Architecture

```text
apps/desktop   Electron terminal. React, Tailwind, Zustand, TanStack Query.
apps/server    Express API. Routes call controllers. Controllers call services. Services own Prisma.
packages/shared  Roles, money, DTOs, and Zod schemas used by both sides.
PostgreSQL     Source of truth.
SQLite         Per-terminal cache and offline outbox, inside Electron.
               The browser build falls back to IndexedDB so the same screens can be reviewed without the shell.
Socket.IO      Branch rooms. A change on one terminal refreshes the others.
```

Money is stored as integer minor units. Tax and service charge are basis points (`800` = 8.00%) so totals never use floating point.

`POST /api/sync/push` takes a batch of offline operations and writes them in one Prisma transaction. Replaying a batch is safe: orders, items, reservations, and queue entries keep the id the terminal created. If one operation in the batch is rejected, none of that batch is saved.

`GET /api/sync/pull?branchId=&lastSyncTimestamp=` returns what changed after that time, grouped by kind.

When the API cannot be reached, the terminal keeps the last floor, menu, and checks, and queues new work. A PIN that has succeeded once on that terminal can unlock it again without the server. The header reads **Emergency mode** until the queue drains.

Printing speaks ESC/POS over the printer’s network port (`192.168.0.20:9100`). Sending a check routes lines by station: sushi, kitchen, bar, dessert. The cash drawer kick is the standard pulse on the receipt printer. USB drivers are not bundled.

## Run

PostgreSQL has to be reachable at `DATABASE_URL`. `docker compose up -d` starts one with user `postgres`, password `postgres`, database `towns_pos`.

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

The API listens on port 4000. The terminal opens on port 5173. Staff screens use hash routes, so a guest QR link in development is:

`http://localhost:5173/#/q/shibuya-a1`

A Windows installer is `npm run dist:win -w @towns/desktop` from a Windows machine. `npm run dist -w @towns/desktop` packs the current platform.

## Live demo (Netlify + Render)

See **[DEMO.md](./DEMO.md)** for the step-by-step: Netlify hosts the browser UI, Render hosts the API and a small Postgres database.

## Demo staff

All of these belong to the Shibuya floor unless noted. Passwords are for email sign-in. The floor uses the PIN.

| Role | Email | Password | PIN |
| --- | --- | --- | --- |
| Super Admin | super@towns.test | Towns#Super1 | 9001 |
| Admin | admin@towns.test | Towns#Admin1 | 9002 |
| Manager | manager@towns.test | Towns#Manager1 | 1001 |
| Cashier | cashier@towns.test | Towns#Cash1 | 2001 |
| Waiter | waiter@towns.test | Towns#Waiter1 | 3001 |
| Kitchen | kitchen@towns.test | Towns#Kitchen1 | 4001 |
| Bar | bar@towns.test | Towns#Bar1 | 5001 |
| Inventory | inventory@towns.test | Towns#Stock1 | 6001 |

Shibuya opens with table A1 already seated and VIP 2 reserved for Aiko Mori. Ginza is the second branch. Admins can switch branches in the header.

## What is in this build

Phase 1. Email and PIN sign-in, the eight roles, restaurant profile, tax, service charge, printers, receipt text, and more than one branch.

Phase 2. A drag-and-drop floor, table states, walk-in and advance reservations with a deposit, and a waitlist with queue numbers, estimated wait, and an SMS handoff. No SMS provider is configured, so “Ready” records the message as queued.

Phase 3. Dine-in from a table, takeout, delivery, online, and a guest QR page. Transfer, merge, and split. Kitchen stations on send. Dining progress from seated through billing. Finish releases the table to cleaning. It does not take payment.

Menu tiles are readable and priced. Editing categories, modifiers, and happy hour is phase 5. The kitchen display, payments, reports, loyalty, and the later Japanese-specific boards (heat map, omakase, tea refill) are not in this build.

Keyboard: ⌘/Alt 1 tables, 2 orders, 3 queue, 4 book.

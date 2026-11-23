# HR Leave Tracker

A leave desk for HR staff. Staff send requests from a phone-friendly form (English or Arabic). The admin sees each request with an eligibility check against that person's allowance and history, then approves or declines it.

- **Leave form:** `/apply` (public). Staff choose their name, leave type and dates, and get a 6-character reference to check the status later.
- **Admin:** `/` (password protected). Requests, People, Calendar and Settings.

## Rules

- Pay in **IQD** means **Iraqi** rules. Any other currency means **foreign** rules. Override per person under *Edit details*.
- Each group has its own allowances in **Settings**: days off per month, annual leave days per year and an optional sick-leave limit.
- Annual leave is either all available from 1 January or earned 1/12 per month.
- Fridays can be excluded from day counts.
- The leave year is the calendar year.

## Stack

A Cloudflare Worker (`src/worker.js`) with a D1 database (`hr-leave-tracker`). The pages in `public/` are plain ES modules with Preact and htm (vendored, so there's no frontend build). `scripts/build-assets.mjs` bundles `public/` into the Worker at deploy time. The leave rules live in `public/js/logic.js` and are shared by the server and the admin app.

## Commands

```bash
npm install
```

```bash
npx wrangler d1 migrations apply hr-leave-tracker --local
```

```bash
npm run dev
```

```bash
npm run deploy
```

To reload the staff list from a payroll sheet, generate the seed file. It is git-ignored because it holds staff names and IDs. Running it also resets the admin password and **deletes all requests**, so use it only for a fresh start:

```bash
python3 scripts/seed_from_xlsx.py path/to/payroll.xlsx "new-admin-password"
```

```bash
npx wrangler d1 execute hr-leave-tracker --remote --file seed/seed.sql
```

To add individual people, use *People → Add person* in the app instead.

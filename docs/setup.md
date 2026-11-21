# Local setup

This guide takes a clean machine to a running storefront, admin panel and
database. Production deployment is covered in [deployment.md](deployment.md).

## 1. Prerequisites

- Node.js **20 or newer** and npm.
- A Supabase project (the free tier is sufficient for setup and review).
- Optional: the Vercel CLI for running `/api` functions locally.
- Git, if you are cloning the repository.

```bash
node --version
npm --version
```

## 2. Install dependencies

```bash
npm install
```

If Windows reports an `EBUSY` or file-lock error during install, close any
process using `node_modules` (editors, antivirus scanners, another terminal) and
run `npm install --ignore-scripts` followed by `npm install`.

## 3. Create the Supabase project

1. Sign in at <https://supabase.com/dashboard>.
2. Create a new project and record:
   - the **Project URL** (for example `https://abcdefgh.supabase.co`);
   - the **anon public key**;
   - the **service_role key** (under Project Settings → API).
3. Keep the service-role key server-side only. It bypasses row-level security.

### Apply the migrations

Migrations must run **in numeric order**. The simplest method is the Supabase
SQL editor:

| Order | File | Creates |
| --- | --- | --- |
| 1 | `supabase/migrations/0001_schema.sql` | Enums, tables, indexes, triggers |
| 2 | `supabase/migrations/0002_rls.sql` | Row-level security policies and `is_admin()` |
| 3 | `supabase/migrations/0003_functions.sql` | Order, payment, stock and dashboard functions |
| 4 | `supabase/migrations/0004_seed.sql` | Launch catalogue, settings and inactive supplier account |
| 5 | `supabase/migrations/0005_storage.sql` | `product-images` bucket and storage policies |
| 6 | `supabase/migrations/0006_stock_view.sql` | Public available-stock view |
| 7 | `supabase/migrations/0007_operations.sql` | Rate limiting, email log and housekeeping |

For each file: open **SQL Editor**, paste the complete file and run it. Check
for errors before moving to the next file.

The files use a simple `0001_`–`0007_` prefix rather than Supabase CLI's
timestamp convention. If you prefer the CLI, rename them to timestamps first:

```text
20260101000100_schema.sql
20260101000200_rls.sql
...
```

Then link and push:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations are written to be idempotent where practical, but do not run them
out of order on a fresh project.

### Configure authentication

In **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:5173` for local work.
- **Redirect URLs:** add `http://localhost:5173/account` and your production
  `/account` URL.

In **Authentication → Providers → Email**:

- Enable email/password sign-in.
- Keep **Confirm email** enabled for a live store. If it is disabled, newly
  registered users receive a session immediately; the UI handles both cases.

Supabase's built-in email sender is rate-limited and intended for testing. For
production, configure custom SMTP in Supabase Auth settings. This is separate
from the store's transactional email provider.

## 4. Configure environment variables

Copy the example file:

```powershell
copy .env.example .env
```

```bash
cp .env.example .env
```

At minimum, set:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_STORE_URL=http://localhost:5173

SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
PUBLIC_SITE_URL=http://localhost:5173

PAYMENT_PROVIDER=manual
MANUAL_PAYMENT_ACCOUNT_NAME=Hasswell London Ltd
MANUAL_PAYMENT_SORT_CODE=00-00-00
MANUAL_PAYMENT_ACCOUNT_NUMBER=00000000

EMAIL_PROVIDER=log
CRON_SECRET=replace-with-a-long-random-string
RATE_LIMIT_SALT=replace-with-another-long-random-string
```

Notes:

- `.env` is ignored by Git. Never commit it.
- Only `VITE_` variables reach the browser. Do not put a secret behind a
  `VITE_` name.
- `EMAIL_PROVIDER=log` records emails in `email_log` and writes them to the
  server console. It does **not** send. This is intentional until a sending
  domain and API key are verified.
- `PAYMENT_PROVIDER=manual` requires real bank details. Leaving them blank
  disables checkout rather than accepting an order that cannot be paid.

## 5. Start the storefront

```bash
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` serves the pages and talks directly to Supabase using the anon key.
Vite does **not** run the serverless functions in `/api`, so cart validation,
checkout, order lookup and all admin writes will fail in this mode.

To run the complete stack locally, install and use the Vercel CLI:

```bash
npx vercel dev
```

`vercel dev` serves the static pages, the rewrites and the `/api` functions using
the same `.env` values. Use it for end-to-end checkout and admin testing.

## 6. Create the administrator

1. Open `/register` and create an account with the email that will own the store.
2. In Supabase **SQL Editor**, run `supabase/scripts/promote-admin.sql` after
   replacing `REPLACE_WITH_ADMIN_EMAIL` with that address.
3. Sign in at `/admin`.

The script updates `profiles.role`. The `is_admin()` function and the RLS
policies allow access immediately; no redeploy is needed.

Verify with:

```sql
select id, email, role, is_active from profiles where role = 'admin';
```

Never make `profiles` writable to customers. The role column is protected by a
trigger and column privileges; see [database.md](database.md).

## 7. First-run checks

- [ ] Home page shows the seeded launch catalogue.
- [ ] `/shop` filters and search work.
- [ ] A product page loads variants and stock.
- [ ] `/admin` rejects a non-admin account.
- [ ] `/admin` loads for the promoted account.
- [ ] An order can be created with `manual` payment and appears on the
      confirmation page.
- [ ] The order appears in Admin → Orders with payment `pending`.
- [ ] Marking it paid (after a real transfer) commits stock and sends the
      confirmation email path.

The seeded catalogue uses generated SVG artwork. Replace product copy and imagery
before launch; see [handover.md](handover.md).

## 8. Configure the supplier (optional)

The seeded AW Dropship account is **inactive** with placeholder configuration.
To use catalogue and stock sync:

1. Obtain an API token from AW Dropship: **Channels → your Manual/API channel →
   API**.
2. Set `AW_DROPSHIP_API_TOKEN` in `.env`.
3. In Admin → Supplier, enable the account.
4. Run **Sync catalogue** and review the result.

Do not enable `AW_DROPSHIP_ORDER_SUBMISSION_ENABLED`. It does not activate
automated submission; the adapter still refuses to guess AW's request bodies.
Read [aw-dropship.md](aw-dropship.md).

## 9. Troubleshooting

### The storefront says Supabase is not configured

`VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing. Vite only reads
environment variables at startup: stop and restart `npm run dev`.

### Catalogue is empty

- Confirm migrations `0001` and `0004` ran successfully.
- Confirm products have `status = 'active'`.
- Check the browser console for an RLS or network error.
- Confirm the anon key belongs to the same project as the URL.

### Admin login succeeds but the panel is forbidden

The account has no admin profile. Run `promote-admin.sql` with the exact email
used at registration, then sign out and back in.

### Admin writes return 401 or 403

The browser session token is missing or expired, or the profile is not an active
admin. Check `/api/health` and the browser Network tab. The admin client signs
the user out on 401/403 (`admin:unauthorised`).

### Checkout returns `PAYMENT_PROVIDER_UNAVAILABLE`

The selected provider is not fully configured. For `manual`, set the bank
details. For `stripe`, set both `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`.

### Images do not load

- `0005_storage.sql` must have created the public `product-images` bucket.
- Seeded artwork is served from `/assets/products/*.svg` in `public/`.
- Admin uploads require an authenticated admin session and a valid image MIME
  type.

### `npm run build` fails with a missing module

Check the import path case-sensitively. Windows is case-insensitive; Vercel's
Linux builders are not.

### `npm test` finds no tests

Use the repository's script rather than calling `node --test` directly:

```bash
npm test
```

It expands `tests/*.test.js` explicitly on both Windows and Linux.

## Next steps

- [Deployment](deployment.md)
- [Architecture](architecture.md)
- [Security](security.md)
- [Handover](handover.md)

# Deployment

The application deploys to Vercel with Supabase as the managed database, auth
and storage layer. No server is maintained by the client.

## 1. Create the production Supabase project

1. Create a separate project from development.
2. Record the project URL, anon key and service-role key.
3. Run the migrations in order:
   `0001_schema.sql` → `0002_rls.sql` → `0003_functions.sql` →
   `0004_seed.sql` → `0005_storage.sql` → `0006_stock_view.sql` →
   `0007_operations.sql`.
4. Confirm the `product-images` bucket exists and is public.
5. Confirm RLS is enabled:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

### Authentication settings

In **Authentication → URL Configuration**:

- **Site URL:** `https://YOUR_DOMAIN`
- **Redirect URLs:** `https://YOUR_DOMAIN/account`

For preview deployments, add the relevant preview URLs only if you intend to
test authentication there.

In **Authentication → Providers → Email**:

- Enable email/password.
- Keep email confirmation enabled for a live store.
- Configure custom SMTP before launch. Supabase's built-in sender is for testing
  and is rate-limited.

### Create the administrator

1. Register the owner account at `https://YOUR_DOMAIN/register` after the first
   deployment, or create the user in Supabase Auth.
2. Run `supabase/scripts/promote-admin.sql` with the owner's email.
3. Sign in at `https://YOUR_DOMAIN/admin`.

## 2. Push the repository

The project is configured for the GitHub repository:

```text
https://github.com/ahmedshamil150/Hasswell-London.git
```

```bash
git add .
git commit -m "Initial Hasswell London platform"
git branch -M master
git remote add origin https://github.com/ahmedshamil150/Hasswell-London.git
git push -u origin master
```

Never commit `.env`, `.vercel`, service-role keys, supplier tokens or payment
secrets. Check before pushing:

```bash
git status
git grep -n "SUPABASE_SERVICE_ROLE_KEY="
git grep -n "sk_live_"
git grep -n "whsec_"
```

The first two commands should not find a real value. If a secret was committed,
rotate it; deleting the commit is not enough.

## 3. Import the project into Vercel

1. In Vercel, **Add New → Project** and import the GitHub repository.
2. Framework preset: **Vite** (already set in `vercel.json`).
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Node.js version: **24.x**. It is pinned by `engines.node` in `package.json`,
   so leaving the project setting on its default is fine. Do not change the
   range to `>=20`: Vercel treats open-ended ranges as "latest supported major"
   and will silently upgrade across major versions.
6. Do not override the install command unless your environment requires it.

Vercel detects the `api/` directory as serverless functions. `vercel.json`
provides clean URLs, sitemap/robots rewrites, the cron schedule and security
headers.

## 4. Environment variables

Add these in **Project → Settings → Environment Variables**. Use the production
scope for live values. Vite variables are embedded at build time: changing a
`VITE_` value requires a redeploy.

### Required for the storefront and API

| Name | Example | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://abc.supabase.co` | Public |
| `VITE_SUPABASE_ANON_KEY` | `eyJ…` | Public anon key, RLS-protected |
| `VITE_STORE_URL` | `https://hasswelllondon.co.uk` | Public canonical URL |
| `SUPABASE_URL` | `https://abc.supabase.co` | Server |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ…` | **Secret**; never expose |
| `PUBLIC_SITE_URL` | `https://hasswelllondon.co.uk` | Server redirects/canonicals |
| `PAYMENT_PROVIDER` | `manual` or `stripe` | Selects the adapter |
| `EMAIL_PROVIDER` | `log` or `resend` | `log` does not send |
| `CRON_SECRET` | long random string | Protects `/api/cron/*` |
| `RATE_LIMIT_SALT` | long random string | Hashes rate-limit identifiers |

### Payment

| Name | When required |
| --- | --- |
| `MANUAL_PAYMENT_INSTRUCTIONS` | Manual provider, optional free-text lines |
| `MANUAL_PAYMENT_ACCOUNT_NAME` | Manual provider |
| `MANUAL_PAYMENT_SORT_CODE` | Manual provider |
| `MANUAL_PAYMENT_ACCOUNT_NUMBER` | Manual provider |
| `STRIPE_SECRET_KEY` | Stripe provider |
| `STRIPE_WEBHOOK_SECRET` | Stripe provider |
| `STRIPE_PAYMENT_METHOD_TYPES` | Optional, default `card` |

### Email and supplier

| Name | When required |
| --- | --- |
| `EMAIL_FROM` | Resend provider; must be a verified sender |
| `EMAIL_REPLY_TO` | Optional |
| `RESEND_API_KEY` | Resend provider |
| `AW_DROPSHIP_API_TOKEN` | Supplier sync and polling |
| `AW_DROPSHIP_BASE_URL` | Optional; defaults to live API |
| `AW_DROPSHIP_ORDER_SUBMISSION_ENABLED` | Leave `false`; does not enable submission |
| `AW_DROPSHIP_DEFAULT_CARRIER` | Reserved; currently unused |
| `AW_DROPSHIP_TIMEOUT_MS` | Optional, default 20000 |

Generate secrets with a password manager or:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice: once for `CRON_SECRET`, once for `RATE_LIMIT_SALT`.

## 5. Deploy

Deploy from the Vercel dashboard or:

```bash
npx vercel --prod
```

After deployment, open:

- `https://YOUR_DOMAIN/` — storefront
- `https://YOUR_DOMAIN/admin` — admin sign-in
- `https://YOUR_DOMAIN/api/health` — capability report

`/api/health` returns `ok` only when the database, Supabase configuration, an
available payment provider and `CRON_SECRET` are all present. It never returns
keys or URLs. A `degraded` status tells you which capability is missing.

## 6. Configure the domain

1. Add the domain in Vercel → Settings → Domains.
2. Point DNS as instructed by Vercel.
3. Set `PUBLIC_SITE_URL` and `VITE_STORE_URL` to the final HTTPS origin, then
   redeploy.
4. Update Supabase **Site URL** and **Redirect URLs** to the final domain.
5. Confirm HTTP redirects to HTTPS and HSTS is present.

## 7. Configure Stripe (if used)

1. Complete Stripe onboarding and business verification.
2. Add the live secret key as `STRIPE_SECRET_KEY`.
3. Create a webhook endpoint:
   - URL: `https://YOUR_DOMAIN/api/payments/webhook`
   - Events:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Set `PAYMENT_PROVIDER=stripe`.
6. Redeploy.
7. Make a low-value live test purchase and confirm:
   - the session total equals the order total;
   - the webhook marks the order paid once;
   - stock is committed once;
   - the confirmation email is recorded/sent.

Stripe sends `Stripe-Signature`; the endpoint rejects missing, malformed or old
signatures before parsing the body. Do not disable this check to "make it work".

## 8. Configure Vercel Cron

`vercel.json` defines:

```json
{
  "crons": [
    { "path": "/api/cron/sync-supplier", "schedule": "0 3 * * *" }
  ]
}
```

That schedule runs once daily at 03:00 UTC. It is deliberately compatible with
Vercel's Hobby plan, which rejects cron expressions that run more than once per
day. The endpoint itself is unchanged and can be called more frequently.

The endpoint requires:

```text
Authorization: Bearer <CRON_SECRET>
```

Vercel automatically attaches this header when a `CRON_SECRET` environment
variable exists. If your plan or setup does not, call the endpoint from an
external scheduler with the same header.

The job:

1. syncs the AW catalogue and stock when a supplier account is active;
2. releases unpaid orders older than 24 hours;
3. prunes rate-limit and email-log rows.

### Cron frequency and stock freshness

Vercel Hobby accounts are limited to **daily** cron jobs. A schedule such as
`0 */2 * * *` is rejected at deployment with:

> Hobby accounts are limited to daily cron jobs. This cron expression would run
> more than once per day. Upgrade to the Pro plan…

On Hobby, the daily schedule above is the maximum available:

- supplier stock and prices can be up to 24 hours stale;
- unpaid orders can remain reserved for up to roughly 48 hours (24-hour
  reservation plus the next daily run);
- manual **Sync catalogue** and **Poll status** actions in the admin panel still
  work at any time.

For a live dropshipping store, more frequent stock updates are preferable. Use
one of these options:

1. **Vercel Pro:** change the schedule to `0 */2 * * *` (every two hours).
2. **External scheduler:** keep the Hobby deployment and call
   `https://YOUR_DOMAIN/api/cron/sync-supplier` every one or two hours with
   `Authorization: Bearer <CRON_SECRET>`. The included GitHub Actions workflow
   does this for free; see below.
3. **Manual operation:** run **Sync catalogue** in Admin → Supplier before
   processing orders. This is only suitable for low order volumes.

Do not remove the cron entirely: it also releases expired reservations and
prunes operational tables.

### Free two-hourly scheduling with GitHub Actions

This repository includes `.github/workflows/supplier-sync.yml`, which calls the
same endpoint every two hours at minute 30. It needs no Vercel Pro plan.

1. In GitHub, open **Settings → Secrets and variables → Actions → New repository
   secret**.
2. Add `SITE_URL` — for example `https://hasswelllondon.co.uk` (no trailing
   slash).
3. Add `CRON_SECRET` — the **same** value configured in Vercel.
4. Open **Actions → Supplier sync → Run workflow** to test it immediately.
5. Confirm the run returns `ok: true` and that Admin → Supplier shows a new sync
   log.

The workflow:

- runs only on the repository's default branch;
- prints no secrets;
- fails loudly if either secret is missing or the URL is not HTTPS;
- retries transient failures up to three times;
- avoids overlapping runs.

GitHub's scheduler can be delayed under load and may pause scheduled workflows
in a repository with no activity for 60 days. The daily Vercel cron remains
enabled as a fallback, so a missed GitHub run is recovered within 24 hours.
Re-enable the workflow from the Actions tab if GitHub pauses it.

Test manually:

```bash
curl -i https://YOUR_DOMAIN/api/cron/sync-supplier \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expect JSON with `ok: true`, supplier result (or `skipped`), released order count
and `pruned`.

## 9. Configure email

The default `EMAIL_PROVIDER=log` writes intended emails to `email_log` and the
server log. It does **not** send. This is deliberate until a sending domain is
verified.

To enable delivery with Resend:

1. Verify the sending domain in Resend.
2. Create an API key.
3. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (for example
   `orders@yourdomain.co.uk`) and optionally `EMAIL_REPLY_TO`.
4. Redeploy.
5. Place a test order and check Admin → Email log for `sent`.
6. Check the recipient inbox and spam folder.

Supabase Auth emails (confirmation, password reset) are configured separately in
Supabase and are not sent through Resend by this application.

## 10. Configure the supplier

1. Set `AW_DROPSHIP_API_TOKEN` from the client's AW channel.
2. Set `AW_DROPSHIP_BASE_URL` to `https://api.aiku.io` (or the staging URL for
   testing).
3. Deploy.
4. In Admin → Supplier, run **Test connection** (read-only).
5. Enable the account.
6. Run **Sync catalogue** and review the log.
7. Leave automated submission disabled. Follow
   [aw-dropship.md](aw-dropship.md) for the manual fulfilment process.

## 11. Post-deployment smoke test

Run these against production, in order:

- [ ] `/` loads with products from Supabase, not placeholders hardcoded in HTML.
- [ ] `/shop` search, category filter and sort work.
- [ ] `/product/:slug` shows the correct price, variants and stock.
- [ ] An out-of-stock product cannot be added beyond available quantity.
- [ ] `/api/health` reports `ok`.
- [ ] `/sitemap.xml` lists active products and `/robots.txt` disallows admin.
- [ ] `/admin` rejects a customer account.
- [ ] `/admin` loads for the owner account.
- [ ] A manual-payment test order reaches the confirmation page and appears in
      Admin → Orders as `pending`.
- [ ] Cancelling the test order releases stock (check Admin → Inventory and the
      order timeline).
- [ ] Complete a real low-value payment (Stripe) or verify a manual transfer.
- [ ] The order becomes `paid` / `awaiting_supplier` exactly once.
- [ ] Stock is committed once and a confirmation email is recorded.
- [ ] Supplier sync (if configured) updates stock without dropping below
      reservations.
- [ ] Record a manual supplier submission on a paid test order.
- [ ] Record a shipment with carrier and tracking; the customer order page shows
      tracking and the dispatch email is recorded.
- [ ] Cancelling a paid order restores stock.
- [ ] Mobile layout and keyboard navigation pass a quick review.
- [ ] No console errors, mixed-content warnings or exposed keys in the bundle.

Search the built assets for accidental secrets:

```bash
npm run build
git grep -n "service_role" dist
git grep -n "sk_live_" dist
git grep -n "AW_DROPSHIP_API_TOKEN=" dist
```

The browser bundle should contain only public Supabase values.

## 12. Monitoring and operations

- Check `/api/health` after every deployment.
- Review Vercel function logs for `[api]`, `[db]`, `[stripe]`, `[email]` and
  `[cron]` entries.
- Review Admin → Supplier sync logs after each cron run.
- Review Admin → Email log for `failed` rows.
- Watch unpaid orders and stock alerts on the dashboard.
- Keep dependencies patched; run `npm audit` and review before upgrading.
- Keep Supabase backups enabled and test a restore on a staging project.

## 13. Rollback

1. In Vercel, promote the previous deployment (Deployments → … → Promote).
2. If a database migration caused the issue, restore from a backup or apply a
   forward fix. Do not hand-edit production tables without recording why.
3. Rotate any credential exposed by the failed deployment.
4. Re-run the smoke test before announcing recovery.

## 14. Pre-launch configuration summary

| Item | Required before real orders |
| --- | --- |
| Supabase production project and migrations | Yes |
| `PUBLIC_SITE_URL`, `VITE_STORE_URL` on final domain | Yes |
| Admin account promoted and secured | Yes |
| Payment provider fully configured and tested | Yes |
| Bank details or Stripe onboarding | Yes |
| Real shipping rates and delivery estimate in Admin → Settings | Yes |
| Real product copy, prices, stock and imagery | Yes |
| Legal pages reviewed | Yes |
| Verified email sender | Recommended |
| Cron secret and schedule | Yes |
| Backups enabled | Yes |
| AW token and supplier account (if dropshipping live) | Yes |
| Automated AW submission | **No** — remains manual until verified |

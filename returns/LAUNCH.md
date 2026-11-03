# Returns preview and launch notes

## Scope and isolation

This module belongs to the existing Sungrown site on the `feature/returns-preview` branch. It does not read or modify the separate business dashboard. The preview uses a dedicated Cloudflare D1 database, `sungrown-returns-preview`. A separate production database binding is staged; production intake remains disabled. Do not merge this branch or enable production intake until separately approved.

Preview staff roles are fictional, publicly selectable demo identities. They are **not Google accounts or production staff access**. Preview accepts only email addresses ending in `.example`; do not upload real documents or personal information. The test inbox captures messages in the dedicated database; no email provider is contacted in preview.

## Try the $120 example

1. Open `/admin/returns/` on the preview and choose **Alex · Returns owner**. Three fictional examples are created once, including Cedar Retail's $120 missed pickup and Cascade Retail's completed $120 check.
2. Open `/returns/`, submit a fictional store, `buyer@store.example`, product/quantity or an existing list, and an issue. Keep the reference. Open the staff test inbox and use **View my return**. No retailer account is required.
3. In the queue, select the new return. Assign Alex, next action and next update date. Review product, quantity, $120 purchase value, delivery date and related claims, then check all five review checks. Staff enter dollar amounts directly: enter `120` for $120. The API stores integer cents.
4. Approve the $120 request. This does not mark product received or payment issued. Schedule a pickup or record a missed pickup and replacement plan. The original submission remains unchanged; the buyer receives one meaningful update in the test inbox.
5. Record returned product plus complete records. The payment clock starts at the later of their two dates. Sign out and choose **Morgan · Finance** to record the actual check date, amount and reference. Sign back in as the owner and send the outcome. The retailer sees the actual check outcome, not an invoice-credit claim.
6. Use **Find my return** to request a replacement link. Existing links can be revoked by the owner. Test inbox links expire after seven days. Claim references alone grant no access.
7. Choose **Taylor · Leadership** for the pilot report, CSV export and preview settings. Try a $200 claim, then a related $1 claim from the same store: the combined review path becomes standard. Leadership must approve standard claims.

## Implemented controls

- Shared persistent claim records power staff actions, retailer status and notifications.
- Idempotency keys prevent retried intake from duplicating a claim or receipt; double-taps are disabled in the form. Claim storage completes before success is shown.
- Attachments are private D1 records, never static files. Accepted types are PDF, CSV, text, JPEG, PNG and WebP; maximum 500 KB. Staff-authenticated download is required, served as an attachment with `nosniff`.
- Expiring 256-bit claim links are hashed at rest, scoped to one claim and revocable. Tokens travel in URL fragments, are removed from the visible URL, and API access uses a bearer header. Retailer JSON omits private notes, staff audit details, email addresses and attachments.
- Neutral recovery responses, per-IP rate limits, explicit staff allowlist, short-lived HttpOnly staff sessions, CSRF/origin checks, output escaping, CSP, `no-store` and `no-referrer` headers.
- Google OIDC server flow with state, nonce, PKCE, RSA signature, audience, issuer, expiry and verified-email checks. Explicit allowlist roles are checked on every request. Staff role separation is enforced server-side, including approval and payment.
- Optimistic claim versions reject stale updates. Staff mutation, audit entry and meaningful notification are saved in one D1 transaction. Failed email delivery leaves claims intact; retries reuse a notification key. Google delivery uses a stable Message-ID and records the provider receipt. Ambiguous or interrupted sends are marked uncertain and require checking Sent mail before a resend; definitive failures may be retried. The optional Resend adapter keeps its 23-hour retry guard for its 24-hour idempotency window.
- Related review totals prevent splitting a same-store claim around the $200 threshold. Owners cannot change the related-claim group; leadership reviews group exceptions. Standard, repeated, disputed, late and other flagged claims require leadership approval. Unsold inventory is kept out of automatic quality approval.
- Finance records a check; the owner communicates the final outcome. Approval, disposition and payment are separate. No money moves, invoices change, or credits are issued by this software.
- Proposed policy values remain disabled until leadership enables the pilot. The confirmed cap is $3,000 in approvals per Washington calendar month, with individual leadership review of exceptions and no automatic percentage allowance. Destruction is off by default and requires leadership plus written claim-specific authorization and records if enabled.
- Reporting exports original timestamps, open/overdue work, blockers, payment records, approved late exceptions, payment flags, missed pickups and elapsed days; weekly audit sampling selects 10% of quick claims (rounded up) plus every flagged claim. Audit data stays internal.

## Before any real launch

1. **Google sign-in:** create a Google OAuth web client and add `https://<approved-host>/api/returns/auth/callback` as its exact redirect URI. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as server-side settings/secrets. Configure `RETURNS_STAFF` as an explicit JSON map of lower-case staff emails to `{ "name": "…", "role": "rep|owner|finance|lead" }`. Confirm who can approve, record payment, authorize destruction and audit. Company domain membership is insufficient.
2. **Production storage:** create a separate production D1 database, apply migrations in order, and configure its `RETURNS_DB` binding separately. Never bind the fictional preview database to production. Choose retention, backup/restore ownership, attachment size limits and document access/handling rules. This preview keeps bounded private attachments in D1 to avoid adding a second storage service; larger files should use private object storage.
3. **Google email delivery:** the selected provider is Google Workspace, with `RETURNS_FROM=Sungrown Returns <returns@sungrown.com>` and replies to `returns@sungrown.com`. The sender is confirmed as a Google user mailbox. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_MAIL_REFRESH_TOKEN` as runtime secrets after an explicit Gmail send-only consent flow. Do not paste credentials into chat or commit them. Test sender identity, replies, bounce handling and staff retry/reconciliation using an approved staff recipient before enabling `REAL_EMAIL_ENABLED=true`. Real Google authorization and delivery remain unverified.
4. **Policy decisions:** leadership must confirm the proposed 60-day pilot, 90/100-day windows, $200 related-claim review threshold, late/hardware exceptions, unsold-inventory handling, business-day holiday calendar, owner acknowledgement targets, payment-clock rules, exposure cap and exception tolerance. Confirm any regulatory requirements separately; proposed values are business inputs, not legal conclusions. Confirm onsite destruction explicitly or leave disabled.
5. **Launch settings:** production remains `RETURNS_MODE=disabled`, `INTAKE_ENABLED=false`, `REAL_EMAIL_ENABLED=false`. An approved release must intentionally configure production as `RETURNS_MODE=live`, `INTAKE_ENABLED=true`, `POLICY_APPROVED=true`, live email settings and approved persisted pilot settings. Preview role login is unavailable in live mode. No production deployment or real emails are authorized by this preview task.
6. **Operations:** assign returns owners, Finance coverage, a regular queue/overdue review, weekly audit responsibility, failed-email monitoring and reporting cadence. Set up a scheduled outbox drain for provider outages if desired; this version attempts immediate delivery and provides staff retries. Do not imply that scheduling or records entry performs a physical pickup, destroys product or issues a check.

## Verification

`node --test tests/*.test.mjs` covers idempotency and receipt uniqueness, attachment-only intake, private status data, invalid/expired/revoked links, neutral/rate-limited recovery, failed-email retry, the exact $200 boundary and related totals, staff role checks, CSRF, stale versions, the $120 journey with missed pickup and actual check outcome, late submissions, disabled destruction, reporting/audit, launch gates and business-day calculations.

Live Google OAuth, real outbound email, actual payments, actual product handling and production launch are intentionally unverified/disabled. The holiday calendar starts empty; leadership must supply holidays before making business-day service promises.

References: [Cloudflare Pages environment configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Launch preparation — November 3, 2026

The separate `sungrown-returns-production` D1 database has been created and its schema initialized without demo data. Its binding is staged in this branch; production intake, real email and policy approval remain disabled. `www.sungrown.com` has been added to Pages as a pending custom domain. GoDaddy still serves authoritative DNS; the public `www` CNAME remains on Squarespace until the cutover is authorized and performed. A DNS baseline and rollback instructions are saved with the handoff.

Production readiness validation now includes an atomic exposure-cap guard: simultaneous approvals cannot both consume the same remaining cap. Completion reporting reads the configured completion window.

## Updated leadership inputs

Submission/completion windows are 90/100 calendar days. The other pilot terms were accepted. Eight staff accounts and their roles are confirmed privately; the allowlist is not committed to this public repository.

Monthly cap enforcement is atomic. Paid returns cannot be re-decided. A cross-month approval does not consume the new month’s budget, and reporting reads the configured completion window. Google sending does not assume provider idempotency: an uncertain send is held for reconciliation rather than automatically repeated.

The monthly approval cap is confirmed at $3,000, with individual leadership review for exceptions and no automatic exception-percentage allowance. The returns sender is confirmed as a Google user mailbox. Staff assignments are confirmed privately, including one explicitly authorized combined owner/Finance account; backend and UI support multiple roles. No real staff identity or private allowlist is included in source control. Pilot activation and live intake/email remain off pending Google setup and domain cutover.

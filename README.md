# Sungrown.com

Portable informational rebuild of Sungrown's existing Squarespace site. Static HTML, CSS, JavaScript, local fonts, images, and video; no package installation or build step is required.

## Preview

```sh
python3 -m http.server 4173 --directory public
```

Open http://localhost:4173. Edit the HTML files in `public/`, shared behavior in `public/site.js`, and migration overrides in `public/site.css`. The original layout styles are retained in `public/assets/` to preserve the existing design.

## Cloudflare Pages

In Cloudflare, open **Workers & Pages → Create application → Pages → Import an existing Git repository** and select `marcusnaramore/Sungrown.com`.

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Production branch | main |
| Build command | `exit 0` |
| Build output directory | `public` |

Cloudflare's Git integration deploys subsequent commits automatically. No API tokens or environment variables are needed for this static site. For a CLI deployment after authentication, run `npx wrangler pages deploy public --project-name sungrown-com` (create the Pages project first).

Official setup reference: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Pages

- `/`: homepage, company film, brands overview, community invitation.
- `/about`: brand and product information; purchasing, pricing, and product-finder links omitted.
- `/resources`: brand asset library and original general contact Google Form. Wholesale pricing and ordering sections omitted; returns implementation deferred.
- `/moodlist`: original Google Forms newsletter signup.
- `404.html`: real missing-page response instead of a single-page application fallback.

The original broken second homepage brand button now points to `/about`. Mobile navigation works without Squarespace scripts. Images, fonts, styles, and company film are local; Google Forms and the linked Google Drive asset library remain external dependencies. No form submissions were sent during testing.

## Migration checklist

1. Deploy to a `pages.dev` preview and review every page, embedded form, and asset-library permission with the site owner.
2. Add `sungrown.com` and `www.sungrown.com` in Pages **Custom domains** and follow Cloudflare's DNS validation steps. Choose and configure a primary-host redirect there. Preserve existing email records (MX, SPF, DKIM, DMARC).
3. Verify the preview before switching DNS. Confirm current brand copy, product claims, copyright date, and disclaimer with the owner; content intentionally matches the existing site.
4. After DNS propagation, verify HTTPS, both hostnames, the four routes, and Google Forms response destinations. Keep Squarespace available until the migration is verified, then cancel its hosting separately.

Canonical and social URLs point to the eventual `https://www.sungrown.com` domain. Update those if the primary domain changes. No DNS, domain, email, or existing-hosting changes are included in this repository.

## Future work

Returns support can be added separately once its fields, submission destination, and staff workflow are defined. There is no dashboard, account portal, returns form, wholesale menu, cart, or checkout in this version.

The source preserves the owner's existing branding and site layout. The repository's assets and retained styles remain subject to their original licenses; this repository does not grant new rights to third parties.

## Validation

Run `python3 scripts/check.py` to validate local references, Cloudflare asset size limits, and excluded commerce routes. Desktop and 390px mobile navigation and brand-image layouts were checked in a browser. The 69-second company film was verified as H.264 video with AAC audio and compressed below the Pages per-file limit.

The existing Google Forms endpoints returned HTTP 401 during migration verification, so successful embedding, public access, and response delivery remain unverified. Original form URLs are preserved with direct-link fallbacks. The form owner should verify sharing/access before launch. The MoodList layout is widened for responsive embedding, and its header contrast is corrected.

## Returns feature preview

The `feature/returns-preview` branch adds `/returns/`, `/admin/returns/`, a dedicated D1 backend, private attachments, notification outbox/test inbox, and isolated Google OIDC authorization scaffolding. **Do not merge or deploy this branch to production as part of preview review.** See `returns/LAUNCH.md` for setup, review steps, and remaining launch decisions.

Local development (Node >=22.13): `node returns/dev.mjs`; tests: `node --test tests/*.test.mjs`. The local SQLite preview uses the same backend request handler and SQL as the Cloudflare Pages Functions deployment, through a small D1-compatible adapter. The `.returns-local` directory is ignored and never uploaded.

## Returns: barcode lookup, $250 trust tier, credits and rep requests (Nov 2026)

Decided Nov 17, 2026: 90-day standard window; per-store exceptions (180 / 365 / Always) come from the
**Returns Policy Exceptions** column in 5RD; returns priced at $250 or less per store over a rolling
30 days go to the trust tier (onsite destruction suggested, still needs an owner decision); buyers
choose check or credit; credits sit on a Pending credits list until Finance applies them to an order.

**Weekly (Owner/Finance/Leadership):** Returns workspace → Order data & stores → upload the OMS
*Transfer Outbound Details* export as downloaded (.xlsx or .csv, last 7–10 days). The browser reads
the file and uploads it in chunks; duplicate lines are skipped.

**When 5RD changes (Leadership):** download the 5RD tab and upload it on the same page. It replaces
the store list. Approved 180-day requests survive re-uploads.

**Rep emails (Leadership):** set on the same page. Reps without an email (open territories) fall back
to `REP_FALLBACK_EMAIL` (default marcus@sungrown.com).

**Database:** the new tables create themselves on first use. The live policy change (quick limit
$200 → $250, 30-day rolling total) only happens when migration `0005_catalog_trust_credits.sql`
is applied: `npx wrangler d1 migrations apply sungrown-returns-production --env production --remote`.
The public preview stays fictional: real order or store files are refused there.

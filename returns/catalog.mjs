// Store list (5RD), shipped-package lookup (OMS export), rep requests and pending credits.
// Kept separate from core.mjs; core passes its shared helpers in as `h`.

const DAY = 86400000;
export const WINDOWS = ['90', '180', '365', 'always'];
const REQUEST_KINDS = { discuss: 'Buyer wants to talk with their rep', extended_window: 'Ask about a 180-day return window', slow_sellers: 'Talk to my rep about slow sellers' };
const ACCEPTED = ['Accepted', 'PartiallyAccepted'];

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const license = s => String(s ?? '').trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
export const storeKey = (lic, name) => (license(lic) ? 'L' + license(lic) + ':' : 'N:') + slug(name);
export function normalizeWindow(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s.startsWith('always')) return 'always';
  const n = s.match(/\d+/)?.[0];
  return WINDOWS.includes(n) ? n : '90';
}
// Cloudflare Pages does not run D1 migrations on deploy, so the tables this module needs are
// created on first use (identical to migration 0005; safe to run both). Policy changes are NOT applied
// here in the live workspace: run migration 0005 deliberately. The fictional preview applies them itself.
const ready = new WeakSet();
const DDL = [
  "CREATE TABLE IF NOT EXISTS stores(key TEXT PRIMARY KEY,license TEXT,name TEXT NOT NULL,rep TEXT,route TEXT,segment TEXT,parent TEXT,return_window TEXT NOT NULL DEFAULT '90',updated TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS stores_license ON stores(license)',
  'CREATE TABLE IF NOT EXISTS shipments(id TEXT PRIMARY KEY,license TEXT NOT NULL,client TEXT,tsid TEXT NOT NULL,order_number TEXT,product TEXT,units REAL,unit_cents INTEGER,status TEXT,delivered TEXT NOT NULL,imported TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS shipments_tsid ON shipments(tsid)',
  'CREATE INDEX IF NOT EXISTS shipments_delivered ON shipments(delivered)',
  'CREATE TABLE IF NOT EXISTS rep_requests(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,idempotency TEXT UNIQUE NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)',
  "INSERT OR IGNORE INTO configuration VALUES('rep_emails','{}')",
  "INSERT OR IGNORE INTO configuration VALUES('catalog','{}')",
];
export async function ensureSchema(h, env) {
  if (ready.has(env.RETURNS_DB)) return;
  for (const sql of DDL) await h.q(env, sql).run();
  if (env.RETURNS_MODE === 'preview')
    await h.q(env, "UPDATE configuration SET data=json_set(data,'$.submitDays',90,'$.completeDays',100,'$.quickLimit',20000,'$.trustWindowDays',30) WHERE key='policy' AND json_extract(data,'$.trustWindowDays') IS NULL").run();
  ready.add(env.RETURNS_DB);
}

const windowDays = w => (w === 'always' ? null : Number(w || 90));

async function config(h, env, key) {
  const r = await h.q(env, 'SELECT data FROM configuration WHERE key=?', key).first();
  return r ? JSON.parse(r.data) : {};
}
async function saveConfig(h, env, key, data) {
  await h.q(env, 'INSERT INTO configuration(key,data) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data', key, JSON.stringify(data)).run();
}

// ---------- Imports (staff only, live workspace only) ----------

export async function importShipments(h, env, body, s) {
  if (env.RETURNS_MODE === 'preview') h.fail('Preview uses fictional data only. Import real order data in the live staff workspace.', 403);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > 2000) h.fail('Send between 1 and 2,000 rows at a time.');
  const imported = h.now(), statements = [];
  let skipped = 0, first = null, last = null;
  for (const r of rows) {
    const tsid = String(r.tsid ?? '').trim(), lic = license(r.license), delivered = String(r.delivered ?? '');
    const units = Number(r.units), price = Number(r.price);
    if (!/^\d{6,24}$/.test(tsid) || !/^\d{1,9}$/.test(lic) || !/^\d{4}-\d{2}-\d{2}$/.test(delivered) || !(units > 0) || !(price >= 0)) { skipped++; continue; }
    const unitCents = Math.round((price / units) * 100);
    const id = await h.hash([r.manifest, tsid, lic, r.order, units, price].join('|'));
    statements.push(h.q(env, 'INSERT OR REPLACE INTO shipments(id,license,client,tsid,order_number,product,units,unit_cents,status,delivered,imported) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id, lic, h.clean(r.client, 140), tsid, h.clean(r.order, 40), h.clean(r.product, 240), units, unitCents, h.clean(r.status, 40), delivered, imported));
    first = !first || delivered < first ? delivered : first;
    last = !last || delivered > last ? delivered : last;
  }
  for (let i = 0; i < statements.length; i += 100) await env.RETURNS_DB.batch(statements.slice(i, i + 100));
  const c = await config(h, env, 'catalog');
  c.shipments = { importedAt: imported, by: s.email, latestBatch: { first, last, saved: statements.length, skipped } };
  await saveConfig(h, env, 'catalog', c);
  return { saved: statements.length, skipped };
}

export async function importStores(h, env, body, s) {
  if (env.RETURNS_MODE === 'preview') h.fail('Preview uses fictional data only. Import the real store list in the live staff workspace.', 403);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const run = h.clean(body.importId, 60);
  if (!run || rows.length > 2000) h.fail('Send up to 2,000 store rows per request with an import ID.');
  const overrides = await config(h, env, 'window_overrides');
  const statements = [];
  for (const r of rows) {
    const name = h.clean(r.name, 140);
    if (!name) continue;
    const key = storeKey(r.license, name);
    let w = normalizeWindow(r.window);
    if (w === '90' && overrides[key]) w = overrides[key];
    statements.push(h.q(env, 'INSERT OR REPLACE INTO stores(key,license,name,rep,route,segment,parent,return_window,updated) VALUES(?,?,?,?,?,?,?,?,?)',
      key, license(r.license) || null, name, h.clean(r.rep, 80) || null, h.clean(r.route, 120) || null, h.clean(r.segment, 60) || null, h.clean(r.parent, 140) || null, w, run));
  }
  for (let i = 0; i < statements.length; i += 100) await env.RETURNS_DB.batch(statements.slice(i, i + 100));
  let removed = 0;
  if (body.final === true) {
    const result = await h.q(env, 'DELETE FROM stores WHERE updated<>?', run).run();
    removed = result.meta.changes;
    const c = await config(h, env, 'catalog');
    c.stores = { importedAt: h.now(), by: s.email };
    await saveConfig(h, env, 'catalog', c);
  }
  return { saved: statements.length, removed };
}

export async function catalogSummary(h, env) {
  const c = await config(h, env, 'catalog');
  const ship = await h.q(env, 'SELECT COUNT(*) n, MIN(delivered) first, MAX(delivered) last, COUNT(DISTINCT license) stores FROM shipments').first();
  const stores = await h.q(env, 'SELECT COUNT(*) n, SUM(CASE WHEN license IS NULL THEN 1 ELSE 0 END) unlicensed FROM stores').first();
  const { results: exceptions } = await h.q(env, "SELECT key,name,license,return_window FROM stores WHERE return_window<>'90' ORDER BY name").all();
  const { results: reps } = await h.q(env, "SELECT COALESCE(rep,'(no rep)') rep, COUNT(*) n FROM stores GROUP BY COALESCE(rep,'(no rep)') ORDER BY n DESC").all();
  const { results: unmatched } = await h.q(env, "SELECT license, MAX(client) client, COUNT(*) n FROM shipments WHERE license NOT IN (SELECT license FROM stores WHERE license IS NOT NULL) GROUP BY license ORDER BY client").all();
  return { imports: c, shipments: ship, stores, exceptions, reps, repEmails: await config(h, env, 'rep_emails'), unmatched, fallback: repFallback(env) };
}

export async function saveRepEmails(h, env, body) {
  const map = {};
  for (const [rep, address] of Object.entries(body.repEmails || {})) {
    const e = h.email(address);
    if (!e) continue;
    if (!/^\S+@\S+\.\S+$/.test(e)) h.fail(`Enter a valid email for ${rep}.`);
    map[h.clean(rep, 80)] = e;
  }
  await saveConfig(h, env, 'rep_emails', map);
  return { repEmails: map };
}

// ---------- Public store list and package lookup ----------

export async function listStores(h, env) {
  const { results } = await h.q(env, 'SELECT key,name FROM stores ORDER BY name').all();
  return results;
}

export async function storeByKey(h, env, key) {
  if (key) await ensureSchema(h, env);
  return key ? await h.q(env, 'SELECT * FROM stores WHERE key=?', h.clean(key, 200)).first() : null;
}

export async function lookup(h, env, store, tsidInput) {
  const tsid = String(tsidInput ?? '').replace(/\D/g, '');
  if (!store) h.fail('Choose your store from the list first.');
  if (tsid.length < 6) h.fail('Enter the package barcode number (the long number on the label).');
  const statuses = ACCEPTED.map(() => '?').join(',');
  const shipment = store.license
    ? await h.q(env, `SELECT * FROM shipments WHERE tsid=? AND license=? AND status IN (${statuses}) ORDER BY delivered DESC LIMIT 1`, tsid, store.license, ...ACCEPTED).first()
    : await h.q(env, `SELECT * FROM shipments WHERE tsid=? AND lower(client)=lower(?) AND status IN (${statuses}) ORDER BY delivered DESC LIMIT 1`, tsid, store.name, ...ACCEPTED).first();
  const days = windowDays(store.return_window);
  if (!shipment) return { tsid, found: false, windowDays: days };
  const age = Math.floor((Date.parse(h.washingtonDate(h.now())) - Date.parse(shipment.delivered)) / DAY);
  return { tsid, found: true, product: shipment.product, orderNumber: shipment.order_number, delivered: shipment.delivered,
    unitCents: shipment.unit_cents, shippedUnits: shipment.units, daysSinceDelivery: age, windowDays: days, withinWindow: days == null || age <= days };
}

export const ISSUES = ['Won’t fire', 'Leaking or clogged', 'Freshness or quality', 'Other'];
export const MIXED_ISSUE = 'Multiple reasons (see items)';

// One reason for the whole return: the shared per-item reason, or a mixed label.
export function claimIssue(lines) {
  const set = [...new Set((lines || []).map(l => l.issue).filter(Boolean))];
  return set.length === 1 ? set[0] : set.length ? MIXED_ISSUE : '';
}

export async function priceLines(h, env, store, lines) {
  if (!Array.isArray(lines) || lines.length > 50) h.fail('Add up to 50 items per return.');
  const priced = [];
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) h.fail('Enter a whole-number quantity for each item.');
    const found = await lookup(h, env, store, l.tsid);
    const units = found.found ? Math.min(qty, found.shippedUnits || qty) : qty;
    const issue = h.clean(l.issue, 80) || null;
    if (issue && !ISSUES.includes(issue)) h.fail('Choose what went wrong for each item.');
    priced.push({ ...found, qty, lineCents: found.found ? found.unitCents * units : null, issue, note: h.clean(l.note, 500) || null });
  }
  const matched = priced.every(l => l.found);
  return { lines: priced, matched, totalCents: matched ? priced.reduce((n, l) => n + l.lineCents, 0) : null,
    earliestDelivery: priced.filter(l => l.found).map(l => l.delivered).sort()[0] || null, anyLate: priced.some(l => l.found && !l.withinWindow) };
}

// ---------- Rep requests ----------

const repFallback = env => (env.RETURNS_MODE === 'preview' ? 'lead@demo.example' : env.REP_FALLBACK_EMAIL || 'marcus@sungrown.com');

export async function createRepRequest(h, env, req, body) {
  if (env.RETURNS_MODE !== 'preview' && env.INTAKE_ENABLED !== 'true') h.fail('Requests open when the returns portal launches. Please contact your rep directly.', 503);
  await h.limit(req, env, 'rep-request', 10);
  const kind = h.clean(body.kind, 40), contact = h.clean(body.name, 120), mail = h.email(body.email), note = h.clean(body.note, 1000), key = h.clean(body.idempotency, 100);
  if (!REQUEST_KINDS[kind] || !contact || !/^\S+@\S+\.\S+$/.test(mail) || key.length < 16) h.fail('Choose your store and enter your name and work email.');
  if (kind === 'discuss' && !note) h.fail('Tell us what you’d like to discuss.');
  if (env.RETURNS_MODE === 'preview' && !mail.endsWith('.example')) h.fail('Preview only: use a fictional email ending in .example.');
  const store = await storeByKey(h, env, body.storeKey);
  const storeName = store?.name || h.clean(body.store, 140);
  if (!storeName) h.fail('Choose your store.');
  const idem = await h.hash(mail + '|' + key);
  const existing = await h.q(env, 'SELECT id FROM rep_requests WHERE idempotency=?', idem).first();
  if (existing) return { message: 'Thanks. Your rep will reach out.' };
  const repEmails = await config(h, env, 'rep_emails');
  const recipient = env.RETURNS_MODE === 'preview' ? 'rep@demo.example' : (store?.rep && repEmails[store.rep]) || repFallback(env);
  const id = h.uid(), created = h.now();
  const data = { kind, storeKey: store?.key || null, store: storeName, rep: store?.rep || null, currentWindow: store?.return_window || null, contact, email: mail, note, status: 'New', created, recipient, history: [] };
  await h.q(env, 'INSERT OR IGNORE INTO rep_requests(id,idempotency,data) VALUES(?,?,?)', id, idem, JSON.stringify(data)).run();
  const origin = new URL(req.url).origin;
  const text = `${REQUEST_KINDS[kind]}\n\nStore: ${storeName}\nContact: ${contact} <${mail}>\nAssigned rep: ${store?.rep || 'None on file'}\n${kind !== 'slow_sellers' ? `Current return window: ${store?.return_window || '90'} days\n` : ''}\n${note || '(No note)'}\n\nReply to the buyer directly, then mark it handled: ${origin}/admin/returns/?view=requests`;
  await h.q(env, 'INSERT OR IGNORE INTO outbox(id,claim_id,event_key,recipient,payload) VALUES(?,?,?,?,?)', h.uid(), 'rep-request:' + id, 'rep-request-' + id, recipient,
    JSON.stringify({ subject: `${storeName} · ${REQUEST_KINDS[kind]}`, text, link: `${origin}/admin/returns/?view=requests`,
      html: `<h2>${h.html(REQUEST_KINDS[kind])}</h2><p><b>Store:</b> ${h.html(storeName)}<br><b>Contact:</b> ${h.html(contact)} &lt;${h.html(mail)}&gt;<br><b>Assigned rep:</b> ${h.html(store?.rep || 'None on file')}</p><p>${h.html(note || '(No note)')}</p><p><a href="${origin}/admin/returns/?view=requests">Open rep requests</a></p>` })).run();
  const mailRow = await h.q(env, 'SELECT id FROM outbox WHERE event_key=?', 'rep-request-' + id).first();
  await h.deliver(env, mailRow.id);
  return { message: 'Thanks. Your rep will reach out.' };
}

export async function listRepRequests(h, env) {
  const { results } = await h.q(env, 'SELECT * FROM rep_requests ORDER BY seq DESC LIMIT 300').all();
  const { results: mails } = await h.q(env, "SELECT claim_id, state, error FROM outbox WHERE claim_id LIKE 'rep-request:%'").all();
  const mailState = Object.fromEntries(mails.map(m => [m.claim_id.slice(12), m]));
  return results.map(r => ({ id: r.id, ref: 'RQ-' + (1000 + r.seq), version: r.version, ...JSON.parse(r.data), email_state: mailState[r.id]?.state || null }));
}

export async function updateRepRequest(h, env, id, body, s) {
  const r = await h.q(env, 'SELECT * FROM rep_requests WHERE id=?', id).first();
  if (!r) h.fail('Request not found.', 404);
  if (body.version !== r.version) h.fail('Someone else updated this request. Refresh and try again.', 409);
  const data = JSON.parse(r.data), action = h.clean(body.action, 20), note = h.clean(body.note, 1000);
  const roles = h.rolesOf(s);
  if (action === 'contacted') data.status = 'Contacted';
  else if (action === 'approve' || action === 'decline') {
    if (data.kind === 'slow_sellers') h.fail('Only return-window requests need a decision.');
    if (!roles.includes('lead')) h.fail('The Sales Director (leadership role) decides return-window requests.', 403);
    if (action === 'approve') {
      if (!data.storeKey) h.fail('This request is not linked to a store on the list. Add the store in 5RD first.');
      await h.q(env, "UPDATE stores SET return_window='180' WHERE key=? AND return_window IN ('90')", data.storeKey).run();
      const overrides = await config(h, env, 'window_overrides');
      overrides[data.storeKey] = '180';
      await saveConfig(h, env, 'window_overrides', overrides);
    }
    data.status = action === 'approve' ? '180 days approved' : 'Kept at 90 days';
  } else h.fail('Unknown action.');
  data.history = [...(data.history || []), { at: h.now(), by: s.email, action, note }];
  const result = await h.q(env, 'UPDATE rep_requests SET data=?,version=version+1 WHERE id=? AND version=?', JSON.stringify(data), id, r.version).run();
  if (!result.meta.changes) h.fail('Someone else updated this request. Refresh and try again.', 409);
  return { ok: true };
}

// ---------- Large returns: leadership approval with the rep in the conversation ----------

export async function notifyLargeReturn(h, env, req, c, p) {
  if (c.path !== 'large') return;
  const limit = p.approvalLimit || 150000;
  const repEmails = await config(h, env, 'rep_emails');
  const lead = repFallback(env);
  const rep = env.RETURNS_MODE === 'preview' ? 'rep@demo.example' : (c.rep && repEmails[c.rep]) || null;
  const origin = new URL(req.url).origin, link = `${origin}/admin/returns/?claim=${c.id}`;
  const amount = '$' + ((c.relatedTotal ?? c.requestedCents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const subject = `${c.store} · ${c.ref} · ${amount} return needs leadership approval`;
  const text = `${c.store} submitted ${c.ref}: ${amount} (over the $${(limit / 100).toLocaleString('en-US')} approval line, counting this store's last 30 days).\n\nLeadership approves this one, with the store's rep in the conversation before the buyer hears a decision.\nRep: ${c.rep || 'none on file'}\nBuyer: ${c.email}\n\nItems:\n${c.product}\n\nOpen it: ${link}`;
  const html = `<p><b>${h.html(c.store)}</b> submitted <b>${h.html(c.ref)}</b>: <b>${h.html(amount)}</b>, over the $${(limit / 100).toLocaleString('en-US')} approval line (this store's last 30 days).</p><p>Leadership approves this one, with the store's rep in the conversation before the buyer hears a decision.<br>Rep: ${h.html(c.rep || 'none on file')} · Buyer: ${h.html(c.email)}</p><pre style="white-space:pre-wrap">${h.html(c.product)}</pre><p><a href="${link}">Open the return</a></p>`;
  const recipients = [...new Set([rep, lead].filter(Boolean))];
  for (const to of recipients) {
    const key = `large-${c.id}-${to}`;
    await h.q(env, 'INSERT OR IGNORE INTO outbox(id,claim_id,event_key,recipient,payload) VALUES(?,?,?,?,?)', h.uid(), 'large-return:' + c.id, key, to, JSON.stringify({ subject, text, html, link })).run();
    const m = await h.q(env, 'SELECT id,state FROM outbox WHERE event_key=?', key).first();
    if (m.state === 'pending') await h.deliver(env, m.id);
  }
}

// ---------- Pending credits ----------

export function creditsFrom(claims) {
  return claims
    .filter(c => c.paymentMethod === 'credit' || (c.decision === 'approved' && c.paymentPreference === 'credit' && !c.paymentDate))
    .map(c => ({ id: c.id, ref: c.ref, store: c.store, rep: c.rep || null, cents: c.creditCents ?? c.approvedCents, status: c.creditStatus === 'applied' ? 'Applied' : c.creditStatus === 'pending' ? 'Pending · next order' : 'Approved · credit requested', approvedOn: c.creditApprovedDate || null, appliedOrder: c.creditOrder || null, appliedOn: c.creditStatus === 'applied' ? c.paymentDate : null }))
    .sort((a, b) => (a.status === 'Applied') - (b.status === 'Applied') || String(a.store).localeCompare(String(b.store)));
}

// ---------- Fictional preview data ----------

export async function seedCatalog(h, env) {
  await ensureSchema(h, env);
  if ((await h.q(env, 'SELECT COUNT(*) n FROM stores').first()).n) return;
  const today = h.washingtonDate(h.now());
  const daysAgo = n => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
  const stores = [
    ['900001', 'Cedar Retail · Demo', 'Sam · Sales rep', '90'],
    ['900002', 'Juniper Retail · Demo', 'Sam · Sales rep', '180'],
    ['900003', 'Cascade Retail · Demo', 'Sam · Sales rep', 'always'],
    ['', 'Tamarack Tribal Retail · Demo', '', '90'],
  ];
  for (const [lic, name, rep, w] of stores)
    await h.q(env, 'INSERT OR IGNORE INTO stores(key,license,name,rep,route,segment,parent,return_window,updated) VALUES(?,?,?,?,?,?,?,?,?)', storeKey(lic, name), lic || null, name, rep || null, 'Demo route', '2 - Partner', null, w, 'seed').run();
  const ships = [
    ['9000000000000101', '900001', 'Cedar Retail · Demo', 'Demo Cart · 1g · Sunrise (fictional)', 12, 1200, 20],
    ['9000000000000102', '900001', 'Cedar Retail · Demo', 'Demo All-in-One · 1g · Dusk (fictional)', 10, 1300, 140],
    ['9000000000000201', '900002', 'Juniper Retail · Demo', 'Demo Cart · 1g · Sunrise (fictional)', 20, 1150, 150],
    ['9000000000000301', '900003', 'Cascade Retail · Demo', 'Demo Gummies · 20pk (fictional)', 30, 650, 400],
    ['9000000000000401', '', 'Tamarack Tribal Retail · Demo', 'Demo Cart · 1g · Sunrise (fictional)', 8, 1200, 10],
  ];
  for (const [tsid, lic, client, product, units, unitCents, ago] of ships)
    await h.q(env, 'INSERT OR IGNORE INTO shipments(id,license,client,tsid,order_number,product,units,unit_cents,status,delivered,imported) VALUES(?,?,?,?,?,?,?,?,?,?,?)', 'seed-' + tsid, lic || 'TRIBAL', client, tsid, 'DEMO-' + tsid.slice(-3), product, units, unitCents, 'Accepted', daysAgo(ago), h.now()).run();
}

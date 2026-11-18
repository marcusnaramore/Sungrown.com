import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { handle } from '../returns/core.mjs';
import { adapter } from '../returns/dev.mjs';
import { readCsv, shipmentRows, storeRows, isoDate } from '../public/returns/sheet-reader.js';

const names = ['0001_returns.sql', '0002_delivery_receipts.sql', '0003_launch_policy_proposal.sql', '0004_confirm_monthly_cap_and_manual_exceptions.sql', '0005_catalog_trust_credits.sql'];
const migrations = await Promise.all(names.map(n => readFile(new URL('../migrations/' + n, import.meta.url), 'utf8')));
const sha = s => createHash('sha256').update(s).digest('hex');

function setup(mode = 'preview') {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) db.exec(m);
  const env = { RETURNS_MODE: mode, RETURNS_DB: adapter(db) };
  const t = {
    db, env,
    async request(path, body, auth, headers = {}) {
      const r = await handle(new Request('https://preview.example/api/returns/' + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { origin: 'https://preview.example', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body) }), env);
      return { status: r.status, body: await r.json() };
    },
    async login(role = 'owner') {
      const r = await handle(new Request('https://preview.example/api/returns/demo-login', { method: 'POST', headers: { origin: 'https://preview.example', 'content-type': 'application/json' }, body: JSON.stringify({ email: role + '@demo.example' }) }), env);
      const body = await r.json();
      return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: body.staff.csrf };
    },
    // Live-mode staff session for an allowlisted account (live mode never uses demo roles).
    liveSession(email) {
      const raw = 'a'.repeat(63) + Math.floor(Math.random() * 10), csrf = 'c'.repeat(64);
      db.prepare('INSERT INTO staff_sessions VALUES(?,?,?,?)').run(sha(raw), email, Date.now() + 3600000, csrf);
      return { cookie: 'sg_staff=' + raw, csrf };
    },
  };
  return t;
}
const claim = (t, ref) => { const r = t.db.prepare('SELECT * FROM claims WHERE seq=?').get(Number(ref.slice(3)) - 1000); return { id: r.id, version: r.version, ...JSON.parse(r.data) }; };
const intake = (store, lines, more = {}) => ({ storeKey: store, email: 'buyer@cedar.example', issue: 'Leaking or clogged', note: '', lines, idempotency: crypto.randomUUID(), ...more });
const CEDAR = 'L900001:cedarretaildemo', JUNIPER = 'L900002:juniperretaildemo', CASCADE = 'L900003:cascaderetaildemo', TRIBAL = 'N:tamaracktribalretaildemo';

test('preview seeds fictional stores; lookup prices packages and applies each store window', async () => {
  const t = setup(); await t.login();
  const stores = (await t.request('stores')).body.stores;
  assert.equal(stores.length, 4);
  assert.ok(stores.every(s => s.name.includes('Demo')));
  assert.ok(stores.every(s => !('rep' in s) && !('license' in s)), 'public store list exposes names only');
  let r = (await t.request('lookup', { storeKey: CEDAR, tsid: '9000000000000101' })).body;
  assert.equal(r.found, true); assert.equal(r.unitCents, 1200); assert.equal(r.windowDays, 90); assert.equal(r.withinWindow, true);
  r = (await t.request('lookup', { storeKey: CEDAR, tsid: '9000-0000-0000-0102' })).body; // formatting is ignored
  assert.equal(r.found, true); assert.equal(r.withinWindow, false, '140 days is outside the 90-day window');
  assert.equal((await t.request('lookup', { storeKey: JUNIPER, tsid: '9000000000000201' })).body.withinWindow, true, '180-day store');
  assert.equal((await t.request('lookup', { storeKey: CASCADE, tsid: '9000000000000301' })).body.windowDays, null, 'always-paid store has no window');
  assert.equal((await t.request('lookup', { storeKey: TRIBAL, tsid: '9000000000000401' })).body.found, true, 'unlicensed store matches by name');
  assert.equal((await t.request('lookup', { storeKey: JUNIPER, tsid: '9000000000000101' })).body.found, false, 'another store’s package is never found');
});

test('barcode intake prices from order data and routes $250-or-less to the trust tier', async () => {
  const t = setup(); await t.login();
  const r = await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000101', qty: 2 }]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = claim(t, r.body.ref);
  assert.equal(c.store, 'Cedar Retail · Demo');
  assert.equal(c.requestedCents, 2400); assert.equal(c.purchaseValueCents, 2400);
  assert.equal(c.path, 'quick'); assert.equal(c.trustTier, true); assert.equal(c.suggestedDisposition, 'onsite_destruction');
  assert.match(c.product, /2 × Demo Cart/);
  assert.equal(c.decision, 'pending', 'trust tier never auto-approves');
  assert.equal(c.lines[0].orderNumber, 'DEMO-101');
});

test('late lines are flagged for review; quantities cannot exceed what shipped', async () => {
  const t = setup(); await t.login();
  const c = claim(t, (await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000102', qty: 99 }]))).body.ref);
  assert.ok(c.flags.includes('late')); assert.equal(c.path, 'standard');
  assert.equal(c.requestedCents, 13000, 'capped at the 10 units shipped');
  const always = claim(t, (await t.request('claims', intake(CASCADE, [{ tsid: '9000000000000301', qty: 3 }]))).body.ref);
  assert.equal(always.flags.includes('late'), false); assert.equal(always.path, 'quick');
});

test('trust tier counts a store’s claims over a rolling 30 days so a return cannot be split under $250', async () => {
  const t = setup(); await t.login();
  const a = claim(t, (await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000101', qty: 12 }]))).body.ref);
  assert.equal(a.path, 'quick'); assert.equal(a.requestedCents, 14400);
  const b = claim(t, (await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000101', qty: 12 }]))).body.ref);
  assert.equal(b.relatedTotal, 28800); assert.equal(b.path, 'standard');
  // A claim from 40 days ago no longer counts.
  const old = JSON.parse(t.db.prepare('SELECT data FROM claims WHERE id=?').get(a.id).data);
  old.submissionDate = new Date(Date.now() - 40 * 86400000).toISOString();
  t.db.prepare('UPDATE claims SET data=? WHERE id=?').run(JSON.stringify(old), a.id);
  const c = claim(t, (await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000101', qty: 12 }]))).body.ref);
  assert.equal(c.relatedTotal, 28800, 'b + c only: a is outside the 30 days'); assert.equal(c.path, 'standard');
});

test('real imports are refused in the public preview', async () => {
  const t = setup(), lead = await t.login('lead');
  assert.equal((await t.request('admin/import/shipments', { rows: [{ tsid: '1234567', license: '1', delivered: '2026-11-01', units: 1, price: 1 }] }, lead)).status, 403);
  assert.equal((await t.request('admin/import/stores', { rows: [], importId: 'x', final: true }, lead)).status, 403);
});

test('live: OMS and 5RD imports, license-keyed lookup, staff-only lookup while intake is closed', async () => {
  const t = setup('live');
  t.env.RETURNS_STAFF = JSON.stringify({ 'lead@sungrown.example': { name: 'Lead', roles: ['lead', 'owner', 'finance'] }, 'rep@sungrown.example': { name: 'Rep', role: 'rep' } });
  const lead = t.liveSession('lead@sungrown.example'), rep = t.liveSession('rep@sungrown.example');
  const csv = 'Last Pull,9-17 to 11-17\nManifest TSID,Inventory TSID,Retained ID,Client,License No.,Order Number,Product,Product Line,Sub Product Line,Status,Original Price,Price,Transfered Units,Original Accepted Units,Accepted Units,Action Status,ReShip Order No,Dispose Inventory TSID,Return Inventory TSID,Is Finalized,Requires Action,Transferred Date,Manifested Date,Discount Amount\n'
    + '12074702195920584,12074376261602020,,Evergreen Market - Auburn,414714,53473,Full Spec - Elite - Cartridge - 1g,Full Spec,Elite,Accepted,180.0000,180.0000,15.000,15.000,15.000,n/a,,,,True,False,' + new Date(Date.now() - 10 * 86400000).toLocaleDateString('en-US') + ' 4:57:53 AM,8/13/2026,$0.00\n'
    + '12074702195920584,12074376261602020,,Evergreen Market - Auburn,414714,53473,Full Spec - Elite - Cartridge - 1g,Full Spec,Elite,Accepted,180.0000,180.0000,15.000,15.000,15.000,n/a,,,,True,False,' + new Date(Date.now() - 10 * 86400000).toLocaleDateString('en-US') + ' 4:57:53 AM,8/13/2026,$0.00\n'
    + '1,12074376261602021,,Evergreen Market - Auburn,414714,53474,Rejected item,Full Spec,Elite,Rejected,10,10,1,0,0,n/a,,,,True,False,11/01/2026 1:00:00 PM,,$0.00\n';
  const ships = shipmentRows(readCsv(csv));
  assert.equal(ships.length, 3); assert.equal(ships[0].tsid, '12074376261602020', 'all 17 digits survive');
  assert.equal((await t.request('admin/import/shipments', { rows: ships }, rep)).status, 403, 'reps cannot import');
  const imp = await t.request('admin/import/shipments', { rows: ships }, lead);
  assert.equal(imp.status, 200); assert.equal(t.db.prepare('SELECT COUNT(*) n FROM shipments').get().n, 2, 'exact duplicate rows collapse');
  const fiveRd = storeRows(readCsv('State,Sungrown ID,Name,Segment,Rep Name,License,Route,Group / Parent Company,Returns Policy Exceptions\nWA,1,Evergreen Market - All,PC 2 - Partner,X,,,,\nWA,2,Evergreen Market - Auburn,2 - Partner,Emmanuel Diaz,414714,WA - KC 07,,365\nWA,3,Old Store,5 - Closed,X,1,,,\nNJ,4,Jersey Store,4 - Prospect,X,2,,,\nWA,5,Fireweed Cannabis Company,2 - Partner,Shannon Smith,,WA - NW,,\n'));
  assert.deepEqual(fiveRd.map(s => s.name), ['Evergreen Market - Auburn', 'Fireweed Cannabis Company']);
  assert.equal((await t.request('admin/import/stores', { rows: fiveRd, importId: 'run1', final: true }, lead)).status, 200);
  const sum = (await t.request('admin/catalog', undefined, rep)).body;
  assert.equal(sum.stores.n, 2); assert.equal(sum.exceptions[0].return_window, '365'); assert.equal(sum.fallback, 'marcus@sungrown.com');
  const key = 'L414714:evergreenmarketauburn';
  assert.equal((await t.request('lookup', { storeKey: key, tsid: '12074376261602020' })).status, 503, 'public lookup stays closed until intake opens');
  const staffLookup = (await t.request('admin/lookup', { storeKey: key, tsid: '12074376261602020' }, rep)).body;
  assert.equal(staffLookup.found, true); assert.equal(staffLookup.unitCents, 1200); assert.equal(staffLookup.orderNumber, '53473'); assert.equal(staffLookup.windowDays, 365);
  assert.equal((await t.request('admin/lookup', { storeKey: key, tsid: '12074376261602021' }, rep)).body.found, false, 'rejected transfers are not returnable');
  // A second store import replaces the list: stores no longer in 5RD drop off.
  await t.request('admin/import/stores', { rows: fiveRd.slice(0, 1), importId: 'run2', final: true }, lead);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM stores').get().n, 1);
  assert.equal(isoDate('46000'), '2025-12-09'); assert.equal(isoDate('8/17/2026 4:57:53 AM'), '2026-08-17');
});

test('rep requests reach the store’s rep (or the fallback), and the Sales Director approves 180 days', async () => {
  const t = setup('live');
  t.env.INTAKE_ENABLED = 'true';
  t.env.RETURNS_STAFF = JSON.stringify({ 'lead@sungrown.example': { name: 'Lead', roles: ['lead'] }, 'rep@sungrown.example': { name: 'Rep', role: 'rep' } });
  const lead = t.liveSession('lead@sungrown.example'), rep = t.liveSession('rep@sungrown.example');
  await t.request('admin/import/stores', { importId: 'r1', final: true, rows: [{ name: 'Store A', license: '111', rep: 'Chris Brendt' }, { name: 'Store B', license: '222', rep: 'Western Washington Rep' }] }, lead);
  await t.request('admin/rep-emails', { repEmails: { 'Chris Brendt': 'chris@sungrown.example' } }, lead);
  const ask = (storeKey, kind) => t.request('rep-request', { kind, storeKey, name: 'Buyer', email: 'buyer@store.example', note: 'Please call', idempotency: crypto.randomUUID() });
  assert.equal((await ask('L111:storea', 'slow_sellers')).status, 201);
  assert.equal((await ask('L222:storeb', 'extended_window')).status, 201);
  const to = t.db.prepare("SELECT recipient FROM outbox WHERE claim_id LIKE 'rep-request:%' ORDER BY rowid").all().map(r => r.recipient);
  assert.deepEqual(to, ['chris@sungrown.example', 'marcus@sungrown.com']);
  const list = (await t.request('admin/rep-requests', undefined, rep)).body.requests;
  const windowReq = list.find(r => r.kind === 'extended_window');
  assert.equal((await t.request('admin/rep-requests/' + windowReq.id, { action: 'approve', version: windowReq.version }, rep)).status, 403, 'reps cannot approve windows');
  assert.equal((await t.request('admin/rep-requests/' + windowReq.id, { action: 'approve', version: windowReq.version }, lead)).status, 200);
  assert.equal(t.db.prepare("SELECT return_window w FROM stores WHERE key='L222:storeb'").get().w, '180');
  // The approval survives the next 5RD import even before someone types 180 into 5RD.
  await t.request('admin/import/stores', { importId: 'r2', final: true, rows: [{ name: 'Store B', license: '222', rep: 'Western Washington Rep' }] }, lead);
  assert.equal(t.db.prepare("SELECT return_window w FROM stores WHERE key='L222:storeb'").get().w, '180');
});

test('credit settlement: pending on the next order, applied with an order number, buyer told both times', async () => {
  const t = setup(), owner = await t.login('owner'), finance = await t.login('finance'), lead = await t.login('lead');
  const ref = (await t.request('claims', intake(CEDAR, [{ tsid: '9000000000000101', qty: 2 }], { paymentPreference: 'credit' }))).body.ref;
  let c = claim(t, ref);
  const act = async (auth, b) => { const r = await t.request('admin/claims/' + c.id, { version: c.version, ...b }, auth); assert.equal(r.status, 200, JSON.stringify(r.body)); c = claim(t, ref); return r; };
  await act(owner, { action: 'assign', owner: 'owner@demo.example', nextAction: 'Reviewing', nextUpdate: '2026-12-01' });
  await act(owner, { action: 'review', requestedCents: 2400, purchaseValueCents: 2400, deliveryDate: c.deliveryDate, flags: [], checkProduct: true, checkQuantity: true, checkValue: true, checkTiming: true, checkDuplicates: true });
  await act(owner, { action: 'decision', decision: 'approved', approvedCents: 2400, message: 'Approved', nextUpdate: '2026-12-01' });
  await act(owner, { action: 'records', receivedDate: '2026-11-10', recordsDate: '2026-11-10', records: 'Fictional records' });
  assert.equal((await t.request('admin/credits', undefined, finance)).body.credits[0].status, 'Approved · credit requested');
  await act(finance, { action: 'payment', method: 'credit', paymentDate: '2026-11-11', paidCents: 2400 });
  assert.equal(c.creditStatus, 'pending'); assert.equal(c.paymentDate, undefined); assert.match(c.nextAction, /pay the invoice total/);
  assert.equal((await t.request('admin/claims/' + c.id, { version: c.version, action: 'outcome' }, owner)).status, 400, 'cannot close before the credit is applied');
  assert.equal((await t.request('admin/claims/' + c.id, { version: c.version, action: 'credit-applied', orderNumber: 'ORD - 55001', appliedDate: '2026-11-12' }, owner)).status, 403, 'only Finance applies credits');
  await act(finance, { action: 'credit-applied', orderNumber: 'ORD - 55001', appliedDate: '2026-11-12' });
  assert.equal(c.creditOrder, 'ORD-55001'); assert.equal(c.status, 'Payment issued');
  await act(owner, { action: 'outcome' });
  assert.match(c.nextAction, /applied a \$24\.00 credit to order ORD-55001/);
  const kinds = t.db.prepare('SELECT payload FROM outbox WHERE claim_id=? ORDER BY rowid').all(c.id).map(m => JSON.parse(m.payload).subject.split(' · ')[1]);
  assert.ok(kinds.includes('Credit approved') && kinds.includes('Credit applied'));
  const credits = (await t.request('admin/credits', undefined, lead)).body.credits;
  assert.equal(credits[0].status, 'Applied'); assert.equal(credits[0].appliedOrder, 'ORD-55001');
  const status = claim(t, ref);
  assert.equal(status.paymentReference, 'CREDIT-ORD-55001');
});

test('works on a database that never ran migration 0005; live policy is only changed by the migration', async () => {
  for (const mode of ['preview', 'live']) {
    const db = new DatabaseSync(':memory:');
    for (const m of migrations.slice(0, 4)) db.exec(m);
    const env = { RETURNS_MODE: mode, RETURNS_DB: adapter(db), RETURNS_STAFF: '{}' };
    const r = await handle(new Request('https://x.example/api/returns/stores', { headers: { origin: 'https://x.example' } }), env);
    assert.equal(r.status, 200);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='shipments'").get());
    const p = JSON.parse(db.prepare("SELECT data FROM configuration WHERE key='policy'").get().data);
    assert.equal(p.quickLimit, mode === 'preview' ? 25000 : 20000);
  }
});

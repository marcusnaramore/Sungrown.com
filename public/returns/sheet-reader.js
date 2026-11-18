// Reads the first sheet of an .xlsx file (or a .csv) into an array of rows (arrays of strings).
// No dependencies: unzips with the platform DecompressionStream and reads the sheet XML directly.
// Cell values are kept as the raw text in the file, so long package IDs (TSIDs) never lose digits.

const decoder = new TextDecoder();

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unzipIndex(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a readable .xlsx workbook.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('The workbook appears to be damaged.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, offset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const f = files[name];
    if (!f) return null;
    const start = f.offset + 30 + view.getUint16(f.offset + 26, true) + view.getUint16(f.offset + 28, true);
    const raw = buf.subarray(start, start + f.size);
    return decoder.decode(f.method === 0 ? raw : await inflate(raw));
  };
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (entities[e] ?? m));
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescape(m[1])).join('');
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

// Returns every sheet in workbook order: [{name, rows}].
export async function readWorkbook(arrayBuffer) {
  const read = unzipIndex(new Uint8Array(arrayBuffer));
  const shared = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const wb = await read('xl/workbook.xml'), rels = (await read('xl/_rels/workbook.xml.rels')) || '';
  const relTags = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]);
  const sheets = [];
  for (const m of (wb || '').matchAll(/<sheet\b[^>]*>/g)) {
    const id = m[0].match(/\br:id="([^"]+)"/)?.[1], name = unescape(m[0].match(/\bname="([^"]*)"/)?.[1] || '');
    const target = relTags.find(r => r.includes(`Id="${id}"`))?.match(/Target="([^"]+)"/)?.[1];
    if (target) sheets.push({ name, path: target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '') });
  }
  if (!sheets.length) sheets.push({ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' });
  const out = [];
  for (const { name, path } of sheets) {
    const sheet = await read(path);
    if (sheet) out.push({ name, rows: sheetRows(sheet, shared) });
  }
  if (!out.length) throw new Error('The workbook has no readable sheet.');
  return out;
}

export async function readXlsx(arrayBuffer) { return (await readWorkbook(arrayBuffer))[0].rows; }

function sheetRows(sheet, shared) {
  const rows = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      let value = '';
      if (type === 'inlineStr') value = texts(body);
      else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v != null) value = type === 's' ? shared[Number(v)] ?? '' : unescape(v);
      }
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, v => v ?? ''));
  }
  return rows;
}

export function readCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Returns [{name, rows}] for an .xlsx (every tab) or .csv (one sheet).
export async function readSheetFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf.slice(0, 2));
  return bytes[0] === 0x50 && bytes[1] === 0x4b ? readWorkbook(buf) : [{ name: file.name, rows: readCsv(decoder.decode(buf)) }];
}

// Use the first tab that the given converter accepts; report the tab used.
export function pick(sheets, convert) {
  let lastError;
  for (const s of sheets) { try { return { sheet: s.name, rows: convert(s.rows) }; } catch (e) { lastError = e; } }
  throw lastError;
}

// Find the header row (within the first 10 rows) that contains every required column name.
export function locate(rows, required) {
  const norm = s => String(s).trim().toLowerCase();
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const header = rows[i].map(norm);
    if (required.every(r => header.includes(norm(r)))) {
      const index = {};
      header.forEach((h, j) => { if (h && !(h in index)) index[h] = j; });
      return { start: i + 1, col: name => index[norm(name)] };
    }
  }
  return null;
}

// Excel stores dates as day serials; the OMS export stores them as "8/17/2026 4:57:53 AM". Return YYYY-MM-DD.
export function isoDate(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  return '';
}

const OMS_COLUMNS = ['Manifest TSID', 'Inventory TSID', 'Client', 'License No.', 'Order Number', 'Product', 'Status', 'Price', 'Transfered Units', 'Transferred Date'];
// Turn an OMS TransferOutboundDetails export into compact shipment rows for upload.
export function shipmentRows(rows) {
  const at = locate(rows, OMS_COLUMNS);
  if (!at) throw new Error('This does not look like an OMS TransferOutboundDetails export (missing Inventory TSID, License No. or Transferred Date).');
  const g = (r, name) => String(r[at.col(name)] ?? '').trim();
  const out = [];
  for (const r of rows.slice(at.start)) {
    const tsid = g(r, 'Inventory TSID');
    if (!tsid) continue;
    out.push({
      manifest: g(r, 'Manifest TSID'), tsid, client: g(r, 'Client'), license: g(r, 'License No.'),
      order: g(r, 'Order Number'), product: g(r, 'Product'), status: g(r, 'Status'),
      price: g(r, 'Price'), units: g(r, 'Transfered Units'), delivered: isoDate(g(r, 'Transferred Date')),
    });
  }
  return out;
}

const STORE_COLUMNS = ['Name', 'License'];
// Turn a 5RD export into store rows (active Washington locations only; parent-company rollups are skipped).
export function storeRows(rows) {
  const at = locate(rows, STORE_COLUMNS);
  if (!at) throw new Error('This does not look like the 5RD store list (missing Name and License columns).');
  const g = (r, name) => at.col(name) == null ? '' : String(r[at.col(name)] ?? '').trim();
  const out = [];
  for (const r of rows.slice(at.start)) {
    const name = g(r, 'Name'), segment = g(r, 'Segment'), state = g(r, 'State');
    if (!name || (state && state !== 'WA') || /^PC\b/i.test(segment) || /closed/i.test(segment)) continue;
    out.push({ name, license: g(r, 'License'), rep: g(r, 'Rep Name'), route: g(r, 'Route'), segment,
      parent: g(r, 'Group / Parent Company'), window: g(r, 'Returns Policy Exceptions') });
  }
  return out;
}

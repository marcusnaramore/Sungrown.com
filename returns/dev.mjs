import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {handle} from './core.mjs';
export function adapter(db){return {prepare(sql){let args=[];const runSync=()=>{const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};};return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return runSync();},runSync};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.runSync());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};}
if(process.argv[1]===new URL(import.meta.url).pathname){
 await mkdir('.returns-local',{recursive:true});const db=new DatabaseSync('.returns-local/preview.sqlite');
 if(!db.prepare("SELECT name FROM sqlite_master WHERE name='claims'").get())db.exec(await readFile('migrations/0001_returns.sql','utf8'));if(!db.prepare("SELECT name FROM pragma_table_info('outbox') WHERE name='first_attempt'").get())db.exec(await readFile('migrations/0002_delivery_receipts.sql','utf8'));if(!JSON.parse(db.prepare("SELECT data FROM configuration WHERE key='policy'").get().data).exposureCapPeriod)db.exec(await readFile('migrations/0003_launch_policy_proposal.sql','utf8'));if(JSON.parse(db.prepare("SELECT data FROM configuration WHERE key='policy'").get().data).exceptionPolicy==='pending')db.exec(await readFile('migrations/0004_confirm_monthly_cap_and_manual_exceptions.sql','utf8'));
 const env={RETURNS_MODE:'preview',RETURNS_DB:adapter(db)};
 const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.mjs':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4','.svg':'image/svg+xml','.ico':'image/x-icon'};
 const server=createServer(async(req,res)=>{try{let chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>800000){res.writeHead(413);res.end('Upload too large');return;}chunks.push(c);}const url='http://localhost:4174'+req.url;
 if(req.url.startsWith('/api/returns/')){const r=await handle(new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 let p=resolve('public','.'+decodeURIComponent(new URL(url).pathname));if(!p.startsWith(resolve('public')+'/')&&p!==resolve('public'))throw Error('Not found');if(!extname(p))p+='/index.html';let buf;try{buf=await readFile(p);}catch{res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':types[extname(p)]||'application/octet-stream','cache-control':'no-store'});res.end(buf);
 }catch{res.writeHead(500);res.end('Preview server error');}});server.listen(4174,'127.0.0.1',()=>console.log('Returns preview: http://localhost:4174/returns/\nAdmin: http://localhost:4174/admin/returns/'));
}

const encode=bytes=>btoa(String.fromCharCode(...bytes));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const mailbox=env=>env.RETURNS_MAILBOX||'returns@sungrown.com';
async function key(env){
 if(!/^[a-f0-9]{64}$/.test(env.RETURNS_MAIL_KEY||''))throw Error('Sender encryption is not configured.');
 return crypto.subtle.importKey('raw',Uint8Array.from(env.RETURNS_MAIL_KEY.match(/../g),s=>parseInt(s,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function sealMailToken(env,refreshToken){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('sungrown-returns-mail|'+mailbox(env))},await key(env),new TextEncoder().encode(refreshToken));
 return {iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))};
}
export async function openMailToken(env,sealed){
 const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(sealed.iv),additionalData:new TextEncoder().encode('sungrown-returns-mail|'+mailbox(env))},await key(env),decode(sealed.ciphertext));
 return new TextDecoder().decode(clear);
}
export async function mailAuthorization(env){
 if(env.GOOGLE_MAIL_REFRESH_TOKEN)return env.GOOGLE_MAIL_REFRESH_TOKEN;
 const row=await env.RETURNS_DB.prepare("SELECT data FROM configuration WHERE key='google_mail'").first();
 if(!row)throw Error('Google mail authorization has not been configured.');
 const saved=JSON.parse(row.data);
 if(saved.mailbox!==mailbox(env))throw Error('Sender mailbox does not match the configured mailbox.');
 return openMailToken(env,saved.sealed);
}

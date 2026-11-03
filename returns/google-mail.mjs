// Google Workspace delivery. Credentials are runtime secrets, never source files.
const utf8base64=value=>btoa(String.fromCharCode(...new TextEncoder().encode(value)));
const mimeBase64=value=>utf8base64(value).match(/.{1,76}/g)?.join('\r\n')||'';
const encodedSubject=value=>{const chunks=[];let current='';for(const character of String(value)){if(new TextEncoder().encode(current+character).length>42){chunks.push(current);current='';}current+=character;}if(current)chunks.push(current);return chunks.map(c=>'=?UTF-8?B?'+utf8base64(c)+'?=').join('\r\n ');};
const safeHeader=value=>String(value||'').replace(/[\r\n]/g,' ').trim();
export async function sendGoogleMail(env,mail,payload,setUncertain){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.GOOGLE_MAIL_REFRESH_TOKEN)throw Error('Google mail authorization has not been configured.');
 const exchange=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_MAIL_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!exchange.ok)throw Error('Google mail authorization failed ('+exchange.status+'). Reconnect the sender mailbox.');
 const {access_token}=await exchange.json();if(!access_token)throw Error('Google did not return mail authorization.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(mail.event_key)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const messageId=`<returns-${digest}@sungrown.com>`,boundary='sg-'+digest.slice(0,32);
 const message=[`From: ${safeHeader(env.RETURNS_FROM)}`,`To: ${safeHeader(mail.recipient)}`,`Reply-To: ${safeHeader(env.RETURNS_REPLY_TO||'returns@sungrown.com')}`,`Subject: ${encodedSubject(payload.subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: ${messageId}`,'MIME-Version: 1.0',`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',mimeBase64(payload.text),`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',mimeBase64(payload.html||payload.text),`--${boundary}--`,''].join('\r\n');
 setUncertain(true);
 let response;try{response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{authorization:'Bearer '+access_token,'content-type':'application/json'},body:JSON.stringify({raw:utf8base64(message).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')})});}catch{throw Error('Google delivery is uncertain. Check Sent mail for Message-ID '+messageId+' before any resend.');}
 if(!response.ok){if(response.status<500)setUncertain(false);throw Error(response.status>=500?'Google delivery is uncertain. Check Sent mail for Message-ID '+messageId+' before any resend.':'Google rejected delivery ('+response.status+'). The claim and notification remain saved.');}
 const receipt=await response.json();if(!receipt.id)throw Error('Google delivery is uncertain. Check Sent mail for Message-ID '+messageId+' before any resend.');return receipt;
}

export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=n=>n==null?'Not reviewed':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export const date=s=>s?new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(s.length===10?s+'T12:00:00Z':s)):'To be confirmed';
export let currentStaff;
export function setStaff(s){currentStaff=s;}
export async function api(path,body,options={}){const r=await fetch('/api/returns/'+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(currentStaff?{'x-csrf-token':currentStaff.csrf}:{}),...options.headers},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Please try again.'),{status:r.status});return data;}
export const field=(name,label,type='text',value='',extra='')=>`<label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
export const note=(name,label,value='',extra='')=>`<label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}" ${extra}>${esc(value)}</textarea>`;
export const check=(name,label,checked=false)=>`<label class="check-row"><input type="checkbox" name="${name}" ${checked?'checked':''}> ${esc(label)}</label>`;
export async function fileData(file){if(!file)return undefined;if(file.size>500*1024)throw Error('Choose an attachment up to 500 KB.');return {name:file.name,mime:file.type||'text/plain',body:await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);})};}
export function formBody(form){const data=Object.fromEntries(new FormData(form));for(const c of form.querySelectorAll('input[type=checkbox]'))data[c.name]=c.checked;return data;}
export function errorBox(el,e){el.textContent=e.message||String(e);el.classList.remove('hidden');el.focus();}

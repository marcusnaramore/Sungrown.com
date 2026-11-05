const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(value,max)=>String(value??'').trim().slice(0,max);
export function intakePreferences(input){
 let retailerRequestedCents=null;
 if(input.requestedAmount!=null){
  const amount=String(input.requestedAmount).trim();
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(amount))invalid('Enter the requested dollar amount with no more than two decimal places.');
  const [whole,fraction='']=amount.split('.');retailerRequestedCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(retailerRequestedCents<=0||retailerRequestedCents>100000000)invalid('Enter a requested amount between $0.01 and $1,000,000.00.');
 }
 const dispositionPreference=text(input.dispositionPreference,40)||null;
 const paymentPreference=text(input.paymentPreference,40)||null;
 if(dispositionPreference&&!['onsite_destruction','pickup','no_preference'].includes(dispositionPreference))invalid('Choose on-site destruction, return pickup, or no preference.');
 if(paymentPreference&&!['check','credit','no_preference'].includes(paymentPreference))invalid('Choose check, credit, or no preference.');
 let checkMailing=null;
 if(paymentPreference==='check'){
  checkMailing={payableTo:text(input.checkPayableTo,140),line1:text(input.checkAddress1,180),line2:text(input.checkAddress2,180),city:text(input.checkCity,100),state:text(input.checkState,10).toUpperCase(),postalCode:text(input.checkPostalCode,10),country:'US'};
  if(!checkMailing.payableTo||!checkMailing.line1||!checkMailing.city||!'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI AA AE AP'.split(' ').includes(checkMailing.state)||!/^\d{5}(?:-\d{4})?$/.test(checkMailing.postalCode))invalid('For a check, enter the payable name and complete US mailing address, including a two-letter state and ZIP code.');
 }
 return {retailerRequestedCents,dispositionPreference,paymentPreference,checkMailing};
}

// New offers never mutate legacy receipts or their entitlement definitions.
export const MONTHLY_IDS=['basicmonthv6','essentialmonthv6','promonthv6','creatormonthv6','studiomonthv6'];
export const ANNUAL_IDS=MONTHLY_IDS.map(id=>id.replace('month','year'));
export function subscriptionOffers(legacy){
 const sources=['single1v5','week7v5','pro7v5','creator30v5','studio30v5'];
 return Object.fromEntries(sources.flatMap((source,i)=>['monthly','yearly'].map(interval=>{
  const original=legacy[source],annual=interval==='yearly',id=annual?ANNUAL_IDS[i]:MONTHLY_IDS[i];
  return [id,Object.freeze({...original,label:i===0?'Básico':original.label,duration_days:annual?365:30,price_cents:original.price_cents*(annual?12:1),monthly_price_cents:original.price_cents,billing_interval:interval,renewal_mode:'manual',fit:'Para mundos de até '+original.max_file_mb+' MB · '+original.daily_operations+' operações por dia'})];
 })));
}
export function periodEnd(startsAt,definition){
 if(!definition.billing_interval)return startsAt+definition.duration_days*86400000;
 const start=new Date(startsAt),end=new Date(startsAt),day=start.getUTCDate();
 end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+(definition.billing_interval==='yearly'?12:1));
 const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
 end.setUTCDate(Math.min(day,last));return end.getTime();
}

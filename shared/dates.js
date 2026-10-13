const DAY = 86400000;
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(+date) && date.toISOString().slice(0,10) === value;
}
export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
}
export function dateNumber(value) { return Date.parse(`${value}T00:00:00Z`) / DAY; }
export function acquaintanceDays(start, today = shanghaiToday()) {
  if (!validDate(start)) return null;
  return Math.max(0, dateNumber(today) - dateNumber(start) + 1);
}
export function reunionDays(meetings) {
  const intervals = meetings.filter(m => validDate(m.start) && validDate(m.end) && m.end >= m.start).map(m => [dateNumber(m.start),dateNumber(m.end)]).sort((a,b)=>a[0]-b[0]);
  let total=0, first=null, last=null;
  for(const [a,b] of intervals) {
    if(first === null) { first=a; last=b; }
    else if(a<=last+1) last=Math.max(last,b);
    else { total+=last-first+1; first=a; last=b; }
  }
  return total+(first === null ? 0 : last-first+1);
}
export function countdown(target, today=shanghaiToday()) {
  if(!validDate(target)) return {days:null,text:'下一次见面，等我们一起定'};
  const days=dateNumber(target)-dateNumber(today);
  return {days,text:days>0?`还有 ${days} 天，就能见到你`:days===0?'就是今天，终于又见面了':'这次见面已到来，期待下一次约定'};
}
export function dateLabel(value) { return validDate(value) ? value.replaceAll('-','.') : '日期待填写'; }

import { validDate } from '../shared/dates.js';

const MAX_OBJECT_BYTES=51*1024*1024;
const MAX_MANIFEST_BYTES=8*1024*1024;
const PREFIX='house-transfer-v1:';
const SLOTS=['yiting','haomiao'];
const TYPES=new Set(['image/webp','image/jpeg','image/png','video/mp4']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA=/^[a-f0-9]{64}$/;
const BINDING=/^supabase:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const schemas={
  settings:{id:'house',data:'json'},
  meetings:{id:'id',start:'date',end:'date',title:160,place:160,story:4000},
  entries:{id:'id',kind:'kind',author:'slot',text:4000,mood:30,date:'date',meeting_id:'nullable-id',status:'status',created:'time',updated:'time',read_at:'nullable-time'},
  media:{id:'id',owner:'slot',entry_id:'nullable-id',key:'key',type:'type',name:254,deleted_at:'nullable-time',purge_started_at:'nullable-time'},
  comments:{id:'id',entry_id:'id',author:'slot',text:2000,created:'time'},
  hearts:{id:'id',entry_id:'id',author:'slot'},
  misses:{id:'id',author:'slot',created:'time'},
  markers:{id:'id'}
};
const limits={settings:1,meetings:250,entries:250,media:2000,comments:5000,hearts:5000,misses:5000,markers:250};
const CONTENT=['entries','media','comments','hearts','misses'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const constantEqual=(a,b)=>{
  const left=new TextEncoder().encode(a),right=new TextEncoder().encode(b);
  let difference=left.length^right.length;
  for(let index=0;index<left.length;index++)difference|=left[index]^(right[index]??0);
  return difference===0;
};
const validKey=key=>typeof key==='string'&&/^private\/(?:yiting|haomiao)\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(key);

async function readBounded(request,limit) {
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))fail('Transfer body is too large',413);
  if(!request.body)fail('Transfer body is missing');
  const reader=request.body.getReader(),chunks=[];
  let size=0;
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();fail('Transfer body is too large',413);}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}

function field(value,type) {
  if(typeof type==='number')return typeof value==='string'&&value.length<=type;
  if(type.startsWith('nullable-'))return value===null||field(value,type.slice(9));
  if(typeof value!=='string')return false;
  if(type==='id')return ID.test(value);
  if(type==='slot')return SLOTS.includes(value);
  if(type==='house')return value==='house';
  if(type==='key')return validKey(value);
  if(type==='type')return TYPES.has(value);
  if(type==='date')return validDate(value);
  if(type==='time')return value.length<=40&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
  if(type==='kind')return ['diary','memory','letter'].includes(value);
  if(type==='status')return ['published','draft'].includes(value);
  if(type==='json') {
    if(value.length>1024*1024)return false;
    try{return plain(JSON.parse(value));}catch{return false;}
  }
  return false;
}

function validate(data) {
  if(!exact(data,['version','tables','memberBindings'])||data.version!==1||!exact(data.tables,Object.keys(schemas))||!exact(data.memberBindings,SLOTS))fail('Invalid transfer manifest');
  const tables=data.tables;
  for(const [table,schema] of Object.entries(schemas)) {
    const rows=tables[table],seen=new Set();
    if(!Array.isArray(rows)||rows.length>limits[table])fail('Invalid transfer table: '+table);
    for(const row of rows) {
      if(!exact(row,Object.keys(schema))||Object.entries(schema).some(([key,type])=>!field(row[key],type))||seen.has(row.id))fail('Invalid transfer row: '+table);
      seen.add(row.id);
    }
  }
  if(tables.settings.length!==1)fail('Transfer requires one house setting');
  const settings=JSON.parse(tables.settings[0].data);
  if(!plain(settings.people)||SLOTS.some(slot=>!plain(settings.people[slot])))fail('Invalid house members');
  const meetings=new Map(tables.meetings.map(row=>[row.id,row]));
  const entries=new Map(tables.entries.map(row=>[row.id,row]));
  const media=new Map(tables.media.map(row=>[row.id,row])),keys=new Set(),hearts=new Set();
  for(const meeting of meetings.values())if(meeting.start>meeting.end)fail('Invalid meeting dates');
  for(const entry of entries.values())if(entry.meeting_id!==null&&!meetings.has(entry.meeting_id))fail('Unknown entry meeting');
  for(const item of media.values()) {
    if(item.key!=='private/'+item.owner+'/'+item.id||keys.has(item.key))fail('Invalid private media key');
    keys.add(item.key);
    if(item.entry_id!==null&&(!entries.has(item.entry_id)||entries.get(item.entry_id).author!==item.owner))fail('Invalid media ownership relation');
    if(item.purge_started_at!==null&&item.deleted_at===null)fail('Invalid media deletion state');
  }
  for(const row of [...tables.comments,...tables.hearts])if(!entries.has(row.entry_id))fail('Unknown reply or heart entry');
  for(const row of tables.hearts) {
    const key=row.entry_id+'/'+row.author;
    if(hearts.has(key))fail('Duplicate heart');
    hearts.add(key);
  }
  for(const slot of SLOTS) {
    const binding=data.memberBindings[slot];
    if(!exact(binding,['from','to'])||!(binding.from===null||(typeof binding.from==='string'&&binding.from.length>0&&binding.from.length<=200))||typeof binding.to!=='string'||!BINDING.test(binding.to))fail('Invalid member binding');
    const avatar=settings.people[slot].avatar;
    if(avatar&&(!media.has(avatar)||media.get(avatar).owner!==slot||!media.get(avatar).type.startsWith('image/')))fail('Invalid member avatar');
  }
  if(data.memberBindings.yiting.to===data.memberBindings.haomiao.to)fail('Member identities must differ');
  if(settings.roomArt&&(!media.has(settings.roomArt)||!media.get(settings.roomArt).type.startsWith('image/')))fail('Unknown private room art');
  return tables;
}

async function status(env) {
  const result=await env.DB.prepare("SELECT (SELECT COUNT(*) FROM entries) AS entries,(SELECT COUNT(*) FROM media) AS media,(SELECT COUNT(*) FROM comments) AS comments,(SELECT COUNT(*) FROM hearts) AS hearts,(SELECT COUNT(*) FROM misses) AS misses,(SELECT COUNT(*) FROM meetings) AS meetings,(SELECT COUNT(*) FROM settings) AS settings").first();
  const marker=await env.DB.prepare('SELECT id FROM markers WHERE id LIKE ? LIMIT 1').bind(PREFIX+'%').first();
  return {counts:result,committed:!!marker};
}

async function committedMarker(env) {
  return (await env.DB.prepare('SELECT id FROM markers WHERE id LIKE ? LIMIT 1').bind(PREFIX+'%').first())?.id??null;
}

async function commit(request,env) {
  let data;
  try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(request,MAX_MANIFEST_BYTES)));}
  catch(error){if(error.status)throw error;fail('Invalid transfer JSON');}
  const tables=validate(data),hash=await digest(new TextEncoder().encode(JSON.stringify(data))),marker=PREFIX+hash;
  const previous=await committedMarker(env);
  if(previous){if(previous!==marker)fail('A different transfer is already committed',409);return json({...await status(env),ok:true,idempotent:true});}
  const before=await status(env);
  if(CONTENT.some(table=>before.counts[table]!==0))fail('Target already contains private content',409);
  const current=(await env.DB.prepare('SELECT slot,user_id FROM members').all()).results;
  if(current.some(row=>!SLOTS.includes(row.slot))||SLOTS.some(slot=>(current.find(row=>row.slot===slot)?.user_id??null)!==data.memberBindings[slot].from))fail('Member binding changed before transfer',409);
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,tables.media.length)},async()=>{
    while(cursor<tables.media.length) {
      const row=tables.media[cursor++],object=await env.BUCKET.head(row.key);
      if(!object||object.httpMetadata?.contentType!==row.type||!SHA.test(object.customMetadata?.transfer_sha256??''))fail('Private object is missing or mismatched: '+row.id,409);
    }
  }));
  const guard=CONTENT.map(table=>'(SELECT COUNT(*) FROM '+table+')=0').join(' AND ')+" AND NOT EXISTS (SELECT 1 FROM markers WHERE id LIKE ?) AND NOT EXISTS (SELECT 1 FROM members WHERE slot NOT IN ('yiting','haomiao')) AND (SELECT user_id FROM members WHERE slot='yiting') IS ? AND (SELECT user_id FROM members WHERE slot='haomiao') IS ?";
  const batch=[env.DB.prepare('INSERT INTO markers(id) SELECT CASE WHEN '+guard+' THEN ? ELSE NULL END').bind(PREFIX+'%',data.memberBindings.yiting.from,data.memberBindings.haomiao.from,marker),env.DB.prepare('DELETE FROM settings'),env.DB.prepare('DELETE FROM meetings')];
  for(const [table,schema] of Object.entries(schemas)) {
    const columns=Object.keys(schema),select=columns.map(column=>"json_extract(value,'$."+column+"')").join(',');
    batch.push(env.DB.prepare('INSERT '+(table==='markers'?'OR IGNORE ':'')+'INTO '+table+'('+columns.join(',')+') SELECT '+select+' FROM json_each(?) ORDER BY CAST(key AS INTEGER)').bind(JSON.stringify(tables[table])));
  }
  for(const slot of SLOTS)batch.push(env.DB.prepare('INSERT INTO members(slot,user_id) VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET user_id=excluded.user_id').bind(slot,data.memberBindings[slot].to));
  try{await env.DB.batch(batch);}
  catch {
    if(await committedMarker(env)===marker)return json({...await status(env),ok:true,idempotent:true});
    fail('Target changed or transfer could not commit; no database rows imported',409);
  }
  return json({...await status(env),ok:true,idempotent:false});
}

export async function handleHouseTransfer(request,env) {
  const url=new URL(request.url);
  if(url.pathname!=='/api/house-transfer'&&url.pathname!=='/api/house-transfer/object'&&url.pathname!=='/api/house-transfer/commit')return null;
  const secret=env.HOUSE_TRANSFER_KEY,provided=request.headers.get('X-House-Transfer-Key')??'',expires=Date.parse(env.HOUSE_TRANSFER_EXPIRES_AT??''),now=Date.now();
  const secure=url.protocol==='https:'||['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(env.AUTH_PROVIDER!=='supabase'||typeof secret!=='string'||secret.length<32||secret.length>512||provided.length>512||!Number.isFinite(expires)||expires<=now||expires>now+2*60*60*1000||!secure||!constantEqual(secret,provided))return json({error:'Not found'},404);
  if(!env.DB||!env.BUCKET)return json({error:'Transfer storage is unavailable'},503);
  try {
    if(url.pathname==='/api/house-transfer'&&request.method==='GET')return json(await status(env));
    if(url.pathname==='/api/house-transfer/object'&&request.method==='PUT') {
      const key=url.searchParams.get('key'),type=request.headers.get('Content-Type')??'',hash=request.headers.get('X-House-Content-SHA256')??'';
      if(!validKey(key)||!TYPES.has(type)||!SHA.test(hash))fail('Invalid private object metadata');
      const previous=await env.BUCKET.head(key);
      if(previous) {
        if(previous.customMetadata?.transfer_sha256!==hash||previous.httpMetadata?.contentType!==type)fail('Refusing to overwrite an existing object',409);
        return json({ok:true,idempotent:true});
      }
      const bytes=await readBounded(request,MAX_OBJECT_BYTES);
      if(!bytes.byteLength||await digest(bytes)!==hash)fail('Private object digest does not match');
      // Conditional creation also protects against an object appearing after the head check.
      const saved=await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type},customMetadata:{transfer_sha256:hash},onlyIf:{etagDoesNotMatch:'*'}});
      if(!saved) {
        const raced=await env.BUCKET.head(key);
        if(raced?.customMetadata?.transfer_sha256===hash&&raced.httpMetadata?.contentType===type)return json({ok:true,idempotent:true});
        fail('Refusing to overwrite an existing object',409);
      }
      return json({ok:true,idempotent:false});
    }
    if(url.pathname==='/api/house-transfer/commit'&&request.method==='POST')return await commit(request,env);
    return json({error:'Not found'},404);
  }catch(error) {
    return json({error:error.status?error.message:'Transfer storage operation failed'},error.status??503);
  }
}

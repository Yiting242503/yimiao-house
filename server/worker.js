import { initialSettings, initialMeetings } from '../shared/seed.js';
import { validDate, shanghaiToday } from '../shared/dates.js';
import { entryMediaLimit } from '../shared/media-limits.js';
import { createEmailAuth } from './email-auth.js';
import { privateMediaResponse, privateMediaKeys, privatePreviewKey } from './private-media-response.js';

const slots = ['yiting','haomiao'];
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',...headers}});
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const stmt = (env,sql,...params) => env.DB.prepare(sql).bind(...params);
const all = async (env,sql,...params) => (await stmt(env,sql,...params).all()).results;
const one = (env,sql,...params) => stmt(env,sql,...params).first();
const local = (request,env) => env.AUTH_PROVIDER !== 'supabase' && env.LOCAL_PREVIEW === 'true' && ['127.0.0.1','localhost','[::1]'].includes(new URL(request.url).hostname);
const str = (v,max=4000) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const uuid = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const PHOTO_LIMIT = 8*1024*1024;
const VIDEO_LIMIT = 50*1024*1024;
const UPLOAD_LIMIT = 51*1024*1024;
const initialization = new WeakMap();
const mp4Brands = new Set(['isom','iso2','iso3','iso4','iso5','iso6','mp41','mp42','avc1','M4V ','M4VH','M4VP','dash','MSNV']);

function mediaType(bytes,fileSize) {
  if(bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if(bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71) return 'image/png';
  const four=(start)=>String.fromCharCode(...bytes.subarray(start,start+4));
  if(four(0)==='RIFF' && four(8)==='WEBP') return 'image/webp';
  if(bytes.length<16 || four(4)!=='ftyp') return null;
  const size=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0);
  if(size<16 || size>fileSize || size>bytes.length || size%4!==0) return null;
  if(!mp4Brands.has(four(8))) return null;
  return 'video/mp4';
}

async function uploadForm(request) {
  if(Number(request.headers.get('content-length')||0)>UPLOAD_LIMIT) fail('上传内容不能超过 51 MB',413);
  if(!request.body) fail('请选择照片或 MP4 视频');
  let size=0, oversized=false;
  const limited=request.body.pipeThrough(new TransformStream({
    transform(chunk,controller) {
      size+=chunk.byteLength;
      if(size>UPLOAD_LIMIT) { oversized=true; fail('上传内容不能超过 51 MB',413); }
      controller.enqueue(chunk);
    }
  }));
  try { return await new Response(limited,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData(); }
  catch(error) { if(oversized) fail('上传内容不能超过 51 MB',413); fail('上传内容格式不正确'); }
}

async function previewBytes(request,variant) {
  const limit=variant==='thumb'?256*1024:1024*1024;
  if(Number(request.headers.get('content-length')||0)>limit) fail('预览照片过大',413);
  if(!request.body) fail('请选择 WebP 预览照片');
  let size=0;
  const limited=request.body.pipeThrough(new TransformStream({transform(chunk,controller) {
    size+=chunk.byteLength;
    if(size>limit) fail('预览照片过大',413);
    controller.enqueue(chunk);
  }}));
  let bytes;
  try { bytes=new Uint8Array(await new Response(limited).arrayBuffer()); }
  catch(error) { if(error.status) throw error; fail('预览照片格式不正确'); }
  if(bytes.length<12 || mediaType(bytes,bytes.length)!=='image/webp' || new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)!==bytes.length-8) fail('预览照片必须是 WebP 格式');
  return bytes;
}

async function emailActor(env,auth,verified) {
  const flags={localPreview:false,emailLogin:true,emailLoginReady:auth.ready};
  if(!verified.authenticated) return {...flags,authorized:false,authenticated:false};
  const {userId,verifiedEmail}=verified;
  const emails=JSON.parse(env.MEMBER_EMAILS);
  const slot=slots.find(key=>emails[key].trim().toLowerCase()===verifiedEmail);
  if(!slot) return {...flags,userId,authorized:false,authenticated:true};
  const bound=await one(env,'SELECT user_id FROM members WHERE slot=?',slot);
  if(bound && bound.user_id!==userId) fail('账号绑定已变更，请由管理员检查',403);
  if(bound) return {...flags,slot,userId,authorized:true,authenticated:true};
  await stmt(env,'INSERT OR IGNORE INTO members (slot,user_id) VALUES (?,?)',slot,userId).run();
  const pinned=await one(env,'SELECT user_id FROM members WHERE slot=?',slot);
  if(pinned?.user_id!==userId) fail('此身份已经绑定到另一个账号，请由管理员检查',403);
  return {...flags,slot,userId,authorized:true,authenticated:true};
}

async function identity(request,env,auth) {
  if(env.AUTH_PROVIDER==='supabase') return emailActor(env,auth,await auth.resolveIdentity());
  if(local(request,env)) {
    const token = request.headers.get('cookie')?.match(/(?:^|;\s*)house_session=([^;]+)/)?.[1];
    const session = token && await one(env,'SELECT slot FROM sessions WHERE token=? AND expires>?',token,Date.now());
    return session ? {slot:session.slot,userId:`local-${session.slot}`,authorized:true,authenticated:true,localPreview:true} : {authorized:false,authenticated:false,localPreview:true};
  }
  if(env.AUTH_PROVIDER!=='sites') fail('小屋登录暂未连接，请稍后再试',503);
  const userId=request.headers.get('oai-authenticated-user-id');
  if(!userId) return {authorized:false,authenticated:false,localPreview:false};
  let configured, emails;
  try { configured=JSON.parse(env.MEMBER_IDS || '{}'); emails=JSON.parse(env.MEMBER_EMAILS||'{}'); } catch { fail('账号绑定配置需要检查',503); }
  if(Object.keys(configured).some(k=>!slots.includes(k)) || slots.some(k=>configured[k] && typeof configured[k]!=='string') || (configured.yiting && configured.yiting===configured.haomiao)) fail('账号绑定配置需要检查',503);
  if(Object.keys(emails).some(k=>!slots.includes(k)) || slots.some(k=>emails[k] && typeof emails[k]!=='string') || (emails.yiting && emails.yiting===emails.haomiao)) fail('账号绑定配置需要检查',503);
  const verifiedEmail=(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
  // Platform invitations gate the verified email; first sign-in permanently binds its stable site ID.
  const slot=slots.find(k=>configured[k]?configured[k]===userId:emails[k] && emails[k].trim().toLowerCase()===verifiedEmail);
  if(!slot) return {authorized:false,authenticated:true,userId,localPreview:false};
  const bound=await one(env,'SELECT user_id FROM members WHERE slot=?',slot);
  if(bound && bound.user_id!==userId) fail('账号绑定已变更，请由管理员检查',403);
  if(bound) return {slot,userId,authorized:true,authenticated:true,localPreview:false};
  await stmt(env,'INSERT OR IGNORE INTO members (slot,user_id) VALUES (?,?)',slot,userId).run();
  const pinned=await one(env,'SELECT user_id FROM members WHERE slot=?',slot);
  if(pinned?.user_id!==userId) fail('此身份已经绑定到另一个账号，请由管理员检查',403);
  return {slot,userId,authorized:true,authenticated:true,localPreview:false};
}

async function loginRateLimit(request,env,email,action) {
  const now=Date.now();
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const rules=[
    {key:`${action}:ip:${await hash(ip)}`,duration:action==='send'?3600000:300000,limit:action==='send'?10:20},
    {key:`${action}:email:${await hash(typeof email==='string'?email.trim().toLowerCase().slice(0,254):'')}`,duration:action==='send'?60000:300000,limit:action==='send'?1:5}
  ];
  await stmt(env,'DELETE FROM auth_rate_limits WHERE window<?',now-86400000).run();
  for(const rule of rules) {
    const row=await stmt(env,`INSERT INTO auth_rate_limits (key,window,attempts) VALUES (?,?,1)
      ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN window<=? THEN 1 ELSE attempts+1 END,
      window=CASE WHEN window<=? THEN excluded.window ELSE window END
      RETURNING attempts`,rule.key,now,now-rule.duration,now-rule.duration).first();
    if(row.attempts>rule.limit) fail(action==='send'?'验证码发送较频繁，请稍后再试':'验证次数较多，请稍后再试',429);
  }
}

async function initialize(env) {
  // Coalesce concurrent first requests without caching authorization or database state.
  let pending=initialization.get(env.DB);
  if(!pending) {
    pending=(async()=>{
      if(await one(env,"SELECT id FROM markers WHERE id='initial-meetings-v1'")) return;
      // The seed marker and all initial data still commit in one transaction.
      await env.DB.batch([
        stmt(env,'INSERT OR IGNORE INTO settings (id,data) VALUES (?,?)','house',JSON.stringify(initialSettings)),
        ...initialMeetings.map(m=>stmt(env,"INSERT OR IGNORE INTO meetings (id,start,end,title,place,story) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM markers WHERE id='initial-meetings-v1')",m.id,m.start,m.end,m.title,m.place,m.story)),
        stmt(env,"INSERT OR IGNORE INTO markers (id) VALUES ('initial-meetings-v1')")
      ]);
    })();
    initialization.set(env.DB,pending);
  }
  try { await pending; }
  finally { if(initialization.get(env.DB)===pending) initialization.delete(env.DB); }
}

async function entryFor(env,id,actor) {
  const entry=await one(env,'SELECT * FROM entries WHERE id=?',id);
  if(!entry || (entry.status==='draft' && entry.author!==actor.slot)) fail('这条内容不可访问',404);
  return entry;
}
function mustOwn(record,actor) { if(record.author!==actor.slot) fail('只有作者可以修改或删除',403); }
async function body(request,maxLength=32000) {
  const length=Number(request.headers.get('content-length')||0);
  if(length>maxLength) fail('文字过长',413);
  try { const text=await request.text(); if(text.length>maxLength) fail('文字过长',413); return JSON.parse(text); } catch(e) { if(e.status) throw e; fail('内容格式不正确'); }
}
function mutationGuard(request,env) {
  if(request.headers.get('X-House-Request')!=='1') fail('请从小屋页面完成操作',403);
  const origin=request.headers.get('origin');
  if(origin) {
    let originUrl; try { originUrl=new URL(origin); } catch { fail('请求来源不正确',403); }
    const trusted=local(request,env) ? ['127.0.0.1','localhost'].includes(originUrl.hostname) : origin===new URL(request.url).origin;
    if(!trusted) fail('请求来源不正确',403);
  }
}

async function snapshot(env,actor) {
  // Read a consistent snapshot in one D1 round trip instead of eight serial calls.
  const [settingsRows,entryRows,mediaRows,recycledRows,commentRows,heartRows,meetingRows,missRows]=await env.DB.batch([
    stmt(env,"SELECT data FROM settings WHERE id='house'"),
    stmt(env,"SELECT e.* FROM entries e WHERE (e.status<>'draft' OR e.author=?) AND (e.kind<>'memory' OR EXISTS (SELECT 1 FROM media m WHERE m.entry_id=e.id AND m.deleted_at IS NULL AND m.purge_started_at IS NULL)) ORDER BY e.created DESC LIMIT 250",actor.slot),
    stmt(env,"SELECT m.id,m.entry_id,m.type,m.name FROM media m JOIN entries e ON m.entry_id=e.id WHERE m.deleted_at IS NULL AND m.purge_started_at IS NULL AND (e.status<>'draft' OR e.author=?) ORDER BY m.rowid",actor.slot),
    stmt(env,"SELECT m.id,m.type,m.name,m.deleted_at,m.purge_started_at,m.entry_id,e.text AS entry_text,e.date,e.meeting_id,t.title AS meeting_title FROM media m JOIN entries e ON m.entry_id=e.id LEFT JOIN meetings t ON t.id=e.meeting_id WHERE m.owner=? AND e.author=? AND e.kind='memory' AND m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC,m.rowid DESC",actor.slot,actor.slot),
    stmt(env,"SELECT c.* FROM comments c JOIN entries e ON c.entry_id=e.id WHERE e.status<>'draft' OR e.author=? ORDER BY c.created",actor.slot),
    stmt(env,"SELECT h.* FROM hearts h JOIN entries e ON h.entry_id=e.id WHERE e.status<>'draft' OR e.author=?",actor.slot),
    stmt(env,'SELECT * FROM meetings ORDER BY start DESC'),
    stmt(env,'SELECT * FROM misses ORDER BY created DESC LIMIT 50')
  ]);
  const settings=JSON.parse(settingsRows.results[0].data),entries=entryRows.results,media=mediaRows.results,comments=commentRows.results,hearts=heartRows.results;
  return {settings,meetings:meetingRows.results,entries:entries.map(e=>({...e,media:media.filter(m=>m.entry_id===e.id),comments:comments.filter(c=>c.entry_id===e.id),hearts:hearts.filter(h=>h.entry_id===e.id)})),recycledMedia:recycledRows.results,misses:missRows.results,session:actor};
}

async function api(request,env,ctx,auth) {
  const url=new URL(request.url), path=url.pathname;
  if(!env.DB || !env.BUCKET) fail('小屋存储暂时未连接，请稍后重试',503);
  if(request.method!=='GET' && request.method!=='HEAD') mutationGuard(request,env);
  if(path.startsWith('/api/auth/')) {
    if(env.AUTH_PROVIDER!=='supabase' || request.method!=='POST') fail('页面不存在',404);
    if(!auth.ready) fail('邮箱登录暂未连接，请稍后再试',503);
    if(path==='/api/auth/request-code') {
      const data=await body(request);
      await loginRateLimit(request,env,data.email,'send');
      await auth.requestCode(data.email);
      return json({ok:true});
    }
    if(path==='/api/auth/verify-code') {
      const data=await body(request);
      await loginRateLimit(request,env,data.email,'verify');
      const verified=await auth.verifyCode(data.email,data.code);
      let actor;
      try { actor=await emailActor(env,auth,verified); }
      catch(error) { await auth.signOut(); throw error; }
      if(!actor.authorized) { await auth.signOut(); fail('这个账号还没有小屋的钥匙',403); }
      return json({ok:true});
    }
    if(path==='/api/auth/logout') { await auth.signOut(); return json({ok:true}); }
    fail('页面不存在',404);
  }
  if(path==='/api/dev-login' && request.method==='POST') {
    if(!local(request,env)) fail('页面不存在',404);
    const data=await body(request);
    if(!slots.includes(data.slot)) fail('此账号不能进入小屋',403);
    const token=uuid();
    await stmt(env,'INSERT INTO sessions (token,slot,expires) VALUES (?,?,?)',token,data.slot,Date.now()+86400000).run();
    return json({ok:true},200,{'Set-Cookie':`house_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if(path==='/api/dev-logout' && request.method==='POST') {
    if(!local(request,env)) fail('页面不存在',404);
    const token=request.headers.get('cookie')?.match(/(?:^|;\s*)house_session=([^;]+)/)?.[1];
    if(token) await stmt(env,'DELETE FROM sessions WHERE token=?',token).run();
    return json({ok:true},200,{'Set-Cookie':'house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  const actor=await identity(request,env,auth);
  if(path==='/api/session' && request.method==='GET') return json(actor);
  if(!actor.authenticated) fail('请先登录小屋',401);
  if(!actor.authorized) fail('这个账号还没有小屋的钥匙',403);
  // Existing media have no dependency on the initial meetings/settings write batch.
  if(!path.startsWith('/api/media/')) await initialize(env);
  if(path==='/api/house' && request.method==='GET') return json(await snapshot(env,actor));
  if(path==='/api/album-video-order' && request.method==='PUT') {
    const data=await body(request);
    const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
    if(!data || Array.isArray(data) || !['daily','meeting'].includes(data.kind) || !validId(data.albumId) || !Array.isArray(data.ids) || data.ids.some(id=>!validId(id)) || new Set(data.ids).size!==data.ids.length || !Number.isSafeInteger(data.version) || data.version<0) fail('视频排序格式不正确');
    const scope=data.kind==='daily' ? "e.id=? AND e.meeting_id IS NULL" : 'e.meeting_id=?';
    const scopeExists=data.kind==='daily'
      ? await one(env,"SELECT id FROM entries WHERE id=? AND kind='memory' AND status='published' AND meeting_id IS NULL",data.albumId)
      : await one(env,"SELECT t.id FROM meetings t WHERE t.id=? AND EXISTS (SELECT 1 FROM entries e WHERE e.meeting_id=t.id AND e.kind='memory' AND e.status='published')",data.albumId);
    if(!scopeExists) fail('相册不存在或暂时不可访问',404);
    const activeVideos=`SELECT m.id FROM media m JOIN entries e ON m.entry_id=e.id WHERE ${scope} AND e.kind='memory' AND e.status='published' AND m.type LIKE 'video/%' AND m.deleted_at IS NULL AND m.purge_started_at IS NULL`;
    const current=await all(env,activeVideos,data.albumId),currentIds=new Set(current.map(file=>file.id));
    if(current.length!==data.ids.length || data.ids.some(id=>!currentIds.has(id))) fail('请为这本相册当前的全部视频排序',403);
    const old=JSON.parse((await one(env,"SELECT data FROM settings WHERE id='house'")).data);
    if(data.version!==(old.version||0)) fail('另一人刚修改了相册，请重新打开后再排序',409);
    const merged={...old,version:(old.version||0)+1,videoOrders:{...old.videoOrders,[`${data.kind}:${data.albumId}`]:data.ids}};
    const orderJson=JSON.stringify(data.ids);
    // Recheck membership in the same write: uploads, trash or relinking may change the album without changing settings.version.
    const saved=await stmt(env,`UPDATE settings SET data=? WHERE id='house' AND data=?
      AND EXISTS (SELECT 1 FROM entries e WHERE ${scope} AND e.kind='memory' AND e.status='published')
      ${data.kind==='meeting' ? 'AND EXISTS (SELECT 1 FROM meetings WHERE id=?)' : ''}
      AND (SELECT count(*) FROM (${activeVideos}))=?
      AND NOT EXISTS (${activeVideos} AND m.id NOT IN (SELECT value FROM json_each(?)))`,
      JSON.stringify(merged),JSON.stringify(old),data.albumId,...(data.kind==='meeting'?[data.albumId]:[]),data.albumId,data.ids.length,data.albumId,orderJson).run();
    if(!saved.meta.changes) fail('相册内容或设置刚有变化，请重新打开后再排序',409);
    return json({ok:true});
  }
  if(path==='/api/settings' && request.method==='PUT') {
    const data=await body(request), old=JSON.parse((await one(env,"SELECT data FROM settings WHERE id='house'")).data);
    if((data.version||0)!==(old.version||0)) fail('另一人刚修改了设置，请重新打开设置再保存；你编辑的内容还在',409);
    const merged={...old,name:str(data.name,40)||old.name,version:(old.version||0)+1,people:{...old.people}};
    for(const key of ['acquainted','relationship','nextMeeting']) if(Object.hasOwn(data,key)) merged[key]=data[key]||'';
    for(const key of ['acquainted','relationship','nextMeeting']) if(merged[key] && !validDate(merged[key])) fail('请填写有效日期');
    for(const slot of slots) {
      const p=data.people?.[slot];
      if(!p) continue;
      merged.people[slot]={...old.people[slot],name:str(p.name,30)||old.people[slot].name,city:str(p.city,40),context:str(p.context,20),home:str(p.home,80),previous:str(p.previous,80),avatar:str(p.avatar,80)};
      if(p.avatar && p.avatar!==old.people[slot].avatar) {
        const file=await one(env,'SELECT owner,entry_id,type FROM media WHERE id=?',p.avatar);
        if(!file || file.owner!==actor.slot || file.entry_id || !file.type.startsWith('image/')) fail('头像文件不可用，请选择照片',403);
      }
    }
    if(Object.hasOwn(data,'roomArt')) {
      const roomArt=str(data.roomArt,80);
      if(roomArt && roomArt!==old.roomArt) {
        const file=await one(env,'SELECT owner,entry_id,type FROM media WHERE id=?',roomArt);
        if(!file || file.owner!==actor.slot || file.entry_id || !file.type.startsWith('image/')) fail('小屋插画不可用，请选择未关联的照片',403);
      }
      merged.roomArt=roomArt;
    }
    if(Object.hasOwn(data,'albumCovers')) {
      const covers=data.albumCovers;
      if(!covers || Array.isArray(covers) || Object.getPrototypeOf(covers)!==Object.prototype) fail('相册封面设置格式不正确');
      const pairs=Object.entries(covers);
      if(pairs.length>250) fail('相册封面设置过多');
      const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
      const savedCovers=Object.create(null);
      for(const [meetingId,mediaId] of pairs) {
        if(!validId(meetingId) || !validId(mediaId)) fail('相册封面标识不正确');
        if(old.albumCovers?.[meetingId]!==mediaId) {
          const file=await one(env,"SELECT m.type FROM media m JOIN entries e ON m.entry_id=e.id JOIN meetings t ON t.id=e.meeting_id WHERE m.id=? AND t.id=? AND e.kind='memory' AND e.status='published' AND m.deleted_at IS NULL AND m.purge_started_at IS NULL",mediaId,meetingId);
          if(!file || !file.type.startsWith('image/')) fail('请选择这次见面中已保存的照片作为封面',403);
        }
        savedCovers[meetingId]=mediaId;
      }
      merged.albumCovers=savedCovers;
    }
    if(Object.hasOwn(data,'dailyAlbums')) {
      const albums=data.dailyAlbums;
      if(!albums || Array.isArray(albums) || Object.getPrototypeOf(albums)!==Object.prototype) fail('日常相册设置格式不正确');
      const pairs=Object.entries(albums);
      if(pairs.length>250) fail('日常相册设置过多');
      const validId=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
      const savedAlbums=Object.create(null);
      for(const [entryId,value] of pairs) {
        if(!validId(entryId) || !value || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).some(key=>!['name','cover'].includes(key))) fail('日常相册设置格式不正确');
        const name=value.name??'',cover=value.cover??'';
        if(typeof name!=='string' || name.length>80 || typeof cover!=='string' || (cover&&!validId(cover))) fail('请填写 80 字以内的相册名称，并选择有效的封面');
        const previous=old.dailyAlbums?.[entryId];
        if(!previous || previous.name!==name.trim() || previous.cover!==cover) {
          const entry=await one(env,"SELECT id FROM entries WHERE id=? AND kind='memory' AND status='published' AND meeting_id IS NULL",entryId);
          if(!entry) fail('请选择未关联见面的日常相册',403);
        }
        if(cover && previous?.cover!==cover) {
          const file=await one(env,"SELECT id FROM media WHERE id=? AND entry_id=? AND type LIKE 'image/%' AND deleted_at IS NULL AND purge_started_at IS NULL",cover,entryId);
          if(!file) fail('请选择这本日常相册里已保存的照片作为封面',403);
        }
        savedAlbums[entryId]={name:name.trim(),cover};
      }
      merged.dailyAlbums=savedAlbums;
    }
    const saved=await stmt(env,"UPDATE settings SET data=? WHERE id='house' AND data=?",JSON.stringify(merged),JSON.stringify(old)).run();
    if(!saved.meta.changes) fail('另一人刚修改了设置，请重新打开设置再保存',409);
    return json({ok:true});
  }
  if(path==='/api/meetings' && request.method==='POST') {
    const data=await body(request);
    if(!validDate(data.start)||!validDate(data.end)||data.end<data.start) fail('结束日期不能早于开始日期');
    const id=data.id || uuid();
    if(data.id && !await one(env,'SELECT id FROM meetings WHERE id=?',id)) fail('见面记录不存在',404);
    await stmt(env,'INSERT INTO meetings (id,start,end,title,place,story) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,end=excluded.end,title=excluded.title,place=excluded.place,story=excluded.story',id,data.start,data.end,str(data.title,80)||'一次见面',str(data.place,160),str(data.story,4000)).run();
    return json({ok:true,id});
  }
  const meetingMatch=path.match(/^\/api\/meetings\/([^/]+)$/);
  if(meetingMatch && request.method==='DELETE') {
    await env.DB.batch([stmt(env,'UPDATE entries SET meeting_id=NULL WHERE meeting_id=?',meetingMatch[1]),stmt(env,'DELETE FROM meetings WHERE id=?',meetingMatch[1])]);
    return json({ok:true});
  }
  if(path==='/api/upload' && request.method==='POST') {
    const form=await uploadForm(request), file=form.get('file');
    if(!file || typeof file==='string' || !file.size) fail('请选择照片或 MP4 视频');
    if(file.size>VIDEO_LIMIT) fail('请选择 50 MB 以内的 MP4 视频',413);
    const prefix=new Uint8Array(await file.slice(0,4096).arrayBuffer());
    const type=mediaType(prefix,file.size);
    if(!type) fail('支持 JPG、PNG、WebP 照片和 MP4 视频，请检查文件内容');
    if(type.startsWith('image/') && file.size>PHOTO_LIMIT) fail('请选择 8 MB 以内的照片',413);
    const id=uuid(), key=`private/${actor.slot}/${id}`;
    await env.BUCKET.put(key,file,{httpMetadata:{contentType:type}});
    try { await stmt(env,'INSERT INTO media (id,owner,entry_id,key,type,name) VALUES (?,?,NULL,?,?,?)',id,actor.slot,key,type,str(file.name,180)).run(); }
    catch(e) { await env.BUCKET.delete(key); throw e; }
    return json({id,name:file.name,type});
  }
  const mediaMatch=path.match(/^\/api\/media\/([^/]+)$/);
  if(mediaMatch && ['GET','HEAD'].includes(request.method)) {
    const file=await one(env,'SELECT m.*,e.id AS linked_entry_id,e.author AS entry_author,e.status AS entry_status FROM media m LEFT JOIN entries e ON e.id=m.entry_id WHERE m.id=?',mediaMatch[1]);
    if(!file) fail('照片不存在',404);
    if(file.purge_started_at || (file.deleted_at && file.owner!==actor.slot)) fail('照片不可访问',404);
    if(file.entry_id) {
      if(!file.linked_entry_id || (file.entry_status==='draft' && file.entry_author!==actor.slot)) fail('这条内容不可访问',404);
    }
    else if(file.owner!==actor.slot) {
      const settings=JSON.parse((await one(env,"SELECT data FROM settings WHERE id='house'"))?.data||'{}');
      if(settings.roomArt!==file.id && !slots.some(s=>settings.people?.[s]?.avatar===file.id)) fail('照片不可访问',404);
    }
    return privateMediaResponse(request,env.BUCKET,file);
  }
  const previewMatch=path.match(/^\/api\/media\/([^/]+)\/preview\/(thumb|display)$/);
  if(previewMatch && request.method==='PUT') {
    const file=await one(env,'SELECT * FROM media WHERE id=?',previewMatch[1]);
    if(!file) fail('照片不存在',404);
    if(file.owner!==actor.slot) fail('只有上传者可以生成预览照片',403);
    if(!file.type.startsWith('image/')) fail('只有照片可以生成预览图');
    if(file.purge_started_at) fail('这张照片正在永久删除，请稍后重试',409);
    if(file.entry_id) await entryFor(env,file.entry_id,actor);
    const bytes=await previewBytes(request,previewMatch[2]),key=privatePreviewKey(file.key,previewMatch[2]);
    await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/webp'}});
    // A purge can start while the upload streams. Never leave a recreated preview behind.
    const available=await one(env,'SELECT id FROM media WHERE id=? AND owner=? AND purge_started_at IS NULL',file.id,actor.slot);
    if(!available) { await env.BUCKET.delete(key); fail('照片状态已改变，请刷新后重试',409); }
    return json({ok:true});
  }
  const mediaMutation=path.match(/^\/api\/media\/([^/]+)(?:\/(restore|permanent))?$/);
  if(mediaMutation && ((request.method==='DELETE' && mediaMutation[2]!=='restore') || (request.method==='POST' && mediaMutation[2]==='restore'))) {
    const file=await one(env,'SELECT m.*,e.kind AS entry_kind,e.author AS entry_author FROM media m LEFT JOIN entries e ON m.entry_id=e.id WHERE m.id=?',mediaMutation[1]);
    if(!file) fail('照片不存在',404);
    if(file.owner!==actor.slot || file.entry_author!==actor.slot || file.entry_kind!=='memory') fail('只有作者可以管理自己相册里的照片',403);
    const action=mediaMutation[2];
    if(action==='permanent') {
      if(!file.deleted_at) fail('请先把照片移到最近删除',409);
      // The marker blocks restore and previews before storage deletion starts. A retry
      // reuses it after either a storage failure or an interrupted request.
      const marked=await stmt(env,'UPDATE media SET purge_started_at=COALESCE(purge_started_at,?) WHERE id=? AND deleted_at IS NOT NULL RETURNING key',iso(),file.id).first();
      if(!marked) fail('照片状态已改变，请刷新后重试',409);
      await env.BUCKET.delete(privateMediaKeys(marked.key));
      await stmt(env,'DELETE FROM media WHERE id=? AND deleted_at IS NOT NULL AND purge_started_at IS NOT NULL',file.id).run();
    } else {
      if(file.purge_started_at) fail('这张照片正在永久删除，请稍后重试',409);
      const saved=action==='restore'
        ? await stmt(env,"UPDATE media SET deleted_at=NULL WHERE id=? AND purge_started_at IS NULL AND (deleted_at IS NULL OR (SELECT COUNT(*) FROM media m JOIN entries e ON m.entry_id=e.id JOIN entries album ON album.id=? WHERE e.kind='memory' AND e.status='published' AND m.deleted_at IS NULL AND m.purge_started_at IS NULL AND ((album.meeting_id IS NULL AND e.id=album.id) OR (album.meeting_id IS NOT NULL AND e.meeting_id=album.meeting_id)))<?)",file.id,file.entry_id,entryMediaLimit('memory')).run()
        : await stmt(env,'UPDATE media SET deleted_at=COALESCE(deleted_at,?) WHERE id=? AND purge_started_at IS NULL',iso(),file.id).run();
      if(!saved.meta.changes) fail(action==='restore'?`这个相册已放满 ${entryMediaLimit('memory')} 个照片或视频，或照片状态已改变，请刷新后重试`:'照片状态已改变，请刷新后重试',409);
    }
    return json({ok:true});
  }
  if(path==='/api/entries' && request.method==='POST') {
    const data=await body(request,96000);
    if(!['diary','memory','letter'].includes(data.kind)) fail('记录类型不正确');
    const text=str(data.text,8000), mediaIds=Array.isArray(data.media)?[...new Set(data.media)]:[];
    const mediaLimit=entryMediaLimit(data.kind);
    if(mediaIds.length>mediaLimit) fail(data.kind==='memory'?`这个相册最多放 ${mediaLimit} 个照片或视频`:`每条记录最多放 ${mediaLimit} 个附件`);
    if(mediaIds.some(id=>typeof id!=='string' || !id || id.length>80)) fail('附件标识不正确');
    if(!text && !mediaIds.length) fail('留下一句话或一张照片吧');
    if(data.kind==='memory' && !mediaIds.length) fail('请选择一张回忆照片或一个视频');
    const status=data.kind==='letter' && data.status==='draft'?'draft':'published';
    const id=data.id||str(data.requestId,80)||uuid(), now=iso();
    const previous=await one(env,'SELECT * FROM entries WHERE id=?',id);
    if(data.id&&!previous) fail('这条记录已被删除',404);
    if(previous) { mustOwn(previous,actor); if(previous.kind!==data.kind) fail('记录类型不能更改'); if(previous.status!=='draft' && status==='draft') fail('已发送的信不能变回草稿'); }
    const date=data.date||shanghaiToday();
    if(!validDate(date)) fail('日期格式不正确');
    if(data.meetingId && !await one(env,'SELECT id FROM meetings WHERE id=?',data.meetingId)) fail('关联的见面记录不存在');
    const selectedIds=JSON.stringify(mediaIds);
    const selectedFiles=mediaIds.length?await all(env,'SELECT id,owner,entry_id,deleted_at,purge_started_at FROM media WHERE id IN (SELECT value FROM json_each(?))',selectedIds):[];
    const filesById=new Map(selectedFiles.map(file=>[file.id,file]));
    for(const fileId of mediaIds) {
      const file=filesById.get(fileId);
      if(!file || file.owner!==actor.slot || (file.entry_id && file.entry_id!==id)) fail('照片不可用于这条记录',403);
      if(file.deleted_at || file.purge_started_at) fail('照片已移到最近删除，请先恢复后再编辑',409);
    }
    const meetingAlbum=data.kind==='memory'&&!!data.meetingId;
    const otherAlbumCountSql="SELECT COUNT(*) AS total FROM media m JOIN entries e ON m.entry_id=e.id WHERE e.kind='memory' AND e.status='published' AND e.meeting_id=? AND e.id<>? AND m.deleted_at IS NULL AND m.purge_started_at IS NULL";
    if(meetingAlbum&&mediaIds.length+(await one(env,otherAlbumCountSql,data.meetingId,id)).total>mediaLimit) fail(`这个相册最多放 ${mediaLimit} 个照片或视频`);
    // Repeat attachment validation inside the transaction so an editor opened
    // before a deletion cannot overwrite its newer state.
    const mediaAvailable=mediaIds.length?'(SELECT COUNT(*) FROM media WHERE id IN (SELECT value FROM json_each(?)) AND owner=? AND (entry_id IS NULL OR entry_id=?) AND deleted_at IS NULL AND purge_started_at IS NULL)=?':'1';
    const available=`${mediaAvailable}${meetingAlbum?` AND (${otherAlbumCountSql})+?<=?`:''}`;
    const availableParams=[...(mediaIds.length?[selectedIds,actor.slot,id,mediaIds.length]:[]),...(meetingAlbum?[data.meetingId,id,mediaIds.length,mediaLimit]:[])];
    const retained=mediaIds.length?'AND id NOT IN (SELECT value FROM json_each(?))':'';
    const retainedParams=mediaIds.length?[selectedIds]:[];
    const saved=await env.DB.batch([
      stmt(env,`INSERT INTO entries (id,kind,author,text,mood,date,meeting_id,status,created,updated,read_at) SELECT ?,?,?,?,?,?,?,?,?,?,NULL WHERE ${available} ON CONFLICT(id) DO UPDATE SET text=excluded.text,mood=excluded.mood,date=excluded.date,meeting_id=excluded.meeting_id,status=excluded.status,updated=excluded.updated`,id,data.kind,actor.slot,text,str(data.mood,30),date,data.meetingId||null,status,now,now,...availableParams),
      data.kind==='memory'
        ? stmt(env,`UPDATE media SET deleted_at=COALESCE(deleted_at,?) WHERE entry_id=? AND deleted_at IS NULL AND purge_started_at IS NULL ${retained} AND ${available}`,now,id,...retainedParams,...availableParams)
        : stmt(env,`UPDATE media SET entry_id=NULL WHERE entry_id=? AND ${available}`,id,...availableParams),
      ...(mediaIds.length?[stmt(env,`UPDATE media SET entry_id=? WHERE id IN (SELECT value FROM json_each(?)) AND ${available}`,id,selectedIds,...availableParams)]:[])
    ]);
    if(!saved[0].meta.changes) fail('这个相册的容量或照片状态已改变，请刷新后重试',409);
    return json({ok:true,id,status});
  }
  const entryMatch=path.match(/^\/api\/entries\/([^/]+)(?:\/(heart|read|comments))?$/);
  if(entryMatch) {
    const entry=await entryFor(env,entryMatch[1],actor), action=entryMatch[2];
    if(request.method==='DELETE' && !action) {
      mustOwn(entry,actor);
      if(entry.kind==='memory') {
        await stmt(env,'UPDATE media SET deleted_at=COALESCE(deleted_at,?) WHERE entry_id=? AND purge_started_at IS NULL',iso(),entry.id).run();
        return json({ok:true});
      }
      const files=await all(env,'SELECT key FROM media WHERE entry_id=?',entry.id);
      await env.DB.batch([stmt(env,'DELETE FROM comments WHERE entry_id=?',entry.id),stmt(env,'DELETE FROM hearts WHERE entry_id=?',entry.id),stmt(env,'DELETE FROM media WHERE entry_id=?',entry.id),stmt(env,'DELETE FROM entries WHERE id=?',entry.id)]);
      if(files.length) ctx.waitUntil(env.BUCKET.delete(files.flatMap(f=>privateMediaKeys(f.key))).catch(e=>console.error('Media cleanup:',e.message)));
      return json({ok:true});
    }
    if(request.method==='POST' && action==='heart') {
      if(entry.status==='draft') fail('草稿暂时不能点爱心');
      const heart=await one(env,'SELECT id FROM hearts WHERE entry_id=? AND author=?',entry.id,actor.slot);
      if(heart) await stmt(env,'DELETE FROM hearts WHERE id=?',heart.id).run();
      else await stmt(env,'INSERT INTO hearts (id,entry_id,author) VALUES (?,?,?)',uuid(),entry.id,actor.slot).run();
      return json({ok:true});
    }
    if(request.method==='POST' && action==='read') {
      if(entry.kind==='letter' && entry.status!=='draft' && entry.author!==actor.slot) await stmt(env,'UPDATE entries SET read_at=COALESCE(read_at,?) WHERE id=?',iso(),entry.id).run();
      return json({ok:true});
    }
    if(request.method==='POST' && action==='comments') {
      if(entry.status==='draft') fail('草稿暂时不能回复');
      const data=await body(request), text=str(data.text,2000);
      if(!text) fail('写一句回复吧');
      await stmt(env,'INSERT INTO comments (id,entry_id,author,text,created) VALUES (?,?,?,?,?)',uuid(),entry.id,actor.slot,text,iso()).run();
      return json({ok:true});
    }
  }
  const commentMatch=path.match(/^\/api\/comments\/([^/]+)$/);
  if(commentMatch && ['DELETE','PUT'].includes(request.method)) {
    const comment=await one(env,'SELECT * FROM comments WHERE id=?',commentMatch[1]);
    if(!comment) fail('回复不存在',404);
    await entryFor(env,comment.entry_id,actor); mustOwn(comment,actor);
    if(request.method==='DELETE') await stmt(env,'DELETE FROM comments WHERE id=?',comment.id).run();
    else { const data=await body(request), text=str(data.text,2000); if(!text) fail('回复不能为空'); await stmt(env,'UPDATE comments SET text=? WHERE id=?',text,comment.id).run(); }
    return json({ok:true});
  }
  if(path==='/api/miss' && request.method==='POST') {
    const latest=await one(env,'SELECT created FROM misses WHERE author=? ORDER BY created DESC LIMIT 1',actor.slot);
    if(latest && Date.now()-Date.parse(latest.created)<2000) fail('这份想念已经送到了，稍等一下再点吧',429);
    await stmt(env,'INSERT INTO misses (id,author,created) VALUES (?,?,?)',uuid(),actor.slot,iso()).run();
    return json({ok:true});
  }
  fail('没有找到这个入口',404);
}

export default {
  async fetch(request,env,ctx) {
    let auth,response;
    try {
      if(new URL(request.url).pathname.startsWith('/api/')) {
        if(env.AUTH_PROVIDER==='supabase') auth=createEmailAuth(request,env);
        response=await api(request,env,ctx,auth);
        return auth?auth.decorateResponse(response):response;
      }
      if(env.ASSETS) return await env.ASSETS.fetch(request);
      const assets=typeof __HOUSE_ASSETS__==='undefined'?{}:__HOUSE_ASSETS__;
      const pathname=new URL(request.url).pathname;
      const asset=assets[pathname]||(pathname==='/'?assets['/index.html']:null);
      if(asset) {
        const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
        return new Response(bytes,{headers:{'Content-Type':asset.type,'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=3600':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com"}});
      }
      return new Response('意淼小屋 API',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
    } catch(e) {
      if(!e.status) console.error('House request failed:',e.message);
      response=json({error:e.status?e.message:'暂时没有保存成功，你写的内容还在，请重试'},e.status||503);
      return auth?auth.decorateResponse(response):response;
    }
  }
};

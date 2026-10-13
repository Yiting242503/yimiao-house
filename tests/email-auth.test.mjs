import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { reunionDays } from '../shared/dates.js';

const members={yiting:'member-a@example.test',haomiao:'member-b@example.test'};
const ids={yiting:'11111111-1111-4111-8111-111111111111',haomiao:'22222222-2222-4222-8222-222222222222'};
const origin='https://house.example';
const cookieOf=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
const asJson=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

function authService() {
  const sessions=new Map(),refreshes=new Map(),sent=[];
  const state={outage:false,expired:false,alternate:false,refreshCount:0};
  const issue=(email,id)=>{
    const now=Math.floor(Date.now()/1000),exp=state.expired?now-30:now+3600;
    const user={id,email,email_confirmed_at:'2026-01-01T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const access_token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,email,aud:'authenticated',exp,iat:now,session_id:crypto.randomUUID()})}.fixture-signature`;
    const refresh_token=crypto.randomUUID();
    sessions.set(access_token,user);refreshes.set(refresh_token,{email,id});
    return {access_token,refresh_token,token_type:'bearer',expires_in:exp-now,expires_at:exp,user};
  };
  const handle=async request=>{
    const url=new URL(request.url);
    assert.equal(url.origin,'https://fixture.supabase.test','No real network calls are allowed');
    if(url.pathname==='/auth/v1/otp') {
      const data=await request.json();sent.push(data);
      return asJson({});
    }
    if(url.pathname==='/auth/v1/verify') {
      const data=await request.json();
      if(data.token!=='123456')return asJson({msg:'Token has expired or is invalid',code:'otp_expired'},403);
      const slot=Object.keys(members).find(key=>members[key]===data.email);
      if(!slot)return asJson({msg:'Denied'},403);
      return asJson(issue(data.email,state.alternate?'33333333-3333-4333-8333-333333333333':ids[slot]));
    }
    if(url.pathname==='/auth/v1/token') {
      const data=await request.json(),user=refreshes.get(data.refresh_token);
      if(!user)return asJson({msg:'Refresh token is invalid',code:'refresh_token_not_found'},400);
      state.refreshCount++;state.expired=false;
      return asJson(issue(user.email,user.id));
    }
    const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user') {
      if(state.outage)return asJson({msg:'Provider unavailable'},503);
      const user=sessions.get(token);
      return user?asJson(user):asJson({msg:'Session has expired',code:'session_not_found'},401);
    }
    if(url.pathname==='/auth/v1/logout') {sessions.delete(token);return new Response(null,{status:204});}
    assert.fail(`Unexpected auth endpoint: ${url.pathname}`);
  };
  return {handle,state,sent};
}

async function runtime(service,configured=true) {
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:await readFile('dist/server/index.js','utf8'),compatibilityDate:'2026-10-01',d1Databases:{DB:'isolated-email-auth'},r2Buckets:{BUCKET:'isolated-email-media'},outboundService:service.handle,bindings:{AUTH_PROVIDER:'supabase',LOCAL_PREVIEW:'true',MEMBER_EMAILS:JSON.stringify(members),...(configured?{SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture'}:{})}}));
  const db=await mf.getD1Database('DB');
  for(const file of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())for(const sql of (await readFile(`drizzle/${file}`,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
  const call=(path,method='GET',data,cookie='',extra={})=>mf.dispatchFetch(origin+'/api'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-House-Request':'1',Origin:origin}),'CF-Connecting-IP':'192.0.2.10',...(cookie?{Cookie:cookie}:{}),...extra},body:data===undefined?undefined:JSON.stringify(data)});
  return {mf,db,call};
}

test('standalone email login fails closed when unconfigured and ignores platform headers',async()=>{
  const {mf,call}=await runtime(authService(),false);
  try {
    const session=await (await call('/session','GET',undefined,'',{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':members.yiting})).json();
    assert.equal(session.emailLogin,true);assert.equal(session.emailLoginReady,false);assert.equal(session.authorized,false);assert.equal(session.localPreview,false);
    assert.equal((await call('/house')).status,401);
    assert.equal((await call('/dev-login','POST',{slot:'yiting'})).status,404);
    assert.equal((await call('/auth/request-code','POST',{email:members.yiting})).status,503);
  }finally{await mf.dispose();}
});

test('OTP verifies through the auth server; two cookie sessions share data with author and draft isolation',async()=>{
  const service=authService(),{mf,call}=await runtime(service);
  try {
    assert.equal((await call('/house','GET',undefined,'',{'oai-authenticated-user-id':ids.yiting,'oai-authenticated-user-email':members.yiting})).status,401);
    assert.equal((await call('/auth/request-code','POST',{email:'outsider@example.test'})).status,403);
    assert.equal(service.sent.length,0);
    assert.equal((await call('/auth/request-code','POST',{email:members.yiting})).status,200);
    assert.equal(service.sent[0].create_user,false);
    assert.equal((await call('/auth/request-code','POST',{email:members.yiting})).status,429);
    assert.equal((await call('/auth/verify-code','POST',{email:members.yiting,code:'12'})).status,400);
    const invalid=await call('/auth/verify-code','POST',{email:members.yiting,code:'000000'});
    assert.equal(invalid.status,400);assert.equal(invalid.headers.getSetCookie().length,0);
    const aLogin=await call('/auth/verify-code','POST',{email:members.yiting,code:'123456'});
    assert.equal(aLogin.status,200,await aLogin.clone().text());
    assert.deepEqual(await aLogin.json(),{ok:true});
    const a=cookieOf(aLogin);assert.ok(a.includes('__Host-house-auth'));
    for(const value of aLogin.headers.getSetCookie()){assert.match(value,/HttpOnly/i);assert.match(value,/Secure/i);assert.match(value,/SameSite=Lax/i);assert.match(value,/Path=\//);}
    const aSession=await (await call('/session','GET',undefined,a)).json();
    assert.equal(aSession.slot,'yiting');assert.equal(aSession.userId,`supabase:${ids.yiting}`);
    assert.equal((await call('/auth/request-code','POST',{email:members.haomiao})).status,200);
    const bLogin=await call('/auth/verify-code','POST',{email:members.haomiao,code:'123456'});
    assert.equal(bLogin.status,200,await bLogin.clone().text());const b=cookieOf(bLogin);
    const house=await (await call('/house','GET',undefined,a)).json();
    assert.equal(house.meetings.length,14);assert.equal(reunionDays(house.meetings),48);
    const diary=await (await call('/entries','POST',{kind:'diary',text:'Fixture diary',author:'haomiao'},a)).json();
    const shared=await (await call('/house','GET',undefined,b)).json();
    assert.equal(shared.entries.find(entry=>entry.id===diary.id).author,'yiting');
    assert.equal((await call(`/entries/${diary.id}`,'DELETE',undefined,b)).status,403);
    assert.equal((await call(`/entries/${diary.id}/comments`,'POST',{text:'Fixture reply',author:'yiting'},b)).status,200);
    const refreshed=await (await call('/house','GET',undefined,a)).json();
    assert.equal(refreshed.entries.find(entry=>entry.id===diary.id).comments[0].author,'haomiao');
    const draft=await (await call('/entries','POST',{kind:'letter',text:'Fixture private draft',status:'draft'},a)).json();
    assert.ok((await (await call('/house','GET',undefined,a)).json()).entries.some(entry=>entry.id===draft.id));
    assert.ok(!(await (await call('/house','GET',undefined,b)).json()).entries.some(entry=>entry.id===draft.id));
    assert.equal((await call(`/entries/${draft.id}/comments`,'POST',{text:'Denied'},b)).status,404);
    assert.equal((await call('/entries','POST',{kind:'diary',text:'CSRF'},a,{Origin:'https://outsider.example'})).status,403);
    assert.equal((await call('/media/unknown')).status,401);
    service.state.outage=true;
    const outage=await call('/house','GET',undefined,a);assert.equal(outage.status,503);
    assert.ok(!outage.headers.getSetCookie().some(value=>/Max-Age=0/i.test(value)));
    service.state.outage=false;
    assert.equal((await call('/house','GET',undefined,a)).status,200);
    service.state.alternate=true;
    const changed=await call('/auth/verify-code','POST',{email:members.yiting,code:'123456'});
    assert.equal(changed.status,403);assert.ok(changed.headers.getSetCookie().some(value=>/Max-Age=0/i.test(value)));
    service.state.alternate=false;
    assert.equal((await call('/auth/logout','POST',{},b)).status,200);
    assert.equal((await call('/house','GET',undefined,b)).status,401);
    assert.equal((await call(`/entries/${diary.id}`,'DELETE',undefined,a)).status,200);
    const after=await (await call('/house','GET',undefined,a)).json();
    assert.equal(after.meetings.length,14);assert.equal(reunionDays(after.meetings),48);
  }finally{await mf.dispose();}
});

test('expired access tokens refresh using server cookies without browser storage',async()=>{
  const service=authService();service.state.expired=true;
  const {mf,call}=await runtime(service);
  try {
    const login=await call('/auth/verify-code','POST',{email:members.yiting,code:'123456'});
    assert.equal(login.status,200,await login.clone().text());assert.ok(service.state.refreshCount>0);
    const session=await (await call('/session','GET',undefined,cookieOf(login))).json();
    assert.equal(session.slot,'yiting');assert.equal(session.authorized,true);
  }finally{await mf.dispose();}
});

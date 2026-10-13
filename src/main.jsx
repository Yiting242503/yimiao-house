import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { House, Heart, BookOpen, Images, CalendarDays, Mail, MapPin, Settings, ArrowUpRight, X, Plus, Check, Pencil, Trash2, RotateCcw, Upload, Send, ChevronLeft, ChevronRight, RefreshCw, LogOut, LockKeyhole, LoaderCircle, MessageCircle, Sparkles, Sun, Cloud, Moon, Coffee, Pause, Play, Video, Image as ImageIcon } from 'lucide-react';
import { api, upload, optimizePhoto, prepareMediaUpload } from './api';
import { acquaintanceDays, reunionDays, countdown, shanghaiToday, dateLabel, validDate } from '../shared/dates';
import { entryMediaLimit } from '../shared/media-limits.js';
import './style.css';
import EmailLogin from './components/EmailLogin.jsx';
import TitleCrystal from './components/CrystalizedBall/TitleCrystal.jsx';
import RoomMotion from './components/RoomMotion/RoomMotion.jsx';
import AlbumVideos from './components/AlbumVideos/AlbumVideos.jsx';
import PrivateVideo, { useVideoPlaying } from './components/PrivateVideo.jsx';
import { videoPlayback } from './components/video-playback.js';
import { preparePhotoPreviews } from './components/media-previews.js';

const views={album:{title:'一起走过',sub:'把回忆，留在看得见的地方',icon:Images},meetings:{title:'一次次走向你',sub:'每一次见面，都值得记住',icon:CalendarDays},diary:{title:'今天的小事',sub:'你的日常，也是我想靠近的生活',icon:BookOpen},letters:{title:'写给你的话',sub:'有些想念，适合慢慢写',icon:Mail},distance:{title:'隔着距离，也住在一起',sub:'两座城市，同一盏灯',icon:MapPin},activity:{title:'小屋动态',sub:'这里装着刚刚送来的想念',icon:Heart},settings:{title:'小屋设置',sub:'把这里，慢慢变成我们的样子',icon:Settings}};
const nav=[['album','一起走过'],['meetings','见面日历'],['diary','今天的小事'],['letters','写给你的话']];
const moods=[['晴朗',Sun],['想你',Heart],['平静',Coffee],['低落',Cloud],['疲惫',Moon]];
const timeLabel=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const mediaUrl=(id,variant)=>`/api/media/${id}${variant?`?variant=${variant}`:''}`;
const isVideoMedia=file=>file?.type?.startsWith('video/');
const isImageMedia=file=>file?.type?.startsWith('image/');
const mediaName=file=>file?.name||'视频';
const loadCircularCarousel=()=>import('./components/CircularCarousel/CircularCarousel');
const loadAlbumPhoto=()=>import('./components/HoloCard/AlbumPhoto.jsx');
const CircularCarousel=lazy(loadCircularCarousel);
const AlbumPhoto=lazy(loadAlbumPhoto);
const prepareAlbumViews=()=>{void Promise.allSettled([loadCircularCarousel(),loadAlbumPhoto()]);};
const RoomGlass=lazy(()=>import('./components/GlassSurface/RoomGlass.jsx').catch(()=>({default:()=>null})));
const AlbumBorder=lazy(()=>import('./components/BorderGlow/AlbumBorder.jsx').catch(()=>({default:({children})=>children})));
const AeroPreview=lazy(()=>import('./components/AeroShards/AeroPreview.jsx'));
const previewMode=new URLSearchParams(window.location.search).get('preview');
const glassButtons=previewMode!=='original';
const borderGlow=previewMode!=='original';

function IconButton({icon:Icon,label,onClick,...props}) {return <button className="icon-button" aria-label={label} title={label} onClick={onClick} {...props}><Icon size={18}/></button>;}
function Button({icon:Icon,children,className='',...props}) {return <button className={`button ${className}`} {...props}>{Icon&&<Icon size={17}/>}<span>{children}</span></button>;}
function Empty({icon:Icon=ImageIcon,title,children,action}) {return <div className="empty"><div className="empty-icon"><Icon size={30} strokeWidth={1.25}/></div><h3>{title}</h3>{children&&<p>{children}</p>}{action}</div>;}
function Avatar({person,slot,size='small'}) {return person.avatar?<img className={`avatar ${size}`} src={mediaUrl(person.avatar,'thumb')} alt={person.name} decoding="async"/>:<span className={`avatar ${size} ${slot==='yiting'?'peach':'sage'}`}>{person.name.slice(-1)}</span>;}
function Field({label,children,hint}) {return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
function Modal({open,onClose,title,subtitle,children,wide=false,className='',headingExtra}) {return <Dialog.Root open={open} onOpenChange={value=>!value&&onClose()}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className={`modal ${wide?'wide':''} ${className}`}><div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title>{subtitle&&<Dialog.Description>{subtitle}</Dialog.Description>}{headingExtra}</div><Dialog.Close asChild><IconButton icon={X} label="关闭"/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;}
function MediaThumbnail({file,alt,compact=false}) {
  return isVideoMedia(file)?<span className={`video-thumbnail ${compact?'compact':''}`}><Video size={compact?23:34} strokeWidth={1.4}/><span>{mediaName(file)}</span></span>:<img className={compact?'entry-thumbnail':undefined} src={mediaUrl(file.id,'thumb')} alt={alt} loading="lazy" decoding="async"/>;
}
function App() {
  const [session,setSession]=useState(null),[house,setHouse]=useState(null),[loadError,setLoadError]=useState(''),[view,setView]=useState(previewMode==='border'?'album':null),[toast,setToast]=useState(''),[busy,setBusy]=useState(false),[composer,setComposer]=useState(null),[meetingForm,setMeetingForm]=useState(null),[detail,setDetail]=useState(null),[confirm,setConfirm]=useState(null),[heartBurst,setHeartBurst]=useState(0);
  const [tip,setTip]=useState(()=>localStorage.getItem('house-tip')!=='dismissed');
  const [detailPhoto,setDetailPhoto]=useState(0);
  const [detailHolo,setDetailHolo]=useState(false);
  const [detailAlbum,setDetailAlbum]=useState(null),[detailMediaId,setDetailMediaId]=useState(null);
  const [meetingAlbum,setMeetingAlbum]=useState(null);
  const [dailyAlbumEditor,setDailyAlbumEditor]=useState(null);
  const [today,setToday]=useState(shanghaiToday());
  const timer=useRef(null);
  const notify=useCallback(message=>{setToast(message);clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(''),4200);},[]);
  const load=useCallback(async()=>{setLoadError('');try {const user=await api('/session');setSession(user);if(user.authorized)setHouse(await api('/house'));else setHouse(null);}catch(e){setLoadError(e.message);}},[]);
  useEffect(()=>{load();const focus=()=>{setToday(shanghaiToday());load();};window.addEventListener('focus',focus);const interval=setInterval(()=>{setToday(shanghaiToday());},60000);return()=>{window.removeEventListener('focus',focus);clearInterval(interval);clearTimeout(timer.current);};},[load]);
  const act=async(task,success,refreshOnFailure=false)=>{setBusy(true);try{await task();await load();if(success)notify(success);return true;}catch(e){if(e.status===409||refreshOnFailure)await load();notify(e.message);return false;}finally{setBusy(false);}};
  const openView=key=>{if(key==='album'||key==='meetings')prepareAlbumViews();setView(key);setDetail(null);setDetailAlbum(null);setDetailMediaId(null);setMeetingAlbum(null);setDailyAlbumEditor(null);};
  useEffect(()=>{
    if(!document.modelContext?.registerTool || !session?.authorized)return;
    const lifecycle=new AbortController();
    Promise.resolve(document.modelContext.registerTool({name:'open_house_room',title:'打开小屋物件',description:'打开相册、见面日历、日记、信箱、窗边或设置。只切换页面，不保存记录。',inputSchema:{type:'object',properties:{section:{type:'string',enum:Object.keys(views)}},required:['section'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:async input=>{if(!views[input.section])throw new Error('入口不存在');setView(input.section);return {opened:input.section};}},{signal:lifecycle.signal})).catch(()=>{});
    return()=>lifecycle.abort();
  },[session?.authorized]);
  const login=slot=>act(async()=>{await api('/dev-login','POST',{slot});},'欢迎回到小屋');
  const logout=async()=>{if(session.localPreview||session.emailLogin){try {await api(session.emailLogin?'/auth/logout':'/dev-logout','POST',{});setHouse(null);setView(null);await load();}catch(error){notify(error.message);}}else window.location.assign('/signout-with-chatgpt?return_to=%2F');};
  const miss=async()=>{if(busy)return;const saved=await act(()=>api('/miss','POST',{}),'这份想念，已经留在小屋里了');if(saved){setHeartBurst(Date.now());setTimeout(()=>setHeartBurst(0),1800);}};
  const deleteAction=(title,task,options={})=>setConfirm({title,task,description:'删除后无法恢复，确认要删除吗？',confirmLabel:'确认删除',cancelLabel:'保留',success:'已删除',closeDetail:true,...options});
  const openDetail=async (entry,photoIndex=0,holo=view==='album')=>{
    videoPlayback.suspendAll();
    const file=entry.media[photoIndex],scope=entry.kind==='memory'&&isImageMedia(file)&&meetingAlbum&&(meetingAlbum.type==='daily'?entry.id===meetingAlbum.id:entry.meeting_id===meetingAlbum.id)?{type:meetingAlbum.type==='daily'?'daily':'meeting',id:meetingAlbum.id,author:meetingAlbum.author||'all'}:null;
    const photos=scope?albumPhotoItems(house.entries,scope):[];
    setDetailAlbum(scope?{...scope,index:Math.max(0,photos.findIndex(item=>item.file.id===file.id))}:null);setDetailMediaId(file?.id||null);
    setDetailPhoto(photoIndex);setDetailHolo(holo&&entry.kind==='memory');setDetail(entry.id);
    if(entry.kind==='letter'&&entry.status!=='draft'&&entry.author!==session.slot&&!entry.read_at)await act(()=>api(`/entries/${entry.id}/read`,'POST',{}));
  };

  if(!session || loadError || (session.authorized&&!house))return <main className="loading-screen"><House size={34} strokeWidth={1.2}/><h1>意淼小屋</h1><p>{loadError||'正在为你留一盏灯'}</p>{loadError?<Button icon={RefreshCw} onClick={load}>重新连接</Button>:<LoaderCircle className="spin" size={20}/>}</main>;
  if(!session.authorized)return <><main className="welcome"><div className="welcome-art"/><div className="welcome-content"><span className="eyebrow"><House size={15}/> A LITTLE HOME FOR TWO</span><h1>意淼小屋</h1><p className="welcome-tagline">把想念，放进同一个家</p><span className="welcome-line"/><p className="welcome-copy">为彼此留一盏灯。<br/>只有拿着钥匙的人，才能打开这里的回忆。</p>{session.emailLogin?<EmailLogin ready={session.emailLoginReady} onSuccess={load}/>:session.localPreview?<div className="preview-login"><span className="preview-caption">本机预览 · 两个体验账号</span><Button icon={House} disabled={busy} onClick={()=>login('yiting')}>用体验账号 A 进入</Button><Button className="secondary" disabled={busy} onClick={()=>login('haomiao')}>用体验账号 B 进入</Button><small>体验数据保存在这台电脑。正式账号需另行绑定。</small></div>:session.authenticated?<div className="account-pending"><LockKeyhole size={22}/><p>这个账号还没有小屋的钥匙</p><small>请将以下账号标识交给小屋管理员完成绑定。</small><code>{session.userId}</code><a href="/signout-with-chatgpt?return_to=%2F">更换登录账号</a></div>:<a className="button" href="/signin-with-chatgpt?return_to=%2F" target="_top"><LockKeyhole size={17}/> 登录小屋</a>}<div className="welcome-footer">PRIVATE, JUST FOR US.</div></div></main>{toast&&<div role="status" className="toast">{toast}</div>}</>;

  const settings=house.settings, people=settings.people, current=people[session.slot], days=acquaintanceDays(settings.acquainted,today), count=countdown(settings.nextMeeting,today), selectedMeeting=meetingAlbum?.type!=='daily'?house.meetings.find(m=>m.id===meetingAlbum?.id):null;
  const detailPhotos=detailAlbum?albumPhotoItems(house.entries,detailAlbum):[],foundDetailIndex=detailPhotos.findIndex(item=>item.file.id===detailMediaId),detailIndex=foundDetailIndex>=0?foundDetailIndex:Math.min(detailAlbum?.index||0,Math.max(0,detailPhotos.length-1)),activeDetailPhoto=detailPhotos[detailIndex];
  const selected=detail?detailAlbum?activeDetailPhoto?.entry:house.entries.find(e=>e.id===detail):null;
  const moveDetail=delta=>{if(busy||!detailPhotos.length)return;const index=(detailIndex+delta+detailPhotos.length)%detailPhotos.length,item=detailPhotos[index];setDetail(item.entry.id);setDetailPhoto(item.photoIndex);setDetailMediaId(item.file.id);setDetailAlbum(value=>({...value,index}));};
  const closeDetail=()=>{if(activeDetailPhoto)setMeetingAlbum(value=>value?{...value,photoId:activeDetailPhoto.file.id}:value);setDetail(null);setDetailAlbum(null);setDetailMediaId(null);};
  const returnPhotoId=activeDetailPhoto?.file.id||meetingAlbum?.photoId;
  const selectedDaily=meetingAlbum?.type==='daily'?(house.entries.find(entry=>entry.id===meetingAlbum.id)||{...meetingAlbum.entry,media:[]}):null;
  const dailyEditorEntry=house.entries.find(entry=>entry.id===dailyAlbumEditor)||(selectedDaily?.id===dailyAlbumEditor?selectedDaily:null);
  const homeEffectsActive=!view&&!selected&&!selectedMeeting&&!selectedDaily&&!dailyEditorEntry&&!composer&&!meetingForm&&!confirm;
  if(previewMode==='aero')return <Suspense fallback={<main className="loading-screen"><LoaderCircle className="spin" size={20}/></main>}><AeroPreview/></Suspense>;
  const unread=house.entries.filter(e=>e.kind==='letter'&&e.status!=='draft'&&e.author!==session.slot&&!e.read_at).length;
  const common={house,session,people,act,busy,notify,deleteAction,setComposer,openDetail,openMeeting:(id,author='all')=>setMeetingAlbum({id,author,holo:view==='album'}),openDailyAlbum:entry=>setMeetingAlbum({id:entry.id,type:'daily',entry,holo:view==='album'}),onDailySettings:setDailyAlbumEditor};
  return <div className="app-shell">
    <header className="site-header"><button className="brand" onClick={()=>setView(null)} aria-label="回到小屋"><span className="brand-mark"><House size={23} strokeWidth={1.5}/><Heart size={10}/></span><span>{settings.name}<small>YIMIAO'S LITTLE HOME</small></span></button><nav aria-label="主要导航">{nav.map(([key,label])=><button key={key} onClick={()=>openView(key)}>{label}{key==='letters'&&unread>0&&<span className="unread-dot"/>}</button>)}</nav><div className="header-right"><button className="current-person" onClick={()=>openView('settings')}><Avatar person={current} slot={session.slot}/><span>{current.name}</span></button><IconButton icon={Settings} label="小屋设置" onClick={()=>openView('settings')}/></div></header>
    <main>
      <section className="home-intro"><div><div className="eyebrow"><span className="tiny-line"/> OUR DISTANCE, OUR HOME</div><h1><span className="home-title-text">{settings.name}</span><TitleCrystal active={homeEffectsActive}/></h1><p>{settings.subtitle}</p></div><div className="intro-right"><div className="home-date"><span>{days===null?'相识日期待填写':days===0?'等待相识的那一天':`相识第 ${days} 天`}</span><span>{dateLabel(today)}</span></div><div className="stats"><div><strong>{days===null?'—':days}<small>天</small></strong><span>相识的日子</span></div><div><strong>{house.meetings.length}<small>次</small></strong><span>已记录的见面</span></div><div><strong>{reunionDays(house.meetings)}<small>天</small></strong><span>相聚日期</span></div></div></div></section>
      <section className="room-section" aria-label="我们的小屋，可点击房间物件">
        <RoomMotion active={homeEffectsActive}>
          <img src={settings.roomArt?mediaUrl(settings.roomArt):'/assets/room.webp'} className="room-image" width="1536" height="1024" fetchPriority="high" alt="暖灯照着沙发，两个卡通小人坐在一起；相册墙、日历、窗户、日记本与信箱围绕着他们。"/>
          <div className="room-corner"><span className="room-number">ROOM NO. 001</span><span>今天，也想和你待在一起</span></div>
          <Hotspot label="一起走过" icon={Images} x={26} y={23} onClick={()=>openView('album')}/>
          <Hotspot label="见面日历" icon={CalendarDays} x={53} y={21} onClick={()=>openView('meetings')}/>
          <Hotspot label="隔着距离" icon={MapPin} x={77} y={32} onClick={()=>openView('distance')}/>
          <Hotspot label="想你了" icon={Heart} x={15} y={57} onClick={miss} disabled={busy}/>
          <Hotspot label="今天的小事" icon={BookOpen} x={55} y={77} onClick={()=>openView('diary')}/>
          <Hotspot label="写给你的话" icon={Mail} x={89} y={61} onClick={()=>openView('letters')}/>
          {tip&&<div className="first-tip"><Sparkles size={15}/><span>轻触房间里的物件，打开我们的小日常</span><IconButton icon={X} label="关闭首次提示" onClick={()=>{setTip(false);localStorage.setItem('house-tip','dismissed');}}/></div>}
          {heartBurst>0&&<div className="heart-burst" aria-hidden="true">{Array.from({length:7},(_,i)=><Heart key={i} fill="currentColor" size={18+i%3*8} style={{'--i':i}}/>)}</div>}
        </RoomMotion>
        <div className="room-bottom"><div className="two-people"><Avatar person={people.yiting} slot="yiting"/><Avatar person={people.haomiao} slot="haomiao"/><span>{people.yiting.name}<span className="name-and"> & </span>{people.haomiao.name}<small>在各自的城市，把生活过给彼此看。</small></span></div><button className="text-action" onClick={()=>openView('distance')}><MapPin size={15}/>{people.yiting.city||'城市待填写'} · {people.haomiao.city||'城市待填写'}<ArrowUpRight size={16}/></button></div>
      </section>
      <nav className="mobile-navigation" aria-label="小屋文字导航">{Object.entries(views).filter(([k])=>k!=='activity').map(([key,v])=><button key={key} onClick={()=>openView(key)}><v.icon size={19}/>{({album:'一起走过',meetings:'见面日历',diary:'今天的小事',letters:'写给你的话',distance:'隔着距离',settings:'小屋设置'})[key]}</button>)}<button onClick={miss} disabled={busy}><Heart size={19}/>想你了</button></nav>
      <section className="home-journal"><div className="journal-column"><div className="section-heading"><div><span className="eyebrow">LITTLE MOMENTS</span><h2>今天的小事</h2></div><IconButton icon={Plus} label="记录今天的小事" onClick={()=>setComposer({kind:'diary'})}/></div>{house.entries.filter(e=>e.kind==='diary').slice(0,2).map(e=><button className="recent-entry" key={e.id} onClick={()=>{openView('diary');openDetail(e);}}><span className="entry-meta">{people[e.author].name} · {timeLabel(e.created)}</span><p>{e.text.slice(0,75)||'留下一张生活的照片'}</p></button>)}{!house.entries.some(e=>e.kind==='diary')&&<div className="quiet-empty"><BookOpen size={24} strokeWidth={1.2}/><p>今天过得怎么样？</p><span>第一件小事，等你留下。</span><button className="text-action" onClick={()=>setComposer({kind:'diary'})}>写一点今天 <ArrowUpRight size={15}/></button></div>}</div><div className="journal-column next-meeting"><div className="section-heading"><div><span className="eyebrow">UNTIL WE MEET</span><h2>下一次，见到你</h2></div><CalendarDays size={23} strokeWidth={1.3}/></div>{count.days>0?<div className="countdown-number">{count.days}<span>天</span></div>:<div className="calendar-glyph"><CalendarDays size={42} strokeWidth={1}/></div>}<p>{count.text}</p><button className="text-action" onClick={()=>openView('distance')}>{validDate(settings.nextMeeting)?'查看我们的约定':'一起定个日子'}<ArrowUpRight size={15}/></button></div><div className="journal-column"><div className="section-heading"><div><span className="eyebrow">A NOTE FROM HOME</span><h2>小屋里的回声</h2></div><IconButton icon={RefreshCw} label="刷新动态" onClick={load}/></div>{house.misses.slice(0,2).map(m=><div className="miss-row" key={m.id}><Heart size={17}/><div><p>{people[m.author].name}想你了</p><span>{timeLabel(m.created)}</span></div></div>)}{!house.misses.length&&<div className="quiet-empty"><Mail size={25} strokeWidth={1.2}/><p>有一盏灯，一直为你亮着。</p><span>收到的想念，会留在这里。</span></div>}<button className="text-action" onClick={()=>openView('activity')}>看看小屋动态<ArrowUpRight size={15}/></button></div></section>
    </main><footer className="site-footer"><span><House size={15}/>{settings.name}</span><span>两个人的日常，慢慢装满这个家。</span><button onClick={logout}><LogOut size={14}/>{session.localPreview?'退出本机体验':'退出登录'}</button></footer>
    <Dialog.Root open={!!view} onOpenChange={value=>!value&&setView(null)}><Dialog.Portal><Dialog.Overlay className="sheet-overlay"/><Dialog.Content className="sheet"><div className="sheet-top"><button className="text-action" onClick={()=>setView(null)}><ChevronLeft size={17}/>回到小屋</button><Dialog.Close asChild><IconButton icon={X} label="关闭抽屉"/></Dialog.Close></div>{view&&<><div className="sheet-heading"><span className="eyebrow">OUR LITTLE HOME / {view.toUpperCase()}</span><Dialog.Title>{views[view].title}</Dialog.Title><Dialog.Description>{views[view].sub}</Dialog.Description></div><div className="sheet-body">{view==='meetings'?<Meetings {...common} setMeetingForm={setMeetingForm}/>:view==='settings'?<HouseSettings {...common} logout={logout}/>:view==='distance'?<Distance {...common} today={today} onSettings={()=>openView('settings')}/>:view==='activity'?<Activity {...common}/>:<Entries {...common} kind={view==='album'?'memory':view==='letters'?'letter':'diary'}/>}</div></>}</Dialog.Content></Dialog.Portal></Dialog.Root>
    {selectedMeeting&&<MeetingMemories key={`${selectedMeeting.id}:${meetingAlbum.author}`} open={!selected} meeting={selectedMeeting} returnPhotoId={returnPhotoId} house={house} busy={busy} act={act} authorFilter={meetingAlbum.author} onClose={()=>setMeetingAlbum(null)} onUpload={()=>{setMeetingAlbum(null);setComposer({kind:'memory',meeting_id:selectedMeeting.id,date:selectedMeeting.start});}} onEdit={()=>{setMeetingAlbum(null);setMeetingForm(selectedMeeting);}} onDelete={()=>deleteAction(`删除「${selectedMeeting.title}」`,()=>api(`/meetings/${selectedMeeting.id}`,'DELETE'))} onPhoto={(entry,index)=>openDetail(entry,index,meetingAlbum.holo)}/>}
    {selectedDaily&&<MeetingMemories key={`daily:${selectedDaily.id}`} open={!selected&&!composer&&!dailyEditorEntry} dailyEntry={selectedDaily} meeting={{id:selectedDaily.id,title:dailyAlbumName(house.settings,selectedDaily.id),start:selectedDaily.date,end:selectedDaily.date}} returnPhotoId={returnPhotoId} house={house} busy={busy} act={act} onClose={()=>setMeetingAlbum(null)} onUpload={selectedDaily.author===session.slot?()=>setComposer(selectedDaily):undefined} onEdit={()=>setDailyAlbumEditor(selectedDaily.id)} onPhoto={(entry,index)=>openDetail(entry,index,meetingAlbum.holo)}/>}
    {dailyEditorEntry&&<DailyAlbumEditor key={dailyEditorEntry.id} entry={dailyEditorEntry} house={house} act={act} busy={busy} onClose={()=>setDailyAlbumEditor(null)}/>}
    {composer&&<Composer {...common} data={composer} onClose={()=>setComposer(null)}/>}
    {meetingForm&&<MeetingEditor {...common} data={meetingForm} onClose={()=>setMeetingForm(null)}/>}
    {selected&&<EntryDetail key={detailAlbum?`album:${detailAlbum.type}:${detailAlbum.id}:${detailAlbum.author}`:selected.id} {...common} entry={selected} initialPhoto={detailPhoto} holoPhotos={detailHolo} albumNavigation={detailAlbum&&activeDetailPhoto?{file:activeDetailPhoto.file,index:detailIndex,total:detailPhotos.length,onPrevious:()=>moveDetail(-1),onNext:()=>moveDetail(1)}:null} onClose={closeDetail}/>}
    <AlertDialog.Root open={!!confirm} onOpenChange={value=>!value&&!busy&&setConfirm(null)}><AlertDialog.Portal><AlertDialog.Overlay className="modal-overlay"/><AlertDialog.Content className="confirm-dialog"><Trash2 size={27} strokeWidth={1.4}/><AlertDialog.Title>{confirm?.title}</AlertDialog.Title><AlertDialog.Description>{confirm?.description}</AlertDialog.Description><div className="form-actions"><AlertDialog.Cancel asChild><Button className="secondary" disabled={busy}>{confirm?.cancelLabel}</Button></AlertDialog.Cancel><Button icon={Trash2} className="danger" disabled={busy} onClick={async()=>{const action=confirm;if(await act(action.task,action.success,action.refreshOnFailure)){setConfirm(null);if(action.closeDetail)setDetail(null);action.onSuccess?.();}}}>{busy?'正在处理':confirm?.confirmLabel}</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
    {toast&&<div role="status" className="toast"><Check size={17}/>{toast}</div>}
  </div>;
}
function Hotspot({label,icon:Icon,x,y,onClick,disabled}) {const positions={'一起走过':[28,24],'见面日历':[54.3,26],'隔着距离':[80,33],'想你了':[12,33],'今天的小事':[50.8,70.5],'写给你的话':[89,47]};const position=positions[label]||[x,y];return <button className={`hotspot${glassButtons?' glass-hotspot':''}`} style={{left:`${position[0]}%`,'--y':`${position[1]}%`}} onClick={onClick} disabled={disabled}>{glassButtons&&<Suspense fallback={null}><RoomGlass/></Suspense>}<span className="hotspot-icon"><Icon size={17} strokeWidth={1.6}/></span><span className="hotspot-label">{label}</span><span className="hotspot-pulse"/></button>;}

function Entries({kind,house,session,people,setComposer,openDetail,openMeeting,openDailyAlbum,onDailySettings,act,busy,deleteAction}) {
  const [filter,setFilter]=useState('all'),[coverMeetingId,setCoverMeetingId]=useState(null),[showTrash,setShowTrash]=useState(false);
  useEffect(()=>{setShowTrash(false);setFilter('all');},[kind]);
  const coverMeeting=house.meetings.find(meeting=>meeting.id===coverMeetingId);
  const entries=house.entries.filter(e=>e.kind===kind&&(filter==='all'||(filter==='draft'?e.status==='draft':e.author===filter&&e.status!=='draft'))).sort((a,b)=>kind==='memory'?b.date.localeCompare(a.date)||b.created.localeCompare(a.created):b.created.localeCompare(a.created));
  if(kind==='memory'&&showTrash)return <RecentlyDeleted files={house.recycledMedia||[]} act={act} busy={busy} deleteAction={deleteAction} onBack={()=>setShowTrash(false)}/>;
  return <><div className="view-toolbar"><div className="segmented"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>全部</button>{kind==='letter'?<button className={filter==='draft'?'active':''} onClick={()=>setFilter('draft')}>我的草稿</button>:<><button className={filter==='yiting'?'active':''} onClick={()=>setFilter('yiting')}>{people.yiting.name}</button><button className={filter==='haomiao'?'active':''} onClick={()=>setFilter('haomiao')}>{people.haomiao.name}</button></>}</div><Button icon={Plus} onClick={()=>setComposer({kind})}>{kind==='memory'?'添一张回忆':kind==='letter'?'写一封信':'记一件小事'}</Button></div>{kind==='memory'&&<div className="album-trash-entry"><span>每张回忆，都可以单独整理。</span><Button className="secondary" icon={Trash2} onClick={()=>setShowTrash(true)}>最近删除 ({house.recycledMedia?.length||0})</Button></div>}{entries.length?kind==='memory'?<MemoryAlbumGrid entries={entries} house={house} people={people} session={session} busy={busy} deleteAction={deleteAction} openMeeting={id=>openMeeting(id,filter)} openDailyAlbum={openDailyAlbum} onDailySettings={onDailySettings} onCover={setCoverMeetingId}/>:<div className="entries-list">{entries.map(e=><button className={`entry-card ${kind}`} key={e.id} onClick={()=>e.status==='draft'?setComposer(e):openDetail(e)}><div className="entry-card-content"><span className="entry-meta">{people[e.author].name} · {dateLabel(e.date)}{e.mood&&` · ${e.mood}`}</span>{kind==='letter'&&<span className={`letter-status ${!e.read_at&&e.status!=='draft'?'unread':''}`}>{e.status==='draft'?'仅自己可见 · 草稿':e.read_at?'已读':'未读'}</span>}<p>{e.text||(isVideoMedia(e.media[0])?mediaName(e.media[0]):'一张生活的照片')}</p>{e.media.length>0&&<MediaThumbnail file={e.media[0]} alt="记录附图" compact/>}<span className="entry-card-bottom"><Heart size={14}/> {e.hearts.length}<MessageCircle size={14}/> {e.comments.length}</span></div></button>)}</div>:<Empty icon={kind==='memory'?Images:kind==='letter'?Mail:BookOpen} title={kind==='memory'?'相框还空着，回忆已经在心里':kind==='letter'?'有句话，想慢慢说给你听':'今天的小事，等你来写'}>{kind==='memory'?'把你们的照片或视频放进来，再留下一句那天的心情。':kind==='letter'?'写下后可以先存为草稿，准备好再送出去。':'晴天、晚饭、路过的风景，都可以留在这里。'}</Empty>}{coverMeeting&&<AlbumCoverEditor key={coverMeeting.id} meeting={coverMeeting} house={house} act={act} busy={busy} onClose={()=>setCoverMeetingId(null)}/>}</>;
}

function RecentlyDeleted({files,act,busy,deleteAction,onBack}) {
  const [selectedIds,setSelectedIds]=useState([]),[progress,setProgress]=useState(null);
  const selected=files.filter(file=>selectedIds.includes(file.id));
  useEffect(()=>{const available=new Set(files.map(file=>file.id));setSelectedIds(current=>{const remaining=current.filter(id=>available.has(id));return remaining.length===current.length?current:remaining;});},[files]);
  const toggleSelected=(id,checked)=>setSelectedIds(current=>checked?[...new Set([...current,id])]:current.filter(value=>value!==id));
  const permanentlyDelete=file=>deleteAction(`永久删除这${isVideoMedia(file)?'个视频':'张照片'}？`,()=>api(`/media/${file.id}/permanent`,'DELETE'),{description:`「${file.name||'这份回忆'}」将从小屋中彻底删除，无法再恢复。`,confirmLabel:'永久删除',cancelLabel:'取消',success:'已永久删除',closeDetail:false,refreshOnFailure:true});
  const permanentlyDeleteSelected=()=>{
    if(!selected.length||busy)return;
    const targets=[...selected],videos=targets.filter(isVideoMedia).length,photos=targets.length-videos,summary=[photos&&`${photos} 张照片`,videos&&`${videos} 段视频`].filter(Boolean).join('、');
    let pending=targets,completed=0;
    deleteAction(`永久删除选中的 ${targets.length} 个附件？`,async()=>{
      const failed=[];setProgress({done:completed,total:targets.length});
      try {
        for(const file of pending){
          try {await api(`/media/${file.id}/permanent`,'DELETE');completed++;setSelectedIds(current=>current.filter(id=>id!==file.id));setProgress({done:completed,total:targets.length});}
          catch{failed.push(file);}
        }
        pending=failed;
        if(pending.length)throw new Error(`${completed} 个附件已永久删除，${pending.length} 个未完成。请再次确认重试，或取消返回。`);
      } finally {setProgress(null);}
    },{description:`选中的 ${summary} 将从小屋中彻底删除，无法恢复。`,confirmLabel:'批量永久删除',cancelLabel:'取消',success:`已永久删除 ${targets.length} 个附件`,closeDetail:false,refreshOnFailure:true,onSuccess:()=>setSelectedIds([])});
  };
  return <section className="photo-trash" aria-label="最近删除">
    <div className="view-toolbar"><Button className="secondary" icon={ChevronLeft} disabled={busy} onClick={onBack}>返回相册</Button><span className="small-summary">{files.length} 个附件</span></div>
    <div className="photo-trash-heading"><span className="empty-icon"><Trash2 size={24} strokeWidth={1.4}/></span><div><h3>最近删除</h3><p>这里保存你自己删除的照片和视频。永久删除前会一直保留，恢复后回到原来的相册与位置。</p></div></div>
    {files.length>0&&<div className="photo-trash-batch-controls" role="group" aria-label="批量整理最近删除"><label className="photo-trash-select-all"><input type="checkbox" checked={selected.length===files.length} ref={input=>{if(input)input.indeterminate=selected.length>0&&selected.length<files.length;}} disabled={busy} onChange={event=>setSelectedIds(event.target.checked?files.map(file=>file.id):[])}/><span>全选</span></label><Button className="secondary" disabled={busy||!selected.length} onClick={()=>setSelectedIds([])}>清空选择</Button><span className="small-summary" role="status">已选择 {selected.length} 个附件</span><Button className="danger" icon={Trash2} disabled={busy||!selected.length} onClick={permanentlyDeleteSelected}>批量永久删除</Button></div>}
    {progress&&<p className="photo-trash-batch-progress" role="status">正在永久删除 {progress.done} / {progress.total} 个附件</p>}
    {files.length?<div className="photo-trash-grid">{files.map(file=><article className={`photo-trash-item${selectedIds.includes(file.id)?' selected':''}`} data-media-id={file.id} key={file.id}>
      <div className="photo-trash-preview">{file.purge_started_at?<div className="photo-trash-unavailable"><Trash2 size={25} strokeWidth={1.4}/><span>已开始永久删除</span></div>:<MediaThumbnail file={file} alt={file.name||'已删除照片'}/>}<label className="photo-trash-select"><input type="checkbox" checked={selectedIds.includes(file.id)} disabled={busy} onChange={event=>toggleSelected(file.id,event.target.checked)} aria-label={`选择${isVideoMedia(file)?'视频':'照片'} ${file.name||'这份回忆'}`}/><span>选择</span></label></div>
      <div className="photo-trash-content"><h4>{file.name||(isVideoMedia(file)?'一段回忆视频':'一张回忆照片')}</h4><p className="photo-trash-origin"><Images size={14}/><span>{file.meeting_title||'日常片段'} · {dateLabel(file.date)}</span></p>{file.entry_text&&<p className="photo-trash-caption">{file.entry_text}</p>}<p className="photo-trash-date">{timeLabel(file.deleted_at)} 删除</p>{file.purge_started_at&&<p className="photo-trash-warning">无法预览或恢复，请继续永久删除。</p>}
        <div className="photo-trash-actions"><Button className="secondary" icon={RotateCcw} disabled={busy||!!file.purge_started_at} onClick={()=>act(()=>api(`/media/${file.id}/restore`,'POST',{}),'已恢复到原来的相册')}>恢复</Button><Button className="danger" icon={Trash2} disabled={busy} onClick={()=>permanentlyDelete(file)}>{file.purge_started_at?'继续永久删除':'永久删除'}</Button></div>
      </div>
    </article>)}</div>:<Empty icon={Trash2} title="最近删除里还没有照片">单独删除的照片和视频会来到这里，想念的瞬间还可以找回来。</Empty>}
  </section>;
}

function dailyAlbumName(settings,entryId) {return settings.dailyAlbums?.[entryId]?.name||'日常片段';}

function albumPhotoItems(entries,scope) {
  return entries.filter(entry=>entry.kind==='memory'&&entry.status!=='draft'&&(scope.type==='daily'?entry.id===scope.id:entry.meeting_id===scope.id&&(scope.author==='all'||entry.author===scope.author))).sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created)).flatMap(entry=>entry.media.map((file,photoIndex)=>({file,entry,photoIndex})).filter(({file})=>isImageMedia(file)));
}

function MemoryAlbumGrid({entries,house,people,session,busy,deleteAction,openMeeting,openDailyAlbum,onDailySettings,onCover}) {
  const [menu,setMenu]=useState(null),menuRef=useRef(null),triggerRef=useRef(null);
  const closeMenu=(restoreFocus=false)=>{setMenu(null);if(restoreFocus)triggerRef.current?.focus();};
  useEffect(()=>{
    if(!menu)return;
    menuRef.current?.querySelector('button:not(:disabled)')?.focus();
    const outside=event=>{if(!menuRef.current?.contains(event.target))setMenu(null);};
    const dismiss=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMenu(null);triggerRef.current?.focus();}};
    window.addEventListener('pointerdown',outside);window.addEventListener('keydown',dismiss,true);
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',dismiss,true);};
  },[menu]);
  const openMenu=(event,album)=>{
    event.preventDefault();event.stopPropagation();triggerRef.current=event.currentTarget.querySelector('.entry-card');
    const bounds=triggerRef.current.getBoundingClientRect(),keyboard=event.type==='keydown';
    setMenu({album,x:Math.max(8,Math.min(keyboard?bounds.left+20:event.clientX,window.innerWidth-232)),y:Math.max(8,Math.min(keyboard?bounds.top+20:event.clientY,window.innerHeight-116))});
  };
  const removeAlbum=()=>{
    const album=menu.album,owned=album.entries.filter(entry=>entry.author===session.slot),allOwned=owned.length===album.entries.length,title=album.meeting?.title||dailyAlbumName(house.settings,album.latest.id);
    closeMenu();
    deleteAction(allOwned?`删除「${title}」相册？`:`删除「${title}」中我上传的照片？`,async()=>{for(const entry of owned)await api(`/entries/${entry.id}`,'DELETE');},{description:allOwned?'相册内的照片和视频会移入「最近删除」，可以恢复。':'你上传的照片和视频会移入「最近删除」，另一人的上传会继续保留。',confirmLabel:allOwned?'删除相册':'删除我的上传',cancelLabel:'取消',success:allOwned?'相册已移入最近删除':'你的上传已移入最近删除',closeDetail:false,refreshOnFailure:true});
  };
  const meetingById=new Map(house.meetings.map(meeting=>[meeting.id,meeting])),albums=new Map();
  for(const entry of entries){
    const meeting=meetingById.get(entry.meeting_id),key=meeting?`meeting:${meeting.id}`:`entry:${entry.id}`;
    if(!albums.has(key))albums.set(key,{key,meeting,entries:[],latest:entry});
    albums.get(key).entries.push(entry);
  }
  return <div className="album-grid">{[...albums.values()].map(album=>{
    const {meeting,latest}=album,ordered=[...album.entries].sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created)),media=ordered.flatMap(entry=>entry.media),choices=meeting?meetingPhotoChoices(house.entries,meeting.id):media.filter(isImageMedia).map(file=>({file})),coverId=meeting?house.settings.albumCovers?.[meeting.id]:house.settings.dailyAlbums?.[latest.id]?.cover,cover=(choices.find(({file})=>file.id===coverId)||choices[0])?.file||media[0],photos=media.filter(isImageMedia).length,videos=media.filter(isVideoMedia).length,authors=[...new Set(ordered.map(entry=>entry.author))].map(author=>people[author].name).join(' · '),title=meeting?.title||dailyAlbumName(house.settings,latest.id);
    const card=<button className={`entry-card memory ${meeting?'meeting-album':'daily-album'}`} data-meeting-id={meeting?.id} data-entry-id={meeting?undefined:latest.id} onClick={()=>meeting?openMeeting(meeting.id):openDailyAlbum(latest)} aria-haspopup="dialog">
      {cover?<MediaThumbnail file={cover} alt={`${title}的相册封面`}/>:<span className="album-cover-empty"><Images size={34} strokeWidth={1.3}/></span>}
      <div className="entry-card-content"><span className="entry-meta">{meeting?`${dateLabel(meeting.start)} — ${dateLabel(meeting.end)}`:dateLabel(latest.date)}</span><h3>{title}</h3><span className="album-meeting-place"><MapPin size={12}/>{meeting?.place||'地点待填写'}</span><span className="album-authors">{authors}</span>
        <span className="entry-card-bottom"><Images size={14}/>{photos} 张照片{videos>0&&<><Video size={14}/>{videos} 段视频</>}<ChevronRight size={15} className="album-open-arrow"/></span>
      </div>
    </button>;
    return <article className="album-item" key={album.key} onContextMenu={event=>openMenu(event,album)} onKeyDown={event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openMenu(event,album);}}>{borderGlow?<Suspense fallback={card}><AlbumBorder>{card}</AlbumBorder></Suspense>:card}<IconButton icon={ImageIcon} label={meeting?`设置${title}相册封面`:`设置${title}相册名称与封面`} className={`icon-button album-cover-button${meeting?'':' daily-album-settings-button'}`} aria-haspopup="dialog" onClick={()=>meeting?onCover(meeting.id):onDailySettings(latest.id)}/></article>;
  })}{menu&&<div className="album-context-menu" ref={menuRef} role="menu" aria-label="相册操作" style={{left:menu.x,top:menu.y}} onKeyDown={event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...menuRef.current.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}else if(event.key==='Tab')closeMenu();}}><button role="menuitem" onClick={()=>{const album=menu.album;closeMenu();if(album.meeting)onCover(album.meeting.id);else onDailySettings(album.latest.id);}}><ImageIcon size={16}/>{menu.album.meeting?'设置相册封面':'相册名称与封面'}</button><button className="danger" role="menuitem" disabled={busy||!menu.album.entries.some(entry=>entry.author===session.slot)} onClick={removeAlbum}><Trash2 size={16}/>{menu.album.entries.every(entry=>entry.author===session.slot)?'删除相册':menu.album.entries.some(entry=>entry.author===session.slot)?'删除我上传的照片':'仅作者可删除相册'}</button></div>}</div>;
}

function meetingPhotoChoices(entries,meetingId) {
  return entries.filter(entry=>entry.kind==='memory'&&entry.meeting_id===meetingId&&entry.status!=='draft').sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created)).flatMap(entry=>entry.media.filter(isImageMedia).map(file=>({file,entry})));
}

function AlbumCoverEditor({meeting,house,act,busy,onClose}) {
  const choices=meetingPhotoChoices(house.entries,meeting.id);
  const [selected,setSelected]=useState(()=>choices.some(({file})=>file.id===house.settings.albumCovers?.[meeting.id])?house.settings.albumCovers[meeting.id]:'');
  const [error,setError]=useState('');
  const save=async event=>{
    event.preventDefault();setError('');
    if(selected&&!choices.some(({file})=>file.id===selected)){setError('这张照片已不在相册里，请重新选择。');return;}
    const albumCovers={...house.settings.albumCovers};
    if(selected)albumCovers[meeting.id]=selected;else delete albumCovers[meeting.id];
    if(await act(()=>api('/settings','PUT',{...house.settings,albumCovers}),'相册封面已保存'))onClose();
    else setError('封面还没有保存，选择已保留。');
  };
  return <Modal open onClose={busy?()=>{}:onClose} title="选择相册封面" subtitle={meeting.title} className="album-cover-modal" wide><form className="album-cover-form" onSubmit={save}><fieldset className="album-cover-fieldset" disabled={busy}><legend className="sr-only">相册封面照片</legend><label className={`album-cover-default ${selected===''?'selected':''}`}><input type="radio" name="album-cover" value="" checked={selected===''} onChange={()=>setSelected('')}/><span>自动使用第一张照片</span>{selected===''&&<Check size={16}/>}</label>{choices.length?<div className="album-cover-grid">{choices.map(({file,entry},index)=><label className={`album-cover-option ${selected===file.id?'selected':''}`} key={file.id}><input type="radio" name="album-cover" value={file.id} checked={selected===file.id} onChange={()=>setSelected(file.id)} aria-label={`第 ${index+1} 张照片`}/><img src={mediaUrl(file.id,'thumb')} alt={entry.text||`${meeting.title}第 ${index+1} 张照片`} loading="lazy" decoding="async"/>{selected===file.id&&<span className="album-cover-check"><Check size={18}/></span>}<span className="album-cover-photo-date">{dateLabel(entry.date)}</span></label>)}</div>:<Empty icon={Images} title="还没有可作封面的照片"/>}{error&&<p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button type="button" className="secondary" onClick={onClose}>取消</Button><Button type="submit" icon={Check}>{busy?'正在保存':'保存封面'}</Button></div></fieldset></form></Modal>;
}

function DailyAlbumEditor({entry,house,act,busy,onClose}) {
  const choices=entry.media.filter(isImageMedia),metadata=house.settings.dailyAlbums?.[entry.id];
  const [name,setName]=useState(metadata?.name||''),[cover,setCover]=useState(()=>choices.some(file=>file.id===metadata?.cover)?metadata.cover:''),[error,setError]=useState('');
  const save=async event=>{
    event.preventDefault();setError('');
    if(cover&&!choices.some(file=>file.id===cover)){setError('这张照片已不在相册里，请重新选择。');return;}
    const dailyAlbums={...house.settings.dailyAlbums,[entry.id]:{name:name.trim(),cover}};
    if(await act(()=>api('/settings','PUT',{...house.settings,dailyAlbums}),'相册名称与封面已保存'))onClose();
    else setError('还没有保存，名称和选择都保留着。');
  };
  return <Modal open onClose={busy?()=>{}:onClose} title="相册名称与封面" subtitle="给这段日常一个名字，再选一张喜欢的封面。" className="album-cover-modal daily-album-editor" wide>
    <form className="album-cover-form" onSubmit={save}><fieldset className="album-cover-fieldset" disabled={busy}>
      <Field label="相册名称" hint="留空时显示「日常片段」。"><input value={name} onChange={event=>setName(event.target.value)} placeholder="例如：我们的周末" maxLength={80}/></Field>
      <legend className="sr-only">日常相册名称与封面</legend>
      <label className={`album-cover-default ${cover===''?'selected':''}`}><input type="radio" name="daily-cover" checked={cover===''} onChange={()=>setCover('')}/><span>自动使用第一张照片</span>{cover===''&&<Check size={16}/>}</label>
      {choices.length?<div className="album-cover-grid">{choices.map((file,index)=><label className={`album-cover-option ${cover===file.id?'selected':''}`} key={file.id}><input type="radio" name="daily-cover" checked={cover===file.id} onChange={()=>setCover(file.id)} aria-label={`第 ${index+1} 张照片`}/><img src={mediaUrl(file.id,'thumb')} alt={`第 ${index+1} 张封面照片`} loading="lazy" decoding="async"/>{cover===file.id&&<span className="album-cover-check"><Check size={18}/></span>}<span className="album-cover-photo-date">{dateLabel(entry.date)}</span></label>)}</div>:<p className="inline-note">还没有可作封面的照片，相册名称可以先保存。</p>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="button" className="secondary" onClick={onClose}>取消</Button><Button type="submit" icon={Check}>{busy?'正在保存':'保存相册'}</Button></div>
    </fieldset></form>
  </Modal>;
}

function Meetings({house,setMeetingForm,openMeeting}) {
  const meetings=[...house.meetings].sort((a,b)=>a.start.localeCompare(b.start));
  return <><div className="view-toolbar"><p className="small-summary">{meetings.length} 次见面 · {reunionDays(meetings)} 个相聚日期</p><Button icon={Plus} onClick={()=>setMeetingForm({})}>新增见面</Button></div><p className="inline-note">开始与结束当天都计入，重叠日期只算一次。</p><div className="meeting-timeline">{meetings.map((m,i)=>{const media=house.entries.filter(e=>e.meeting_id===m.id&&e.status!=='draft').flatMap(e=>e.media),photos=media.filter(isImageMedia).length,videos=media.filter(isVideoMedia).length;return <article className="meeting-item" key={m.id}>{(i===0||m.start.slice(0,4)!==meetings[i-1].start.slice(0,4))&&<div className="year-marker">{m.start.slice(0,4)}</div>}<button className="meeting-summary" onClick={()=>openMeeting(m.id)} aria-haspopup="dialog"><span className="meeting-index">{String(i+1).padStart(2,'0')}</span><span><strong>{m.title}</strong><small>{dateLabel(m.start)} — {dateLabel(m.end)}</small><small className="meeting-list-place"><MapPin size={12}/><span>{m.place||'地点待填写'}</span></small></span><span className="meeting-photo-count" title={`${photos} 张照片 · ${videos} 段视频`} aria-label={`${photos} 张照片，${videos} 段视频`}>{videos&&!photos?<Video size={15}/>:<Images size={15}/>}<span>{photos+videos||'待补'}</span><ChevronRight size={17}/></span></button></article>;})}</div></>;
}

function MeetingMemories({meeting,dailyEntry,house,busy,act,onClose,onUpload,onEdit,onDelete,onPhoto,returnPhotoId,authorFilter='all',open=true}) {
  const videoPlaying=useVideoPlaying();
  const [playing,setPlaying]=useState(true),[active,setActive]=useState(0),[group,setGroup]=useState(0),[initialIndex,setInitialIndex]=useState(0),[jumpRevision,setJumpRevision]=useState(0);
  const [editingPlace,setEditingPlace]=useState(false),[place,setPlace]=useState(meeting.place||'');
  const controls=useRef(null);
  const memories=(dailyEntry?[dailyEntry]:house.entries.filter(e=>e.meeting_id===meeting.id&&e.status!=='draft'&&(authorFilter==='all'||e.author===authorFilter))).sort((a,b)=>a.date.localeCompare(b.date)||a.created.localeCompare(b.created)).flatMap(entry=>entry.media.map((file,photoIndex)=>({file,entry,photoIndex})));
  const items=memories.filter(({file})=>isImageMedia(file)).map(({file,entry,photoIndex})=>({id:file.id,src:mediaUrl(file.id,'thumb'),alt:entry.text||`${meeting.title}的照片`,title:entry.text?entry.text.slice(0,40):'一起走过的瞬间',subtitle:dateLabel(entry.date),entry,photoIndex}));
  const videos=memories.filter(({file})=>isVideoMedia(file));
  const groupSize=8,groupCount=Math.ceil(items.length/groupSize),safeGroup=Math.min(group,Math.max(0,groupCount-1)),offset=safeGroup*groupSize;
  const groupItems=items.slice(offset,offset+groupSize);
  const safeActive=Math.max(0,Math.min(active,groupItems.length-1)),current=groupItems[safeActive];
  const firstPhotoPreview=current?<button className="single-meeting-photo" style={{height:'100%',padding:0,margin:0}} onClick={()=>openPhoto(current.entry,current.photoIndex)} aria-label="打开当前照片"><img src={current.src} alt={current.alt} decoding="async" fetchPriority="high" style={{height:'calc(100% - 60px)'}}/><span>{current.title}</span></button>:null;
  const changeGroup=(next,index=0)=>{setGroup(next);setActive(index);setInitialIndex(index);};
  const jumpTo=index=>{if(!items.length)return;setPlaying(false);const target=Math.max(0,Math.min(index,items.length-1));setGroup(Math.floor(target/groupSize));setActive(target%groupSize);setInitialIndex(target%groupSize);setJumpRevision(value=>value+1);};
  const photoIds=items.map(item=>item.id).join(',');
  useEffect(()=>{if(!returnPhotoId)return;const index=items.findIndex(item=>item.id===returnPhotoId);if(index>=0&&(index!==offset+safeActive||playing))jumpTo(index);},[returnPhotoId,photoIds]);
  const openPhoto=(entry,index)=>{const target=items.findIndex(item=>item.entry.id===entry.id&&item.photoIndex===index);if(target>=0)jumpTo(target);else{setPlaying(false);setInitialIndex(active);}onPhoto(entry,index);};
  const navigate=delta=>{if(!items.length)return;setPlaying(false);const index=(offset+safeActive+delta+items.length)%items.length,nextGroup=Math.floor(index/groupSize);if(nextGroup!==safeGroup)changeGroup(nextGroup,index%groupSize);else if(delta>0)controls.current?.next();else controls.current?.previous();};
  const savePlace=async event=>{event.preventDefault();if(await act(()=>api('/meetings','POST',{...meeting,place:place.trim()}),'见面地点已保存'))setEditingPlace(false);};
  const placeEditor=editingPlace?<form className="meeting-place-editor" onSubmit={savePlace}><MapPin size={16}/><input aria-label="见面地点" value={place} onChange={event=>setPlace(event.target.value)} maxLength={160} placeholder="见面的地点" autoFocus disabled={busy}/><IconButton icon={Check} label="保存见面地点" type="submit" disabled={busy}/><IconButton icon={X} label="取消编辑地点" type="button" disabled={busy} onClick={()=>setEditingPlace(false)}/></form>:<button className="meeting-place meeting-place-button" title="编辑见面地点" aria-label="编辑见面地点" onClick={()=>{setPlace(meeting.place||'');setEditingPlace(true);}}><MapPin size={14}/><span>{meeting.place||'地点待填写'}</span><Pencil size={12}/></button>;
  return <Modal open={open} onClose={onClose} title={meeting.title} subtitle={dailyEntry?dateLabel(dailyEntry.date):`${dateLabel(meeting.start)} 至 ${dateLabel(meeting.end)}`} className={`meeting-memory-modal${dailyEntry?' daily-memory-modal':''}`} headingExtra={!dailyEntry&&<p className="meeting-heading-place-label"><MapPin size={12}/><span>{meeting.place||'地点待填写'}</span></p>}>
    <div className="meeting-memory-body">
      <div className="memory-topline"><span className="eyebrow">MOMENTS WITH YOU</span><span><Images size={15}/>{items.length} 张照片{videos.length>0&&<> · <Video size={15}/>{videos.length} 段视频</>}</span></div>
      {items.length>1?<><div className="meeting-carousel-stage" onKeyDownCapture={event=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Home'||event.key==='End')jumpTo(event.key==='Home'?0:items.length-1);else navigate(event.key==='ArrowRight'?1:-1);}}}><Suspense fallback={firstPhotoPreview}><CircularCarousel key={`${offset}:${jumpRevision}:${groupItems.map(item=>item.id).join(',')}`} items={groupItems} initialIndex={Math.max(0,Math.min(initialIndex,groupItems.length-1))} controlsRef={controls} preset="cylinder" intro="rise" cardWidth={250} aspectRatio={1.15} gap={35} autoplay={playing&&!videoPlaying&&groupItems.length>1?'drift':'off'} speed={6} parallax={0.1} stretch={0.12} fadeColor="#faf7f0" cornerRadius={8} captions onChange={setActive} onItemClick={item=>openPhoto(item.entry,item.photoIndex)} ariaLabel={`${meeting.title}的回忆照片`}/></Suspense></div><div className="meeting-carousel-controls"><IconButton icon={ChevronLeft} label="上一张回忆" onClick={()=>navigate(-1)}/><span className="memory-counter">{offset+safeActive+1} / {items.length}</span><IconButton icon={ChevronRight} label="下一张回忆" onClick={()=>navigate(1)}/><span className="control-divider"/><IconButton icon={playing?Pause:Play} label={playing?'暂停相册转动':'继续相册转动'} onClick={()=>setPlaying(value=>!value)}/>{current&&<IconButton icon={ArrowUpRight} label="打开当前照片与留言" onClick={()=>openPhoto(current.entry,current.photoIndex)}/>}</div></>:items.length===1?<button className="single-meeting-photo" onClick={()=>openPhoto(items[0].entry,items[0].photoIndex)} aria-label="打开这次见面的照片"><img src={items[0].src} alt={items[0].alt}/><span>{items[0].title}<ArrowUpRight size={17}/></span></button>:!videos.length&&<div className="meeting-memory-empty"><Empty icon={Images} title="那次见面的光，等照片来收藏">相框先为我们留着。<br/>等你把那天的点滴放进来。</Empty></div>}
      {videos.length>0&&<AlbumVideos videos={videos} savedOrder={house.settings.videoOrders?.[`${dailyEntry?'daily':'meeting'}:${meeting.id}`]||[]} people={house.settings.people} busy={busy} refreshKey={house.settings.version||0} sortable={!!dailyEntry||authorFilter==='all'} onOpen={openPhoto} onSave={ids=>act(()=>api('/album-video-order','PUT',{kind:dailyEntry?'daily':'meeting',albumId:meeting.id,ids,version:house.settings.version||0}),'视频顺序已保存')}/>}
      <div className="meeting-memory-story">{!dailyEntry&&placeEditor}<p className="story-text">{dailyEntry?dailyEntry.text||'把平常的日子，也留在这里。':meeting.story||'这一次的故事，还没有写下来。'}</p></div>
      <div className="meeting-memory-actions">{onUpload&&<Button icon={Upload} disabled={busy} onClick={onUpload}>{dailyEntry?'补充相册照片':'补上这次的照片'}</Button>}<Button icon={Pencil} className="secondary" disabled={busy} onClick={onEdit}>{dailyEntry?'相册名称与封面':'地点与故事'}</Button>{onDelete&&<IconButton icon={Trash2} label="删除这次见面" disabled={busy} onClick={onDelete}/>}</div>
    </div>
  </Modal>;
}

function MeetingEditor({data,onClose,act,busy}) {
  const [form,setForm]=useState({title:'',start:'',end:'',place:'',story:'',...data});
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const save=async e=>{e.preventDefault();if(await act(()=>api('/meetings','POST',form),'见面记录已保存'))onClose();};
  return <Modal open onClose={onClose} title={data.id?'补充这次见面':'记下一次见面'} subtitle="日期、照片、故事，一点点补齐。"><form onSubmit={save} className="editor-form"><Field label="见面的名字"><input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="例如：第十五次见面" maxLength={80} required/></Field><div className="form-grid"><Field label="开始日期"><input type="date" value={form.start} onChange={e=>set('start',e.target.value)} required/></Field><Field label="结束日期"><input type="date" value={form.end} min={form.start} onChange={e=>set('end',e.target.value)} required/></Field></div><Field label="地点"><input value={form.place} onChange={e=>set('place',e.target.value)} placeholder="暂时留空也没关系" maxLength={160}/></Field><Field label="那次的小故事"><textarea value={form.story} onChange={e=>set('story',e.target.value)} placeholder="你想记住的某个瞬间……" rows={5} maxLength={4000}/></Field><div className="form-actions"><Button type="button" className="secondary" onClick={onClose}>取消</Button><Button type="submit" icon={Check} disabled={busy}>{busy?'正在保存':'保存见面'}</Button></div></form></Modal>;
}

function Composer({data,onClose,house,session,act,busy,notify,deleteAction}) {
  const kind=data.kind, draftKey=`house-draft:${session.slot}:${kind}:${data.id||data.meeting_id||'new'}`;
  const activeSavedIds=house.entries.find(entry=>entry.id===data.id)?.media.map(file=>file.id)||[];
  const [form,setForm]=useState(()=>{try {const saved=JSON.parse(localStorage.getItem(draftKey)||'null');return saved?{...saved,media:kind==='memory'?(saved.media||[]).filter(id=>activeSavedIds.includes(id)):saved.media||[]}:{text:data.text||'',mood:data.mood||'平静',date:data.date||shanghaiToday(),meetingId:data.meeting_id||'',media:data.media?.map(f=>f.id)||[]};}catch{return {text:data.text||'',mood:data.mood||'平静',date:data.date||shanghaiToday(),meetingId:data.meeting_id||'',media:data.media?.map(f=>f.id)||[]};}});
  const [files,setFiles]=useState([]),[sending,setSending]=useState(false),[preparing,setPreparing]=useState(false),[preparingProgress,setPreparingProgress]=useState({ready:0,total:0}),[progress,setProgress]=useState(0),[uploadIndex,setUploadIndex]=useState(0),[error,setError]=useState(''),[canRetry,setCanRetry]=useState(false);
  const fileInput=useRef(null), uploaded=useRef(new Map()), photoUrls=useRef([]), retryStatus=useRef('published'), requestId=useRef(data.id||form.requestId||crypto.randomUUID());
  useEffect(()=>{localStorage.setItem(draftKey,JSON.stringify({...form,requestId:requestId.current}));},[form,draftKey]);
  useEffect(()=>()=>photoUrls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
  const activeMediaKey=activeSavedIds.join(',');
  useEffect(()=>{if(kind!=='memory')return;const available=new Set(activeMediaKey?activeMediaKey.split(','):[]);setForm(previous=>{const media=previous.media.filter(id=>available.has(id));return media.length===previous.media.length?previous:{...previous,media};});},[kind,activeMediaKey]);
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const savedMedia=new Map([...house.entries.flatMap(entry=>entry.media),...(data.media||[])].map(file=>[file.id,file]));
  const removedSavedMedia=kind==='memory'?activeSavedIds.filter(id=>!form.media.includes(id)).length:0;
  const albumLimit=entryMediaLimit(kind),otherAlbumMedia=kind==='memory'&&form.meetingId?house.entries.filter(entry=>entry.kind==='memory'&&entry.status==='published'&&entry.meeting_id===form.meetingId&&entry.id!==requestId.current).reduce((total,entry)=>total+entry.media.length,0):0;
  const mediaLimit=Math.max(0,albumLimit-otherAlbumMedia),selectedCount=form.media.length+files.length;
  const selectFiles=async e=>{
    setError('');setCanRetry(false);const chosen=Array.from(e.target.files||[]);e.target.value='';
    if(!chosen.length)return;
    if(chosen.length+selectedCount>mediaLimit){setError(kind==='memory'?`这个相册最多放 ${albumLimit} 个照片或视频，还可以添加 ${Math.max(0,mediaLimit-selectedCount)} 个。请重新选择。`:'每条记录最多放 6 个附件');return;}
    setPreparing(true);setPreparingProgress({ready:0,total:chosen.length});
    try {const ready=[];for(const file of chosen){ready.push(await prepareMediaUpload(file));setPreparingProgress({ready:ready.length,total:chosen.length});}setFiles(f=>[...f,...ready.map(file=>{const url=URL.createObjectURL(file);photoUrls.current.push(url);return {file,url};})]);}
    catch(e){setError(e.message);}finally{setPreparing(false);}
  };
  const submit=async status=>{
    if(sending||preparing||busy)return;retryStatus.current=status;setError('');setCanRetry(false);setSending(true);setProgress(0);
    if(selectedCount>mediaLimit){setError(kind==='memory'?`这个相册最多放 ${albumLimit} 个照片或视频，请先移除 ${selectedCount-mediaLimit} 个。`:'每条记录最多放 6 个附件');setSending(false);return;}
    try {
      for(let i=0;i<files.length;i++){
        setUploadIndex(i+1);
        if(!uploaded.current.has(files[i].url)){
          const result=await upload(files[i].file,p=>setProgress(Math.round((i+p/100)/files.length*100)));
          uploaded.current.set(files[i].url,result.id);
          preparePhotoPreviews(files[i].file,result.id);
        }
        setProgress(Math.round((i+1)/files.length*100));
      }
      const success=await act(()=>api('/entries','POST',{...form,id:data.id,requestId:requestId.current,kind,status,media:[...form.media,...files.map(file=>uploaded.current.get(file.url))]}),status==='draft'?'信件草稿已保存，仅自己可见':kind==='letter'?'信已送进你们的信箱':'已保存到小屋');
      if(success){localStorage.removeItem(draftKey);onClose();}
      else{setError('记录还没有保存，附件和文字都保留着。');setCanRetry(true);}
    }catch(e){setError(e.message);setCanRetry(true);}finally{setSending(false);}
  };
  return <Modal open onClose={sending||preparing?()=>{}:onClose} title={kind==='memory'?'添一张回忆':kind==='letter'?'写给你的话':'今天，有什么小事？'} subtitle={kind==='letter'?'草稿只有你自己能看见。':'文字会暂存在这台设备，保存成功后才成为小屋的记录。'}>
    <fieldset className="editor-form editor-fieldset" disabled={sending||preparing||busy}>
      {kind==='diary'&&<div className="mood-picker">{moods.map(([label,Icon])=><button key={label} className={form.mood===label?'selected':''} onClick={()=>set('mood',label)}><Icon size={18}/>{label}</button>)}</div>}
      <Field label={kind==='letter'?'想对你说':'留下一句话'}><textarea className={kind==='letter'?'letter-input':''} rows={kind==='letter'?10:5} value={form.text} maxLength={8000} placeholder={kind==='letter'?'亲爱的，\n\n今天想和你说……':'比如，今天看到了很漂亮的晚霞……'} onChange={e=>set('text',e.target.value)}/></Field>
      <div className="form-grid"><Field label="回忆日期"><input type="date" value={form.date} onChange={e=>set('date',e.target.value)}/></Field>{kind==='memory'&&<Field label="关联一次见面"><select value={form.meetingId} onChange={e=>set('meetingId',e.target.value)}><option value="">日常片段 · 不关联见面</option>{[...house.meetings].reverse().map(m=><option key={m.id} value={m.id}>{m.title} · {m.start}</option>)}</select></Field>}</div>
      {kind==='memory'&&<p className="photo-picker-note">一次可选择多张照片或视频 · 相册已选 {otherAlbumMedia+selectedCount} / {albumLimit}</p>}
      <div className="photo-picker">{form.media.map(id=>{const file=savedMedia.get(id),video=isVideoMedia(file);return <div className={`selected-photo ${video?'selected-video':''}`} key={id}>{video?<><PrivateVideo src={mediaUrl(id,'stream')} originalSrc={mediaUrl(id)} label={mediaName(file)}/><span className="selected-video-name">{mediaName(file)}</span></>:<img src={mediaUrl(id,'thumb')} alt="已上传照片" loading="lazy" decoding="async"/>}<IconButton icon={X} label={video?'移除视频':'移除照片'} onClick={()=>set('media',form.media.filter(m=>m!==id))}/></div>;})}{files.map((f,i)=>{const video=isVideoMedia(f.file);return <div className={`selected-photo ${video?'selected-video':''}`} key={f.url}>{video?<><PrivateVideo src={f.url} label={f.file.name}/><span className="selected-video-name">{f.file.name}</span></>:<img src={f.url} alt="待上传照片" loading="lazy"/>}<IconButton icon={X} label={video?'移除待上传视频':'移除待上传照片'} onClick={()=>{setFiles(files.filter((_,j)=>j!==i));uploaded.current.delete(f.url);URL.revokeObjectURL(f.url);}}/></div>;})}<button className="add-photo" disabled={selectedCount>=mediaLimit} onClick={()=>fileInput.current.click()}><Upload size={22}/><span>{selectedCount>=mediaLimit?'已选满':kind==='memory'?'选择多张照片':'照片或视频'}</span></button><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,.mp4" multiple hidden onChange={selectFiles}/></div>
      {removedSavedMedia>0&&<p className="inline-note photo-removal-note">保存后，移除的 {removedSavedMedia} 个附件会放入「最近删除」，可以再恢复。</p>}
      {sending&&files.length>0&&<div className="upload-progress" role="status"><progress max="100" value={progress} aria-label="附件上传进度"/><span>{progress===100?'附件已上传，正在保存记录':`正在上传 ${uploadIndex} / ${files.length} · ${progress}%`}</span></div>}
      {error&&<p className="form-error" role="alert">{error}{canRetry&&<> <button onClick={()=>submit(retryStatus.current)}>重试上传</button></>}</p>}
      <div className="draft-caption" role="status"><Check size={14}/>{preparing?`正在处理附件 ${preparingProgress.ready} / ${preparingProgress.total}`:'编辑中的文字已暂存'}{files.length>0?' · 待保存的附件请在关闭前保存':''}</div>
      <div className="form-actions">{data.status==='draft'&&<IconButton icon={Trash2} label="删除这封草稿" onClick={()=>deleteAction('删除这封草稿',async()=>{await api(`/entries/${data.id}`,'DELETE');localStorage.removeItem(draftKey);onClose();})}/>}<Button className="secondary" onClick={onClose}>留待下次</Button>{kind==='letter'&&data.status!=='published'&&<Button className="secondary" icon={BookOpen} onClick={()=>submit('draft')}>保存草稿</Button>}<Button icon={kind==='letter'?Send:Check} onClick={()=>submit('published')}>{sending||busy?'正在保存':kind==='letter'?'发送给你':'保存到小屋'}</Button></div>
    </fieldset>
  </Modal>;
}

function DetailPhoto({file,alt,holo}) {
  const original=<img src={mediaUrl(file.id)} alt={alt} decoding="async"/>;
  if(!holo)return original;
  const preview=<img src={mediaUrl(file.id,'display')} alt={alt} decoding="async" fetchPriority="high"/>;
  return <PhotoEffectBoundary key={file.id} fallback={preview}><Suspense fallback={preview}><AlbumPhoto image={mediaUrl(file.id,'display')} originalImage={mediaUrl(file.id)} alt={alt}/></Suspense></PhotoEffectBoundary>;
}

class PhotoEffectBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}

function EntryDetail({entry,people,session,act,busy,deleteAction,setComposer,onClose,initialPhoto=0,holoPhotos=false,albumNavigation}) {
  const [reply,setReply]=useState(''),[photo,setPhoto]=useState(()=>Math.max(0,Math.min(initialPhoto,entry.media.length-1))),[editReply,setEditReply]=useState(null),[editText,setEditText]=useState('');
  useEffect(()=>{setPhoto(current=>Math.max(0,Math.min(current,entry.media.length-1)));},[entry.media.length]);
  useEffect(()=>{setReply('');setEditReply(null);setEditText('');},[entry.id]);
  const safePhoto=Math.max(0,Math.min(photo,entry.media.length-1)),selectedMedia=albumNavigation?.file||entry.media[safePhoto],hasVideos=!albumNavigation&&entry.media.some(isVideoMedia),mediaCount=albumNavigation?.total||entry.media.length,mediaIndex=albumNavigation?.index??safePhoto;
  const navigatePhoto=delta=>{if(busy)return;if(albumNavigation){if(delta<0)albumNavigation.onPrevious();else albumNavigation.onNext();}else setPhoto((safePhoto+delta+entry.media.length)%entry.media.length);};
  const own=entry.author===session.slot;
  const sendReply=async e=>{e.preventDefault();if(await act(()=>api(`/entries/${entry.id}/comments`,'POST',{text:reply}),'回复已保存'))setReply('');};
  const deleteSelectedMedia=()=>deleteAction(isVideoMedia(selectedMedia)?'删除这个视频？':'删除这张照片？',()=>api(`/media/${selectedMedia.id}`,'DELETE'),{description:'这个附件会移入「最近删除」，可以恢复到原来的相册与位置。其他照片、文字和留言会保留。',confirmLabel:'移入最近删除',success:'已移入最近删除，可以恢复',closeDetail:false,onSuccess:()=>{if(mediaCount===1)onClose();}});
  const deleteEntry=()=>deleteAction(entry.kind==='memory'?'删除整条回忆？':'删除这条记录',()=>api(`/entries/${entry.id}`,'DELETE'),entry.kind==='memory'?{description:'这条回忆里的照片和视频会全部移入「最近删除」。恢复任意附件后，原来的文字与留言也会一起回来。',confirmLabel:'移入最近删除',success:'回忆附件已移入最近删除'}:{});
  return <Modal open onClose={onClose} title={entry.kind==='letter'?'一封写给你的信':entry.kind==='memory'?'一起走过的瞬间':'今天的小事'} subtitle={`${people[entry.author].name} · ${dateLabel(entry.date)}${entry.mood?' · '+entry.mood:''}`} wide>
    <div className="detail-body">
      {selectedMedia&&<div className="photo-viewer" data-media-id={selectedMedia.id} data-entry-id={entry.id} onKeyDownCapture={event=>{if(mediaCount>1&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();navigatePhoto(event.key==='ArrowLeft'?-1:1);}}}>
        {isVideoMedia(selectedMedia)?<><PrivateVideo key={selectedMedia.id} src={mediaUrl(selectedMedia.id,'stream')} originalSrc={mediaUrl(selectedMedia.id)} label={mediaName(selectedMedia)}/><p className="detail-video-name"><Video size={15}/>{mediaName(selectedMedia)}</p></>:<DetailPhoto file={selectedMedia} alt={entry.text||'我们的照片'} holo={holoPhotos}/>}
        {mediaCount>1&&<div className="photo-controls"><IconButton icon={ChevronLeft} label={hasVideos?'上一个附件':'上一张'} disabled={busy} onClick={()=>navigatePhoto(-1)}/><span className="photo-counter" aria-live="polite">{mediaIndex+1} / {mediaCount}</span><IconButton icon={ChevronRight} label={hasVideos?'下一个附件':'下一张'} disabled={busy} onClick={()=>navigatePhoto(1)}/></div>}
        {own&&entry.kind==='memory'&&<div className="photo-delete-actions"><Button className="secondary delete-current-media" icon={Trash2} disabled={busy} onClick={deleteSelectedMedia}>{isVideoMedia(selectedMedia)?'删除这个视频':'删除这张照片'}</Button></div>}
      </div>}
      <p className={entry.kind==='letter'?'letter-paper':'detail-text'}>{entry.text}</p>
      {entry.kind==='letter'&&<p className="inline-note">{entry.read_at?`对方已于 ${timeLabel(entry.read_at)} 读过这封信`:'还在信箱里，等对方打开'}</p>}
      <div className="detail-actions"><Button className={`secondary ${entry.hearts.some(h=>h.author===session.slot)?'hearted':''}`} icon={Heart} disabled={busy} onClick={()=>act(()=>api(`/entries/${entry.id}/heart`,'POST',{}))}>{entry.hearts.length||''} 爱心</Button>{own&&<div className="entry-actions"><IconButton icon={Pencil} label="编辑我的记录" disabled={busy} onClick={()=>{setComposer(entry);onClose();}}/><IconButton icon={Trash2} label={entry.kind==='memory'?'删除整条回忆':'删除我的记录'} disabled={busy} onClick={deleteEntry}/></div>}</div>
      <div className="comments"><h3>留给彼此的话 <span>{entry.comments.length}</span></h3>{entry.comments.map(c=><div className="comment" key={c.id}><Avatar person={people[c.author]} slot={c.author}/><div className="comment-body"><span>{people[c.author].name}<small>{timeLabel(c.created)}</small></span>{editReply===c.id?<form onSubmit={async e=>{e.preventDefault();if(await act(()=>api(`/comments/${c.id}`,'PUT',{text:editText}),'回复已修改'))setEditReply(null);}}><input value={editText} onChange={e=>setEditText(e.target.value)} required maxLength={2000}/><Button icon={Check} disabled={busy}>保存</Button></form>:<p>{c.text}</p>}</div>{c.author===session.slot&&<div className="comment-controls"><IconButton icon={Pencil} label="编辑回复" onClick={()=>{setEditReply(c.id);setEditText(c.text);}}/><IconButton icon={Trash2} label="删除回复" onClick={()=>deleteAction('删除这条回复',()=>api(`/comments/${c.id}`,'DELETE'),{closeDetail:false})}/></div>}</div>)}<form className="reply-form" onSubmit={sendReply}><input value={reply} onChange={e=>setReply(e.target.value)} placeholder="留一句话给你……" aria-label="回复内容" required maxLength={2000}/><IconButton icon={Send} label="发送回复" type="submit" disabled={busy}/></form></div>
    </div>
  </Modal>;
}

function Distance({house,people,today,onSettings,act,busy}) {
  const [date,setDate]=useState(house.settings.nextMeeting);
  const c=countdown(house.settings.nextMeeting,today);
  return <div className="distance-view"><div className="city-pair">{['yiting','haomiao'].map((slot,i)=><React.Fragment key={slot}>{i===1&&<div className="city-connection"><span/><Heart size={20}/><span/></div>}<div className={`city-card ${slot}`}><MapPin size={28} strokeWidth={1.2}/><span>{people[slot].name}</span><h3>{people[slot].city||'城市待填写'}</h3><p>{people[slot].context||'生活地点待填写'}</p><small>{people[slot].home?`家在 ${people[slot].home}`:people[slot].previous?`之前生活在 ${people[slot].previous}`:''}</small></div></React.Fragment>)}</div><p className="inline-note centered">城市连线是示意，不表示实际距离。</p><Button className="secondary" icon={Pencil} onClick={onSettings}>修改我们的城市</Button><div className="next-date-form"><span className="eyebrow">OUR NEXT RENDEZVOUS</span><h3>{c.text}</h3>{house.settings.nextMeeting&&<p>{dateLabel(house.settings.nextMeeting)}</p>}<Field label="下一次见面的日期"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Button icon={Check} disabled={busy} onClick={()=>act(()=>api('/settings','PUT',{...house.settings,nextMeeting:date}),date?'约定的日子已保存':'已清空下一次见面日期')}>保存我们的约定</Button></div></div>;
}
function Activity({house,people}) {
  const events=[...house.misses.map(m=>({...m,kind:'miss'})),...house.entries.filter(e=>e.status!=='draft').map(e=>({...e,kind:e.kind}))].sort((a,b)=>b.created.localeCompare(a.created));
  return events.length?<div className="activity-list">{events.map(e=><div className="activity-row" key={e.id}><span className="activity-icon">{e.kind==='miss'?<Heart size={19}/>:e.kind==='letter'?<Mail size={19}/>:e.kind==='memory'?<Images size={19}/>:<BookOpen size={19}/>}</span><div><p>{people[e.author].name}{e.kind==='miss'?'想你了':e.kind==='letter'?'送来一封小信':e.kind==='memory'?'留下一张回忆':'记下一件小事'}</p><small>{timeLabel(e.created)}</small></div></div>)}</div>:<Empty icon={Heart} title="第一份想念，等你送来">暖灯旁的爱心，会把想念留在这里。</Empty>;
}
function HouseSettings({house,session,people,act,busy,notify,logout}) {
  const [form,setForm]=useState(()=>structuredClone(house.settings)),[uploading,setUploading]=useState(false);
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const personSet=(slot,key,value)=>setForm(f=>({...f,people:{...f.people,[slot]:{...f.people[slot],[key]:value}}}));
  const avatar=async(slot,file)=>{if(!file)return;setUploading(true);try{const result=await upload(await optimizePhoto(file),()=>{});personSet(slot,'avatar',result.id);notify('头像已上传，记得保存设置');}catch(e){notify(e.message);}finally{setUploading(false);}};
  const save=async e=>{e.preventDefault();await act(()=>api('/settings','PUT',form),'小屋设置已保存');};
  return <form className="settings-form" onSubmit={save}>{session.localPreview&&<div className="preview-notice"><LockKeyhole size={17}/><div>本机体验环境<small>保存到这台电脑的数据库和私有文件存储；线上两人共享需绑定正式账号。</small></div></div>}<Field label="小屋的名字"><input value={form.name} onChange={e=>set('name',e.target.value)} required maxLength={40}/></Field><div className="settings-section"><h3>住在这里的两个人</h3>{['yiting','haomiao'].map(slot=><div className="person-settings" key={slot}><div className="person-settings-top"><Avatar person={form.people[slot]} slot={slot} size="large"/><label className="avatar-upload"><Upload size={15}/>{uploading?'正在上传':'换一个头像'}<input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>avatar(slot,e.target.files?.[0])} disabled={uploading}/></label></div><div className="form-grid"><Field label="显示名"><input value={form.people[slot].name} onChange={e=>personSet(slot,'name',e.target.value)} required maxLength={30}/></Field><Field label="当前城市"><input value={form.people[slot].city} onChange={e=>personSet(slot,'city',e.target.value)} maxLength={40}/></Field><Field label="城市旁的状态"><input value={form.people[slot].context} onChange={e=>personSet(slot,'context',e.target.value)} placeholder="上学 / 实习 / 在家" maxLength={20}/></Field><Field label="家的位置"><input value={form.people[slot].home} onChange={e=>personSet(slot,'home',e.target.value)} placeholder="还没有填写" maxLength={80}/></Field></div><Field label="之前的生活地点"><input value={form.people[slot].previous} onChange={e=>personSet(slot,'previous',e.target.value)} placeholder="没有记录，不推测搬迁日期" maxLength={80}/></Field>{slot==='yiting'&&<div className="city-presets"><button type="button" onClick={()=>{personSet(slot,'city','陵水');personSet(slot,'context','上学');}}>陵水 · 上学</button><button type="button" onClick={()=>{personSet(slot,'city','砀山');personSet(slot,'context','在家');}}>砀山 · 在家</button></div>}</div>)}</div><div className="settings-section"><h3>我们的日期</h3><Field label="相识日期" hint="相识当天是第 1 天，按上海时区的日历日期计算。"><input type="date" value={form.acquainted} onChange={e=>set('acquainted',e.target.value)}/></Field><Field label="恋爱开始日期" hint={form.relationship?'与相识日期分别记录。':'这一天，还等我们一起填上。'}><input type="date" value={form.relationship} onChange={e=>set('relationship',e.target.value)}/></Field><Field label="下一次见面日期"><input type="date" value={form.nextMeeting} onChange={e=>set('nextMeeting',e.target.value)}/></Field></div><div className="form-actions"><Button type="submit" icon={Check} disabled={busy||uploading}>{busy?'正在保存':'保存小屋设置'}</Button></div><button className="logout-button" type="button" onClick={logout}><LogOut size={16}/>{session.localPreview?'退出本机体验，切换账号':'退出登录'}</button></form>;
}

createRoot(document.getElementById('root')).render(<App/>);

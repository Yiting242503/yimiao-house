import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, GripVertical, LoaderCircle, MessageCircle, Video, X } from 'lucide-react';
import { dateLabel } from '../../../shared/dates';
import PrivateVideo from '../PrivateVideo.jsx';
import { videoPlayback } from '../video-playback.js';
import './AlbumVideos.css';

export function orderedVideoIds(videos, savedOrder = []) {
  const available = videos.map(({ file }) => file.id), allowed = new Set(available), seen = new Set();
  return [...savedOrder, ...available].filter(id => {
    if (!allowed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function moveVideo(ids, sourceId, targetIndex) {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) return ids;
  const destination = Math.max(0, Math.min(targetIndex, ids.length - 1));
  if (sourceIndex === destination) return ids;
  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(destination, 0, sourceId);
  return next;
}

export default function AlbumVideos({ videos = [], savedOrder = [], people, busy = false, onOpen, onSave, refreshKey, sortable = true }) {
  const [draft, setDraft] = useState(null), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState(null), [dropId, setDropId] = useState(null), [announcement, setAnnouncement] = useState('');
  const players = useRef(new Map()), scopeAtStart = useRef(''), versionAtStart = useRef(refreshKey), dragging = useRef(null), touchDragging = useRef(null), list = useRef(null), savingRef = useRef(false);
  const editing = draft !== null, canonicalIds = orderedVideoIds(videos, savedOrder), scopeKey = videos.map(({ file }) => file.id).sort().join(',');
  const byId = new Map(videos.map(item => [item.file.id, item]));
  const displayedIds = editing ? orderedVideoIds(videos, draft) : canonicalIds;
  const stale = editing && (scopeAtStart.current !== scopeKey || versionAtStart.current !== refreshKey);
  const locked = busy || saving;

  useEffect(() => {
    if (editing && stale && !savingRef.current) setError('相册已更新，请取消后重新调整顺序。');
  }, [editing, stale, saving]);
  useEffect(() => {
    if (!editing || sortable || savingRef.current) return;
    setDraft(null); setError('请打开完整相册后，再调整视频顺序。');
    dragging.current = null; touchDragging.current = null; setDraggingId(null); setDropId(null);
  }, [editing, sortable]);
  useEffect(() => () => players.current.forEach(player => player.pause()), []);

  const enterSort = event => {
    if (!sortable || locked || editing || videos.length < 2) return;
    event?.preventDefault(); event?.stopPropagation();
    players.current.forEach(player => videoPlayback.suspend(player));
    scopeAtStart.current = scopeKey; versionAtStart.current = refreshKey;
    setDraft([...canonicalIds]); setError(''); setAnnouncement('已进入排序模式，可以拖动视频或使用上移、下移按钮。');
  };
  const clearDrag = () => {
    dragging.current = null; touchDragging.current = null; setDraggingId(null); setDropId(null);
  };
  const cancel = () => {
    if (locked) return;
    setDraft(null); setError(''); clearDrag(); setAnnouncement('已取消调整，保留原来的顺序。');
  };
  const move = (id, index) => {
    if (!editing || locked || stale) return;
    setDraft(current => moveVideo(current, id, index));
    const name = byId.get(id)?.file.name || '视频';
    setAnnouncement(`${name}，第 ${Math.max(0, Math.min(index, displayedIds.length - 1)) + 1} 个视频。`);
  };
  const save = async () => {
    if (!editing || locked || stale || !onSave) return;
    setSaving(true); savingRef.current = true; setError(''); clearDrag();
    try {
      if (await onSave([...displayedIds])) {
        setDraft(null); setAnnouncement('视频顺序已保存。');
      } else setError('顺序还没有保存，调整已保留，可以重试。');
    } catch (failure) {
      setError(failure.message || '顺序还没有保存，请重试。');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };
  const targetAt = (x, y) => {
    const target = document.elementFromPoint(x, y)?.closest('[data-video-id]');
    return target && list.current?.contains(target) ? target.dataset.videoId : null;
  };
  const touchStart = (event, id) => {
    if (event.pointerType !== 'touch' || locked || stale) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    touchDragging.current = id; setDraggingId(id);
  };
  const touchMove = event => {
    if (!touchDragging.current) return;
    event.preventDefault(); event.stopPropagation(); setDropId(targetAt(event.clientX, event.clientY));
  };
  const touchEnd = event => {
    if (!touchDragging.current) return;
    event.preventDefault(); event.stopPropagation();
    const targetId = targetAt(event.clientX, event.clientY);
    if (targetId) move(touchDragging.current, displayedIds.indexOf(targetId));
    clearDrag();
  };

  if (!videos.length) return null;
  return <section className={`album-videos meeting-videos${editing ? ' sorting' : ''}`} aria-label="相册视频">
    <div className="meeting-videos-heading album-videos-heading"><h3><Video size={18}/>那天的片段</h3><span>{videos.length} 段视频</span></div>
    {videos.length > 1 && <div className="album-video-sort-toolbar">
      <p>{editing ? '拖动手柄调整顺序，也可以使用上移、下移按钮。' : sortable ? '双击视频，调整播放顺序。' : '打开完整相册后，可以调整视频顺序。'}</p>
      {!editing && <button type="button" className="button secondary" onClick={enterSort} disabled={locked || !sortable || !onSave}><ArrowUpDown size={16}/>调整视频顺序</button>}
    </div>}
    <div ref={list} className="album-video-list meeting-video-list">
      {displayedIds.map((id, index) => {
        const { file, entry, photoIndex } = byId.get(id), name = file.name || '一段回忆视频';
        return <article key={id} className={`album-video-item meeting-video${draggingId === id ? ' is-dragging' : ''}${dropId === id ? ' is-drop-target' : ''}`} data-video-id={id}
          onDoubleClickCapture={enterSort}
          onDragOverCapture={event => { if (!editing || locked || stale || !dragging.current) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropId(id); }}
          onDropCapture={event => { if (!editing || locked || stale) return; event.preventDefault(); event.stopPropagation(); const sourceId = dragging.current; if (sourceId) move(sourceId, displayedIds.indexOf(id)); clearDrag(); }}>
          <div className="album-video-stage"><PrivateVideo ref={player => { if (player) players.current.set(id, player); else players.current.delete(id); }} className="album-video-player" src={`/api/media/${id}?variant=stream`} originalSrc={`/api/media/${id}`} controls={!editing} label={name} tabIndex={editing ? -1 : undefined}/>
            {editing && <div className="album-video-sort-overlay"><span className="album-video-position">{index + 1}</span><button type="button" className="album-video-drag-handle" aria-label={`拖动${name}调整顺序`} draggable={!locked && !stale} disabled={locked || stale}
              onDragStart={event => { if (locked || stale) { event.preventDefault(); return; } event.stopPropagation(); dragging.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-album-video-id', id); setDraggingId(id); }}
              onDragEnd={clearDrag} onPointerDown={event => touchStart(event, id)} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={() => { if (touchDragging.current) clearDrag(); }}
              onKeyDown={event => { const positions = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: displayedIds.length - 1 }; if (positions[event.key] === undefined) return; event.preventDefault(); event.stopPropagation(); move(id, positions[event.key]); }}><GripVertical size={23}/><span>拖动排序</span></button></div>}
          </div>
          <div className="meeting-video-caption"><div><p>{name}</p><span>{dateLabel(entry.date)} · {people?.[entry.author]?.name || ''}</span></div>{!editing && onOpen && <button type="button" className="icon-button" aria-label="打开视频与留言" disabled={locked} onClick={() => { videoPlayback.suspendAll(); onOpen(entry, photoIndex); }}><MessageCircle size={18}/></button>}</div>
          {editing && <div className="album-video-move-controls"><button type="button" className="button secondary" aria-label={`上移${name}`} disabled={locked || stale || index === 0} onClick={() => move(id, index - 1)}><ArrowUp size={16}/>上移</button><button type="button" className="button secondary" aria-label={`下移${name}`} disabled={locked || stale || index === displayedIds.length - 1} onClick={() => move(id, index + 1)}><ArrowDown size={16}/>下移</button></div>}
        </article>;
      })}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {editing && <div className="album-video-sort-actions"><button type="button" className="button secondary" onClick={cancel} disabled={locked}><X size={16}/>取消</button><button type="button" className="button" onClick={save} disabled={locked || stale || !onSave}>{saving ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}<span>{saving ? '正在保存' : '保存顺序'}</span></button></div>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </section>;
}

'use client'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'

import { createClient } from '@supabase/supabase-js'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Types ────────────────────────────────────────────────────────────────────
type StemType = 'vocal' | 'drums' | 'bass' | 'piano' | 'guitar' | 'other'
type ToastType = 'success' | 'error' | 'warn' | 'info'
interface Toast { id: number; msg: string; type: ToastType }

interface StemTrack {
  id:      string
  file:    File
  name:    string
  type:    StemType
  volume:  number   // dB -60..0
  pan:     number   // -100..100
  muted:   boolean
  solo:    boolean
  rmsDb:   number
  loading: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FREE = 5
const STEM_COLORS: Record<StemType, string> = {
  vocal: '#4ade80', drums: '#f87171', bass: '#fbbf24',
  piano: '#a78bfa', guitar: '#34d399', other: '#9ca3af',
}
const STEM_LABELS: Record<StemType, string> = {
  vocal: 'VOCAL', drums: 'DRUMS', bass: 'BASS',
  piano: 'PIANO', guitar: 'GUITAR', other: 'OTHER',
}
const DB_TICKS = [0, -6, -12, -20, -40, -60]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2)
const dbl   = (db: number) => db <= -60 ? 0 : Math.pow(10, db / 20)
const dbH   = (db: number) => Math.max(0, ((Math.max(-60, db) + 60) / 60) * 100)
const dbCol = (db: number) => db > -6 ? '#f87171' : db > -20 ? '#fbbf24' : '#4ade80'

function guessType(name: string): StemType {
  const l = name.toLowerCase()
  if (/vocal|vox|voice|lead|sing/.test(l)) return 'vocal'
  if (/drum|kick|snare|hat|perc|beat/.test(l)) return 'drums'
  if (/bass/.test(l)) return 'bass'
  if (/piano|keys?|key\b|ivories/.test(l)) return 'piano'
  if (/guitar|gtr/.test(l)) return 'guitar'
  return 'other'
}

async function analyzeRMS(file: File): Promise<number> {
  try {
    const ab  = await file.arrayBuffer()
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(ab)
    await ctx.close()
    const d    = buf.getChannelData(0)
    const step = Math.max(1, Math.floor(d.length / 88200))
    let sum = 0, n = 0
    for (let i = 0; i < d.length; i += step) { sum += d[i] * d[i]; n++ }
    return Math.max(-60, 20 * Math.log10(Math.max(Math.sqrt(sum / n), 1e-6)))
  } catch { return -30 }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MixingPage() {
  const router = useRouter()

  const [user,    setUser]    = useState<any>(null)
  const [tier,    setTier]    = useState('FREE')
  const [isDark,  setIsDark]  = useState(true)
  const [tracks,  setTracks]  = useState<StemTrack[]>([])
  const [isPro,   setIsPro]   = useState(false)
  const [dragging,setDrag]    = useState(false)
  const [editId,  setEditId]  = useState<string | null>(null)
  const [editName,setEditNm]  = useState('')
  const [playing, setPlaying] = useState(false)
  const [toasts,  setToasts]  = useState<Toast[]>([])

  const toastId = useRef(0)
  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500)
  }, [])

  // ── Auth ──
  useEffect(() => {
    document.title = 'THISISMIDI — AI Mixing'
    supabase.auth.getSession().then(({ data: { session } }) => handleUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => handleUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const handleUser = (u: any) => {
    setUser(u)
    const pro = u?.app_metadata?.is_pro
    setTier(pro ? 'PRO' : u ? 'FREE' : 'FREE')
    setIsPro(!!pro)
  }

  // ── Web Audio ──
  const ctxRef     = useRef<AudioContext | null>(null)
  const buffers    = useRef<Map<string, AudioBuffer>>(new Map())
  const srcNodes   = useRef<Map<string, AudioBufferSourceNode>>(new Map())
  const gainNodes  = useRef<Map<string, GainNode>>(new Map())
  const panNodes   = useRef<Map<string, StereoPannerNode>>(new Map())
  const masterGain = useRef<GainNode | null>(null)
  const playRef    = useRef(false)

  const vuContainers = useRef<Map<string, HTMLDivElement>>(new Map())
  const masterVuRef  = useRef<HTMLDivElement | null>(null)
  const fileRef      = useRef<HTMLInputElement>(null)

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext()
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  const loadBuf = useCallback(async (track: StemTrack) => {
    try {
      const ctx = getCtx()
      const ab  = await track.file.arrayBuffer()
      buffers.current.set(track.id, await ctx.decodeAudioData(ab))
    } catch {}
  }, [getCtx])

  const addFiles = useCallback(async (files: File[]) => {
    const isWav  = (f: File) => /\.(wav|flac|aiff?)$/i.test(f.name)
    const isAudio = (f: File) => /\.(wav|mp3|flac|aiff?|ogg)$/i.test(f.name)

    const valid = files.filter(f => {
      if (!isAudio(f))            { toast(`${f.name}: 지원하지 않는 형식`, 'error'); return false }
      if (isWav(f) && !isPro)     { toast('WAV / FLAC은 PRO 전용입니다 🔒', 'warn');  return false }
      return true
    })
    if (!valid.length) return

    setTracks(prev => {
      if (!isPro && prev.length >= MAX_FREE) { toast('무료 플랜: 최대 5트랙 (PRO 업그레이드 필요)', 'warn'); return prev }
      const slots = isPro ? valid.length : MAX_FREE - prev.length
      const toAdd = valid.slice(0, slots)
      if (valid.length > slots) toast(`${valid.length - slots}개 추가는 PRO 필요 🔒`, 'warn')

      const nw: StemTrack[] = toAdd.map(file => ({
        id: uid(), file,
        name: file.name.replace(/\.[^.]+$/, ''),
        type: guessType(file.name),
        volume: -12, pan: 0,
        muted: false, solo: false, rmsDb: -30, loading: true,
      }))
      nw.forEach(async t => {
        const rmsDb = await analyzeRMS(t.file)
        setTracks(ts => ts.map(x => x.id === t.id ? { ...x, rmsDb, loading: false } : x))
        await loadBuf(t)
      })
      return [...prev, ...nw]
    })
  }, [isPro, toast, loadBuf])

  const setVol = useCallback((id: string, db: number) => {
    setTracks(ts => ts.map(t => t.id === id ? { ...t, volume: db } : t))
    const g = gainNodes.current.get(id)
    if (g && ctxRef.current) g.gain.setTargetAtTime(dbl(db), ctxRef.current.currentTime, 0.01)
  }, [])

  const setPan = useCallback((id: string, pan: number) => {
    setTracks(ts => ts.map(t => t.id === id ? { ...t, pan } : t))
    const p = panNodes.current.get(id)
    if (p && ctxRef.current) p.pan.setTargetAtTime(pan / 100, ctxRef.current.currentTime, 0.01)
  }, [])

  const applyGains = (ts: StemTrack[]) => {
    if (!playRef.current || !ctxRef.current) return
    const hasSolo = ts.some(t => t.solo)
    ts.forEach(t => {
      const g = gainNodes.current.get(t.id); if (!g) return
      const active = !t.muted && (!hasSolo || t.solo)
      g.gain.setTargetAtTime(active ? dbl(t.volume) : 0, ctxRef.current!.currentTime, 0.01)
    })
  }

  const toggleMute = useCallback((id: string) => {
    setTracks(ts => { const u = ts.map(t => t.id === id ? { ...t, muted: !t.muted } : t); applyGains(u); return u })
  }, []) // eslint-disable-line

  const toggleSolo = useCallback((id: string) => {
    setTracks(ts => { const u = ts.map(t => t.id === id ? { ...t, solo: !t.solo } : t); applyGains(u); return u })
  }, []) // eslint-disable-line

  const removeTrack = useCallback((id: string) => {
    try { srcNodes.current.get(id)?.stop() } catch {}
    ;[srcNodes, gainNodes, panNodes, buffers, vuContainers].forEach(r => r.current.delete(id))
    setTracks(ts => ts.filter(t => t.id !== id))
    toast('트랙 삭제됨', 'info')
  }, [toast])

  const handlePlay = useCallback(async () => {
    const ctx = getCtx()
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear(); gainNodes.current.clear(); panNodes.current.clear()

    const mg = ctx.createGain(); mg.gain.value = 1; mg.connect(ctx.destination)
    masterGain.current = mg

    const hasSolo = tracks.some(t => t.solo)
    tracks.forEach(track => {
      const buf = buffers.current.get(track.id); if (!buf) return
      const src  = ctx.createBufferSource(); src.buffer = buf; src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = !track.muted && (!hasSolo || track.solo) ? dbl(track.volume) : 0
      const pan  = ctx.createStereoPanner(); pan.pan.value = track.pan / 100
      src.connect(gain); gain.connect(pan); pan.connect(mg); src.start(0)
      srcNodes.current.set(track.id, src)
      gainNodes.current.set(track.id, gain)
      panNodes.current.set(track.id, pan)
    })

    if (srcNodes.current.size === 0) { toast('로드된 트랙이 없습니다. 잠시 후 다시 시도하세요.', 'error'); return }
    playRef.current = true; setPlaying(true)

    try {
      const wap  = await import('web-audio-peak-meter')
      const opts = {
        vertical: true, borderSize: 2, fontSize: 9,
        backgroundColor: isDark ? '#171717' : '#f7f7f8',
        tickColor:        isDark ? '#2a2a2a' : '#d0d0d0',
        labelColor:       isDark ? '#555555' : '#999999',
        peakHoldDuration: 2000,
        meterColor: [
          { db: -60, color: '#4ade80' },
          { db: -20, color: '#4ade80' },
          { db: -12, color: '#a3e635' },
          { db: -6,  color: '#fbbf24' },
          { db: -3,  color: '#fb923c' },
          { db:  0,  color: '#f87171' },
        ],
      }
      tracks.forEach(track => {
        const el  = vuContainers.current.get(track.id)
        const pan = panNodes.current.get(track.id)
        if (!el || !pan) return
        el.innerHTML = ''
        new wap.WebAudioPeakMeter(pan, el, opts)
      })
      if (masterVuRef.current && mg) {
        masterVuRef.current.innerHTML = ''
        new wap.WebAudioPeakMeter(mg, masterVuRef.current, opts)
      }
    } catch { toast('VU 미터 초기화 실패', 'error') }
  }, [tracks, getCtx, toast, isDark])

  const handleStop = useCallback(() => {
    playRef.current = false; setPlaying(false)
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear()
    vuContainers.current.forEach(el => { el.innerHTML = '' })
    if (masterVuRef.current) masterVuRef.current.innerHTML = ''
  }, [])

  useEffect(() => () => {
    playRef.current = false
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    ctxRef.current?.close()
  }, [])

  const hasSolo = tracks.some(t => t.solo)

  return (
    <main className={isDark ? 'dark' : 'light'}>

      {/* ── Toasts ── */}
      <div className="toast-wrap">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}
      </div>

      <div className="ws">

        {/* ── Header ── */}
        <header className="hd">
          <div className="brand">THISISMIDI <span className="acc">.</span></div>
          <div className="hd-right">
            {user && <span className="tier-chip">{tier}</span>}
            <button className="btn-sm" onClick={() => setIsDark(d => !d)}>{isDark ? '☀ LIGHT' : '☾ DARK'}</button>
            {user
              ? <button className="btn-sm" onClick={() => supabase.auth.signOut()}>LOGOUT</button>
              : <button className="btn-sm" onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>LOGIN</button>}
          </div>
        </header>

        {/* ── 로그인 전 히어로 ── */}
        {!user ? (
          <div className="hero">
            <p className="hero-eyebrow">Professional AI Music Tools</p>
            <h1 className="hero-title">Sound Better,<br />Instantly.</h1>
            <button className="btn-prime" onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>
              Start with Google →
            </button>
          </div>

        ) : (
          <>
            {/* ── 탭 네비게이션 ── */}
            <nav className="tab-nav">
              <button className="tab-btn" onClick={() => router.push('/')}>
                <span className="tab-icon">🎛</span> AI Mastering
              </button>
              <button className="tab-btn active">
                <span className="tab-icon">🎚</span> AI Mixing
              </button>
            </nav>

            {/* ── 타이틀 ── */}
            <div className="mix-title-row">
              <div>
                <h2 className="mix-h2">AI Mixing</h2>
                <p className="mix-sub">
                  멀티트랙 업로드 → 볼륨 · 패닝 조정 → AI 믹스다운
                  {!isPro && <span className="lock" style={{ marginLeft: 10 }}>무료: MP3 · 최대 5트랙</span>}
                </p>
              </div>
            </div>

            <input ref={fileRef} type="file" multiple id="mix-file"
              accept={isPro ? '.wav,.mp3,.flac,.aiff,.aif,.ogg' : '.mp3,.ogg'}
              style={{ display: 'none' }}
              onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }} />

            {/* ── 드롭존 (트랙 없을 때) ── */}
            {tracks.length === 0 && (
              <label htmlFor="mix-file"
                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}
                className={`drop-zone${dragging ? ' drag-over' : ''}`}
                style={{ cursor: 'pointer' }}>
                <span className="drop-icon">{dragging ? '📂' : '🎚'}</span>
                <span className="drop-main">{dragging ? '여기에 놓으세요!' : '스템 파일을 드래그하거나 클릭하세요'}</span>
                <span className="drop-sub">Vocal · Drums · Bass · Piano · Guitar</span>
                <span className="drop-sub">{isPro ? 'WAV · MP3 · FLAC · AIFF 지원' : 'MP3 지원 (무료) · WAV/FLAC은 PRO 전용'}</span>
              </label>
            )}

            {/* ── 믹서 레이아웃 ── */}
            {tracks.length > 0 && (
              <>
                {/* 트랙 추가 버튼 행 */}
                <div className="action-row" style={{ marginBottom: 16 }}>
                  <label htmlFor="mix-file" className="btn-sec" style={{ cursor: 'pointer' }}>
                    + 트랙 추가
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={playing ? handleStop : handlePlay} className="btn-prime" style={{ minWidth: 160 }}>
                      {playing ? '■ STOP' : '▶ PLAY ALL'}
                    </button>
                    <button className="btn-prime" style={{ background: 'var(--acc2)', minWidth: 80 }}>
                      🎚 MIX
                    </button>
                    <span style={{ fontSize: '.72rem', color: 'var(--txt2)' }}>
                      {tracks.filter(t => !t.muted).length}개 활성
                      {playing && <span style={{ color: 'var(--acc)', marginLeft: 8 }}>● LIVE</span>}
                    </span>
                  </div>
                </div>

                <div className="mix-layout">

                  {/* ── 채널 스트립 ── */}
                  <div className="mix-strips-wrap">
                    <div className="mix-strips">

                      {tracks.map(track => {
                        const col    = STEM_COLORS[track.type]
                        const dimmed = hasSolo && !track.solo

                        return (
                          <div key={track.id} className="strip-card" style={{ opacity: dimmed ? 0.28 : 1 }}>
                            {/* 컬러 탑바 */}
                            <div style={{ height: 3, background: col, borderRadius: '8px 8px 0 0' }} />

                            {/* 타입 배지 + 삭제 */}
                            <div className="strip-head">
                              <span className="strip-badge" style={{ color: col, borderColor: col + '44', background: col + '18' }}>
                                {STEM_LABELS[track.type]}
                              </span>
                              <button className="t-remove" style={{ opacity: 1 }} onClick={() => removeTrack(track.id)}>✕</button>
                            </div>

                            {/* 파일명 (편집 가능) */}
                            <div className="strip-name-row">
                              {editId === track.id ? (
                                <input
                                  value={editName}
                                  onChange={e => setEditNm(e.target.value)}
                                  onBlur={() => { if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t)); setEditId(null) }}
                                  onKeyDown={e => { if (e.key === 'Enter') { if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t)); setEditId(null) } if (e.key === 'Escape') setEditId(null) }}
                                  autoFocus
                                  className="strip-name-input"
                                />
                              ) : (
                                <div className="strip-name" onClick={() => { setEditId(track.id); setEditNm(track.name) }} title="클릭하여 이름 변경">
                                  {track.name}
                                </div>
                              )}
                              {track.loading && <div style={{ fontSize: '.65rem', color: 'var(--txt2)', marginTop: 2 }}>분석 중…</div>}
                            </div>

                            {/* Controls */}
                            <div className="strip-controls">

                              {/* VOLUME */}
                              <div className="ctrl-block">
                                <div className="ctrl-label-row">
                                  <span className="sld-label">VOLUME</span>
                                  <span className="sld-val" style={{ color: col }}>
                                    {track.volume <= -60 ? '-∞' : `${track.volume > 0 ? '+' : ''}${track.volume} dB`}
                                  </span>
                                </div>
                                <input type="range" min={-60} max={0} step={0.5} value={track.volume}
                                  onChange={e => setVol(track.id, +e.target.value)}
                                  style={{ accentColor: col, width: '100%' }} />
                                <div className="mini-bar-bg">
                                  <div className="mini-bar-fill" style={{ width: `${dbH(track.volume)}%`, background: dbCol(track.volume) }} />
                                </div>
                              </div>

                              {/* PAN */}
                              <div className="ctrl-block">
                                <div className="ctrl-label-row">
                                  <span className="sld-label">PAN</span>
                                  <span className="sld-val">
                                    {track.pan === 0 ? 'C' : track.pan > 0 ? `R ${track.pan}` : `L ${Math.abs(track.pan)}`}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--txt2)', width: 8 }}>L</span>
                                  <input type="range" min={-100} max={100} step={1} value={track.pan}
                                    onChange={e => setPan(track.id, +e.target.value)}
                                    style={{ flex: 1, accentColor: 'var(--txt2)' }} />
                                  <span style={{ fontSize: '.6rem', fontWeight: 800, color: 'var(--txt2)', width: 8, textAlign: 'right' }}>R</span>
                                </div>
                                <div className="mini-bar-bg" style={{ position: 'relative' }}>
                                  <div style={{
                                    position: 'absolute', height: '100%', borderRadius: 2,
                                    background: 'var(--txt2)',
                                    left:  track.pan >= 0 ? '50%' : `${50 + track.pan / 2}%`,
                                    width: track.pan === 0 ? 2 : `${Math.abs(track.pan) / 2}%`,
                                    marginLeft: track.pan === 0 ? -1 : 0,
                                  }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                                  {['LEFT', 'CENTER', 'RIGHT'].map(l => (
                                    <span key={l} style={{ fontSize: '.55rem', color: 'var(--txt2)' }}>{l}</span>
                                  ))}
                                </div>
                              </div>

                              {/* MUTE / SOLO */}
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                <button onClick={() => toggleMute(track.id)}
                                  className="ms-btn"
                                  style={{ background: track.muted ? '#f87171' : 'var(--sur2)', color: track.muted ? '#fff' : 'var(--txt2)', borderColor: track.muted ? '#f87171' : 'var(--brd)' }}>
                                  MUTE
                                </button>
                                <button onClick={() => toggleSolo(track.id)}
                                  className="ms-btn"
                                  style={{ background: track.solo ? '#fbbf24' : 'var(--sur2)', color: track.solo ? '#000' : 'var(--txt2)', borderColor: track.solo ? '#fbbf24' : 'var(--brd)' }}>
                                  SOLO
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {/* 트랙 추가 카드 */}
                      <label htmlFor="mix-file" className="strip-add"
                        onClick={() => { if (!isPro && tracks.length >= MAX_FREE) { toast('무료 플랜 최대 5트랙. PRO로 업그레이드하세요 🔒', 'warn') } }}>
                        <span style={{ fontSize: '1.4rem' }}>＋</span>
                        <span style={{ fontSize: '.72rem', fontWeight: 700 }}>트랙 추가</span>
                        {!isPro && tracks.length >= MAX_FREE && (
                          <span className="lock">PRO 필요</span>
                        )}
                        {!isPro && tracks.length < MAX_FREE && (
                          <span style={{ fontSize: '.65rem', color: 'var(--txt2)' }}>{MAX_FREE - tracks.length}개 남음</span>
                        )}
                      </label>
                    </div>
                  </div>

                  {/* ── VU METER 패널 ── */}
                  <div className="panel vu-panel">
                    <div className="panel-top">
                      <h3>VU METER</h3>
                      <span>{playing ? '● LIVE' : 'STATIC RMS'}</span>
                    </div>

                    {/* 미터 바 영역 */}
                    <div className="vu-area">

                      {/* dB 스케일 */}
                      <div className="vu-scale">
                        {DB_TICKS.map(db => (
                          <div key={db} style={{ position: 'absolute', bottom: `${dbH(db)}%`, transform: 'translateY(50%)', right: 0 }}>
                            <div style={{ width: 5, height: 1, background: 'var(--brd)', marginLeft: 14 }} />
                            <span style={{ fontSize: '.55rem', color: 'var(--txt2)', fontWeight: 700, display: 'block', textAlign: 'right', lineHeight: 1 }}>
                              {db}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* 트랙별 미터 */}
                      {tracks.map(track => {
                        const col     = STEM_COLORS[track.type]
                        const staticH = dbH(track.rmsDb)
                        const staticC = dbCol(track.rmsDb)
                        return (
                          <div key={track.id} className="vu-col">
                            <div style={{ height: 4, display: 'flex', justifyContent: 'center' }}>
                              <div style={{ width: 4, height: 4, borderRadius: '50%', background: col }} />
                            </div>
                            <div className="vu-bar-bg">
                              {!playing && (
                                <>
                                  <div style={{ position:'absolute', top:0, inset:'0 0 90%', background:'rgba(248,113,113,.18)' }} />
                                  <div style={{ position:'absolute', inset:'10% 0 76.7%', background:'rgba(251,191,36,.12)' }} />
                                  {[-6,-12,-20,-40].map(d => (
                                    <div key={d} style={{ position:'absolute', left:0, right:0, bottom:`${dbH(d)}%`, height:1, background: isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)' }} />
                                  ))}
                                  <div style={{ position:'absolute', bottom:0, left:0, right:0, height:`${staticH}%`, background:staticC, borderRadius:4, transition:'height .6s ease' }} />
                                  <div style={{ position:'absolute', left:2, right:2, height:2, background:'rgba(255,255,255,.6)', borderRadius:1, bottom:`${staticH}%`, transition:'bottom .6s' }} />
                                </>
                              )}
                              <div ref={el => { if (el) vuContainers.current.set(track.id, el) }}
                                style={{ display: playing ? 'block' : 'none', width: '100%', height: '100%' }} />
                            </div>
                            <div style={{ height: 12, fontSize: '.55rem', fontWeight: 800, color: col, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {track.name.slice(0, 5).toUpperCase()}
                            </div>
                          </div>
                        )
                      })}

                      {/* 마스터 */}
                      <div className="vu-col" style={{ width: 22, flex: 'none' }}>
                        <div style={{ height: 4 }} />
                        <div className="vu-bar-bg">
                          {!playing && (
                            <>
                              <div style={{ position:'absolute', top:0, inset:'0 0 90%', background:'rgba(248,113,113,.18)' }} />
                              <div style={{ position:'absolute', inset:'10% 0 76.7%', background:'rgba(251,191,36,.12)' }} />
                            </>
                          )}
                          <div ref={el => { masterVuRef.current = el }}
                            style={{ display: playing ? 'block' : 'none', width: '100%', height: '100%' }} />
                        </div>
                        <div style={{ height: 12, fontSize: '.55rem', fontWeight: 800, color: 'var(--txt2)', textAlign: 'center' }}>MST</div>
                      </div>
                    </div>

                    {/* 범례 */}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                      {[{ c: '#4ade80', l: 'Safe' }, { c: '#fbbf24', l: 'Hot' }, { c: '#f87171', l: 'Clip' }].map(({ c, l }) => (
                        <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <div style={{ width: 6, height: 6, borderRadius: 1, background: c }} />
                          <span style={{ fontSize: '.65rem', color: 'var(--txt2)' }}>{l}</span>
                        </div>
                      ))}
                    </div>

                    {/* PEAK RMS 테이블 */}
                    <div className="ctrl-group" style={{ marginTop: 12 }}>
                      <p className="g-title">PEAK RMS</p>
                      {tracks.map(track => (
                        <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 4, height: 4, borderRadius: '50%', background: STEM_COLORS[track.type], flexShrink: 0 }} />
                            <span style={{ fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>{track.name}</span>
                          </div>
                          <span style={{ fontSize: '.72rem', fontWeight: 700, color: dbCol(track.rmsDb), fontVariantNumeric: 'tabular-nums' }}>
                            {track.loading ? '…' : track.rmsDb <= -60 ? '-∞' : `${track.rmsDb.toFixed(1)} dB`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </>
            )}
          </>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .dark  { --bg:#080808; --sur:#111111; --sur2:#171717; --brd:#242424; --txt:#ebebeb; --txt2:#777777; --acc:#4ade80; --acc2:#60a5fa; --acc-bg:rgba(74,222,128,0.08); }
        .light { --bg:#f0f0f0; --sur:#ffffff; --sur2:#f7f7f8; --brd:#e0e0e3; --txt:#0a0a0a; --txt2:#555555; --acc:#16a34a; --acc2:#2563eb; --acc-bg:rgba(22,163,74,0.07); }
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
        button,select,label,input{font-family:inherit}
        input[type=range]{-webkit-appearance:none;width:100%;height:3px;border-radius:2px;outline:none;cursor:pointer;background:var(--brd)}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:inherit;border:2px solid var(--bg);cursor:pointer}
        @keyframes toastIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
        @keyframes spin{to{transform:rotate(360deg)}}

        .toast-wrap{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none}
        .toast{padding:11px 16px;border-radius:8px;font-size:.78rem;font-weight:600;border:1px solid;max-width:300px;animation:toastIn .25s ease;pointer-events:auto}
        .toast-success{background:rgba(74,222,128,.12);border-color:#4ade80;color:var(--txt)}
        .toast-error{background:rgba(248,113,113,.12);border-color:#f87171;color:var(--txt)}
        .toast-warn{background:rgba(251,191,36,.12);border-color:#fbbf24;color:var(--txt)}
        .toast-info{background:rgba(96,165,250,.12);border-color:#60a5fa;color:var(--txt)}

        .ws{max-width:1300px;margin:0 auto;padding:20px}
        .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
        .brand{font-size:1.1rem;font-weight:800;letter-spacing:.5px;color:var(--txt)}
        .acc{color:var(--acc)}
        .hd-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .tier-chip{font-size:.65rem;font-weight:800;letter-spacing:1px;padding:3px 10px;border-radius:50px;background:var(--sur2);border:1px solid var(--brd);color:var(--txt2)}
        .btn-sm{background:var(--sur);border:1px solid var(--brd);color:var(--txt);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.72rem;font-weight:700;letter-spacing:.5px;transition:.15s}
        .btn-sm:hover{background:var(--sur2);border-color:var(--txt2)}

        .tab-nav{display:flex;gap:4px;margin-bottom:24px;border-bottom:1px solid var(--brd)}
        .tab-btn{display:flex;align-items:center;gap:7px;padding:10px 18px;background:none;border:none;border-bottom:2px solid transparent;color:var(--txt2);font-size:.8rem;font-weight:700;cursor:pointer;transition:.15s;letter-spacing:.3px;margin-bottom:-1px}
        .tab-btn:hover{color:var(--txt)}
        .tab-btn.active{color:var(--acc);border-bottom-color:var(--acc)}
        .tab-icon{font-size:1rem}

        .mix-title-row{margin-bottom:20px}
        .mix-h2{font-size:1.5rem;font-weight:800;letter-spacing:-.5px;color:var(--txt)}
        .mix-sub{font-size:.78rem;color:var(--txt2);margin-top:5px}

        .drop-zone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:160px;border:1px dashed var(--brd);border-radius:12px;cursor:pointer;transition:.2s;background:var(--sur2);padding:30px;margin-bottom:20px}
        .drop-zone:hover,.drop-zone.drag-over{border-color:var(--acc);background:var(--acc-bg)}
        .drop-icon{font-size:2rem}
        .drop-main{font-size:.9rem;font-weight:700;color:var(--txt)}
        .drop-sub{font-size:.72rem;color:var(--txt2)}

        .action-row{display:flex;align-items:center;gap:10px}
        .btn-prime{background:var(--acc);color:#000;border:none;padding:10px 16px;border-radius:6px;font-weight:800;font-size:.78rem;letter-spacing:.5px;cursor:pointer;transition:.15s}
        .btn-prime:hover:not(:disabled){filter:brightness(1.1)}
        .btn-prime:disabled{opacity:.45;cursor:not-allowed}
        .btn-sec{background:var(--sur2);color:var(--txt);border:1px solid var(--brd);padding:10px 16px;border-radius:6px;font-weight:800;font-size:.78rem;cursor:pointer;transition:.15s;text-align:center;white-space:nowrap}
        .btn-sec:hover{border-color:var(--txt2)}

        .mix-layout{display:flex;gap:20px;align-items:flex-start}
        .mix-strips-wrap{flex:1;min-width:0;overflow-x:auto;padding-bottom:8px}
        .mix-strips{display:flex;gap:10px;min-width:max-content}

        .strip-card{width:155px;flex-shrink:0;background:var(--sur);border:1px solid var(--brd);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;transition:opacity .25s}
        .strip-head{padding:8px 10px 6px;border-bottom:1px solid var(--brd);display:flex;align-items:center;justify-content:space-between}
        .strip-badge{font-size:.65rem;font-weight:800;letter-spacing:.07em;padding:2px 8px;border-radius:20px;border:1px solid}
        .strip-name-row{padding:6px 10px;border-bottom:1px solid var(--brd)}
        .strip-name{font-size:.78rem;font-weight:700;cursor:text;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 4px;border-radius:4px;color:var(--txt)}
        .strip-name-input{width:100%;background:var(--sur2);color:var(--txt);border:1px solid var(--acc);border-radius:5px;font-size:.78rem;font-weight:700;padding:3px 6px;outline:none}
        .strip-controls{padding:11px 10px;display:flex;flex-direction:column;gap:12px;flex:1}
        .ctrl-block{display:flex;flex-direction:column;gap:4px}
        .ctrl-label-row{display:flex;justify-content:space-between;align-items:center}
        .sld-label{font-size:.65rem;color:var(--txt2);font-weight:800;letter-spacing:.07em}
        .sld-val{font-size:.7rem;font-weight:800;color:var(--txt);font-variant-numeric:tabular-nums}
        .mini-bar-bg{height:3px;background:var(--brd);border-radius:2px;overflow:hidden;margin-top:4px;position:relative}
        .mini-bar-fill{height:100%;border-radius:2px;transition:width .12s,background .2s}
        .ms-btn{flex:1;padding:8px 0;border-radius:6px;border:1px solid;cursor:pointer;font-size:.7rem;font-weight:900;letter-spacing:.07em;transition:all .15s}
        .t-remove{background:none;border:none;color:var(--txt2);font-size:.75rem;cursor:pointer;padding:2px 4px;border-radius:4px;transition:.15s}
        .t-remove:hover{background:rgba(248,113,113,.15);color:#f87171}

        .strip-add{width:155px;flex-shrink:0;min-height:260px;border:1px dashed var(--brd);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;cursor:pointer;color:var(--txt2);transition:border-color .2s}
        .strip-add:hover{border-color:var(--acc);background:var(--acc-bg)}

        .vu-panel{width:230px;flex-shrink:0;position:sticky;top:20px}
        .panel{background:var(--sur);border:1px solid var(--brd);border-radius:12px;padding:20px}
        .panel-top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);padding-bottom:12px;margin-bottom:16px}
        .panel-top h3{font-size:.72rem;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--txt)}
        .panel-top span{font-size:.65rem;color:var(--acc)}
        .lock{font-size:.65rem;background:var(--sur2);border:1px solid var(--brd);padding:2px 8px;border-radius:50px;color:var(--txt2)}

        .vu-area{display:flex;gap:4px;height:220px}
        .vu-scale{width:22px;flex-shrink:0;position:relative;height:100%}
        .vu-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}
        .vu-bar-bg{flex:1;width:100%;background:var(--sur2);border-radius:4px;position:relative;overflow:hidden}

        .ctrl-group{background:var(--sur2);padding:14px;border-radius:8px;border:1px solid var(--brd)}
        .g-title{font-size:.65rem;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--brd);color:var(--txt)}

        .hero{text-align:center;padding:110px 0}
        .hero-eyebrow{font-size:.7rem;letter-spacing:3px;text-transform:uppercase;color:var(--txt2);margin-bottom:18px}
        .hero-title{font-size:5.5rem;font-weight:900;letter-spacing:-5px;line-height:.85;color:var(--txt);margin-bottom:48px}
        .hero .btn-prime{font-size:.88rem;padding:13px 30px;border-radius:8px}
      `}} />
    </main>
  )
}

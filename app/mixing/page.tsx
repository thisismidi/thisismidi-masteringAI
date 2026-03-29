'use client'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
type StemType = 'vocal' | 'drums' | 'bass' | 'piano' | 'guitar' | 'other'

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

interface Toast { id: string; msg: string; kind: 'info' | 'success' | 'error' }

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FREE = 5
const STEM_COLORS: Record<StemType, string> = {
  vocal:  '#3b82f6', drums: '#ef4444', bass: '#f59e0b',
  piano:  '#8b5cf6', guitar: '#10b981', other: '#6b7280',
}
const STEM_LABELS: Record<StemType, string> = {
  vocal: 'VOCAL', drums: 'DRUMS', bass: 'BASS',
  piano: 'PIANO', guitar: 'GUITAR', other: 'OTHER',
}
const DB_TICKS = [0, -6, -12, -20, -40, -60]

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid    = () => Math.random().toString(36).slice(2)
const dbl    = (db: number) => db <= -60 ? 0 : Math.pow(10, db / 20)
const dbH    = (db: number) => Math.max(0, ((Math.max(-60, db) + 60) / 60) * 100)
const dbCol  = (db: number) => db > -6 ? '#ef4444' : db > -20 ? '#f59e0b' : '#22c55e'

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
  const [dark,      setDark]    = useState(true)
  const [tracks,    setTracks]  = useState<StemTrack[]>([])
  const [isPro,     setIsPro]   = useState(false)
  const [dragging,  setDrag]    = useState(false)
  const [editId,    setEditId]  = useState<string | null>(null)
  const [editName,  setEditNm]  = useState('')
  const [playing,   setPlaying] = useState(false)
  const [toasts,    setToasts]  = useState<Toast[]>([])

  // ── Web Audio ──
  const ctxRef     = useRef<AudioContext | null>(null)
  const buffers    = useRef<Map<string, AudioBuffer>>(new Map())
  const srcNodes   = useRef<Map<string, AudioBufferSourceNode>>(new Map())
  const gainNodes  = useRef<Map<string, GainNode>>(new Map())
  const panNodes   = useRef<Map<string, StereoPannerNode>>(new Map())
  const masterGain = useRef<GainNode | null>(null)
  const playRef    = useRef(false)

  // ── VU meter DOM containers (web-audio-peak-meter fills these) ──
  const vuContainers  = useRef<Map<string, HTMLDivElement>>(new Map())
  const masterVuRef   = useRef<HTMLDivElement | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  // ── Toast ──
  const toast = useCallback((msg: string, kind: Toast['kind'] = 'info') => {
    const id = uid()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  // ── AudioContext ──
  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume()
    return ctxRef.current
  }, [])

  // ── Load buffer ──
  const loadBuf = useCallback(async (track: StemTrack) => {
    try {
      const ctx = getCtx()
      const ab  = await track.file.arrayBuffer()
      buffers.current.set(track.id, await ctx.decodeAudioData(ab))
    } catch {}
  }, [getCtx])

  // ── Add files ──
  const addFiles = useCallback(async (files: File[]) => {
    const isWav = (f: File) => /\.(wav|flac|aiff?)$/i.test(f.name)
    const ok    = (f: File) => /\.(wav|mp3|flac|aiff?|ogg)$/i.test(f.name)

    const valid = files.filter(f => {
      if (!ok(f))            { toast(`${f.name}: 지원하지 않는 형식`, 'error'); return false }
      if (isWav(f) && !isPro){ toast('WAV / FLAC은 PRO 전용입니다', 'error');   return false }
      return true
    })
    if (!valid.length) return

    setTracks(prev => {
      if (!isPro && prev.length >= MAX_FREE) {
        toast('무료 플랜: 최대 5트랙 (PRO 업그레이드 필요)', 'error')
        return prev
      }
      const slots  = isPro ? valid.length : MAX_FREE - prev.length
      const toAdd  = valid.slice(0, slots)
      if (valid.length > slots) toast(`${valid.length - slots}개 추가는 PRO 필요`, 'error')

      const nw: StemTrack[] = toAdd.map(file => ({
        id: uid(), file,
        name:    file.name.replace(/\.[^.]+$/, ''),
        type:    guessType(file.name),
        volume:  -12, pan: 0,
        muted:   false, solo: false,
        rmsDb:   -30, loading: true,
      }))
      nw.forEach(async t => {
        const rmsDb = await analyzeRMS(t.file)
        setTracks(ts => ts.map(x => x.id === t.id ? { ...x, rmsDb, loading: false } : x))
        await loadBuf(t)
      })
      return [...prev, ...nw]
    })
  }, [isPro, toast, loadBuf])

  // ── Volume / Pan ──
  const setVol = useCallback((id: string, db: number) => {
    setTracks(ts => ts.map(t => t.id === id ? { ...t, volume: db } : t))
    const g = gainNodes.current.get(id)
    if (g) g.gain.setTargetAtTime(dbl(db), ctxRef.current!.currentTime, 0.01)
  }, [])

  const setPan = useCallback((id: string, pan: number) => {
    setTracks(ts => ts.map(t => t.id === id ? { ...t, pan } : t))
    const p = panNodes.current.get(id)
    if (p) p.pan.setTargetAtTime(pan / 100, ctxRef.current!.currentTime, 0.01)
  }, [])

  const applyGains = (ts: StemTrack[]) => {
    if (!playRef.current || !ctxRef.current) return
    const hasSolo = ts.some(t => t.solo)
    ts.forEach(t => {
      const g = gainNodes.current.get(t.id)
      if (!g) return
      const active = !t.muted && (!hasSolo || t.solo)
      g.gain.setTargetAtTime(active ? dbl(t.volume) : 0, ctxRef.current!.currentTime, 0.01)
    })
  }

  const mute = useCallback((id: string) => {
    setTracks(ts => { const u = ts.map(t => t.id === id ? { ...t, muted: !t.muted } : t); applyGains(u); return u })
  }, []) // eslint-disable-line

  const solo = useCallback((id: string) => {
    setTracks(ts => { const u = ts.map(t => t.id === id ? { ...t, solo: !t.solo } : t); applyGains(u); return u })
  }, []) // eslint-disable-line

  const remove = useCallback((id: string) => {
    try { srcNodes.current.get(id)?.stop() } catch {}
    ;[srcNodes, gainNodes, panNodes, buffers, vuContainers].forEach(r => r.current.delete(id))
    setTracks(ts => ts.filter(t => t.id !== id))
  }, [])

  // ── PLAY ALL ──
  const handlePlay = useCallback(async () => {
    const ctx = getCtx()
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear(); gainNodes.current.clear(); panNodes.current.clear()

    // Master bus
    const mg = ctx.createGain(); mg.gain.value = 1
    mg.connect(ctx.destination)
    masterGain.current = mg

    const hasSolo = tracks.some(t => t.solo)
    const snap    = tracks

    snap.forEach(track => {
      const buf = buffers.current.get(track.id)
      if (!buf) return
      const src  = ctx.createBufferSource(); src.buffer = buf; src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = !track.muted && (!hasSolo || track.solo) ? dbl(track.volume) : 0
      const pan  = ctx.createStereoPanner(); pan.pan.value = track.pan / 100
      src.connect(gain); gain.connect(pan); pan.connect(mg)
      src.start(0)
      srcNodes.current.set(track.id, src)
      gainNodes.current.set(track.id, gain)
      panNodes.current.set(track.id, pan)
    })

    if (srcNodes.current.size === 0) { toast('로드된 트랙 없음. 잠시 후 다시 시도하세요', 'error'); return }

    playRef.current = true
    setPlaying(true)

    // ── Initialize web-audio-peak-meter ──────────────────────────────────────
    // npm install web-audio-peak-meter
    try {
      const wap  = await import('web-audio-peak-meter')
      const opts = {
        vertical:         true,
        borderSize:       2,
        fontSize:         9,
        backgroundColor:  dark ? '#141414' : '#f0f0f0',
        tickColor:        dark ? '#2e2e2e' : '#d0d0d0',
        labelColor:       dark ? '#666666' : '#999999',
        peakHoldDuration: 2000,
        meterColor: [
          { db: -60, color: '#22c55e' },
          { db: -20, color: '#22c55e' },
          { db: -12, color: '#84cc16' },
          { db: -6,  color: '#f59e0b' },
          { db: -3,  color: '#f97316' },
          { db:  0,  color: '#ef4444' },
        ],
      }

      // Per-track meters — tap into each panner node's output
      snap.forEach(track => {
        const el  = vuContainers.current.get(track.id)
        const pan = panNodes.current.get(track.id)
        if (!el || !pan) return
        el.innerHTML = ''
        new wap.WebAudioPeakMeter(pan, el, opts)
      })

      // Master meter
      if (masterVuRef.current && mg) {
        masterVuRef.current.innerHTML = ''
        new wap.WebAudioPeakMeter(mg, masterVuRef.current, opts)
      }
    } catch (e) {
      console.error('web-audio-peak-meter init failed:', e)
      toast('VU 미터 초기화 실패 (AudioWorklet 미지원 환경)', 'error')
    }
  }, [tracks, getCtx, toast, dark])

  // ── STOP ──
  const handleStop = useCallback(() => {
    playRef.current = false
    setPlaying(false)
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear()
    // Clear meter library DOM
    vuContainers.current.forEach(el => { el.innerHTML = '' })
    if (masterVuRef.current) masterVuRef.current.innerHTML = ''
  }, [])

  useEffect(() => () => {
    playRef.current = false
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    ctxRef.current?.close()
  }, [])

  // ─── Theme ───────────────────────────────────────────────────────────────
  const C = {
    bg:      dark ? '#090909' : '#f4f4f4',
    surface: dark ? '#131313' : '#ffffff',
    raised:  dark ? '#1a1a1a' : '#efefef',
    border:  dark ? '#242424' : '#e2e2e2',
    text:    dark ? '#efefef' : '#0a0a0a',
    sub:     dark ? '#777777' : '#666666',
    muted2:  dark ? '#444444' : '#aaaaaa',
    accent:  '#3b82f6',
  }

  const hasSolo = tracks.some(t => t.solo)

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh',
      fontFamily: '-apple-system, "Plus Jakarta Sans", BlinkMacSystemFont, sans-serif',
      transition: 'background .3s, color .3s' }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        input[type=range]{-webkit-appearance:none;width:100%;height:3px;border-radius:2px;outline:none;cursor:pointer;background:${C.border}}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:inherit;border:2px solid ${C.bg};cursor:pointer}
        @keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        /* ── web-audio-peak-meter 컨테이너 강제 사이즈 ── */
        .vu-live-container > * { width:100% !important; height:100% !important; }
      `}</style>

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <header style={{ position: 'sticky', top: 0, zIndex: 100,
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '-0.03em' }}>THISISMIDI</span>
          <div style={{ display: 'flex', gap: 3, background: C.raised, borderRadius: 8, padding: 3 }}>
            {['AI Mastering', 'AI Mixing'].map(tab => {
              const active = tab === 'AI Mixing'
              return (
                <button key={tab} style={{
                  padding: '5px 13px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: active ? C.accent : 'transparent',
                  color:      active ? '#fff'   : C.sub,
                  transition: 'all .2s',
                }}>{tab}</button>
              )
            })}
          </div>
          {/* PRO toggle (dev용) */}
          <button onClick={() => setIsPro(p => !p)} style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '.07em',
            padding: '3px 9px', borderRadius: 20, border: 'none', cursor: 'pointer',
            background: isPro ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : 'transparent',
            color: isPro ? '#fff' : '#f59e0b',
            outline: isPro ? 'none' : `1px solid #f59e0b`,
          }}>
            {isPro ? '✦ PRO' : 'FREE'}
          </button>
        </div>

        <button onClick={() => setDark(d => !d)} style={{
          width: 32, height: 32, borderRadius: '50%', border: `1px solid ${C.border}`,
          background: C.raised, cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {dark ? '☀️' : '🌙'}
        </button>
      </header>

      {/* ══ MAIN ════════════════════════════════════════════════════════════ */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px 80px' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.04em' }}>AI Mixing</h1>
          <p style={{ color: C.sub, marginTop: 6, fontSize: 13 }}>
            멀티트랙 업로드 → 볼륨 · 패닝 조정 → AI 믹스다운
            {!isPro && <span style={{ color: '#f59e0b', marginLeft: 8 }}>무료: MP3 · 최대 5트랙</span>}
          </p>
        </div>

        {/* ── DROP ZONE ──────────────────────────────────────────────── */}
        {tracks.length === 0 && (
          <div
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? C.accent : C.border}`,
              borderRadius: 18, padding: '64px 40px', textAlign: 'center',
              cursor: 'pointer', transition: 'all .2s',
              background: dragging ? (dark ? '#0d1a2e' : '#eff6ff') : C.surface,
            }}>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🎛️</div>
            <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 8 }}>
              스템 파일을 드래그하거나 클릭하세요
            </p>
            <p style={{ color: C.sub, fontSize: 13 }}>Vocal · Drums · Bass · Piano · Guitar</p>
            <p style={{ color: C.sub, fontSize: 11, marginTop: 6 }}>
              {isPro ? 'WAV · MP3 · FLAC · AIFF 지원' : 'MP3 지원 (무료) · WAV/FLAC은 PRO 전용'}
            </p>
          </div>
        )}

        <input ref={fileRef} type="file" multiple
          accept={isPro ? '.wav,.mp3,.flac,.aiff,.aif,.ogg' : '.mp3,.ogg'}
          style={{ display: 'none' }}
          onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }} />

        {/* ── MIXER ──────────────────────────────────────────────────── */}
        {tracks.length > 0 && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

            {/* ── Channel strips ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>

                  {tracks.map(track => {
                    const col    = STEM_COLORS[track.type]
                    const dimmed = hasSolo && !track.solo

                    return (
                      <div key={track.id} style={{
                        width: 155, flexShrink: 0,
                        background: C.surface, border: `1px solid ${C.border}`,
                        borderRadius: 14, overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                        opacity: dimmed ? 0.28 : 1, transition: 'opacity .25s',
                      }}>
                        <div style={{ height: 4, background: col, flexShrink: 0 }} />

                        {/* Type badge */}
                        <div style={{ padding: '8px 10px 6px',
                          borderBottom: `1px solid ${C.border}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{
                            fontSize: 10, fontWeight: 800, letterSpacing: '.07em',
                            color: col, padding: '2px 8px', borderRadius: 20,
                            border: `1px solid ${col}33`, background: `${col}14`,
                          }}>
                            {STEM_LABELS[track.type]}
                          </div>
                          <button onClick={() => remove(track.id)} style={{
                            background: 'none', border: 'none', color: C.muted2,
                            cursor: 'pointer', fontSize: 18, lineHeight: 1,
                          }}>×</button>
                        </div>

                        {/* Editable name */}
                        <div style={{ padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                          {editId === track.id ? (
                            <input
                              value={editName}
                              onChange={e => setEditNm(e.target.value)}
                              onBlur={() => {
                                if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t))
                                setEditId(null)
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t)); setEditId(null) }
                                if (e.key === 'Escape') setEditId(null)
                              }}
                              autoFocus
                              style={{ width: '100%', background: C.raised, color: C.text, border: `1px solid ${C.accent}`, borderRadius: 5, fontSize: 12, fontWeight: 700, padding: '3px 6px', outline: 'none' }}
                            />
                          ) : (
                            <div onClick={() => { setEditId(track.id); setEditNm(track.name) }}
                              title="클릭하여 이름 변경"
                              style={{ fontSize: 12, fontWeight: 700, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 4px', borderRadius: 4 }}>
                              {track.name}
                            </div>
                          )}
                          {track.loading && (
                            <div style={{ fontSize: 9, color: C.sub, marginTop: 3, animation: 'blink 1s ease infinite' }}>
                              ⚡ 분석 중…
                            </div>
                          )}
                        </div>

                        {/* Controls */}
                        <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>

                          {/* VOLUME */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 10, color: C.sub, fontWeight: 800, letterSpacing: '.07em' }}>VOLUME</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums' }}>
                                {track.volume <= -60 ? '-∞' : `${track.volume > 0 ? '+' : ''}${track.volume} dB`}
                              </span>
                            </div>
                            <input type="range" min={-60} max={0} step={0.5} value={track.volume}
                              onChange={e => setVol(track.id, +e.target.value)}
                              style={{ accentColor: col }} />
                            <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${dbH(track.volume)}%`, background: dbCol(track.volume), borderRadius: 2, transition: 'width .12s, background .2s' }} />
                            </div>
                          </div>

                          {/* PAN */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: 10, color: C.sub, fontWeight: 800, letterSpacing: '.07em' }}>PAN</span>
                              <span style={{ fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                                {track.pan === 0 ? 'C' : track.pan > 0 ? `R ${track.pan}` : `L ${Math.abs(track.pan)}`}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 800, color: C.sub, width: 8 }}>L</span>
                              <input type="range" min={-100} max={100} step={1} value={track.pan}
                                onChange={e => setPan(track.id, +e.target.value)} style={{ flex: 1 }} />
                              <span style={{ fontSize: 9, fontWeight: 800, color: C.sub, width: 8, textAlign: 'right' }}>R</span>
                            </div>
                            <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 5, position: 'relative', overflow: 'hidden' }}>
                              <div style={{
                                position: 'absolute', height: '100%', borderRadius: 2,
                                background: dark ? '#a1a1aa' : '#71717a',
                                left:  track.pan >= 0 ? '50%' : `${50 + track.pan / 2}%`,
                                width: track.pan === 0 ? 2 : `${Math.abs(track.pan) / 2}%`,
                                marginLeft: track.pan === 0 ? -1 : 0,
                                transition: 'all .1s',
                              }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                              {['LEFT', 'CENTER', 'RIGHT'].map(l => (
                                <span key={l} style={{ fontSize: 8, color: C.muted2 }}>{l}</span>
                              ))}
                            </div>
                          </div>

                          {/* MUTE / SOLO */}
                          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                            <button onClick={() => mute(track.id)} style={{
                              flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                              fontSize: 12, fontWeight: 900, letterSpacing: '.07em',
                              background: track.muted ? '#ef4444' : C.raised,
                              color:      track.muted ? '#fff'    : C.sub,
                              transition: 'all .15s',
                            }}>MUTE</button>
                            <button onClick={() => solo(track.id)} style={{
                              flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                              fontSize: 12, fontWeight: 900, letterSpacing: '.07em',
                              background: track.solo ? '#f59e0b' : C.raised,
                              color:      track.solo ? '#fff'    : C.sub,
                              transition: 'all .15s',
                            }}>SOLO</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Add track card */}
                  <div
                    onClick={() => {
                      if (!isPro && tracks.length >= MAX_FREE) { toast('무료 플랜 최대 5트랙. PRO로 업그레이드하세요', 'error'); return }
                      fileRef.current?.click()
                    }}
                    style={{
                      width: 155, flexShrink: 0, minHeight: 280,
                      border: `2px dashed ${C.border}`, borderRadius: 14,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: 8, cursor: 'pointer', color: C.sub,
                    }}>
                    <span style={{ fontSize: 26 }}>＋</span>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>트랙 추가</span>
                    {!isPro && tracks.length >= MAX_FREE && (
                      <span style={{ fontSize: 9, color: '#f59e0b', fontWeight: 800, padding: '2px 6px', border: '1px solid #f59e0b', borderRadius: 20 }}>
                        PRO 필요
                      </span>
                    )}
                    {!isPro && tracks.length < MAX_FREE && (
                      <span style={{ fontSize: 9, color: C.muted2 }}>{MAX_FREE - tracks.length}개 남음</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Transport */}
              <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={playing ? handleStop : handlePlay} style={{
                  padding: '12px 32px', borderRadius: 10, border: 'none',
                  background: playing ? '#ef4444' : C.accent,
                  color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', transition: 'all .2s',
                }}>
                  {playing ? '⏹ STOP' : '▶ PLAY ALL'}
                </button>
                <button style={{
                  padding: '12px 32px', borderRadius: 10, border: 'none',
                  background: '#22c55e', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                }}>
                  🎚 MIX
                </button>
                <span style={{ fontSize: 12, color: C.sub }}>
                  {tracks.filter(t => !t.muted).length}개 활성
                  {playing && <span style={{ color: '#22c55e', marginLeft: 8, animation: 'blink 1s ease infinite' }}>● LIVE</span>}
                </span>
              </div>
            </div>

            {/* ══ VU METER PANEL ════════════════════════════════════════ */}
            <div style={{
              width: 230, flexShrink: 0,
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 16, padding: '16px 14px',
              position: 'sticky', top: 68,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: C.sub }}>VU METER</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, color: C.sub, fontWeight: 700 }}>
                    {playing ? 'LIVE' : 'STATIC RMS'}
                  </span>
                  <div style={{ width: 7, height: 7, borderRadius: '50%',
                    background: playing ? '#22c55e' : C.border,
                    transition: 'background .3s' }} />
                </div>
              </div>

              {/* Meter area */}
              <div style={{ display: 'flex', gap: 4, height: 240 }}>

                {/* dB scale */}
                <div style={{ width: 22, flexShrink: 0, position: 'relative', height: '100%' }}>
                  {DB_TICKS.map(db => (
                    <div key={db} style={{
                      position: 'absolute', bottom: `${dbH(db)}%`,
                      transform: 'translateY(50%)', right: 0,
                    }}>
                      <div style={{ width: 6, height: 1, background: C.border, marginBottom: 2, marginLeft: 14 }} />
                      <span style={{ fontSize: 7, color: C.muted2, fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums', display: 'block', textAlign: 'right', lineHeight: 1 }}>
                        {db}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Per-track columns */}
                {tracks.map(track => {
                  const col     = STEM_COLORS[track.type]
                  const staticH = dbH(track.rmsDb)
                  const staticC = dbCol(track.rmsDb)

                  return (
                    <div key={track.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {/* Color indicator */}
                      <div style={{ height: 4, width: '100%', display: 'flex', justifyContent: 'center' }}>
                        <div style={{ width: 4, height: 4, borderRadius: '50%', background: col }} />
                      </div>

                      {/* Bar container */}
                      <div style={{ flex: 1, width: '100%', background: C.raised, borderRadius: 5, position: 'relative', overflow: 'hidden' }}>

                        {/* ── Static RMS bars (when not playing) ── */}
                        {!playing && (
                          <>
                            <div style={{ position:'absolute', top:0, inset:'0 0 90%', background:'rgba(239,68,68,.18)' }} />
                            <div style={{ position:'absolute', inset:'10% 0 76.7%', background:'rgba(245,158,11,.12)' }} />
                            {[-6,-12,-20,-40].map(d => (
                              <div key={d} style={{ position:'absolute', left:0, right:0, bottom:`${dbH(d)}%`, height:1,
                                background: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)' }} />
                            ))}
                            <div style={{ position:'absolute', bottom:0, left:0, right:0,
                              height:`${staticH}%`, background:staticC, borderRadius:5,
                              transition:'height .6s ease, background .3s' }} />
                            <div style={{ position:'absolute', left:2, right:2, height:2,
                              background:'rgba(255,255,255,.7)', borderRadius:1, bottom:`${staticH}%`,
                              transition:'bottom .6s ease' }} />
                          </>
                        )}

                        {/* ── web-audio-peak-meter live container ── */}
                        <div
                          className="vu-live-container"
                          ref={el => { if (el) vuContainers.current.set(track.id, el) }}
                          style={{ display: playing ? 'block' : 'none', width: '100%', height: '100%' }}
                        />
                      </div>

                      {/* Track label */}
                      <div style={{ height: 12, fontSize: 8, fontWeight: 800, color: col,
                        textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', width: '100%' }}>
                        {track.name.slice(0, 5).toUpperCase()}
                      </div>
                    </div>
                  )
                })}

                {/* Master column */}
                <div style={{ width: 22, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ height: 4, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.text, opacity: .4 }} />
                  </div>
                  <div style={{ flex: 1, background: C.raised, borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
                    {!playing && (
                      <>
                        <div style={{ position:'absolute', top:0, inset:'0 0 90%', background:'rgba(239,68,68,.18)' }} />
                        <div style={{ position:'absolute', inset:'10% 0 76.7%', background:'rgba(245,158,11,.12)' }} />
                      </>
                    )}
                    <div
                      className="vu-live-container"
                      ref={el => { masterVuRef.current = el }}
                      style={{ display: playing ? 'block' : 'none', width: '100%', height: '100%' }}
                    />
                  </div>
                  <div style={{ height: 12, fontSize: 8, fontWeight: 800, color: C.sub, textAlign: 'center' }}>
                    MST
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                {[{ c: '#22c55e', l: 'Safe' }, { c: '#f59e0b', l: 'Hot' }, { c: '#ef4444', l: 'Clip' }].map(({ c, l }) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 1, background: c }} />
                    <span style={{ fontSize: 9, color: C.sub }}>{l}</span>
                  </div>
                ))}
              </div>

              {/* RMS table */}
              <div style={{ marginTop: 10, padding: '8px 10px', background: C.raised, borderRadius: 8 }}>
                <div style={{ fontSize: 9, color: C.sub, fontWeight: 800, letterSpacing: '.08em', marginBottom: 6 }}>
                  {playing ? 'LIVE LEVELS' : 'PEAK RMS'}
                </div>
                {tracks.map(track => (
                  <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: STEM_COLORS[track.type], flexShrink: 0 }} />
                      <span style={{ fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 68 }}>
                        {track.name}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: dbCol(track.rmsDb), fontVariantNumeric: 'tabular-nums' }}>
                      {track.loading ? '…' : track.rmsDb <= -60 ? '-∞' : `${track.rmsDb.toFixed(1)} dB`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Info banner */}
              {!playing && tracks.length > 0 && (
                <div style={{ marginTop: 8, padding: '7px 10px',
                  background: dark ? '#0d1a0d' : '#f0fdf4',
                  border: `1px solid ${dark ? '#1f3d1f' : '#bbf7d0'}`,
                  borderRadius: 8 }}>
                  <p style={{ fontSize: 9, color: dark ? '#4ade80' : '#16a34a', lineHeight: 1.6 }}>
                    ▶ PLAY ALL 누르면 <strong>web-audio-peak-meter</strong> 라이브러리가 실시간 레벨을 표시합니다
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ══ TOASTS ══════════════════════════════════════════════════════════ */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.kind === 'error' ? '#ef4444' : t.kind === 'success' ? '#22c55e' : C.surface,
            color:  t.kind === 'info' ? C.text : '#fff',
            border: t.kind === 'info' ? `1px solid ${C.border}` : 'none',
            borderRadius: 10, padding: '10px 16px',
            fontSize: 13, fontWeight: 700,
            boxShadow: '0 4px 20px rgba(0,0,0,.25)',
            animation: 'toast-in .3s ease',
          }}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}

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
  volume:  number
  pan:     number
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

// ─── VU Meter constants ───────────────────────────────────────────────────────
const VU_W    = 270
const VU_H    = 162
const VU_CX   = 135
const VU_CY   = 150
const VU_R    = 112
const VU_SA   = Math.PI * 1.111  // 200°
const VU_EA   = Math.PI * 1.889  // 340°
const VU_MIN  = -20
const VU_MAX  = 3
const VU_REF  = -18              // 0 VU = -18 dBFS

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2)
const dbl   = (db: number) => db <= -60 ? 0 : Math.pow(10, db / 20)
const dbH   = (db: number) => Math.max(0, ((Math.max(-60, db) + 60) / 60) * 100)
const dbCol = (db: number) => db > -6 ? '#f87171' : db > -20 ? '#fbbf24' : '#4ade80'
const vu2a  = (v: number) => {
  const t = Math.max(0, Math.min(1, (v - VU_MIN) / (VU_MAX - VU_MIN)))
  return VU_SA + t * (VU_EA - VU_SA)
}

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

// ─── VU Meter Draw ────────────────────────────────────────────────────────────
function drawVUDial(
  canvas: HTMLCanvasElement,
  vuL: number,
  vuR: number,
  pkL: number | null,
  pkR: number | null
) {
  const c = canvas.getContext('2d')
  if (!c) return
  c.clearRect(0, 0, VU_W, VU_H)

  // Face background
  c.beginPath()
  c.roundRect(1, 1, VU_W - 2, VU_H - 2, 6)
  c.fillStyle = '#f0eadb'
  c.fill()
  c.strokeStyle = '#2a2a2a'
  c.lineWidth = 1.5
  c.stroke()

  // Red zone fill (0 VU ~ +3)
  c.beginPath()
  c.moveTo(VU_CX, VU_CY)
  c.arc(VU_CX, VU_CY, VU_R + 14, vu2a(0), VU_EA)
  c.closePath()
  c.fillStyle = 'rgba(180,0,0,0.13)'
  c.fill()

  // Arc track lines
  c.beginPath()
  c.arc(VU_CX, VU_CY, VU_R, VU_SA, vu2a(-0.5))
  c.strokeStyle = '#555'
  c.lineWidth = 1
  c.stroke()
  c.beginPath()
  c.arc(VU_CX, VU_CY, VU_R, vu2a(-0.5), VU_EA)
  c.strokeStyle = '#bb0000'
  c.lineWidth = 1
  c.stroke()

  // Tick marks + labels
  const TICKS = [
    { v: -20, major: true,  lbl: '20'  },
    { v: -15, major: false, lbl: ''    },
    { v: -10, major: true,  lbl: '10'  },
    { v: -9,  major: false, lbl: ''    },
    { v: -8,  major: false, lbl: ''    },
    { v: -7,  major: true,  lbl: '7'   },
    { v: -6,  major: false, lbl: ''    },
    { v: -5,  major: true,  lbl: '5'   },
    { v: -4,  major: false, lbl: ''    },
    { v: -3,  major: true,  lbl: '3'   },
    { v: -2,  major: false, lbl: ''    },
    { v: -1,  major: false, lbl: ''    },
    { v:  0,  major: true,  lbl: '0'   },
    { v:  1,  major: false, lbl: ''    },
    { v:  2,  major: false, lbl: ''    },
    { v:  3,  major: true,  lbl: '3'   },
  ]

  TICKS.forEach(t => {
    const a    = vu2a(t.v)
    const isRed = t.v >= 0
    const col  = isRed ? '#cc0000' : '#1a1a1a'
    const rOut = VU_R + 8
    const rIn  = t.major ? VU_R - 4 : VU_R + 2

    c.beginPath()
    c.moveTo(VU_CX + Math.cos(a) * rIn,  VU_CY + Math.sin(a) * rIn)
    c.lineTo(VU_CX + Math.cos(a) * rOut, VU_CY + Math.sin(a) * rOut)
    c.strokeStyle = col
    c.lineWidth = t.major ? 1.8 : 0.9
    c.stroke()

    if (t.lbl) {
      const rT = VU_R - 20
      c.font = '700 9px monospace'
      c.fillStyle = col
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(t.lbl, VU_CX + Math.cos(a) * rT, VU_CY + Math.sin(a) * rT)
    }
  })

  // End symbols (− / +)
  ;[{ v: -20, lbl: '−' }, { v: 3, lbl: '+' }].forEach(({ v, lbl }) => {
    const a = vu2a(v)
    c.font = '900 11px serif'
    c.fillStyle = v >= 0 ? '#cc0000' : '#1a1a1a'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(lbl, VU_CX + Math.cos(a) * (VU_R - 8), VU_CY + Math.sin(a) * (VU_R - 8))
  })

  // "VU" label
  c.font = '400 18px serif'
  c.fillStyle = '#2a2a2a'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('VU', VU_CX, VU_CY - 30)

  // Peak hold needles (L=red, R=orange)
  const peaks = [
    { pk: pkL, col: '#cc0000' },
    { pk: pkR, col: '#e06000' },
  ]
  peaks.forEach(({ pk, col }) => {
    if (pk === null) return
    const pa = vu2a(Math.max(VU_MIN, Math.min(VU_MAX, pk)))
    c.beginPath()
    c.moveTo(VU_CX + Math.cos(pa) * 12, VU_CY + Math.sin(pa) * 12)
    c.lineTo(VU_CX + Math.cos(pa) * (VU_R + 6), VU_CY + Math.sin(pa) * (VU_R + 6))
    c.strokeStyle = col
    c.lineWidth = 1.5
    c.stroke()
  })

  // L needle (white)
  const naL = vu2a(Math.max(VU_MIN, Math.min(VU_MAX, vuL)))
  c.beginPath()
  c.moveTo(VU_CX, VU_CY)
  c.lineTo(VU_CX + Math.cos(naL) * (VU_R + 2), VU_CY + Math.sin(naL) * (VU_R + 2))
  c.strokeStyle = 'rgba(0,0,0,0.12)'
  c.lineWidth = 4
  c.lineCap = 'round'
  c.stroke()
  c.beginPath()
  c.moveTo(VU_CX, VU_CY)
  c.lineTo(VU_CX + Math.cos(naL) * (VU_R + 2), VU_CY + Math.sin(naL) * (VU_R + 2))
  c.strokeStyle = '#111'
  c.lineWidth = 1.8
  c.stroke()
  c.beginPath()
  c.moveTo(VU_CX, VU_CY)
  c.lineTo(VU_CX + Math.cos(naL + Math.PI) * 14, VU_CY + Math.sin(naL + Math.PI) * 14)
  c.strokeStyle = '#333'
  c.lineWidth = 2.5
  c.stroke()

  // R needle (slightly thinner, blue-ish tint)
  const naR = vu2a(Math.max(VU_MIN, Math.min(VU_MAX, vuR)))
  c.beginPath()
  c.moveTo(VU_CX, VU_CY)
  c.lineTo(VU_CX + Math.cos(naR) * (VU_R + 2), VU_CY + Math.sin(naR) * (VU_R + 2))
  c.strokeStyle = '#1a4a8a'
  c.lineWidth = 1.3
  c.lineCap = 'round'
  c.stroke()

  // Pivot
  c.beginPath(); c.arc(VU_CX, VU_CY, 9, 0, Math.PI * 2)
  c.fillStyle = '#ccc'; c.fill()
  c.strokeStyle = '#888'; c.lineWidth = 1; c.stroke()
  c.beginPath(); c.arc(VU_CX, VU_CY, 5, 0, Math.PI * 2)
  c.fillStyle = '#555'; c.fill()
  c.beginPath(); c.arc(VU_CX, VU_CY, 2.5, 0, Math.PI * 2)
  c.fillStyle = '#999'; c.fill()

  // L / R label on face
  c.font = '600 8px monospace'
  c.fillStyle = '#555'
  c.textAlign = 'left'
  c.fillText('L', 10, VU_H - 8)
  c.fillStyle = '#1a4a8a'
  c.fillText('R', 24, VU_H - 8)
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
  const [vuPeakMax, setVuPeakMax] = useState<number | null>(null)
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
    setTier(pro ? 'PRO' : 'FREE')
    setIsPro(!!pro)
  }

  // ── Web Audio refs ──
  const ctxRef      = useRef<AudioContext | null>(null)
  const buffers     = useRef<Map<string, AudioBuffer>>(new Map())
  const srcNodes    = useRef<Map<string, AudioBufferSourceNode>>(new Map())
  const gainNodes   = useRef<Map<string, GainNode>>(new Map())
  const panNodes    = useRef<Map<string, StereoPannerNode>>(new Map())
  const masterGain  = useRef<GainNode | null>(null)
  const anlLRef     = useRef<AnalyserNode | null>(null)
  const anlRRef     = useRef<AnalyserNode | null>(null)
  const playRef     = useRef(false)
 const animRef     = useRef<number | undefined>(undefined)

  // ── VU meter state (refs for RAF, not React state) ──
  const vuLRef       = useRef(VU_MIN)
  const vuRRef       = useRef(VU_MIN)
  const pkLRef       = useRef<number | null>(null)
  const pkRRef       = useRef<number | null>(null)
const pkLTimer     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
const pkRTimer     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const vuPeakRef    = useRef<number>(-999)
  const vuCanvasRef  = useRef<HTMLCanvasElement | null>(null)
  const olLedRef     = useRef<HTMLDivElement | null>(null)
  const vuPeakElRef  = useRef<HTMLSpanElement | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

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
    const isWav   = (f: File) => /\.(wav|flac|aiff?)$/i.test(f.name)
    const isAudio = (f: File) => /\.(wav|mp3|flac|aiff?|ogg)$/i.test(f.name)
    const valid = files.filter(f => {
      if (!isAudio(f))         { toast(`${f.name}: 지원하지 않는 형식`, 'error'); return false }
      if (isWav(f) && !isPro)  { toast('WAV / FLAC은 PRO 전용입니다 🔒', 'warn');  return false }
      return true
    })
    if (!valid.length) return

    setTracks(prev => {
      if (!isPro && prev.length >= MAX_FREE) { toast('무료 플랜: 최대 5트랙', 'warn'); return prev }
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
      g.gain.setTargetAtTime(!t.muted && (!hasSolo || t.solo) ? dbl(t.volume) : 0, ctxRef.current!.currentTime, 0.01)
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
    ;[srcNodes, gainNodes, panNodes, buffers].forEach(r => r.current.delete(id))
    setTracks(ts => ts.filter(t => t.id !== id))
    toast('트랙 삭제됨', 'info')
  }, [toast])

  // ── VU animation loop ──
  const startVUAnimation = useCallback(() => {
    const tick = () => {
      if (!playRef.current) return
      const anlL = anlLRef.current
      const anlR = anlRRef.current
      const canvas = vuCanvasRef.current
      if (!anlL || !anlR || !canvas) { animRef.current = requestAnimationFrame(tick); return }

      const dL = new Float32Array(256)
      const dR = new Float32Array(256)
      anlL.getFloatTimeDomainData(dL)
      anlR.getFloatTimeDomainData(dR)

      let sL = 0, sR = 0
      for (let i = 0; i < 256; i++) { sL += dL[i] * dL[i]; sR += dR[i] * dR[i] }
      const dbL = Math.sqrt(sL / 256) > 1e-6 ? 20 * Math.log10(Math.sqrt(sL / 256)) : -70
      const dbR = Math.sqrt(sR / 256) > 1e-6 ? 20 * Math.log10(Math.sqrt(sR / 256)) : -70

      const tgtL = Math.max(VU_MIN, Math.min(VU_MAX, dbL - VU_REF))
      const tgtR = Math.max(VU_MIN, Math.min(VU_MAX, dbR - VU_REF))
      vuLRef.current += (tgtL - vuLRef.current) * 0.18
      vuRRef.current += (tgtR - vuRRef.current) * 0.18

      // Peak hold (2.5s)
      if (vuLRef.current > (pkLRef.current ?? -999)) {
        pkLRef.current = vuLRef.current
        clearTimeout(pkLTimer.current)
        pkLTimer.current = setTimeout(() => { pkLRef.current = null }, 2500)
      }
      if (vuRRef.current > (pkRRef.current ?? -999)) {
        pkRRef.current = vuRRef.current
        clearTimeout(pkRTimer.current)
        pkRTimer.current = setTimeout(() => { pkRRef.current = null }, 2500)
      }

      // VU Peak max hold
      const vuAvg = (vuLRef.current + vuRRef.current) / 2
      if (vuAvg > vuPeakRef.current) {
        vuPeakRef.current = vuAvg
        if (vuPeakElRef.current) {
          vuPeakElRef.current.textContent = (vuAvg > 0 ? '+' : '') + vuAvg.toFixed(2)
          vuPeakElRef.current.style.color = vuAvg >= 0 ? '#ef4444' : vuAvg >= -3 ? '#f59e0b' : '#4ade80'
        }
        if (olLedRef.current) {
          olLedRef.current.style.background = vuAvg >= 0 ? '#cc0000' : '#2a0000'
          olLedRef.current.style.boxShadow  = vuAvg >= 0 ? '0 0 8px #cc0000' : 'none'
        }
        setVuPeakMax(vuAvg)
      }

      drawVUDial(canvas, vuLRef.current, vuRRef.current, pkLRef.current, pkRRef.current)
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
  }, [])

  // ── Play / Stop ──
  const handlePlay = useCallback(async () => {
    const ctx = getCtx()
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear(); gainNodes.current.clear(); panNodes.current.clear()
    if (animRef.current) cancelAnimationFrame(animRef.current)

    const mg = ctx.createGain(); mg.gain.value = 1
    const splitter = ctx.createChannelSplitter(2)
    const aL = ctx.createAnalyser(); aL.fftSize = 256
    const aR = ctx.createAnalyser(); aR.fftSize = 256
    mg.connect(splitter); splitter.connect(aL, 0); splitter.connect(aR, 1)
    mg.connect(ctx.destination)
    masterGain.current = mg; anlLRef.current = aL; anlRRef.current = aR

    const hasSolo = tracks.some(t => t.solo)
    tracks.forEach(track => {
      const buf = buffers.current.get(track.id); if (!buf) return
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = !track.muted && (!hasSolo || track.solo) ? dbl(track.volume) : 0
      const pan = ctx.createStereoPanner(); pan.pan.value = track.pan / 100
      src.connect(gain); gain.connect(pan); pan.connect(mg); src.start(0)
      srcNodes.current.set(track.id, src)
      gainNodes.current.set(track.id, gain)
      panNodes.current.set(track.id, pan)
    })

    if (srcNodes.current.size === 0) { toast('로드된 트랙이 없습니다. 잠시 후 다시 시도하세요.', 'error'); return }
    playRef.current = true; setPlaying(true)
    startVUAnimation()
  }, [tracks, getCtx, toast, startVUAnimation])

  const handleStop = useCallback(() => {
    playRef.current = false; setPlaying(false)
    if (animRef.current) cancelAnimationFrame(animRef.current)
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    srcNodes.current.clear()
    // Reset needle to rest position
    vuLRef.current = VU_MIN; vuRRef.current = VU_MIN
    pkLRef.current = null; pkRRef.current = null
    if (vuCanvasRef.current) drawVUDial(vuCanvasRef.current, VU_MIN, VU_MIN, null, null)
  }, [])

  const resetVuPeak = () => {
    vuPeakRef.current = -999
    setVuPeakMax(null)
    if (vuPeakElRef.current) { vuPeakElRef.current.textContent = '—'; vuPeakElRef.current.style.color = '' }
    if (olLedRef.current) { olLedRef.current.style.background = '#2a0000'; olLedRef.current.style.boxShadow = 'none' }
  }

  useEffect(() => {
    if (vuCanvasRef.current) drawVUDial(vuCanvasRef.current, VU_MIN, VU_MIN, null, null)
  }, [])

  useEffect(() => () => {
    playRef.current = false
    if (animRef.current) cancelAnimationFrame(animRef.current)
    srcNodes.current.forEach(s => { try { s.stop() } catch {} })
    ctxRef.current?.close()
  }, [])

  const hasSolo = tracks.some(t => t.solo)

  // ─── Theme tokens ─────────────────────────────────────────────────────────
  const C = {
    bg:      isDark ? '#080808' : '#f0f0f0',
    surface: isDark ? '#111111' : '#ffffff',
    raised:  isDark ? '#171717' : '#f7f7f8',
    border:  isDark ? '#242424' : '#e0e0e3',
    text:    isDark ? '#ebebeb' : '#0a0a0a',
    sub:     isDark ? '#777777' : '#555555',
    muted2:  isDark ? '#444444' : '#aaaaaa',
    accent:  '#4ade80',
    accent2: '#60a5fa',
  }

  return (
    <main style={{ background: C.bg, color: C.text, minHeight: '100vh',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif",
      fontSize: 14, WebkitFontSmoothing: 'antialiased', transition: 'background .25s, color .25s' }}>

      {/* ── Toast ── */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '11px 16px', borderRadius: 8, fontSize: '.78rem', fontWeight: 600,
            border: '1px solid', maxWidth: 300, pointerEvents: 'auto',
            background: t.type === 'success' ? 'rgba(74,222,128,.12)' : t.type === 'error' ? 'rgba(248,113,113,.12)' : t.type === 'warn' ? 'rgba(251,191,36,.12)' : 'rgba(96,165,250,.12)',
            borderColor:  t.type === 'success' ? '#4ade80' : t.type === 'error' ? '#f87171' : t.type === 'warn' ? '#fbbf24' : '#60a5fa',
            color: C.text,
          }}>
            {t.msg}
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>

        {/* ── Header ── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '.5px' }}>
            THISISMIDI <span style={{ color: C.accent }}>.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user && <span style={{ fontSize: '.65rem', fontWeight: 800, padding: '3px 10px', borderRadius: 50, background: C.raised, border: `1px solid ${C.border}`, color: C.sub }}>{tier}</span>}
            <button style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 700 }}
              onClick={() => setIsDark(d => !d)}>{isDark ? '☀ LIGHT' : '☾ DARK'}</button>
            {user
              ? <button style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 700 }}
                  onClick={() => supabase.auth.signOut()}>LOGOUT</button>
              : <button style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 700 }}
                  onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>LOGIN</button>}
          </div>
        </header>

        {/* ── 로그인 전 ── */}
        {!user ? (
          <div style={{ textAlign: 'center', padding: '110px 0' }}>
            <p style={{ fontSize: '.7rem', letterSpacing: 3, textTransform: 'uppercase', color: C.sub, marginBottom: 18 }}>Professional AI Music Tools</p>
            <h1 style={{ fontSize: '5.5rem', fontWeight: 900, letterSpacing: '-5px', lineHeight: .85, marginBottom: 48 }}>Sound Better,<br />Instantly.</h1>
            <button style={{ background: C.accent, color: '#000', border: 'none', padding: '13px 30px', borderRadius: 8, fontWeight: 800, fontSize: '.88rem', cursor: 'pointer' }}
              onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>
              Start with Google →
            </button>
          </div>
        ) : (
          <>
            {/* ── Tab nav ── */}
            <nav style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${C.border}` }}>
              {[{ label: '🎛 AI Mastering', path: '/' }, { label: '🎚 AI Mixing', path: null }].map(tab => (
                <button key={tab.label} onClick={() => tab.path && router.push(tab.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px',
                    background: 'none', border: 'none', cursor: tab.path ? 'pointer' : 'default',
                    borderBottom: !tab.path ? `2px solid ${C.accent}` : '2px solid transparent',
                    color: !tab.path ? C.accent : C.sub,
                    fontSize: '.8rem', fontWeight: 700, marginBottom: -1, transition: '.15s',
                  }}>
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* ── Title ── */}
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-.5px' }}>AI Mixing</h2>
              <p style={{ fontSize: '.78rem', color: C.sub, marginTop: 5 }}>
                멀티트랙 업로드 → 볼륨 · 패닝 조정 → AI 믹스다운
                {!isPro && <span style={{ marginLeft: 10, fontSize: '.65rem', background: C.raised, border: `1px solid ${C.border}`, padding: '2px 8px', borderRadius: 50, color: C.sub }}>무료: MP3 · 최대 5트랙</span>}
              </p>
            </div>

            <input ref={fileRef} type="file" multiple id="mix-file"
              accept={isPro ? '.wav,.mp3,.flac,.aiff,.aif,.ogg' : '.mp3,.ogg'}
              style={{ display: 'none' }}
              onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }} />

            {/* ── Drop zone ── */}
            {tracks.length === 0 && (
              <label htmlFor="mix-file"
                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, minHeight: 160, border: `1px dashed ${dragging ? C.accent : C.border}`,
                  borderRadius: 12, cursor: 'pointer', transition: '.2s', marginBottom: 20,
                  background: dragging ? (isDark ? 'rgba(74,222,128,.05)' : 'rgba(22,163,74,.04)') : C.surface, padding: 30,
                }}>
                <span style={{ fontSize: '2rem', marginBottom: 6 }}>🎚</span>
                <span style={{ fontSize: '.9rem', fontWeight: 700 }}>스템 파일을 드래그하거나 클릭하세요</span>
                <span style={{ fontSize: '.72rem', color: C.sub }}>Vocal · Drums · Bass · Piano · Guitar</span>
                <span style={{ fontSize: '.72rem', color: C.sub }}>{isPro ? 'WAV · MP3 · FLAC · AIFF 지원' : 'MP3 지원 (무료) · WAV/FLAC은 PRO 전용'}</span>
              </label>
            )}

            {/* ── Mixer ── */}
            {tracks.length > 0 && (
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

                {/* Channel strips */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Action row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                    <label htmlFor="mix-file" style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.raised, color: C.text, fontSize: '.78rem', fontWeight: 800, cursor: 'pointer' }}>
                      + 트랙 추가
                    </label>
                    <button onClick={playing ? handleStop : handlePlay}
                      style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: playing ? '#f87171' : C.accent, color: '#000', fontSize: '.78rem', fontWeight: 800, cursor: 'pointer' }}>
                      {playing ? '■ STOP' : '▶ PLAY ALL'}
                    </button>
                    <button style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: C.accent2, color: '#fff', fontSize: '.78rem', fontWeight: 800, cursor: 'pointer' }}>
                      🎚 MIX
                    </button>
                    <span style={{ fontSize: '.72rem', color: C.sub }}>
                      {tracks.filter(t => !t.muted).length}개 활성
                      {playing && <span style={{ color: C.accent, marginLeft: 8 }}>● LIVE</span>}
                    </span>
                  </div>

                  {/* Channel strip cards */}
                  <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 10, minWidth: 'max-content' }}>
                      {tracks.map(track => {
                        const col    = STEM_COLORS[track.type]
                        const dimmed = hasSolo && !track.solo
                        return (
                          <div key={track.id} style={{
                            width: 155, flexShrink: 0, background: C.surface, border: `1px solid ${C.border}`,
                            borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                            opacity: dimmed ? 0.28 : 1, transition: 'opacity .25s',
                          }}>
                            <div style={{ height: 3, background: col }} />
                            <div style={{ padding: '8px 10px 6px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.07em', color: col, padding: '2px 8px', borderRadius: 20, border: `1px solid ${col}33`, background: `${col}18` }}>
                                {STEM_LABELS[track.type]}
                              </span>
                              <button onClick={() => removeTrack(track.id)} style={{ background: 'none', border: 'none', color: C.muted2, cursor: 'pointer', fontSize: 18 }}>×</button>
                            </div>

                            {/* Editable name */}
                            <div style={{ padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                              {editId === track.id ? (
                                <input value={editName} onChange={e => setEditNm(e.target.value)}
                                  onBlur={() => { if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t)); setEditId(null) }}
                                  onKeyDown={e => { if (e.key === 'Enter') { if (editName.trim()) setTracks(ts => ts.map(t => t.id === track.id ? { ...t, name: editName.trim() } : t)); setEditId(null) } if (e.key === 'Escape') setEditId(null) }}
                                  autoFocus
                                  style={{ width: '100%', background: C.raised, color: C.text, border: `1px solid ${C.accent}`, borderRadius: 5, fontSize: 12, fontWeight: 700, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }} />
                              ) : (
                                <div onClick={() => { setEditId(track.id); setEditNm(track.name) }} title="클릭하여 이름 변경"
                                  style={{ fontSize: 12, fontWeight: 700, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 4px' }}>
                                  {track.name}
                                </div>
                              )}
                              {track.loading && <div style={{ fontSize: 9, color: C.sub, marginTop: 2 }}>분석 중…</div>}
                            </div>

                            <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
                              {/* VOLUME */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <span style={{ fontSize: 10, color: C.sub, fontWeight: 800, letterSpacing: '.07em' }}>VOLUME</span>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums' }}>
                                    {track.volume <= -60 ? '-∞' : `${track.volume > 0 ? '+' : ''}${track.volume} dB`}
                                  </span>
                                </div>
                                <input type="range" min={-60} max={0} step={0.5} value={track.volume}
                                  onChange={e => setVol(track.id, +e.target.value)}
                                  style={{ width: '100%', accentColor: col, height: 3, appearance: 'none', WebkitAppearance: 'none', background: C.border, borderRadius: 2, cursor: 'pointer', outline: 'none' }} />
                                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${dbH(track.volume)}%`, background: dbCol(track.volume), borderRadius: 2, transition: 'width .12s' }} />
                                </div>
                              </div>

                              {/* PAN */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <span style={{ fontSize: 10, color: C.sub, fontWeight: 800, letterSpacing: '.07em' }}>PAN</span>
                                  <span style={{ fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                                    {track.pan === 0 ? 'C' : track.pan > 0 ? `R ${track.pan}` : `L ${Math.abs(track.pan)}`}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 9, fontWeight: 800, color: C.sub, width: 8 }}>L</span>
                                  <input type="range" min={-100} max={100} step={1} value={track.pan}
                                    onChange={e => setPan(track.id, +e.target.value)}
                                    style={{ flex: 1, height: 3, appearance: 'none', WebkitAppearance: 'none', background: C.border, borderRadius: 2, cursor: 'pointer', outline: 'none' }} />
                                  <span style={{ fontSize: 9, fontWeight: 800, color: C.sub, width: 8, textAlign: 'right' }}>R</span>
                                </div>
                                <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 4, position: 'relative', overflow: 'hidden' }}>
                                  <div style={{ position: 'absolute', height: '100%', borderRadius: 2, background: isDark ? '#a1a1aa' : '#71717a', left: track.pan >= 0 ? '50%' : `${50 + track.pan / 2}%`, width: track.pan === 0 ? 2 : `${Math.abs(track.pan) / 2}%`, marginLeft: track.pan === 0 ? -1 : 0, transition: 'all .1s' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                                  {['LEFT', 'CENTER', 'RIGHT'].map(l => <span key={l} style={{ fontSize: 8, color: C.muted2 }}>{l}</span>)}
                                </div>
                              </div>

                              {/* MUTE / SOLO */}
                              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                                <button onClick={() => toggleMute(track.id)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, letterSpacing: '.07em', background: track.muted ? '#f87171' : C.raised, color: track.muted ? '#fff' : C.sub, transition: 'all .15s', fontFamily: 'inherit' }}>MUTE</button>
                                <button onClick={() => toggleSolo(track.id)} style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, letterSpacing: '.07em', background: track.solo ? '#fbbf24' : C.raised, color: track.solo ? '#000' : C.sub, transition: 'all .15s', fontFamily: 'inherit' }}>SOLO</button>
                              </div>
                            </div>
                          </div>
                        )
                      })}

                      {/* Add track */}
                      <label htmlFor="mix-file" onClick={() => { if (!isPro && tracks.length >= MAX_FREE) { toast('무료 플랜 최대 5트랙. PRO로 업그레이드하세요 🔒', 'warn') } }}
                        style={{ width: 155, flexShrink: 0, minHeight: 260, border: `2px dashed ${C.border}`, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', color: C.sub }}>
                        <span style={{ fontSize: 24 }}>＋</span>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>트랙 추가</span>
                        {!isPro && tracks.length >= MAX_FREE && <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 800, padding: '2px 6px', border: '1px solid #fbbf24', borderRadius: 20 }}>PRO 필요</span>}
                        {!isPro && tracks.length < MAX_FREE && <span style={{ fontSize: 9, color: C.muted2 }}>{MAX_FREE - tracks.length}개 남음</span>}
                      </label>
                    </div>
                  </div>
                </div>

                {/* ══ VU METER PANEL ════════════════════════════════════ */}
                <div style={{ width: 300, flexShrink: 0, position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Panel header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: C.sub }}>VU METER</span>
                    <span style={{ fontSize: 9, color: playing ? C.accent : C.sub, fontWeight: 700 }}>
                      {playing ? '● LIVE' : '● IDLE'}
                    </span>
                  </div>

                  {/* Analog dial — dark chassis */}
                  <div style={{ background: '#111', borderRadius: 12, padding: '12px 12px 8px', border: `1px solid #2a2a2a` }}>
                    <canvas
                      ref={el => { vuCanvasRef.current = el }}
                      width={VU_W} height={VU_H}
                      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 4 }}
                    />
                    {/* L/R legend */}
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 20, height: 2, background: '#111', border: '0.5px solid #888' }} />
                        <span style={{ fontSize: 9, color: '#666' }}>L 채널</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 20, height: 2, background: '#1a4a8a' }} />
                        <span style={{ fontSize: 9, color: '#666' }}>R 채널</span>
                      </div>
                    </div>
                  </div>

                  {/* VU Peak + PEAK LED */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, color: C.sub, marginBottom: 4 }}>VU Peak (합산)</div>
                      <div>
                        <span ref={el => { vuPeakElRef.current = el }}
                          style={{ fontSize: 36, fontWeight: 400, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                          {vuPeakMax !== null ? (vuPeakMax > 0 ? '+' : '') + vuPeakMax.toFixed(2) : '—'}
                        </span>
                        <span style={{ fontSize: 12, color: C.sub }}> VU</span>
                      </div>
                      <div style={{ fontSize: 9, color: vuPeakMax !== null && vuPeakMax >= 0 ? '#ef4444' : C.sub, marginTop: 4 }}>
                        {vuPeakMax !== null && vuPeakMax >= 0 ? '⚠ 0 VU 초과 — 레벨 낮추세요' : '최고점 홀드 · 0 VU 미만 유지'}
                      </div>
                      <button onClick={resetVuPeak}
                        style={{ fontSize: 9, color: C.sub, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, padding: 0, marginTop: 4, fontFamily: 'inherit' }}>
                        ↺ 리셋
                      </button>
                    </div>

                    {/* PEAK LED */}
                    <div style={{ width: 64, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
                      <div ref={el => { olLedRef.current = el }}
                        style={{ width: 16, height: 16, borderRadius: '50%', background: '#2a0000', border: '1px solid #400', transition: '.12s' }} />
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.sub, letterSpacing: '.06em' }}>PEAK</div>
                      <div style={{ fontSize: 8, color: C.muted2, textAlign: 'center', lineHeight: 1.4 }}>0 VU<br />초과</div>
                    </div>
                  </div>

                  {/* 0 VU 기준 안내 */}
                  <div style={{ fontSize: 9, color: C.muted2, textAlign: 'center', lineHeight: 1.6 }}>
                    기준: 0 VU = {VU_REF} dBFS · 검정 바늘 L · 파란 바늘 R
                  </div>
                </div>

              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

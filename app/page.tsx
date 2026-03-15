**`next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

---

**`app/page.tsx`**

```tsx
'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef, useCallback } from 'react'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)
const ENGINE_URL = "https://thisismidi-thisismidi-mastering-engine.hf.space/master"

const formatTime = (t: number) => {
  if (!t || isNaN(t) || !isFinite(t)) return '0:00'
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type BatchStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error'

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE')
  const [isLightMode, setIsLightMode] = useState(false)

  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{ [key: number]: string }>({})
  const [batchStatus, setBatchStatus] = useState<{ [key: number]: BatchStatus }>({})
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)
  const origMeterData = useRef({ sum: 0, samples: 0, maxPeak: 0 })
  const mastMeterData = useRef({ sum: 0, samples: 0, maxPeak: 0 })

  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)
  const [abSyncMode, setAbSyncMode] = useState(false)

  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")
  const [outFormat, setOutFormat] = useState("MP3")
  const [outSampleRate, setOutSampleRate] = useState("44100")
  const [outBitDepth, setOutBitDepth] = useState("16")

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceNodes = useRef<Map<HTMLAudioElement, { source: MediaElementAudioSourceNode; analyzer: AnalyserNode }>>(new Map())
  const origRafRef = useRef<number | null>(null)
  const mastRafRef = useRef<number | null>(null)
  const abTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [currentOrigUrl, setCurrentOrigUrl] = useState('')
  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  useEffect(() => {
    document.title = "THISISMIDI Mastering AI"
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      handleUser(session?.user ?? null)
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => handleUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const handleUser = (u: any) => {
    setUser(u)
    if (u?.email === 'itsfreiar@gmail.com') setTier('DEVELOPER')
    else if (u?.app_metadata?.is_pro) setTier('PRO')
    else setTier('FREE')
  }

  useEffect(() => {
    if (!isPro) { setOutFormat("MP3"); setOutSampleRate("44100"); setOutBitDepth("16") }
  }, [isPro])

  useEffect(() => {
    if (files[activeIndex]) {
      const url = URL.createObjectURL(files[activeIndex])
      setCurrentOrigUrl(url)
      origMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
      mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
      setOrigLufs(-70); setOrigTp(-70); setMastLufs(-70); setMastTp(-70)
      setOrigTime(0); setMastTime(0)
      return () => URL.revokeObjectURL(url)
    } else {
      setCurrentOrigUrl('')
    }
  }, [files, activeIndex])

  const ensureAudioRouting = (audio: HTMLAudioElement) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    const ctx = audioCtxRef.current
    if (!sourceNodes.current.has(audio)) {
      try {
        const source = ctx.createMediaElementSource(audio)
        const analyzer = ctx.createAnalyser()
        analyzer.fftSize = 2048
        source.connect(analyzer)
        analyzer.connect(ctx.destination)
        sourceNodes.current.set(audio, { source, analyzer })
      } catch (e) { console.error("Audio routing error:", e) }
    }
    return sourceNodes.current.get(audio)?.analyzer
  }

  const startAnalyzing = (audio: HTMLAudioElement, type: 'orig' | 'mast') => {
    const analyzer = ensureAudioRouting(audio)
    if (!analyzer) return
    const rafRef = type === 'orig' ? origRafRef : mastRafRef
    const meterData = type === 'orig' ? origMeterData : mastMeterData
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const update = () => {
      const data = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(data)
      let peak = 0, sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]); if (v > peak) peak = v
        sum += data[i] * data[i]
      }
      meterData.current.sum += sum
      meterData.current.samples += data.length
      if (peak > meterData.current.maxPeak) meterData.current.maxPeak = peak
      const tp = meterData.current.maxPeak > 0 ? 20 * Math.log10(meterData.current.maxPeak) : -70
      const avgRms = Math.sqrt(meterData.current.sum / meterData.current.samples)
      const lufs = avgRms > 0 ? 20 * Math.log10(avgRms) - 0.691 : -70
      if (type === 'orig') { setOrigLufs(Math.round(lufs * 10) / 10); setOrigTp(Math.round(tp * 10) / 10) }
      else { setMastLufs(Math.round(lufs * 10) / 10); setMastTp(Math.round(tp * 10) / 10) }
      rafRef.current = requestAnimationFrame(update)
    }
    update()
  }

  const stopAnalyzing = (type: 'orig' | 'mast') => {
    const rafRef = type === 'orig' ? origRafRef : mastRafRef
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return
    if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume()
    if (type === 'orig') {
      if (origIsPlaying) {
        audio.pause(); stopAnalyzing('orig'); setOrigIsPlaying(false)
      } else {
        mastAudioRef.current?.pause(); stopAnalyzing('mast'); setMastIsPlaying(false)
        try { await audio.play(); startAnalyzing(audio, 'orig'); setOrigIsPlaying(true) }
        catch (e) { console.error("Playback failed:", e) }
      }
    } else {
      if (mastIsPlaying) {
        audio.pause(); stopAnalyzing('mast'); setMastIsPlaying(false)
      } else {
        origAudioRef.current?.pause(); stopAnalyzing('orig'); setOrigIsPlaying(false)
        try { await audio.play(); startAnalyzing(audio, 'mast'); setMastIsPlaying(true) }
        catch (e) { console.error("Playback failed:", e) }
      }
    }
  }

  const stopAbSync = useCallback(() => {
    setAbSyncMode(false)
    if (abTimerRef.current) clearTimeout(abTimerRef.current)
    origAudioRef.current?.pause(); stopAnalyzing('orig'); setOrigIsPlaying(false)
    mastAudioRef.current?.pause(); stopAnalyzing('mast'); setMastIsPlaying(false)
  }, [])

  const runAbCycle = useCallback(async (startTime: number, playingOrig: boolean) => {
    const orig = origAudioRef.current
    const mast = mastAudioRef.current
    if (!orig || !mast) return
    if (playingOrig) {
      mast.pause(); stopAnalyzing('mast'); setMastIsPlaying(false)
      orig.currentTime = startTime
      try { await orig.play(); startAnalyzing(orig, 'orig'); setOrigIsPlaying(true) } catch (e) { return }
    } else {
      orig.pause(); stopAnalyzing('orig'); setOrigIsPlaying(false)
      mast.currentTime = startTime
      try { await mast.play(); startAnalyzing(mast, 'mast'); setMastIsPlaying(true) } catch (e) { return }
    }
    abTimerRef.current = setTimeout(() => {
      runAbCycle(startTime, !playingOrig)
    }, 3000)
  }, [])

  const toggleAbSync = async () => {
    if (abSyncMode) { stopAbSync(); return }
    if (!masteredUrls[activeIndex]) return
    if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume()
    setAbSyncMode(true)
    const startTime = origAudioRef.current?.currentTime || 0
    runAbCycle(startTime, true)
  }

  const handleSeek = (type: 'orig' | 'mast', ratio: number) => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    const duration = type === 'orig' ? origDuration : mastDuration
    if (!audio || !duration) return
    audio.currentTime = ratio * duration
    if (type === 'orig') origMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
    else mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
  }

  const drawWave = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const buf = typeof file === 'string' ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const tCtx = new AudioContext()
      const audioBuf = await tCtx.decodeAudioData(buf)
      const data = audioBuf.getChannelData(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      const step = Math.floor(data.length / canvas.width)
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          const v = data[i * step + j]; if (v < min) min = v; if (v > max) max = v
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2)
        ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await tCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current)
      drawWave(files[activeIndex], origCanvas.current, isLightMode ? '#10b981' : '#4ade80')
    if (masteredUrls[activeIndex] && mastCanvas.current)
      drawWave(masteredUrls[activeIndex], mastCanvas.current, isLightMode ? '#2563eb' : '#3b82f6')
  }, [files, activeIndex, isLightMode, masteredUrls])

  const masterSingle = async (index: number): Promise<string | null> => {
    const file = files[index]
    if (!file) return null
    const fd = new FormData()
    fd.append("file", file)
    fd.append("target_lufs", targetLufs)
    fd.append("true_peak", truePeak)
    fd.append("warmth", warmth)
    fd.append("stereo_width", stereoWidth)
    fd.append("mono_bass", monoBass)
    fd.append("out_format", outFormat)
    fd.append("out_sample_rate", outSampleRate)
    fd.append("out_bit_depth", outBitDepth)
    const resp = await fetch(ENGINE_URL, { method: "POST", body: fd })
    if (!resp.ok) throw new Error(`Server error ${resp.status}`)
    const blob = await resp.blob()
    return URL.createObjectURL(blob)
  }

  const runMastering = async () => {
    if (!files[activeIndex]) return
    setIsProcessing(true)
    setBatchStatus(p => ({ ...p, [activeIndex]: 'processing' }))
    try {
      const url = await masterSingle(activeIndex)
      if (url) {
        setMasteredUrls(p => ({ ...p, [activeIndex]: url }))
        setBatchStatus(p => ({ ...p, [activeIndex]: 'done' }))
        mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
      }
    } catch (e) {
      alert(`마스터링 실패: ${(e as Error).message}`)
      setBatchStatus(p => ({ ...p, [activeIndex]: 'error' }))
    } finally { setIsProcessing(false) }
  }

  const runBatchMastering = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    const pendingIndices = files.map((_, i) => i).filter(i => !masteredUrls[i])
    setBatchStatus(prev => {
      const next = { ...prev }
      pendingIndices.forEach(i => { next[i] = 'queued' })
      return next
    })
    for (const i of pendingIndices) {
      setBatchStatus(p => ({ ...p, [i]: 'processing' }))
      setActiveIndex(i)
      try {
        const url = await masterSingle(i)
        if (url) {
          setMasteredUrls(p => ({ ...p, [i]: url }))
          setBatchStatus(p => ({ ...p, [i]: 'done' }))
        }
      } catch {
        setBatchStatus(p => ({ ...p, [i]: 'error' }))
      }
    }
    setIsProcessing(false)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'))
    if (dropped.length > 0) setFiles(prev => [...prev, ...dropped])
  }, [])

  const getDownloadName = () => {
    if (!files[activeIndex]) return 'Mastered.mp3'
    const base = files[activeIndex].name.split('.').slice(0, -1).join('.')
    return `${base}_Mastered.${outFormat.toLowerCase()}`
  }

  const statusIcon = (i: number) => {
    const s = batchStatus[i]
    if (s === 'done') return '✓'
    if (s === 'processing') return '⟳'
    if (s === 'queued') return '…'
    if (s === 'error') return '✕'
    return ''
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="workspace">
        <header className="main-header">
          <div className="brand">THISISMIDI <span className="accent">.</span></div>
          <div className="user-area">
            {user && <span className="tier-label">{tier}</span>}
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-icon">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user
              ? <button onClick={() => supabase.auth.signOut()} className="btn-text">LOGOUT</button>
              : <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })} className="btn-text">LOGIN</button>
            }
          </div>
        </header>

        {!user ? (
          <div className="auth-hero">
            <h1>Mastering,<br />Simplified.</h1>
            <button onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })} className="btn-prime">Start with Google</button>
          </div>
        ) : (
          <div className="vertical-layout">

            {/* 1. Track Queue */}
            <section className="panel queue-panel">
              <div className="panel-top">
                <h3>Track Queue</h3>
                <span>{files.length} track{files.length !== 1 ? 's' : ''}</span>
              </div>
              <div
                className={`upload-container ${isDragging ? 'dragging' : ''}`}
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
              >
                <input
                  type="file" id="u-file" hidden multiple accept="audio/*"
                  onChange={(e) => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                />
                <label htmlFor="u-file" className="drop-area">
                  {isDragging ? '🎵 Drop to add tracks' : 'Drop audio files here — or click UPLOAD'}
                </label>
                <div className="action-row">
                  <label htmlFor="u-file" className="btn-sub">UPLOAD</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={runMastering} className="btn-prime" disabled={isProcessing || !files[activeIndex]} style={{ flex: 1 }}>
                      {isProcessing && batchStatus[activeIndex] === 'processing' ? 'PROCESSING...' : 'MASTER THIS'}
                    </button>
                    <button onClick={runBatchMastering} className="btn-prime btn-batch" disabled={isProcessing || files.length === 0} title="큐 전체 마스터링">
                      {isProcessing ? 'BATCH...' : `MASTER ALL (${files.length})`}
                    </button>
                  </div>
                </div>
              </div>

              <ul className="track-list">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className={`${activeIndex === i ? 'active' : ''} status-${batchStatus[i] || 'idle'}`}
                    onClick={() => { setActiveIndex(i); setOrigIsPlaying(false); setMastIsPlaying(false) }}
                  >
                    <span className="status-icon">{statusIcon(i)}</span>
                    <span className="track-name">{i + 1}. {f.name}</span>
                    {masteredUrls[i] && (
                      
                        href={masteredUrls[i]}
                        download={`${f.name.split('.').slice(0, -1).join('.')}_Mastered.${outFormat.toLowerCase()}`}
                        className="track-dl"
                        onClick={e => e.stopPropagation()}
                      >↓</a>
                    )}
                  </li>
                ))}
                {files.length === 0 && <li className="empty-hint">업로드된 트랙이 없습니다</li>}
              </ul>
            </section>

            {/* 2. A/B Monitor */}
            <section className="panel monitor-panel">
              <div className="panel-top">
                <h3>A/B Monitor</h3>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={toggleAbSync}
                    className={`btn-ab ${abSyncMode ? 'ab-active' : ''}`}
                    disabled={!masteredUrls[activeIndex]}
                    title="현재 위치에서 Original↔Mastered 3초씩 번갈아 비교"
                  >
                    {abSyncMode ? '⏹ STOP A/B' : '⇄ A/B SYNC'}
                  </button>
                  <span className="selected-info">{files[activeIndex]?.name || 'None'}</span>
                </div>
              </div>

              <div className="monitor-row">
                <div className="m-controls">
                  <p className="m-label" style={{ color: 'var(--acc)' }}>Original</p>
                  <div className="stats">LUFS: {origLufs}<br />TP: {origTp}</div>
                  <button onClick={() => togglePlay('orig')} className="btn-p">
                    {origIsPlaying ? '⏸ PAUSE' : '▶ PLAY'}
                  </button>
                </div>
                <div className="wave-col">
                  <div className="wave-box" onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    handleSeek('orig', (e.clientX - rect.left) / rect.width)
                  }}>
                    <canvas ref={origCanvas} width={1000} height={140} />
                    <div className="seeker" style={{ left: origDuration > 0 ? `${(origTime / origDuration) * 100}%` : '0%' }} />
                  </div>
                  <div className="seek-row">
                    <span className="t-lbl">{formatTime(origTime)}</span>
                    <input type="range" className="seek-slider" min={0} max={origDuration || 0} step={0.05} value={origTime}
                      onChange={(e) => handleSeek('orig', Number(e.target.value) / (origDuration || 1))} />
                    <span className="t-lbl">{formatTime(origDuration)}</span>
                  </div>
                </div>
                <audio ref={origAudioRef} src={currentOrigUrl}
                  onTimeUpdate={(e) => setOrigTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setOrigDuration(e.currentTarget.duration)}
                  onEnded={() => { stopAnalyzing('orig'); setOrigIsPlaying(false) }} />
              </div>

              <div className="monitor-row mt-20">
                <div className="m-controls">
                  <p className="m-label color-m">Mastered</p>
                  <div className="stats">LUFS: {mastLufs}<br />TP: {mastTp}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <button onClick={() => togglePlay('mast')} className="btn-p" disabled={!masteredUrls[activeIndex]}>
                      {mastIsPlaying ? '⏸ PAUSE' : '▶ PLAY'}
                    </button>
                    {masteredUrls[activeIndex] && (
                      <a href={masteredUrls[activeIndex]} download={getDownloadName()} className="btn-p download" style={{ textAlign: 'center' }}>
                        ↓ SAVE
                      </a>
                    )}
                  </div>
                </div>
                <div className="wave-col">
                  <div className="wave-box" onClick={(e) => {
                    if (!masteredUrls[activeIndex]) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    handleSeek('mast', (e.clientX - rect.left) / rect.width)
                  }}>
                    <canvas ref={mastCanvas} width={1000} height={140} />
                    <div className="seeker" style={{ left: mastDuration > 0 ? `${(mastTime / mastDuration) * 100}%` : '0%' }} />
                    {!masteredUrls[activeIndex] && <div className="no-file-overlay">No mastered file yet</div>}
                  </div>
                  <div className="seek-row">
                    <span className="t-lbl">{formatTime(mastTime)}</span>
                    <input type="range" className="seek-slider" min={0} max={mastDuration || 0} step={0.05} value={mastTime}
                      onChange={(e) => handleSeek('mast', Number(e.target.value) / (mastDuration || 1))}
                      disabled={!masteredUrls[activeIndex]} />
                    <span className="t-lbl">{formatTime(mastDuration)}</span>
                  </div>
                </div>
                <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''}
                  onTimeUpdate={(e) => setMastTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setMastDuration(e.currentTarget.duration)}
                  onEnded={() => { stopAnalyzing('mast'); setMastIsPlaying(false) }} />
              </div>
            </section>

            {/* 3. Mastering Controls */}
            <section className="panel controls-panel">
              <div className="panel-top">
                <h3>Mastering Controls</h3>
                {!isPro && <span style={{ fontSize: '0.75rem', color: 'var(--sec)' }}>Pro Features Locked 🔒</span>}
              </div>
              <div className="control-groups-wrapper">

                <div className="control-group">
                  <p className="g-title">Output Format {!isPro && <span className="lock-note">Free</span>}</p>
                  <div className="sel-box">
                    <label>Format</label>
                    <select className="styled-select" value={outFormat} onChange={(e) => setOutFormat(e.target.value)} disabled={!isPro}>
                      <option value="MP3">MP3</option>
                      <option value="WAV">WAV</option>
                      <option value="FLAC">FLAC</option>
                    </select>
                  </div>
                  <div className="sel-box">
                    <label>Sample Rate</label>
                    <select className="styled-select" value={outSampleRate} onChange={(e) => setOutSampleRate(e.target.value)} disabled={!isPro}>
                      <option value="44100">44.1 kHz</option>
                      <option value="48000">48 kHz</option>
                      <option value="96000">96 kHz</option>
                    </select>
                  </div>
                  <div className="sel-box">
                    <label>Bit Depth</label>
                    <select className="styled-select" value={outBitDepth} onChange={(e) => setOutBitDepth(e.target.value)} disabled={!isPro}>
                      <option value="16">16-bit</option>
                      <option value="24">24-bit</option>
                      <option value="32">32-bit float</option>
                    </select>
                  </div>
                </div>

                <div className="control-group">
                  <p className="g-title">Loudness and Safety</p>
                  <div className="sld-row"><label>Target LUFS</label><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e) => setTargetLufs(e.target.value)} /><span>{targetLufs}</span></div>
                  <div className="sld-row"><label>True Peak Ceiling</label><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e) => setTruePeak(e.target.value)} /><span>{truePeak} dBTP</span></div>
                </div>

                <div className="control-group">
                  <p className="g-title">Tone Character</p>
                  <div className="sld-row"><label>Warmth</label><input type="range" min="0" max="100" value={warmth} onChange={(e) => setWarmth(e.target.value)} disabled={!isPro} /><span>{warmth}%</span></div>
                </div>

                <div className="control-group">
                  <p className="g-title">Stereo and Space</p>
                  <div className="sld-row"><label>Stereo Width</label><input type="range" min="0" max="200" value={stereoWidth} onChange={(e) => setStereoWidth(e.target.value)} disabled={!isPro} /><span>{stereoWidth}%</span></div>
                  <div className="sld-row"><label>Mono Bass Anchor</label><input type="range" min="0" max="100" value={monoBass} onChange={(e) => setMonoBass(e.target.value)} disabled={!isPro} /><span>{monoBass}%</span></div>
                </div>

              </div>
            </section>

          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        :root { --bg: #0d0d0d; --p: #161616; --brd: #262626; --txt: #e5e5e5; --acc: #4ade80; --sec: #888; --err: #ef4444; }
        .light-mode { --bg: #f5f5f7; --p: #ffffff; --brd: #e5e5e7; --txt: #1d1d1f; --acc: #10b981; --sec: #86868b; }

        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .workspace { max-width: 1200px; margin: 0 auto; padding: 20px; }

        .main-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .brand { font-size: 1.4rem; font-weight: 900; letter-spacing: -1px; }
        .accent { color: var(--acc); }
        .user-area { display: flex; align-items: center; gap: 15px; }
        .tier-label { font-size: 0.7rem; font-weight: 800; background: var(--brd); padding: 5px 12px; border-radius: 50px; color: var(--sec); }
        .btn-icon, .btn-text { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 700; transition: 0.15s; }
        .btn-icon:hover, .btn-text:hover { background: var(--brd); }

        .vertical-layout { display: flex; flex-direction: column; gap: 24px; width: 100%; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 14px; padding: 24px; }
        .panel-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--brd); padding-bottom: 14px; margin-bottom: 20px; }
        .panel-top h3 { font-size: 0.95rem; margin: 0; font-weight: 800; letter-spacing: -0.5px; }
        .selected-info { font-size: 0.78rem; color: var(--sec); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .upload-container { background: rgba(0,0,0,0.04); border: 1px solid var(--brd); border-radius: 10px; padding: 18px; margin-bottom: 14px; transition: border-color 0.2s, background 0.2s; }
        .upload-container.dragging { border-color: var(--acc); background: rgba(74,222,128,0.06); }
        .drop-area { display: flex; height: 72px; border: 1.5px dashed var(--sec); border-radius: 8px; align-items: center; justify-content: center; font-size: 0.85rem; color: var(--sec); margin-bottom: 12px; cursor: pointer; transition: 0.2s; }
        .drop-area:hover { border-color: var(--acc); color: var(--acc); }
        .action-row { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: stretch; }
        .btn-prime { background: var(--acc); color: #000; border: none; padding: 11px 16px; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 0.85rem; transition: 0.15s; white-space: nowrap; }
        .btn-prime:hover:not(:disabled) { filter: brightness(1.1); }
        .btn-prime:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-batch { background: var(--txt); color: var(--bg); font-size: 0.78rem; }
        .btn-sub { background: var(--txt); color: var(--bg); border: none; padding: 11px 16px; border-radius: 8px; font-weight: 800; cursor: pointer; text-align: center; font-size: 0.85rem; display: block; white-space: nowrap; }

        .track-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
        .track-list li { padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.82rem; border: 1px solid var(--brd); transition: 0.15s; }
        .track-list li:hover { border-color: var(--acc); }
        .track-list li.active { background: rgba(74,222,128,0.08); border-color: var(--acc); }
        .track-list li.status-done .status-icon { color: var(--acc); }
        .track-list li.status-processing .status-icon { color: #f59e0b; display: inline-block; animation: spin 1s linear infinite; }
        .track-list li.status-queued .status-icon { color: var(--sec); }
        .track-list li.status-error .status-icon { color: var(--err); }
        .status-icon { width: 16px; text-align: center; font-size: 0.82rem; flex-shrink: 0; }
        .track-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .track-dl { color: var(--acc); font-weight: 800; font-size: 0.82rem; text-decoration: none; padding: 2px 7px; border-radius: 4px; border: 1px solid var(--acc); flex-shrink: 0; }
        .track-dl:hover { background: rgba(74,222,128,0.12); }
        .empty-hint { color: var(--sec); font-size: 0.8rem; cursor: default; border-style: dashed !important; justify-content: center; }

        .monitor-row { display: flex; gap: 18px; align-items: flex-start; }
        .m-controls { width: 110px; flex-shrink: 0; padding-top: 2px; }
        .m-label { font-size: 0.82rem; font-weight: 800; margin: 0 0 7px 0; }
        .color-m { color: #3b82f6; }
        .stats { font-size: 0.68rem; color: var(--sec); font-family: monospace; margin-bottom: 10px; line-height: 1.5; }
        .btn-p { width: 100%; padding: 8px; border: none; background: var(--brd); color: var(--txt); border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer; transition: 0.15s; }
        .btn-p:hover:not(:disabled) { background: var(--txt); color: var(--bg); }
        .btn-p.download { background: #3b82f6; color: #fff; text-decoration: none; display: block; margin-top: 5px; }
        .btn-p:disabled { opacity: 0.3; cursor: not-allowed; }

        .btn-ab { background: none; border: 1px solid var(--brd); color: var(--sec); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 0.72rem; font-weight: 800; transition: 0.15s; white-space: nowrap; }
        .btn-ab:hover:not(:disabled) { border-color: var(--acc); color: var(--acc); }
        .btn-ab.ab-active { background: rgba(74,222,128,0.12); border-color: var(--acc); color: var(--acc); }
        .btn-ab:disabled { opacity: 0.3; cursor: not-allowed; }

        .wave-col { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .wave-box { width: 100%; height: 150px; background: rgba(0,0,0,0.04); border: 1px solid var(--brd); border-radius: 8px; position: relative; overflow: hidden; cursor: crosshair; }
        canvas { width: 100%; height: 100%; display: block; }
        .seeker { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--acc); opacity: 0.8; pointer-events: none; }
        .no-file-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; color: var(--sec); font-weight: 600; }

        .seek-row { display: flex; align-items: center; gap: 8px; }
        .seek-slider { flex: 1; height: 2px; accent-color: var(--acc); cursor: pointer; }
        .seek-slider:disabled { opacity: 0.3; cursor: not-allowed; }
        .t-lbl { font-size: 0.68rem; font-family: monospace; color: var(--sec); min-width: 30px; }
        .t-lbl:last-child { text-align: right; }

        .control-groups-wrapper { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
        .control-group { background: rgba(0,0,0,0.02); padding: 18px; border-radius: 10px; border: 1px solid var(--brd); }
        .g-title { font-size: 0.82rem; font-weight: 800; margin: 0 0 16px; color: var(--txt); border-bottom: 1px solid var(--brd); padding-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .lock-note { font-size: 0.65rem; font-weight: 600; color: var(--sec); background: var(--brd); padding: 2px 7px; border-radius: 20px; }
        .sel-box { margin-bottom: 12px; }
        .sel-box label { font-size: 0.73rem; font-weight: 600; color: var(--sec); display: block; margin-bottom: 5px; }
        .styled-select { background: var(--bg); color: var(--txt); border: 1px solid var(--brd); padding: 8px 12px; border-radius: 7px; font-size: 0.8rem; width: 100%; cursor: pointer; appearance: none; -webkit-appearance: none; }
        .styled-select:disabled { opacity: 0.4; cursor: not-allowed; }
        .sld-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .sld-row label { font-size: 0.76rem; width: 110px; flex-shrink: 0; font-weight: 600; color: var(--sec); }
        .sld-row input[type=range] { flex: 1; accent-color: var(--acc); cursor: pointer; }
        .sld-row span { width: 60px; font-size: 0.73rem; text-align: right; color: var(--acc); font-family: monospace; font-weight: bold; }

        .mt-20 { margin-top: 20px; }
        .auth-hero { text-align: center; padding: 140px 0; }
        .auth-hero h1 { font-size: 4rem; letter-spacing: -3px; line-height: 0.9; margin-bottom: 36px; font-weight: 900; }

        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}} />
    </main>
  )
}
```

push하고 빌드 다시 확인해봐!

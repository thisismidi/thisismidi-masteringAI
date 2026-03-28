'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef, useCallback } from 'react'
import JSZip from 'jszip'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase    = createClient(supabaseUrl, supabaseKey)
const ENGINE_URL  = process.env.NEXT_PUBLIC_ENGINE_URL ?? 'https://thisismidi-thisismidi-mastering-engine.hf.space/master'
const DEV_EMAIL   = process.env.NEXT_PUBLIC_DEV_EMAIL  ?? ''
const MAX_MB      = 100

type ToastType = 'success' | 'error' | 'warn' | 'info'
interface Toast { id: number; msg: string; type: ToastType }
type EngineStatus = 'idle' | 'warming' | 'running'

function SliderRow({ label, min, max, step, value, onChange, unit, disabled, accent }: {
  label: string; min: number; max: number; step: number
  value: string; onChange: (v: string) => void; unit: string
  disabled?: boolean; accent?: boolean
}) {
  return (
    <div className="sld-row">
      <label className={accent ? 'sld-label acc' : 'sld-label'}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(e.target.value)} disabled={disabled} />
      <span className="sld-val">{value}{unit}</span>
    </div>
  )
}

export default function Home() {
  const [user, setUser]               = useState<any>(null)
  const [tier, setTier]               = useState('FREE')
  const [isDark, setIsDark]           = useState(true)
  const [isDragOver, setIsDragOver]   = useState(false)

  const [files, setFiles]             = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<Record<number, string>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle')
  const [progress, setProgress]       = useState({ cur: 0, total: 0 })
  const [currentOrigUrl, setCurrentOrigUrl] = useState('')

  const [origLufs, setOrigLufs] = useState(-70); const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70); const [mastTp, setMastTp] = useState(-70)
  const origMeter = useRef({ sum: 0, samples: 0, maxPeak: 0 })
  const mastMeter = useRef({ sum: 0, samples: 0, maxPeak: 0 })

  const [origTime, setOrigTime] = useState(0); const [origDur, setOrigDur] = useState(0)
  const [mastTime, setMastTime] = useState(0); const [mastDur, setMastDur] = useState(0)
  const [origPlaying, setOrigPlaying] = useState(false)
  const [mastPlaying, setMastPlaying] = useState(false)

  const [targetLufs, setTargetLufs]   = useState('-14.0')
  const [truePeak, setTruePeak]       = useState('-1.0')
  const [outputTrim, setOutputTrim]   = useState('0.0')
  const [presence, setPresence]       = useState('0')
  const [warmth, setWarmth]           = useState('0')
  const [treble, setTreble]           = useState('0')
  const [stereoWidth, setStereoWidth] = useState('100')
  const [spaceDepth, setSpaceDepth]   = useState('0')
  const [monoBass, setMonoBass]       = useState('0')
  const [glueComp, setGlueComp]       = useState('0')
  const [outFormat, setOutFormat]     = useState('MP3')
  const [outSR, setOutSR]             = useState('44100')
  const [outBit, setOutBit]           = useState('16')

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas   = useRef<HTMLCanvasElement>(null)
  const mastCanvas   = useRef<HTMLCanvasElement>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const sourceNodes  = useRef<Map<HTMLAudioElement, any>>(new Map())
  const rafIdRef     = useRef<number | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500)
  }, [])

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'
  const progressPct = progress.total > 0 ? (progress.cur / progress.total) * 100 : 0

  useEffect(() => {
    document.title = 'THISISMIDI Mastering AI'
    supabase.auth.getSession().then(({ data: { session } }) => handleUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => handleUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const handleUser = (u: any) => {
    setUser(u)
    if (DEV_EMAIL && u?.email === DEV_EMAIL) setTier('DEVELOPER')
    else if (u?.app_metadata?.is_pro) setTier('PRO')
    else setTier('FREE')
  }

  useEffect(() => {
    if (!isPro) { setOutFormat('MP3'); setOutSR('44100'); setOutBit('16') }
  }, [isPro])

  useEffect(() => {
    if (files[activeIndex]) {
      const url = URL.createObjectURL(files[activeIndex])
      setCurrentOrigUrl(url)
      origMeter.current = { sum: 0, samples: 0, maxPeak: 0 }
      mastMeter.current = { sum: 0, samples: 0, maxPeak: 0 }
      setOrigLufs(-70); setOrigTp(-70); setMastLufs(-70); setMastTp(-70)
      return () => URL.revokeObjectURL(url)
    } else { setCurrentOrigUrl('') }
  }, [files, activeIndex])

  const drawWave = async (src: File | string, canvas: HTMLCanvasElement, color: string) => {
    const ctx = canvas.getContext('2d'); if (!ctx) return
    try {
      const buf = typeof src === 'string'
        ? await (await fetch(src)).arrayBuffer()
        : await src.arrayBuffer()
      const tCtx = new AudioContext()
      const audio = await tCtx.decodeAudioData(buf)
      const data  = audio.getChannelData(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      const step = Math.floor(data.length / canvas.width)
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) { const v = data[i * step + j]; if (v < min) min = v; if (v > max) max = v }
        ctx.moveTo(i, (1 + min) * canvas.height / 2)
        ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await tCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    const origColor = isDark ? '#4ade80' : '#16a34a'
    const mastColor = isDark ? '#60a5fa' : '#2563eb'
    if (files[activeIndex] && origCanvas.current) drawWave(files[activeIndex], origCanvas.current, origColor)
    if (masteredUrls[activeIndex] && mastCanvas.current) drawWave(masteredUrls[activeIndex], mastCanvas.current, mastColor)
  }, [files, activeIndex, isDark, masteredUrls])

  const ensureRouting = (audio: HTMLAudioElement) => {
    if (!audioCtxRef.current) audioCtxRef.current = new ((window as any).AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (!ctx) return
    if (!sourceNodes.current.has(audio)) {
      try {
        const src = ctx.createMediaElementSource(audio)
        const an  = ctx.createAnalyser(); an.fftSize = 2048
        src.connect(an); an.connect(ctx.destination)
        sourceNodes.current.set(audio, { src, an })
      } catch (e) { console.error(e) }
    }
    return sourceNodes.current.get(audio)?.an
  }

  const startAnalyzing = (audio: HTMLAudioElement, type: 'orig' | 'mast') => {
    const an = ensureRouting(audio); if (!an) return
    const tick = () => {
      const data = new Float32Array(an.fftSize); an.getFloatTimeDomainData(data)
      let peak = 0, sum = 0
      for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; sum += data[i] * data[i] }
      const meter = type === 'orig' ? origMeter.current : mastMeter.current
      meter.sum += sum; meter.samples += data.length; if (peak > meter.maxPeak) meter.maxPeak = peak
      const tp   = meter.maxPeak > 0 ? 20 * Math.log10(meter.maxPeak) : -70
      const lufs = Math.sqrt(meter.sum / meter.samples) > 0 ? 20 * Math.log10(Math.sqrt(meter.sum / meter.samples)) - 0.691 : -70
      const r = (v: number) => Math.round(v * 10) / 10
      if (type === 'orig') { setOrigLufs(r(lufs)); setOrigTp(r(tp)) }
      else                 { setMastLufs(r(lufs)); setMastTp(r(tp)) }
      rafIdRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLAudioElement | null>, dur: number, type: 'orig' | 'mast') => {
    if (!ref?.current || !dur) return
    ref.current.currentTime = (e.nativeEvent.offsetX / e.currentTarget.getBoundingClientRect().width) * dur
    if (type === 'orig') origMeter.current = { sum: 0, samples: 0, maxPeak: 0 }
    else                 mastMeter.current = { sum: 0, samples: 0, maxPeak: 0 }
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current; if (!audio) return
    if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume()
    if (type === 'orig') {
      if (origPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current) }
      else { mastAudioRef.current?.pause(); setMastPlaying(false); try { await audio.play(); startAnalyzing(audio, 'orig') } catch {} }
      setOrigPlaying(p => !p)
    } else {
      if (mastPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current) }
      else { origAudioRef.current?.pause(); setOrigPlaying(false); try { await audio.play(); startAnalyzing(audio, 'mast') } catch {} }
      setMastPlaying(p => !p)
    }
  }

  // ── 파일 공통 처리 (클릭 + 드래그 공통 사용)
  const processFiles = (selected: File[]) => {
    const limit    = isPro ? 15 : 1
    const oversize = selected.filter(f => f.size > MAX_MB * 1024 * 1024)
    if (oversize.length > 0) { toast(`파일이 너무 큽니다. 최대 ${MAX_MB}MB (${oversize[0].name})`, 'error'); return }
    if (selected.length > limit) {
      toast(isPro ? '최대 15곡까지 처리 가능합니다.' : '무료 버전은 1곡만 가능합니다. PRO로 업그레이드하세요.', 'warn')
      setFiles(selected.slice(0, limit))
    } else { setFiles(selected) }
    setActiveIndex(0); setMasteredUrls({}); setOrigPlaying(false); setMastPlaying(false)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files || []))
  }

  // ── 드래그 앤 드롭
  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setIsDragOver(false)
  }
  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'))
    if (dropped.length === 0) { toast('오디오 파일만 업로드 가능합니다.', 'warn'); return }
    processFiles(dropped)
  }

  const applyPreset = (genre: string) => {
    if (!isPro) { toast('PRESET 기능은 PRO 전용입니다. 🔒', 'warn'); return }
    const P: Record<string, any> = {
      Hiphop:     { targetLufs: '-9.0',  glueComp: '40', presence: '60', warmth: '70', treble: '30', stereoWidth: '110', spaceDepth: '10' },
      Electronic: { targetLufs: '-8.0',  glueComp: '50', presence: '70', warmth: '20', treble: '60', stereoWidth: '130', spaceDepth: '20' },
      RnB:        { targetLufs: '-12.0', glueComp: '30', presence: '40', warmth: '50', treble: '40', stereoWidth: '115', spaceDepth: '15' },
      Film:       { targetLufs: '-14.0', glueComp: '20', presence: '30', warmth: '40', treble: '20', stereoWidth: '140', spaceDepth: '40' },
      Ambient:    { targetLufs: '-16.0', glueComp: '10', presence: '20', warmth: '30', treble: '10', stereoWidth: '160', spaceDepth: '60' },
    }
    const p = P[genre]; if (!p) return
    setTargetLufs(p.targetLufs); setGlueComp(p.glueComp); setPresence(p.presence)
    setWarmth(p.warmth); setTreble(p.treble); setStereoWidth(p.stereoWidth); setSpaceDepth(p.spaceDepth)
    toast(`${genre === 'RnB' ? 'R&B' : genre === 'Film' ? 'Film Music' : genre} 프리셋 적용됨`, 'success')
  }

  const wakeUpEngine = async (): Promise<void> => {
    setEngineStatus('warming')
    toast('AI 엔진 연결 중... 처음 시작 시 최대 30초 소요될 수 있어요.', 'info')
    const healthUrl = ENGINE_URL.replace('/master', '/')
    const deadline  = Date.now() + 35_000
    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) })
        if (res.ok || res.status === 405) break
      } catch {}
      await new Promise(r => setTimeout(r, 3000))
    }
    setEngineStatus('running')
  }

  const runBatchMastering = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProgress({ cur: 0, total: files.length })
    try {
      const res = await fetch(ENGINE_URL.replace('/master', '/'), { signal: AbortSignal.timeout(4000) })
      if (!res.ok && res.status !== 405) throw new Error('cold')
      setEngineStatus('running')
    } catch {
      await wakeUpEngine()
    }
    for (let i = 0; i < files.length; i++) {
      setActiveIndex(i)
      setProgress({ cur: i + 1, total: files.length })
      const fd = new FormData()
      fd.append('file', files[i])
      fd.append('out_format', outFormat); fd.append('out_sample_rate', outSR); fd.append('out_bit_depth', outBit)
      fd.append('target_lufs', targetLufs); fd.append('true_peak', truePeak); fd.append('output_trim', outputTrim)
      fd.append('presence', presence); fd.append('warmth', warmth); fd.append('treble', treble)
      fd.append('stereo_width', stereoWidth); fd.append('space_depth', spaceDepth)
      fd.append('mono_bass', monoBass); fd.append('glue_comp', glueComp)
      try {
        const res = await fetch(ENGINE_URL, { method: 'POST', body: fd })
        if (!res.ok) throw new Error('engine error')
        const blob = await res.blob()
        setMasteredUrls(p => ({ ...p, [i]: URL.createObjectURL(blob) }))
        mastMeter.current = { sum: 0, samples: 0, maxPeak: 0 }
        toast(`✓ ${files[i].name}`, 'success')
      } catch {
        toast(`처리 실패: ${files[i].name}`, 'error')
      }
    }
    setIsProcessing(false)
    setEngineStatus('idle')
    setProgress({ cur: 0, total: 0 })
    if (files.length > 1) toast(`전체 ${files.length}곡 마스터링 완료!`, 'success')
  }

  const downloadZip = async () => {
    const keys = Object.keys(masteredUrls); if (keys.length === 0) return
    toast('ZIP 압축 중...', 'info')
    const zip = new JSZip()
    for (const key of keys) {
      const i    = Number(key)
      const name = files[i].name.split('.').slice(0, -1).join('.') + `_Mastered.${outFormat.toLowerCase()}`
      try { const blob = await (await fetch(masteredUrls[i])).blob(); zip.file(name, blob) } catch {}
    }
    const content = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = 'Mastered_Tracks.zip'; a.click()
    toast('ZIP 다운로드 시작!', 'success')
  }

  const getDownloadName = () => {
    if (!files[activeIndex]) return 'Mastered.mp3'
    return files[activeIndex].name.split('.').slice(0, -1).join('.') + `_Mastered.${outFormat.toLowerCase()}`
  }

  const fmt = (t: number) => {
    if (isNaN(t) || !isFinite(t)) return '00:00'
    return `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`
  }

  const btnLabel = () => {
    if (engineStatus === 'warming') return '⚡ ENGINE WARMING UP...'
    if (isProcessing && progress.total > 1) return `PROCESSING ${progress.cur} / ${progress.total}`
    if (isProcessing) return 'PROCESSING...'
    return files.length > 1 ? `MASTER ALL ${files.length} TRACKS` : 'START MASTERING'
  }

  return (
    <main className={isDark ? 'dark' : 'light'}>
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>

      <div className="ws">
        <header className="hd">
          <div className="brand">THISISMIDI <span className="acc">.</span></div>
          <div className="hd-right">
            {user && <span className="tier-chip">{tier}</span>}
            {engineStatus === 'warming' && <span className="eng-chip warm">⚡ WARMING</span>}
            {engineStatus === 'running' && <span className="eng-chip run">● LIVE</span>}
            <button className="btn-sm" onClick={() => setIsDark(d => !d)}>{isDark ? '☀ LIGHT' : '☾ DARK'}</button>
            {user
              ? <button className="btn-sm" onClick={() => supabase.auth.signOut()}>LOGOUT</button>
              : <button className="btn-sm" onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>LOGIN</button>
            }
          </div>
        </header>

        {!user ? (
          <div className="hero">
            <p className="hero-eyebrow">Professional AI Audio Mastering</p>
            <h1 className="hero-title">Mastering,<br />Simplified.</h1>
            <button className="btn-prime" onClick={() => supabase.auth.signInWithOAuth({ provider: 'google' })}>
              Start with Google →
            </button>
          </div>
        ) : (
          <div className="layout">

            <section className="panel">
              <div className="panel-top">
                <h3>Track Queue</h3>
                <span>{files.length} / {isPro ? 15 : 1} tracks</span>
              </div>
              <input type="file" id="u-file" hidden multiple onChange={handleFileUpload} accept="audio/*" />
              <label
                htmlFor="u-file"
                className={`drop-zone${isDragOver ? ' drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <span className="drop-icon">{isDragOver ? '📂' : '🎵'}</span>
                <span className="drop-main">{isDragOver ? '여기에 놓으세요!' : 'Drop audio files here or click to browse'}</span>
                <span className="drop-sub">MP3 · WAV · FLAC · AIFF &nbsp;|&nbsp; Max {MAX_MB}MB per file</span>
              </label>

              <div className="action-row">
                <label htmlFor="u-file" className="btn-sec">UPLOAD</label>
                <button className="btn-prime" onClick={runBatchMastering} disabled={isProcessing || files.length === 0}>
                  {btnLabel()}
                </button>
              </div>

              {engineStatus === 'warming' && (
                <div className="cold-notice">
                  <span className="spin" />
                  AI 엔진을 깨우는 중입니다. 처음 실행 시 최대 30초 소요될 수 있어요.
                </div>
              )}
              {isProcessing && progress.total > 0 && (
                <div className="prog-track">
                  <div className="prog-bar" style={{ width: `${progressPct}%` }} />
                  <span className="prog-label">{Math.round(progressPct)}%</span>
                </div>
              )}
              {Object.keys(masteredUrls).length > 1 && (
                <button className="btn-zip" onClick={downloadZip}>📥 DOWNLOAD ALL AS ZIP</button>
              )}
              <ul className="track-list">
                {files.map((f, i) => (
                  <li key={i}
                    className={`track-item${activeIndex === i ? ' active' : ''}`}
                    onClick={() => { setActiveIndex(i); setOrigPlaying(false); setMastPlaying(false) }}>
                    <span className="t-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="t-name">{f.name}</span>
                    {isProcessing && progress.cur === i + 1 && engineStatus === 'running' && <span className="t-badge proc">◎</span>}
                    {masteredUrls[i] && <span className="t-badge done">✓</span>}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <div className="panel-top">
                <h3>A / B Monitor</h3>
                <span>{files[activeIndex]?.name || '—'}</span>
              </div>
              <div className="mon-row">
                <div className="mon-ctrl">
                  <p className="mon-label orig-lbl">Original</p>
                  <div className="meter-box">
                    <div className="meter-row"><span>LUFS</span><span className="mval">{origLufs}</span></div>
                    <div className="meter-row"><span>TP</span><span className="mval">{origTp}</span></div>
                  </div>
                  <button className="btn-play" onClick={() => togglePlay('orig')}>
                    {origPlaying ? '■ STOP' : '▶ PLAY'}
                  </button>
                </div>
                <div className="mon-wave">
                  <div className="time-row">{fmt(origTime)} / {fmt(origDur)}</div>
                  <div className="wave-box" onClick={e => handleSeek(e, origAudioRef, origDur, 'orig')}>
                    <canvas ref={origCanvas} width={1000} height={140} />
                    <div className="seeker sk-orig" style={{ left: origDur > 0 ? `${(origTime / origDur) * 100}%` : '0' }} />
                  </div>
                </div>
                <audio ref={origAudioRef} src={currentOrigUrl}
                  onTimeUpdate={e => setOrigTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={e => setOrigDur(e.currentTarget.duration)}
                  onEnded={() => setOrigPlaying(false)} />
              </div>
              <div className="mon-row" style={{ marginTop: 20 }}>
                <div className="mon-ctrl">
                  <p className="mon-label mast-lbl">Mastered</p>
                  <div className="meter-box">
                    <div className="meter-row"><span>LUFS</span><span className="mval pro">{mastLufs}</span></div>
                    <div className="meter-row"><span>TP</span><span className="mval pro">{mastTp}</span></div>
                  </div>
                  <button className="btn-play" onClick={() => togglePlay('mast')} disabled={!masteredUrls[activeIndex]}>
                    {mastPlaying ? '■ STOP' : '▶ PLAY'}
                  </button>
                  {masteredUrls[activeIndex] && (
                    <a className="btn-dl" href={masteredUrls[activeIndex]} download={getDownloadName()}>↓ DOWNLOAD</a>
                  )}
                </div>
                <div className="mon-wave">
                  <div className="time-row">{fmt(mastTime)} / {fmt(mastDur)}</div>
                  <div className="wave-box" onClick={e => handleSeek(e, mastAudioRef, mastDur, 'mast')}>
                    <canvas ref={mastCanvas} width={1000} height={140} />
                    <div className="seeker sk-mast" style={{ left: mastDur > 0 ? `${(mastTime / mastDur) * 100}%` : '0' }} />
                    {!masteredUrls[activeIndex] && <div className="no-file">No mastered file yet</div>}
                  </div>
                </div>
                <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''}
                  onTimeUpdate={e => setMastTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={e => setMastDur(e.currentTarget.duration)}
                  onEnded={() => setMastPlaying(false)} />
              </div>
            </section>

            <section className="panel">
              <div className="panel-top">
                <h3>Mastering Presets</h3>
                {!isPro && <span className="lock">PRO ONLY 🔒</span>}
              </div>
              <div className="preset-grid">
                {[
                  { key: 'Hiphop',     icon: '🎤', label: 'Hiphop'     },
                  { key: 'Electronic', icon: '⚡', label: 'Electronic' },
                  { key: 'RnB',        icon: '🎸', label: 'R&B'        },
                  { key: 'Film',       icon: '🎬', label: 'Film Music'  },
                  { key: 'Ambient',    icon: '🌊', label: 'Ambient'     },
                ].map(({ key, icon, label }) => (
                  <button key={key} className="btn-preset" onClick={() => applyPreset(key)} disabled={!isPro}>
                    <span className="p-icon">{icon}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-top">
                <h3>Mastering Controls</h3>
                {!isPro && <span className="lock">PRO ONLY 🔒</span>}
              </div>
              <div className="ctrl-grid">
                <div className="ctrl-group">
                  <p className="g-title">Output Format</p>
                  <div className="sel-row"><label>Format</label>
                    <select className="sel" value={outFormat} onChange={e => setOutFormat(e.target.value)} disabled={!isPro}>
                      <option value="MP3">MP3</option>
                      {isPro && <><option value="WAV">WAV</option><option value="FLAC">FLAC</option></>}
                    </select>
                  </div>
                  <div className="sel-row"><label>Sample Rate</label>
                    <select className="sel" value={outSR} onChange={e => setOutSR(e.target.value)} disabled={!isPro}>
                      <option value="44100">44.1 kHz</option>
                      {isPro && <><option value="48000">48 kHz</option><option value="96000">96 kHz</option></>}
                    </select>
                  </div>
                  <div className="sel-row"><label>Bit Depth</label>
                    <select className="sel" value={outBit} onChange={e => setOutBit(e.target.value)} disabled={!isPro}>
                      <option value="16">16-bit</option>
                      {isPro && <><option value="24">24-bit</option><option value="32">32-bit float</option></>}
                    </select>
                  </div>
                </div>
                <div className="ctrl-group">
                  <p className="g-title">Loudness &amp; Safety</p>
                  <SliderRow label="Target LUFS"  min={-24} max={-6}  step={0.5} value={targetLufs}  onChange={setTargetLufs}  unit=""      />
                  <SliderRow label="True Peak"    min={-3}  max={0}   step={0.1} value={truePeak}    onChange={setTruePeak}    unit=" dBTP" />
                  <SliderRow label="Output Trim"  min={-6}  max={6}   step={0.1} value={outputTrim}  onChange={setOutputTrim}  unit=" dB"   disabled={!isPro} />
                  <SliderRow label="Presence"     min={0}   max={100} step={1}   value={presence}    onChange={setPresence}    unit="%"     disabled={!isPro} accent />
                </div>
                <div className="ctrl-group">
                  <p className="g-title">Tone Character</p>
                  <SliderRow label="Warmth"       min={0} max={100} step={1} value={warmth}  onChange={setWarmth}  unit="%" disabled={!isPro} />
                  <SliderRow label="Treble (Air)" min={0} max={100} step={1} value={treble}  onChange={setTreble}  unit="%" disabled={!isPro} />
                </div>
                <div className="ctrl-group">
                  <p className="g-title">Stereo, Space &amp; Dynamics</p>
                  <SliderRow label="Stereo Width" min={0}   max={200} step={1} value={stereoWidth} onChange={setStereoWidth} unit="%" disabled={!isPro} />
                  <SliderRow label="Space Depth"  min={0}   max={100} step={1} value={spaceDepth}  onChange={setSpaceDepth}  unit="%" disabled={!isPro} />
                  <SliderRow label="Mono Bass"    min={0}   max={100} step={1} value={monoBass}    onChange={setMonoBass}    unit="%" disabled={!isPro} />
                  <SliderRow label="Vari-Mu Glue" min={0}   max={100} step={1} value={glueComp}    onChange={setGlueComp}    unit="%" disabled={!isPro} accent />
                </div>
              </div>
            </section>

          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .dark {
          --bg: #080808; --sur: #111111; --sur2: #171717; --brd: #242424;
          --txt: #ebebeb; --txt2: #777777; --acc: #4ade80; --acc2: #60a5fa;
          --acc-bg: rgba(74,222,128,0.08); --danger: #f87171; --warn: #fbbf24;
        }
        .light {
          --bg: #f0f0f0; --sur: #ffffff; --sur2: #f7f7f8; --brd: #e0e0e3;
          --txt: #0a0a0a; --txt2: #555555; --acc: #16a34a; --acc2: #2563eb;
          --acc-bg: rgba(22,163,74,0.07); --danger: #dc2626; --warn: #b45309;
        }
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--bg); color: var(--txt); font-family: -apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; transition: background .25s, color .25s; }
        button, select, label { font-family: inherit; }
        .toast-wrap { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
        .toast { padding: 11px 16px; border-radius: 8px; font-size: 0.78rem; font-weight: 600; border: 1px solid; max-width: 300px; animation: toastIn .25s ease; pointer-events: auto; }
        .toast-success { background: rgba(74,222,128,.12); border-color: #4ade80; color: var(--txt); }
        .toast-error   { background: rgba(248,113,113,.12); border-color: #f87171; color: var(--txt); }
        .toast-warn    { background: rgba(251,191,36,.12); border-color: #fbbf24; color: var(--txt); }
        .toast-info    { background: rgba(96,165,250,.12); border-color: #60a5fa; color: var(--txt); }
        .light .toast  { color: #0a0a0a; }
        @keyframes toastIn { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
        .ws     { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .layout { display: flex; flex-direction: column; gap: 20px; }
        .hd       { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
        .brand    { font-size: 1.1rem; font-weight: 800; letter-spacing: 0.5px; color: var(--txt); }
        .acc      { color: var(--acc); }
        .hd-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .tier-chip { font-size: .65rem; font-weight: 800; letter-spacing: 1px; padding: 3px 10px; border-radius: 50px; background: var(--sur2); border: 1px solid var(--brd); color: var(--txt2); }
        .eng-chip  { font-size: .65rem; font-weight: 800; letter-spacing: .5px; padding: 3px 10px; border-radius: 50px; border: 1px solid; }
        .eng-chip.warm { background: rgba(251,191,36,.1); border-color: #fbbf24; color: #fbbf24; }
        .eng-chip.run  { background: rgba(74,222,128,.1); border-color: var(--acc); color: var(--acc); }
        .btn-sm   { background: var(--sur); border: 1px solid var(--brd); color: var(--txt); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: .72rem; font-weight: 700; letter-spacing: .5px; transition: .15s; }
        .btn-sm:hover { background: var(--sur2); border-color: var(--txt2); }
        .panel     { background: var(--sur); border: 1px solid var(--brd); border-radius: 12px; padding: 22px; }
        .panel-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--brd); padding-bottom: 14px; margin-bottom: 18px; }
        .panel-top h3 { font-size: .78rem; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--txt); }
        .panel-top span { font-size: .72rem; color: var(--txt2); }
        .lock { font-size: .65rem; background: var(--sur2); border: 1px solid var(--brd); padding: 2px 8px; border-radius: 50px; color: var(--txt2); }
        .drop-zone  { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 88px; border: 1px dashed var(--brd); border-radius: 8px; cursor: pointer; transition: .2s; background: var(--sur2); padding: 20px; }
        .drop-zone:hover { border-color: var(--acc); background: var(--acc-bg); }
        .drop-zone.drag-over { border-color: var(--acc); background: var(--acc-bg); border-style: solid; transform: scale(1.01); }
        .drop-icon  { font-size: 1.6rem; transition: .2s; }
        .drop-main  { font-size: .83rem; font-weight: 600; color: var(--txt); }
        .drop-sub   { font-size: .7rem; color: var(--txt2); }
        .action-row { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 12px; }
        .btn-prime  { background: var(--acc); color: #000; border: none; padding: 11px; border-radius: 6px; font-weight: 800; font-size: .78rem; letter-spacing: .5px; cursor: pointer; transition: .15s; }
        .btn-prime:hover:not(:disabled) { filter: brightness(1.12); }
        .btn-prime:disabled { opacity: .45; cursor: not-allowed; }
        .btn-sec    { background: var(--sur2); color: var(--txt); border: 1px solid var(--brd); padding: 11px; border-radius: 6px; font-weight: 800; font-size: .78rem; letter-spacing: .5px; cursor: pointer; transition: .15s; text-align: center; display: flex; align-items: center; justify-content: center; }
        .btn-sec:hover { border-color: var(--txt2); }
        .btn-zip    { width: 100%; margin-top: 10px; background: var(--acc2); color: #fff; border: none; padding: 10px; border-radius: 6px; font-weight: 800; font-size: .78rem; cursor: pointer; transition: .15s; }
        .btn-zip:hover { filter: brightness(1.1); }
        .cold-notice { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 10px 14px; background: rgba(251,191,36,.07); border: 1px solid rgba(251,191,36,.35); border-radius: 7px; font-size: .75rem; color: var(--txt); }
        .light .cold-notice { color: #0a0a0a; }
        .spin { width: 13px; height: 13px; border: 2px solid rgba(251,191,36,.3); border-top-color: #fbbf24; border-radius: 50%; animation: spin .75s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .prog-track { position: relative; height: 26px; background: var(--sur2); border: 1px solid var(--brd); border-radius: 6px; overflow: hidden; margin-top: 12px; }
        .prog-bar   { height: 100%; background: var(--acc); border-radius: 6px; transition: width .5s ease; }
        .prog-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: .68rem; font-weight: 800; color: #000; mix-blend-mode: difference; letter-spacing: 1px; }
        .track-list { list-style: none; display: grid; grid-template-columns: repeat(auto-fill,minmax(270px,1fr)); gap: 7px; margin-top: 14px; }
        .track-item { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: 7px; border: 1px solid var(--brd); background: var(--sur2); cursor: pointer; transition: .15s; font-size: .78rem; color: var(--txt); }
        .track-item:hover  { border-color: var(--txt2); }
        .track-item.active { background: var(--acc-bg); border-color: var(--acc); }
        .t-num  { font-size: .65rem; color: var(--txt2); font-weight: 800; flex-shrink: 0; }
        .t-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--txt); }
        .t-badge      { font-size: .65rem; font-weight: 800; flex-shrink: 0; }
        .t-badge.done { color: var(--acc); }
        .t-badge.proc { color: #fbbf24; }
        .mon-row   { display: flex; gap: 16px; align-items: flex-start; }
        .mon-ctrl  { width: 108px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
        .mon-label { font-size: .72rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
        .orig-lbl  { color: var(--acc); }
        .mast-lbl  { color: var(--acc2); }
        .meter-box { display: flex; flex-direction: column; gap: 3px; }
        .meter-row { display: flex; justify-content: space-between; font-size: .68rem; }
        .meter-row span:first-child { color: var(--txt2); }
        .mval      { color: var(--acc); font-weight: 700; }
        .mval.pro  { color: var(--acc2); }
        .btn-play  { width: 100%; padding: 6px; border: 1px solid var(--brd); background: var(--sur2); color: var(--txt); border-radius: 5px; font-size: .7rem; font-weight: 800; cursor: pointer; transition: .15s; }
        .btn-play:hover:not(:disabled) { border-color: var(--txt2); }
        .btn-play:disabled { opacity: .3; cursor: not-allowed; }
        .btn-dl   { display: block; text-align: center; margin-top: 5px; padding: 6px; border-radius: 5px; background: var(--acc2); color: #fff; font-size: .7rem; font-weight: 800; text-decoration: none; }
        .mon-wave  { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .time-row  { text-align: right; font-size: .68rem; color: var(--txt2); font-weight: 700; margin-bottom: 5px; }
        .wave-box  { width: 100%; height: 148px; background: var(--sur2); border: 1px solid var(--brd); border-radius: 8px; position: relative; overflow: hidden; cursor: pointer; }
        canvas     { width: 100%; height: 100%; display: block; }
        .seeker    { position: absolute; top: 0; bottom: 0; width: 2px; pointer-events: none; }
        .sk-orig   { background: var(--acc);  box-shadow: 0 0 7px rgba(74,222,128,.6); }
        .sk-mast   { background: var(--acc2); box-shadow: 0 0 7px rgba(96,165,250,.6); }
        .no-file   { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: .8rem; color: var(--txt2); }
        .preset-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(130px,1fr)); gap: 10px; }
        .btn-preset  { background: var(--sur2); color: var(--txt); border: 1px solid var(--brd); padding: 14px 10px; border-radius: 8px; font-weight: 800; font-size: .76rem; cursor: pointer; transition: .18s; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .btn-preset:hover:not(:disabled) { border-color: var(--acc); background: var(--acc-bg); color: var(--txt); }
        .btn-preset:disabled { opacity: .3; cursor: not-allowed; }
        .p-icon { font-size: 1.3rem; }
        .ctrl-grid  { display: grid; grid-template-columns: repeat(auto-fit,minmax(255px,1fr)); gap: 14px; }
        .ctrl-group { background: var(--sur2); padding: 17px; border-radius: 8px; border: 1px solid var(--brd); }
        .g-title    { font-size: .68rem; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--brd); color: var(--txt); }
        .sel-row    { margin-bottom: 11px; }
        .sel-row label { font-size: .68rem; color: var(--txt2); display: block; margin-bottom: 4px; }
        .sel        { width: 100%; background: var(--sur); color: var(--txt); border: 1px solid var(--brd); padding: 7px 9px; border-radius: 5px; font-size: .76rem; font-family: inherit; }
        .sel:disabled { opacity: .35; }
        .light .sel { color: #0a0a0a; }
        .sld-row    { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; }
        .sld-label  { font-size: .7rem; color: var(--txt2); width: 95px; flex-shrink: 0; }
        .sld-label.acc { color: var(--acc); }
        .sld-row input[type="range"] { flex: 1; min-width: 0; accent-color: var(--acc); cursor: pointer; }
        .sld-row input[type="range"]:disabled { opacity: .3; cursor: not-allowed; }
        .sld-val    { width: 70px; flex-shrink: 0; font-size: .68rem; text-align: right; color: var(--acc); font-weight: 700; white-space: nowrap; }
        .hero        { text-align: center; padding: 110px 0; }
        .hero-eyebrow { font-size: .7rem; letter-spacing: 3px; text-transform: uppercase; color: var(--txt2); margin-bottom: 18px; }
        .hero-title  { font-size: 5.5rem; font-weight: 900; letter-spacing: -5px; line-height: .85; color: var(--txt); margin-bottom: 48px; }
        .hero .btn-prime { font-size: .88rem; padding: 13px 30px; border-radius: 8px; }
        .light { color: #0a0a0a; }
        .light .tier-chip, .light .panel-top span, .light .t-num,
        .light .drop-sub, .light .time-row, .light .meter-row span:first-child,
        .light .sld-label, .light .sel-row label { color: #555555; }
      `}} />
    </main>
  )
}

'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)
const ENGINE_URL = "https://thisismidi-thisismidi-mastering-engine.hf.space/master"

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE') 
  const [isLightMode, setIsLightMode] = useState(false)
  
  // 데이터 및 상태
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) 
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 실시간 미터링 (LUFS & dBTP)
  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)

  // 플레이어 및 시각화
  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const sourceNodes = useRef<Map<HTMLAudioElement, MediaElementAudioSourceNode>>(new Map())

  // Pro 파라미터
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // 타이틀 및 세션 관리
  useEffect(() => {
    document.title = "THISISMIDI Mastering AI";
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      updateSession(session?.user ?? null)
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => updateSession(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const updateSession = (u: any) => {
    setUser(u)
    if (u) {
      if (u.email === 'itsfreiar@gmail.com') setTier('DEVELOPER')
      else if (u.app_metadata?.is_pro) setTier('PRO')
      else setTier('FREE')
    } else setTier('FREE')
  }

  // --- [소리 재생 및 분석 핵심 로직] ---
  const startAnalyzing = async (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') await ctx.resume()
    
    let source = sourceNodes.current.get(audioElement)
    if (!source) {
      source = ctx.createMediaElementSource(audioElement)
      sourceNodes.current.set(audioElement, source)
    }

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 2048
    source.connect(analyzer)
    analyzer.connect(ctx.destination) // 스피커 연결

    const update = () => {
      const dataArray = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(dataArray)
      let peak = 0, sumSquares = 0
      for (let i = 0; i < dataArray.length; i++) {
        const v = Math.abs(dataArray[i]); if (v > peak) peak = v
        sumSquares += dataArray[i] * dataArray[i]
      }
      const tp = peak > 0 ? 20 * Math.log10(peak) : -70
      const lufs = (Math.sqrt(sumSquares / dataArray.length) > 0) ? 20 * Math.log10(Math.sqrt(sumSquares / dataArray.length)) - 0.691 : -70
      if (type === 'orig') { setOrigLufs(Math.round(lufs * 10) / 10); setOrigTp(Math.round(tp * 10) / 10); }
      else { setMastLufs(Math.round(lufs * 10) / 10); setMastTp(Math.round(tp * 10) / 10); }
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  // 구간 이동 (Seeking)
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, audioRef: React.RefObject<HTMLAudioElement>, duration: number) => {
    if (!audioRef.current || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return
    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { await audio.play(); await startAnalyzing(audio, 'orig'); setMastIsPlaying(false); mastAudioRef.current?.pause(); }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { await audio.play(); await startAnalyzing(audio, 'mast'); setOrigIsPlaying(false); origAudioRef.current?.pause(); }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  // 파형 드로잉
  const drawWaveform = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const buffer = (typeof file === 'string') ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const tCtx = new AudioContext()
      const audioBuffer = await tCtx.decodeAudioData(buffer)
      const data = audioBuffer.getChannelData(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      const step = Math.floor(data.length / canvas.width)
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          const v = data[i * step + j]; if (v < min) min = v; if (v > max) max = v
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await tCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) drawWaveform(files[activeIndex], origCanvas.current, isLightMode ? '#007aff' : '#4ade80')
    if (masteredUrls[activeIndex] && mastCanvas.current) drawWaveform(masteredUrls[activeIndex], mastCanvas.current, isLightMode ? '#007aff' : '#3b82f6')
  }, [files, activeIndex, isLightMode, masteredUrls])

  const runMastering = async () => {
    if (files.length === 0) return; setIsProcessing(true)
    const formData = new FormData()
    formData.append("file", files[activeIndex]); formData.append("target_lufs", targetLufs); formData.append("true_peak", truePeak)
    formData.append("warmth", warmth); formData.append("stereo_width", stereoWidth); formData.append("mono_bass", monoBass)
    try {
      const resp = await fetch(ENGINE_URL, { method: "POST", body: formData })
      const blob = await resp.blob(); setMasteredUrls(p => ({ ...p, [activeIndex]: URL.createObjectURL(blob) }))
    } catch (e) { alert("엔진 응답 없음") } finally { setIsProcessing(false) }
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="container">
        <header className="header">
          <h1 className="logo">THISISMIDI <span className="dot">.</span></h1>
          <div className="header-right">
            {user && <span className="tier-badge">{tier}</span>}
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
          </div>
        </header>

        {!user ? (
          <div className="hero">
            <h1>Mastering,<br/>Redefined.</h1>
            <button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-main">Start with Google</button>
          </div>
        ) : (
          <div className="app-grid">
            <section className="panel queue-panel">
              <div className="panel-header"><h2>Track Queue</h2><span>{files.length} tracks</span></div>
              <input type="file" id="u-file" hidden multiple onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="upload-area">Click to Upload</label>
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <span className="track-name">{i+1}. {f.name}</span>
                    {masteredUrls[i] && <span className="done-dot" />}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-action" disabled={isProcessing || files.length === 0}>{isProcessing ? 'PROCESSING...' : 'START MASTERING'}</button>
            </section>

            <div className="main-content">
              <div className="monitor-grid">
                {/* Original Monitor */}
                <div className="panel monitor">
                  <div className="monitor-info">
                    <div className="title-group">
                      <p className="label">ORIGINAL SOURCE</p>
                      <div className="stats"><span>LUFS: <b>{origLufs}</b></span><span>TP: <b>{origTp} dBTP</b></span></div>
                    </div>
                    <button onClick={()=>togglePlay('orig')} className="btn-play">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="wave-wrap" onClick={(e)=>handleSeek(e, origAudioRef, origDuration)}>
                    <canvas ref={origCanvas} width={800} height={180} />
                    <div className="play-line" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                  <audio ref={origAudioRef} crossOrigin="anonymous" src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>

                {/* Mastered Monitor */}
                <div className="panel monitor">
                  <div className="monitor-info">
                    <div className="title-group">
                      <p className="label color-m">MASTERED OUTPUT</p>
                      <div className="stats"><span>LUFS: <b>{mastLufs}</b></span><span>TP: <b>{mastTp} dBTP</b></span></div>
                    </div>
                    <div className="btn-group">
                      <button onClick={()=>togglePlay('mast')} className="btn-play" disabled={!masteredUrls[activeIndex]}>{mastIsPlaying ? 'STOP' : 'PLAY'}</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`} className="btn-play download">DOWNLOAD</a>}
                    </div>
                  </div>
                  <div className="wave-wrap" onClick={(e)=>handleSeek(e, mastAudioRef, mastDuration)}>
                    <canvas ref={mastCanvas} width={800} height={180} />
                    <div className="play-line" style={{left: `${(mastTime/mastDuration)*100}%`}} />
                    {!masteredUrls[activeIndex] && <div className="placeholder-msg">Mastering Result will appear here</div>}
                  </div>
                  <audio ref={mastAudioRef} crossOrigin="anonymous" src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </div>

              <aside className="options-grid">
                <div className="panel">
                  <p className="label">PRO SETTINGS {!isPro && '🔒'}</p>
                  <div className="input-group"><div className="in-info"><label>Warmth</label><span>{warmth}%</span></div><input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} /></div>
                  <div className="input-group"><div className="in-info"><label>Stereo Width</label><span>{stereoWidth}%</span></div><input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} /></div>
                  <div className="input-group"><div className="in-info"><label>Mono Bass</label><span>{monoBass}%</span></div><input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} disabled={!isPro} /></div>
                </div>
                <div className="panel">
                  <p className="label">LOUDNESS TARGET</p>
                  <div className="input-group"><div className="in-info"><label>Target LUFS</label><span>{targetLufs}</span></div><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /></div>
                  <div className="input-group"><div className="in-info"><label>True Peak</label><span>{truePeak} dB</span></div><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /></div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #000; --p: #111; --brd: #222; --txt: #fff; --acc: #4ade80; --sec: #888; }
        .light-mode { --bg: #fff; --p: #f2f2f7; --brd: #d1d1d6; --txt: #000; --acc: #007aff; --sec: #666; }
        
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, "Inter", sans-serif; -webkit-font-smoothing: antialiased; transition: 0.3s; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
        .logo { font-weight: 800; font-size: 1.2rem; margin:0; letter-spacing: -0.5px; }
        .dot { color: var(--acc); }
        .tier-badge { font-size: 0.6rem; font-weight: 900; background: var(--brd); padding: 4px 10px; border-radius: 50px; color: var(--sec); margin-right: 10px; }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 6px 14px; border-radius: 8px; cursor: pointer; font-size: 0.7rem; font-weight: 600; }
        
        .hero { text-align: center; padding: 100px 0; }
        .hero h1 { font-size: 4.5rem; letter-spacing: -3px; line-height: 0.95; font-weight: 900; margin-bottom: 30px; }
        .btn-main { background: var(--txt); color: var(--bg); border: none; padding: 18px 45px; border-radius: 50px; font-weight: 700; cursor: pointer; font-size: 1rem; }
        
        .app-grid { display: grid; grid-template-columns: 260px 1fr; gap: 20px; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 16px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .panel-header h2 { font-size: 0.8rem; margin:0; }
        .upload-area { display: block; padding: 15px; border: 1px dashed var(--brd); text-align: center; border-radius: 10px; font-size: 0.75rem; color: var(--sec); cursor: pointer; }
        .file-list { list-style: none; padding: 0; margin: 15px 0; max-height: 250px; overflow-y: auto; }
        .file-list li { padding: 10px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 4px; border: 1px solid transparent; }
        .file-list li.active { background: var(--bg); border-color: var(--acc); color: var(--acc); }
        .done-dot { width: 6px; height: 6px; background: var(--acc); border-radius: 50%; }
        .btn-action { width: 100%; padding: 15px; background: var(--acc); color: #000; border: none; border-radius: 10px; font-weight: 800; cursor: pointer; font-size: 0.8rem; }
        
        .monitor { margin-bottom: 20px; }
        .monitor-info { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
        .label { font-size: 0.65rem; font-weight: 800; color: var(--sec); margin: 0 0 5px 0; }
        .color-m { color: #3b82f6; }
        .stats { display: flex; gap: 15px; font-size: 0.7rem; font-family: "SF Mono", monospace; }
        .btn-play { background: var(--txt); color: var(--bg); border: none; padding: 7px 16px; border-radius: 8px; font-weight: 700; font-size: 0.7rem; cursor: pointer; }
        .btn-play.download { background: #3b82f6; color: #fff; margin-left: 8px; text-decoration: none; display: inline-block; }
        .btn-play:disabled { opacity: 0.1; }
        
        .wave-wrap { position: relative; height: 180px; background: rgba(0,0,0,0.2); border-radius: 12px; overflow: hidden; cursor: pointer; }
        canvas { width: 100%; height: 100%; display: block; }
        .play-line { position: absolute; top:0; bottom:0; width: 1.5px; background: #fff; pointer-events: none; transition: 0.1s linear; box-shadow: 0 0 10px #fff; }
        .placeholder-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #444; }
        
        .options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .input-group { margin-bottom: 15px; }
        .in-info { display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 8px; font-weight: 600; }
        input[type="range"] { width: 100%; accent-color: var(--acc); cursor: pointer; }
      `}} />
    </main>
  )
}

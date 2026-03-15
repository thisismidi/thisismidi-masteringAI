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

  // 상태 관리
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({})
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 미터링 데이터
  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)

  // 재생 상태
  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  // 레퍼런스 기반 마스터링 컨트롤
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceNodes = useRef<Map<HTMLAudioElement, MediaElementAudioSourceNode>>(new Map())
  const rafIdRef = useRef<number | null>(null)

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // --- [인증 및 초기화] ---
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

  // --- [오디오 엔진: 소리 재생 보장] ---
  const initAudioCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const startAnalyzing = (audio: HTMLAudioElement, type: 'orig' | 'mast') => {
    const ctx = initAudioCtx()
    let source = sourceNodes.current.get(audio)
    if (!source) {
      source = ctx.createMediaElementSource(audio)
      sourceNodes.current.set(audio, source)
    }
    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 2048
    source.connect(analyzer)
    analyzer.connect(ctx.destination) // 🚨 스피커 연결 (필수)

    const update = () => {
      const data = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(data)
      let peak = 0, sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]); if (v > peak) peak = v
        sum += data[i] * data[i]
      }
      const tp = peak > 0 ? 20 * Math.log10(peak) : -70
      const lufs = (Math.sqrt(sum / data.length) > 0) ? 20 * Math.log10(Math.sqrt(sum / data.length)) - 0.691 : -70
      if (type === 'orig') { setOrigLufs(Math.round(lufs * 10) / 10); setOrigTp(Math.round(tp * 10) / 10); }
      else { setMastLufs(Math.round(lufs * 10) / 10); setMastTp(Math.round(tp * 10) / 10); }
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return
    initAudioCtx() // 사용자 클릭 시 엔진 깨움

    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if(rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play(); startAnalyzing(audio, 'orig');
        mastAudioRef.current?.pause(); setMastIsPlaying(false);
      }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if(rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play(); startAnalyzing(audio, 'mast');
        origAudioRef.current?.pause(); setOrigIsPlaying(false);
      }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  // --- [파형 드로잉 및 구간 이동] ---
  const drawWave = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const buf = (typeof file === 'string') ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const tCtx = new AudioContext()
      const audioBuf = await tCtx.decodeAudioData(buf)
      const data = audioBuf.getChannelData(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1
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
    if (files[activeIndex] && origCanvas.current) drawWave(files[activeIndex], origCanvas.current, isLightMode ? '#007aff' : '#555')
    if (masteredUrls[activeIndex] && mastCanvas.current) drawWave(masteredUrls[activeIndex], mastCanvas.current, '#3b82f6')
  }, [files, activeIndex, isLightMode, masteredUrls])

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="workspace">
        {/* Header */}
        <header className="main-header">
          <div className="brand">THISISMIDI <span className="accent">.</span></div>
          <div className="user-area">
            {user && <span className="tier-label">{tier}</span>}
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-icon">{isLightMode ? '🌙' : '☀️'}</button>
            {user ? <button onClick={() => supabase.auth.signOut()} className="btn-text">LOGOUT</button> : <button onClick={() => supabase.auth.signInWithOAuth({provider:'google'})} className="btn-text">LOGIN</button>}
          </div>
        </header>

        {!user ? (
          <div className="auth-hero"><h1>Mastering, <br/>Simplified.</h1><button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-prime">Get Started</button></div>
        ) : (
          <div className="grid-layout">
            
            {/* [REF 1] Track Queue */}
            <section className="panel queue-panel">
              <div className="panel-top"><h3>Track Queue</h3><span>{files.length} tracks</span></div>
              <div className="upload-container">
                <input type="file" id="u-file" hidden multiple onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
                <label htmlFor="u-file" className="drop-area">Drop audio files here (WAV, MP3, etc)</label>
                <div className="action-row">
                  <label htmlFor="u-file" className="btn-sub">UPLOAD</label>
                  <button onClick={async () => {
                    setIsProcessing(true)
                    const fd = new FormData(); fd.append("file", files[activeIndex]); fd.append("target_lufs", targetLufs)
                    fd.append("true_peak", truePeak); fd.append("warmth", warmth); fd.append("stereo_width", stereoWidth); fd.append("mono_bass", monoBass)
                    const r = await fetch(ENGINE_URL, { method: "POST", body: fd })
                    const b = await r.blob(); setMasteredUrls(p => ({ ...p, [activeIndex]: URL.createObjectURL(b) }))
                    setIsProcessing(false)
                  }} className="btn-prime" disabled={isProcessing || !files[activeIndex]}>{isProcessing ? '...' : 'START'}</button>
                </div>
              </div>
              <ul className="track-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <input type="checkbox" checked={activeIndex === i} readOnly />
                    <span className="name">{i+1}. {f.name}</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="center-content">
              {/* [REF 2] A/B Monitor */}
              <section className="panel monitor-panel">
                <div className="panel-top"><h3>A/B Monitor</h3><span className="selected-info">Selected: {files[activeIndex]?.name}</span></div>
                
                <div className="monitor-row">
                  <div className="m-controls">
                    <p className="m-label">Original</p>
                    <div className="stats">LUFS: {origLufs} / TP: {origTp}</div>
                    <button onClick={()=>togglePlay('orig')} className="btn-p">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="wave-box" onClick={(e) => {
                    if(!origAudioRef.current) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    origAudioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * origDuration
                  }}>
                    <canvas ref={origCanvas} width={800} height={140} />
                    <div className="seeker" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                  <audio ref={origAudioRef} crossOrigin="anonymous" src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>

                <div className="monitor-row mt-20">
                  <div className="m-controls">
                    <p className="m-label color-m">Mastered</p>
                    <div className="stats">LUFS: {mastLufs} / TP: {mastTp}</div>
                    <button onClick={()=>togglePlay('mast')} className="btn-p" disabled={!masteredUrls[activeIndex]}>{mastIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="wave-box" onClick={(e) => {
                    if(!mastAudioRef.current) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    mastAudioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * mastDuration
                  }}>
                    <canvas ref={mastCanvas} width={800} height={140} />
                    <div className="seeker" style={{left: `${(mastTime/mastDuration)*100}%` || '0'}} />
                    {!masteredUrls[activeIndex] && <div className="no-file-overlay">No mastered file yet</div>}
                  </div>
                  <audio ref={mastAudioRef} crossOrigin="anonymous" src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </section>

              {/* [REF 3] Mastering Controls */}
              <section className="panel controls-panel">
                <div className="panel-top"><h3>Mastering Controls</h3></div>
                
                <div className="control-group">
                  <p className="g-title">Loudness and Safety</p>
                  <div className="sld-row"><label>Target LUFS</label><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /><span>{targetLufs}</span></div>
                  <div className="sld-row"><label>True Peak Ceiling</label><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /><span>{truePeak} dBTP</span></div>
                </div>

                <div className="control-group mt-15">
                  <p className="g-title">Tone Character</p>
                  <div className="sld-row"><label>Warmth</label><input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} /><span>{warmth}%</span></div>
                </div>

                <div className="control-group mt-15">
                  <p className="g-title">Stereo and Space</p>
                  <div className="sld-row"><label>Stereo Width</label><input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} /><span>{stereoWidth}%</span></div>
                  <div className="sld-row"><label>Mono Bass Anchor</label><input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} /><span>{monoBass}%</span></div>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0d0d0d; --p: #161616; --brd: #262626; --txt: #e5e5e5; --acc: #4ade80; --sec: #888; }
        .light-mode { --bg: #f5f5f7; --p: #ffffff; --brd: #e5e5e7; --txt: #1d1d1f; --acc: #0071e3; --sec: #86868b; }
        
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .workspace { max-width: 1400px; margin: 0 auto; padding: 20px; }
        .main-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .brand { font-size: 1.2rem; font-weight: 800; letter-spacing: -1px; }
        .accent { color: var(--acc); }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 8px; padding: 16px; margin-bottom: 20px; box-shadow: 0 4px 30px rgba(0,0,0,0.2); }
        .panel-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--brd); padding-bottom: 12px; margin-bottom: 15px; }
        .panel-top h3 { font-size: 0.8rem; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; color: var(--sec); }
        
        .grid-layout { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
        .upload-container { background: #000; border: 1px solid var(--brd); border-radius: 6px; padding: 15px; margin-bottom: 15px; }
        .drop-area { display: block; height: 60px; border: 1px dashed #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--sec); margin-bottom: 12px; }
        .action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .btn-prime { background: var(--acc); color: #000; border: none; padding: 10px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 0.8rem; }
        .btn-sub { background: #333; color: #fff; border: none; padding: 10px; border-radius: 4px; font-weight: 700; cursor: pointer; text-align: center; font-size: 0.8rem; }
        
        .track-list { list-style: none; padding: 0; margin: 0; }
        .track-list li { padding: 10px; border-radius: 4px; display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.8rem; }
        .track-list li.active { background: #222; border-left: 3px solid var(--acc); }
        
        .monitor-row { display: flex; gap: 20px; align-items: center; }
        .m-controls { width: 100px; }
        .m-label { font-size: 0.75rem; font-weight: 700; margin: 0 0 5px 0; }
        .color-m { color: #3b82f6; }
        .stats { font-size: 0.65rem; color: var(--sec); font-family: monospace; margin-bottom: 10px; }
        .btn-p { width: 100%; padding: 6px; border: 1px solid #444; background: #000; color: #fff; border-radius: 4px; font-size: 0.65rem; cursor: pointer; }
        .wave-box { flex: 1; height: 140px; background: rgba(0,0,0,0.3); border-radius: 6px; position: relative; overflow: hidden; cursor: pointer; }
        .seeker { position: absolute; top: 0; bottom: 0; width: 1.5px; background: #fff; box-shadow: 0 0 10px #fff; pointer-events: none; }
        .no-file-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; color: #555; }
        
        .control-group { border-bottom: 1px solid var(--brd); padding-bottom: 15px; }
        .g-title { font-size: 0.75rem; font-weight: 700; margin-bottom: 15px; color: var(--sec); }
        .sld-row { display: flex; align-items: center; gap: 20px; margin-bottom: 10px; }
        .sld-row label { font-size: 0.75rem; width: 150px; }
        .sld-row input { flex: 1; accent-color: var(--acc); cursor: pointer; }
        .sld-row span { width: 60px; font-size: 0.75rem; text-align: right; color: var(--acc); font-family: monospace; }
        
        .mt-20 { margin-top: 20px; } .mt-15 { margin-top: 15px; }
        .auth-hero { text-align: center; padding: 150px 0; }
        .auth-hero h1 { font-size: 4rem; letter-spacing: -3px; line-height: 0.9; margin-bottom: 40px; }
      `}} />
    </main>
  )
}

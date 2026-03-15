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
  
  // 1. 여러 곡 관리 데이터
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) 
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 2. 실시간 시각화 및 플레이어 상태
  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origDb, setOrigDb] = useState(-100)
  const [mastDb, setMastDb] = useState(-100)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafIdRef = useRef<number | null>(null)

  // 3. 프로 버전 파라미터 복구
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // 장르 프리셋 로직
  const applyPreset = (genre: string) => {
    if (!isPro) return alert("PRO 티어만 사용 가능한 기능입니다.");
    switch(genre) {
      case 'JAZZ_HIPHOP': setTargetLufs("-14.0"); setWarmth("35"); setStereoWidth("115"); setMonoBass("15"); break;
      case 'TRAP': setTargetLufs("-8.5"); setWarmth("15"); setStereoWidth("105"); setMonoBass("60"); break;
      case 'NEWAGE': setTargetLufs("-16.0"); setWarmth("5"); setStereoWidth("125"); setMonoBass("0"); break;
    }
  }

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        setTier(session.user.email === 'itsfreiar@gmail.com' ? 'DEVELOPER' : 'FREE')
      }
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  // 파형 그리기 (디자인 복구 버전)
  const drawStaticWaveform = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const arrayBuffer = (typeof file === 'string') ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      const rawData = audioBuffer.getChannelData(0)
      const samples = canvas.width
      const blockSize = Math.floor(rawData.length / samples)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      for (let i = 0; i < samples; i++) {
        let min = 1.0, max = -1.0
        for (let j = 0; j < blockSize; j++) {
          const val = rawData[i * blockSize + j]; if (val < min) min = val; if (val > max) max = val
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await audioCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) drawStaticWaveform(files[activeIndex], origCanvas.current, isLightMode ? '#0071e3' : '#4ade80')
    if (masteredUrls[activeIndex] && mastCanvas.current) drawStaticWaveform(masteredUrls[activeIndex], mastCanvas.current, '#3b82f6')
  }, [files, activeIndex, isLightMode, masteredUrls])

  const startVisualizing = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current; if (ctx.state === 'suspended') ctx.resume()
    const analyzer = ctx.createAnalyser(); analyzer.fftSize = 256
    const source = ctx.createMediaElementSource(audioElement); source.connect(analyzer); analyzer.connect(ctx.destination)
    const update = () => {
      const dataArray = new Uint8Array(analyzer.frequencyBinCount); analyzer.getByteTimeDomainData(dataArray)
      let sumSquares = 0; for (let i = 0; i < dataArray.length; i++) { const norm = (dataArray[i] - 128) / 128; sumSquares += norm * norm; }
      const rms = Math.sqrt(sumSquares / dataArray.length); const db = rms > 0 ? 20 * Math.log10(rms) : -100
      if (type === 'orig') setOrigDb(Math.round(db * 10) / 10); else setMastDb(Math.round(db * 10) / 10)
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  const runMastering = async () => {
    if (files.length === 0) return; setIsProcessing(true)
    const formData = new FormData()
    formData.append("file", files[activeIndex]); formData.append("target_lufs", targetLufs)
    formData.append("true_peak", truePeak); formData.append("warmth", warmth)
    formData.append("stereo_width", stereoWidth); formData.append("mono_bass", monoBass)
    try {
      const response = await fetch(ENGINE_URL, { method: "POST", body: formData })
      const blob = await response.blob(); const url = URL.createObjectURL(blob)
      setMasteredUrls(prev => ({ ...prev, [activeIndex]: url })); setIsProcessing(false)
    } catch (error) { alert("연결 실패"); setIsProcessing(false) }
  }

  const togglePlay = (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return
    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { audio.play(); startVisualizing(audio, 'orig'); mastAudioRef.current?.pause(); setMastIsPlaying(false); }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { audio.play(); startVisualizing(audio, 'mast'); origAudioRef.current?.pause(); setOrigIsPlaying(false); }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
      <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />

      <div className="container">
        <header className="header">
          <h1 className="logo">THISISMIDI <span className="dot">.</span></h1>
          <div className="header-right">
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
          </div>
        </header>

        {!user ? (
          <div className="login-hero"><h1>Mastering, <br/>Redefined.</h1><button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-login">Start with Google</button></div>
        ) : (
          <div className="dash">
            {/* 1. Track Queue (여러 곡 관리) */}
            <section className="panel queue-section">
              <div className="panel-header"><h2>Track Queue</h2><span>{files.length} / {isPro ? 15 : 1} tracks</span></div>
              <input type="file" id="u-file" hidden multiple={isPro} onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="dropzone">Drop or <b style={{color:'var(--acc)'}}>Click to Upload</b></label>
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <div className="file-info"><span>{i + 1}.</span> {f.name}</div>
                    {masteredUrls[i] && <span className="done-badge">DONE</span>}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-main" disabled={isProcessing || files.length === 0}>{isProcessing ? 'PROCESSING AUDIO...' : 'START MASTERING'}</button>
            </section>

            <div className="main-grid">
              {/* 2. Monitors (파형 및 실시간 정보) */}
              <div className="monitors">
                <div className="panel">
                  <div className="monitor-header">
                    <p className="p-label">ORIGINAL SOURCE {origIsPlaying && <span className="meter">{origDb} dB</span>}</p>
                    <button onClick={()=>togglePlay('orig')} className="play-btn">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="canvas-container">
                    <canvas ref={origCanvas} width={700} height={180} />
                    <div className="playback-bar" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                </div>

                <div className="panel" style={{marginTop:'20px'}}>
                  <div className="monitor-header">
                    <p className="p-label">MASTERED OUTPUT {mastIsPlaying && <span className="meter" style={{color:'#3b82f6'}}>{mastDb} dB</span>}</p>
                    <div style={{display:'flex', gap:'8px'}}>
                      <button onClick={()=>togglePlay('mast')} className="play-btn" disabled={!masteredUrls[activeIndex]}>PLAY</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`}><button className="play-btn" style={{background:'#3b82f6'}}>DOWNLOAD</button></a>}
                    </div>
                  </div>
                  <div className="canvas-container">
                    <canvas ref={mastCanvas} width={700} height={180} />
                    {!masteredUrls[activeIndex] && <div className="no-file-msg">{isProcessing ? 'Processing in progress...' : 'No mastered file'}</div>}
                    <div className="playback-bar" style={{left: `${(mastTime/mastDuration)*100}%` || '0'}} />
                  </div>
                </div>
              </div>

              {/* 3. Pro Controls (프리셋 및 상세 조절) */}
              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">GENRE PRESETS</p>
                  <div className="genre-grid">
                    <button onClick={()=>applyPreset('JAZZ_HIPHOP')}>Jazz HipHop</button>
                    <button onClick={()=>applyPreset('TRAP')}>Trap / Drill</button>
                    <button onClick={()=>applyPreset('NEWAGE')}>New Age</button>
                  </div>
                </div>

                <div className="panel">
                  <p className="p-label">LOUDNESS & PEAK</p>
                  <div className="row"><div className="row-info"><label>Target LUFS</label><span>{targetLufs}</span></div><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /></div>
                  <div className="row"><div className="row-info"><label>True Peak</label><span>{truePeak} dB</span></div><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /></div>
                </div>

                <div className="panel" style={{marginTop:'20px', opacity: isPro ? 1 : 0.3}}>
                  <p className="p-label">PRO: ANALOG & STEREO {!isPro && '🔒'}</p>
                  <div className="row"><div className="row-info"><label>Warmth (Saturation)</label><span>{warmth}%</span></div><input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} /></div>
                  <div className="row"><div className="row-info"><label>Stereo Width</label><span>{stereoWidth}%</span></div><input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} /></div>
                  <div className="row"><div className="row-info"><label>Mono Bass Focus</label><span>{monoBass}%</span></div><input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} disabled={!isPro} /></div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        .light-mode { --bg: #f5f5f7; --p: #fff; --brd: #d2d2d7; --txt: #1c1c1e; --acc: #0071e3; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; transition: background 0.3s; }
        .container { max-width: 1240px; margin: 0 auto; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0 40px; }
        .logo { font-weight: 900; color: var(--acc); letter-spacing: -1px; margin:0; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 14px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .dash { display: flex; flex-direction: column; gap: 20px; }
        .main-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; }
        .monitor-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .p-label { font-size: 0.65rem; font-weight: bold; color: #888; letter-spacing: 0.5px; margin:0; }
        .meter { font-family: 'Courier New', monospace; font-size: 0.85rem; color: var(--acc); margin-left: 10px; font-weight: bold; }
        .canvas-container { position: relative; width: 100%; height: 180px; background: rgba(0,0,0,0.25); border-radius: 10px; overflow: hidden; }
        .playback-bar { position: absolute; top:0; bottom:0; width: 2px; background: #fff; pointer-events: none; transition: left 0.1s linear; box-shadow: 0 0 10px rgba(255,255,255,0.5); }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.7rem; font-weight: 700; transition: 0.2s; }
        .btn-ui:hover { background: var(--brd); }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 6px 14px; border-radius: 7px; font-weight: 800; font-size: 0.7rem; cursor: pointer; }
        .play-btn:disabled { opacity: 0.2; cursor: not-allowed; }
        .dropzone { display: block; padding: 25px; border: 1.5px dashed var(--brd); text-align: center; border-radius: 10px; color: #777; font-size: 0.8rem; cursor: pointer; transition: 0.2s; }
        .dropzone:hover { border-color: var(--acc); color: var(--txt); }
        .file-list { list-style: none; padding: 0; margin: 20px 0; max-height: 200px; overflow-y: auto; }
        .file-list li { padding: 12px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; margin-bottom: 6px; transition: 0.2s; border: 1px solid transparent; }
        .file-list li.active { background: rgba(74,222,128,0.08); border-color: var(--acc); color: var(--acc); }
        .done-badge { background: var(--acc); color: #000; padding: 2px 7px; border-radius: 5px; font-size: 0.6rem; font-weight: 900; }
        .btn-main { width: 100%; padding: 18px; background: var(--acc); color: #000; border: none; border-radius: 10px; font-weight: 900; cursor: pointer; transition: 0.2s; }
        .btn-main:active { transform: scale(0.98); }
        .genre-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
        .genre-grid button { background: #222; border: 1px solid #333; color: #ddd; padding: 9px; border-radius: 8px; font-size: 0.7rem; cursor: pointer; font-weight: 600; }
        .genre-grid button:hover { border-color: var(--acc); color: var(--acc); }
        .row { margin-bottom: 18px; }
        .row-info { display: flex; justify-content: space-between; font-size: 0.75rem; color: #888; margin-bottom: 8px; }
        input[type="range"] { width: 100%; accent-color: var(--acc); cursor: pointer; }
        .no-file-msg { position: absolute; inset:0; display: flex; align-items: center; justify-content: center; color: #555; font-size: 0.8rem; background: rgba(0,0,0,0.4); }
        .login-hero { text-align: center; padding: 120px 0; }
        .login-hero h1 { font-size: 4rem; letter-spacing: -3px; line-height: 0.9; margin-bottom: 30px; font-weight: 900; }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 20px 50px; border-radius: 50px; font-weight: 800; cursor: pointer; font-size: 1.1rem; }
      `}} />
    </main>
  )
}

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
  
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) 
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

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

  // 🚨 복구된 프로 파라미터 상태
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // 장르 프리셋 함수
  const applyPreset = (genre: string) => {
    if (!isPro) return alert("PRO 티어만 사용 가능한 기능입니다.");
    switch(genre) {
      case 'JAZZ_HIPHOP': setTargetLufs("-14.0"); setWarmth("30"); setStereoWidth("110"); setMonoBass("20"); break;
      case 'TRAP': setTargetLufs("-8.0"); setWarmth("10"); setStereoWidth("100"); setMonoBass("50"); break;
      case 'NEWAGE': setTargetLufs("-16.0"); setWarmth("0"); setStereoWidth("120"); setMonoBass("0"); break;
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

  // 파형 드로잉 로직 생략 (공간상 기존 로직 유지)
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
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5
      for (let i = 0; i < samples; i++) {
        let min = 1.0, max = -1.0
        for (let j = 0; j < blockSize; j++) {
          const val = rawData[i * blockSize + j]
          if (val < min) min = val; if (val > max) max = val
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await audioCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) drawStaticWaveform(files[activeIndex], origCanvas.current, '#4ade80')
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
    } catch (error) { alert("서버 연결 실패"); setIsProcessing(false) }
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <header className="header">
        <h1 className="logo">THISISMIDI <span className="dot">.</span></h1>
        <div className="header-right">
          <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
          {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
        </div>
      </header>

      <div className="container">
        {user ? (
          <div className="dash">
            {/* Track Queue Section */}
            <section className="panel queue">
              <div className="q-header"><h2>Track Queue</h2><span>{files.length} / {isPro ? 15 : 1}</span></div>
              <input type="file" id="u-file" hidden multiple={isPro} onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="dropzone">Click to Upload Audio</label>
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <span>{i + 1}. {f.name}</span> {masteredUrls[i] && <span className="done-badge">DONE</span>}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-main" disabled={isProcessing}>{isProcessing ? 'PROCESSING...' : 'START MASTERING'}</button>
            </section>

            <div className="main-grid">
              {/* Monitors Section */}
              <div className="monitors">
                <div className="panel">
                  <div className="m-header"><p>ORIGINAL {origIsPlaying && <span className="db">{origDb} dB</span>}</p> <button onClick={()=>togglePlay('orig')} className="play-btn">{origIsPlaying ? 'STOP' : 'PLAY'}</button></div>
                  <div className="c-wrap"><canvas ref={origCanvas} width={700} height={160} /><div className="bar" style={{left:`${(origTime/origDuration)*100}%`}} /></div>
                  <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>
                <div className="panel" style={{marginTop:'20px'}}>
                  <div className="m-header"><p>MASTERED {mastIsPlaying && <span className="db" style={{color:'#3b82f6'}}>{mastDb} dB</span>}</p> 
                    <div style={{display:'flex', gap:'10px'}}>
                      <button onClick={()=>togglePlay('mast')} className="play-btn" disabled={!masteredUrls[activeIndex]}>PLAY</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`}><button className="play-btn" style={{background:'#3b82f6'}}>DOWNLOAD</button></a>}
                    </div>
                  </div>
                  <div className="c-wrap"><canvas ref={mastCanvas} width={700} height={160} /><div className="bar" style={{left:`${(mastTime/mastDuration)*100}%` || '0'}} />{!masteredUrls[activeIndex] && <div className="no-file">Ready to Master</div>}</div>
                  <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </div>

              {/* 🚨 복구된 Controls Section */}
              <aside className="controls">
                <div className="panel">
                  <p className="p-label">GENRE PRESETS</p>
                  <div className="genre-grid">
                    <button onClick={()=>applyPreset('JAZZ_HIPHOP')}>Jazz HipHop</button>
                    <button onClick={()=>applyPreset('TRAP')}>Trap/Drill</button>
                    <button onClick={()=>applyPreset('NEWAGE')}>NewAge</button>
                  </div>
                </div>

                <div className="panel" style={{marginTop:'20px'}}>
                  <p className="p-label">LOUDNESS</p>
                  <div className="row"><label>LUFS: {targetLufs}</label><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /></div>
                  <div className="row"><label>TP: {truePeak} dB</label><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /></div>
                </div>

                <div className="panel" style={{marginTop:'20px', opacity: isPro ? 1 : 0.4}}>
                  <p className="p-label">PRO: TONE & STEREO {!isPro && '🔒'}</p>
                  <div className="row"><label>Warmth: {warmth}%</label><input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} /></div>
                  <div className="row"><label>Stereo Width: {stereoWidth}%</label><input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} /></div>
                  <div className="row"><label>Mono Bass: {monoBass}%</label><input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} disabled={!isPro} /></div>
                </div>
              </aside>
            </div>
          </div>
        ) : (
          <div className="login-hero"><h1>Mastering, <br/>Redefined.</h1><button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-login">Login with Google</button></div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        .light-mode { --bg: #f5f5f7; --p: #fff; --brd: #d2d2d7; --txt: #1c1c1e; --acc: #0071e3; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; transition: 0.2s; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 12px; padding: 20px; }
        .header { display: flex; justify-content: space-between; padding: 20px 0; align-items: center; }
        .logo { font-weight: 900; color: var(--acc); font-size: 1.4rem; }
        .main-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; margin-top: 20px; }
        .db { font-family: monospace; font-size: 0.8rem; margin-left: 10px; color: var(--acc); }
        .c-wrap { position: relative; height: 160px; background: rgba(0,0,0,0.3); border-radius: 8px; margin-top: 10px; overflow: hidden; }
        canvas { width: 100%; height: 100%; }
        .bar { position: absolute; top:0; bottom:0; width: 2px; background: #fff; pointer-events: none; transition: 0.1s linear; }
        .p-label { font-size: 0.65rem; font-weight: bold; color: #888; margin: 0 0 15px 0; }
        .genre-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .genre-grid button { background: #222; border: 1px solid #333; color: #eee; padding: 8px; border-radius: 6px; font-size: 0.7rem; cursor: pointer; transition: 0.2s; }
        .genre-grid button:hover { border-color: var(--acc); }
        .row { margin-bottom: 15px; } .row label { font-size: 0.7rem; display: block; margin-bottom: 5px; color: #888; }
        input[type="range"] { width: 100%; accent-color: var(--acc); }
        .btn-main { width: 100%; padding: 18px; background: var(--acc); border: none; border-radius: 8px; font-weight: 900; cursor: pointer; margin-top: 15px; }
        .file-list { list-style: none; padding: 0; margin: 15px 0; }
        .file-list li { padding: 10px; margin-bottom: 5px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; font-size: 0.8rem; border: 1px solid transparent; }
        .file-list li.active { background: rgba(74,222,128,0.1); border-color: var(--acc); color: var(--acc); }
        .done-badge { background: var(--acc); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; font-weight: bold; }
        .play-btn { background: #fff; color: #000; border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; font-size: 0.7rem; cursor: pointer; }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 18px 48px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; margin-top: 20px; }
        .login-hero { text-align: center; padding: 100px 0; } .login-hero h1 { fontSize: 3.5rem; letter-spacing: -2px; }
      `}} />
    </main>
  )
}

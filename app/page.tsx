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

  // 2. 실시간 미터링 (LUFS & dBTP) 및 플레이어 상태
  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)

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
  const sourceNodeRef = useRef<any>(null)

  // 3. 프로 파라미터
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // --- [추가: 브라우저 탭 타이틀 변경] ---
  useEffect(() => {
    document.title = "THISISMIDI Mastering AI";
  }, []);

  // --- [실시간 LUFS & dBTP 분석] ---
  const startAnalyzing = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current; if (ctx.state === 'suspended') ctx.resume()
    const analyzer = ctx.createAnalyser(); analyzer.fftSize = 2048
    
    if (sourceNodeRef.current) try { sourceNodeRef.current.disconnect() } catch(e){}
    const source = ctx.createMediaElementSource(audioElement)
    sourceNodeRef.current = source; source.connect(analyzer); analyzer.connect(ctx.destination)

    const update = () => {
      const dataArray = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(dataArray)
      let peak = 0; let sumSquares = 0
      for (let i = 0; i < dataArray.length; i++) {
        const absVal = Math.abs(dataArray[i]); if (absVal > peak) peak = absVal
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

  // --- [구간 이동 (Seeking)] ---
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, audioRef: React.RefObject<HTMLAudioElement>, duration: number) => {
    if (!audioRef.current || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const runMastering = async () => {
    if (files.length === 0) return; setIsProcessing(true)
    const formData = new FormData()
    formData.append("file", files[activeIndex]); formData.append("target_lufs", targetLufs); formData.append("true_peak", truePeak)
    formData.append("warmth", warmth); formData.append("stereo_width", stereoWidth); formData.append("mono_bass", monoBass)
    try {
      const response = await fetch(ENGINE_URL, { method: "POST", body: formData })
      const blob = await response.blob(); setMasteredUrls(prev => ({ ...prev, [activeIndex]: URL.createObjectURL(blob) }))
    } catch (error) { alert("연결 실패") } finally { setIsProcessing(false) }
  }

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) { setUser(session.user); setTier(session.user.email === 'itsfreiar@gmail.com' ? 'DEVELOPER' : 'FREE'); }
    }
    init()
  }, [])

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="container" style={{maxWidth:'1200px', margin:'0 auto', padding:'20px'}}>
        <header className="header">
          <h1 className="logo">THISISMIDI <span className="dot">.</span></h1>
          <div className="header-right">
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
          </div>
        </header>

        {user ? (
          <div className="dash">
            <section className="panel queue">
              <div className="panel-header"><h2>Track Queue</h2><span>{files.length} tracks</span></div>
              <input type="file" id="u-file" hidden multiple onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="dropzone">Drop or <b style={{color:'var(--acc)'}}>Click to Upload</b></label>
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <span style={{fontSize:'0.85rem'}}>{i+1}. {f.name}</span>
                    {masteredUrls[i] && <span className="done-badge">DONE</span>}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-main" disabled={isProcessing || files.length === 0}>{isProcessing ? 'PROCESSING...' : 'START MASTERING'}</button>
            </section>

            <div className="main-grid">
              <div className="monitors">
                <div className="panel monitor-card">
                  <div className="monitor-header">
                    <div>
                      <p className="p-label">ORIGINAL SOURCE</p>
                      <div className="meter-row">
                        <span>LUFS: <b>{origLufs}</b></span>
                        <span style={{color: origTp > 0 ? '#ff4d4d' : 'inherit'}}>TP: <b>{origTp} dBTP</b></span>
                      </div>
                    </div>
                    <button onClick={async ()=>{
                      if(origIsPlaying) { origAudioRef.current?.pause(); if(rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
                      else { await origAudioRef.current?.play(); startAnalyzing(origAudioRef.current!, 'orig'); mastAudioRef.current?.pause(); setMastIsPlaying(false); }
                      setOrigIsPlaying(!origIsPlaying)
                    }} className="play-btn">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="canvas-container" onClick={(e)=>handleSeek(e, origAudioRef, origDuration)}>
                    <canvas ref={origCanvas} width={700} height={180} />
                    <div className="playback-bar" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                  <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>

                <div className="panel monitor-card" style={{marginTop:'20px'}}>
                  <div className="monitor-header">
                    <div>
                      <p className="p-label" style={{color:'#3b82f6'}}>MASTERED OUTPUT</p>
                      <div className="meter-row">
                        <span style={{color:'#3b82f6'}}>LUFS: <b>{mastLufs}</b></span>
                        <span style={{color: mastTp > 0 ? '#ff4d4d' : '#3b82f6'}}>TP: <b>{mastTp} dBTP</b></span>
                      </div>
                    </div>
                    <div style={{display:'flex', gap:'8px'}}>
                      <button onClick={async ()=>{
                        if(mastIsPlaying) { mastAudioRef.current?.pause(); if(rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
                        else { await mastAudioRef.current?.play(); startAnalyzing(mastAudioRef.current!, 'mast'); origAudioRef.current?.pause(); setOrigIsPlaying(false); }
                        setMastIsPlaying(!mastIsPlaying)
                      }} className="play-btn" disabled={!masteredUrls[activeIndex]}>PLAY</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`} className="play-btn dl-btn">DOWNLOAD</a>}
                    </div>
                  </div>
                  <div className="canvas-container" onClick={(e)=>handleSeek(e, mastAudioRef, mastDuration)}>
                    <canvas ref={mastCanvas} width={700} height={180} />
                    <div className="playback-bar" style={{left: `${(mastTime/mastDuration)*100}%` || '0'}} />
                    {!masteredUrls[activeIndex] && <div className="no-file-msg">{isProcessing ? 'Processing...' : 'Ready to Master'}</div>}
                  </div>
                  <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </div>

              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">PRO SETTINGS</p>
                  <div className="row">
                    <div className="row-info"><label>Warmth</label><span>{warmth}%</span></div>
                    <input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} />
                  </div>
                  <div className="row">
                    <div className="row-info"><label>Stereo Width</label><span>{stereoWidth}%</span></div>
                    <input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} />
                  </div>
                </div>
                <div className="panel">
                  <p className="p-label">LOUDNESS</p>
                  <div className="row">
                    <div className="row-info"><label>Target LUFS</label><span>{targetLufs}</span></div>
                    <input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        ) : (
          <div className="login-hero"><h1>Mastering, <br/>Redefined.</h1><button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-login">Start with Google</button></div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        
        /* 🚨 라이트 모드 디자인 개선: 하얀 배경 & 검은 글씨 */
        .light-mode { 
          --bg: #ffffff; 
          --p: #ffffff; 
          --brd: #e1e1e1; 
          --txt: #000000; 
          --acc: #0071e3; 
        }

        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; transition: background 0.3s; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0 40px; }
        .logo { font-weight: 900; color: var(--acc); margin:0; font-size: 1.4rem; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 14px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .dash { display: flex; flex-direction: column; gap: 20px; }
        .main-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
        .p-label { font-size: 0.65rem; font-weight: bold; color: #888; margin: 0 0 5px 0; }
        .meter-row { display: flex; gap: 12px; font-size: 0.75rem; font-family: monospace; }
        .canvas-container { position: relative; width: 100%; height: 180px; background: rgba(0,0,0,0.05); border-radius: 10px; overflow: hidden; cursor: pointer; border: 1px solid var(--brd); }
        .playback-bar { position: absolute; top:0; bottom:0; width: 2px; background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.8); pointer-events: none; transition: left 0.1s linear; }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.7rem; font-weight: bold; }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 7px 15px; border-radius: 7px; font-weight: bold; cursor: pointer; font-size: 0.7rem; }
        .dl-btn { background: #3b82f6; color: #fff; text-decoration: none; font-size: 0.7rem; }
        .dropzone { display: block; padding: 25px; border: 1px dashed var(--brd); text-align: center; border-radius: 10px; color: #999; font-size: 0.8rem; cursor: pointer; }
        .file-list { list-style: none; padding: 0; margin: 15px 0; }
        .file-list li { padding: 12px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 5px; }
        .file-list li.active { background: rgba(74,222,128,0.1); border: 1px solid var(--acc); color: var(--acc); }
        .done-badge { background: var(--acc); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; font-weight: bold; }
        .btn-main { width: 100%; padding: 18px; background: var(--acc); color: #000; border: none; border-radius: 10px; font-weight: 900; cursor: pointer; }
        .row { margin-bottom: 15px; }
        .row-info { display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 6px; }
        input[type="range"] { width: 100%; accent-color: var(--acc); cursor: pointer; }
        .no-file-msg { position: absolute; inset:0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.03); color: #999; font-size: 0.8rem; }
        .login-hero { text-align: center; padding: 120px 0; }
        .login-hero h1 { font-size: 4rem; letter-spacing: -3px; font-weight: 900; line-height: 1; }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 20px 50px; border-radius: 50px; font-weight: bold; font-size: 1.1rem; cursor: pointer; }
      `}} />
    </main>
  )
}

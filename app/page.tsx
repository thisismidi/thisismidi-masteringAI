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

  // 플레이어 제어 및 미터링 상태 (LUFS & True Peak)
  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const sourceNodeRef = useRef<any>(null)

  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // --- [음악 구간 이동 (Seeking) 해결] ---
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, audioRef: React.RefObject<HTMLAudioElement>, duration: number) => {
    if (!audioRef.current || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const clickedTime = (x / rect.width) * duration
    audioRef.current.currentTime = clickedTime
  }

  // --- [실시간 LUFS & True Peak 계산 (3번 업그레이드)] ---
  const startVisualizing = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 2048
    
    // 기존 노드 연결 해제 후 재연결 (중복 연결 방지)
    if (sourceNodeRef.current) sourceNodeRef.current.disconnect()
    const source = ctx.createMediaElementSource(audioElement)
    sourceNodeRef.current = source
    source.connect(analyzer)
    analyzer.connect(ctx.destination)

    const update = () => {
      const dataArray = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(dataArray)

      // 1. True Peak (최대 절댓값) 계산
      let peak = 0
      for (let i = 0; i < dataArray.length; i++) {
        const absVal = Math.abs(dataArray[i])
        if (absVal > peak) peak = absVal
      }
      const tpDb = peak > 0 ? 20 * Math.log10(peak) : -70

      // 2. Momentary LUFS (K-weighting 간소화 버전)
      let sumSquares = 0
      for (let i = 0; i < dataArray.length; i++) sumSquares += dataArray[i] * dataArray[i]
      const rms = Math.sqrt(sumSquares / dataArray.length)
      const lufs = rms > 0 ? 20 * Math.log10(rms) - 0.691 : -70 // 간이 K-weighting 오프셋

      if (type === 'orig') { setOrigLufs(Math.round(lufs * 10) / 10); setOrigTp(Math.round(tpDb * 10) / 10); }
      else { setMastLufs(Math.round(lufs * 10) / 10); setMastTp(Math.round(tpDb * 10) / 10); }
      
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  // --- [재생 제어 (소리 안나오는 문제 해결)] ---
  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return

    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play()
        startVisualizing(audio, 'orig')
        mastAudioRef.current?.pause(); setMastIsPlaying(false)
      }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play()
        startVisualizing(audio, 'mast')
        origAudioRef.current?.pause(); setOrigIsPlaying(false)
      }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  // --- [곡 변경 시 초기화 로직 (음악 안나오는 문제 해결)] ---
  useEffect(() => {
    if (origAudioRef.current) {
      origAudioRef.current.load() // 새 파일 로드 강제
      setOrigIsPlaying(false); setMastIsPlaying(false)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    }
  }, [activeIndex, files])

  // --- [나머지 필수 로직 (인증/마스터링/드로잉)] ---
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) { setUser(session.user); setTier(session.user.email === 'itsfreiar@gmail.com' ? 'DEVELOPER' : 'FREE'); }
    }
    init()
  }, [])

  const runMastering = async () => {
    if (files.length === 0) return; setIsProcessing(true)
    const formData = new FormData()
    formData.append("file", files[activeIndex]); formData.append("target_lufs", targetLufs); formData.append("true_peak", truePeak)
    formData.append("warmth", warmth); formData.append("stereo_width", stereoWidth); formData.append("mono_bass", monoBass)
    try {
      const response = await fetch(ENGINE_URL, { method: "POST", body: formData })
      const blob = await response.blob(); const url = URL.createObjectURL(blob)
      setMasteredUrls(prev => ({ ...prev, [activeIndex]: url })); setIsProcessing(false)
    } catch (error) { alert("엔진 연결 실패"); setIsProcessing(false) }
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
            <section className="panel queue-section">
              <div className="panel-header"><h2>Track Queue</h2><span>{files.length} tracks</span></div>
              <input type="file" id="u-file" hidden multiple onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="dropzone">Click to Upload Audio</label>
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                    <div className="file-info"><span>{i + 1}.</span> {f.name}</div>
                    {masteredUrls[i] && <span className="done-badge">DONE</span>}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-main" disabled={isProcessing || files.length === 0}>
                {isProcessing ? 'PROCESSING...' : 'START MASTERING'}
              </button>
            </section>

            <div className="main-grid">
              <div className="monitors">
                <div className="panel monitor-card">
                  <div className="monitor-header">
                    <div className="m-title">
                      <p className="p-label">ORIGINAL SOURCE</p>
                      <div className="meter-row">
                        <span>LUFS: <b>{origLufs}</b></span>
                        <span>TP: <b style={{color: origTp > 0 ? '#ff4d4d' : '#888'}}>{origTp} dBTP</b></span>
                      </div>
                    </div>
                    <button onClick={()=>togglePlay('orig')} className="play-btn">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="canvas-container" onClick={(e) => handleSeek(e, origAudioRef, origDuration)}>
                    <canvas ref={origCanvas} width={700} height={180} />
                    <div className="playback-bar" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                  <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>

                <div className="panel monitor-card" style={{marginTop:'20px'}}>
                  <div className="monitor-header">
                    <div className="m-title">
                      <p className="p-label" style={{color:'#3b82f6'}}>MASTERED OUTPUT</p>
                      <div className="meter-row">
                        <span>LUFS: <b style={{color:'#3b82f6'}}>{mastLufs}</b></span>
                        <span>TP: <b style={{color: mastTp > 0 ? '#ff4d4d' : '#3b82f6'}}>{mastTp} dBTP</b></span>
                      </div>
                    </div>
                    <div style={{display:'flex', gap:'8px'}}>
                      <button onClick={()=>togglePlay('mast')} className="play-btn" disabled={!masteredUrls[activeIndex]}>PLAY</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`} className="play-btn dl">DOWNLOAD</a>}
                    </div>
                  </div>
                  <div className="canvas-container" onClick={(e) => handleSeek(e, mastAudioRef, mastDuration)}>
                    <canvas ref={mastCanvas} width={700} height={180} />
                    <div className="playback-bar" style={{left: `${(mastTime/mastDuration)*100}%` || '0'}} />
                    {!masteredUrls[activeIndex] && <div className="no-file">Process to See Result</div>}
                  </div>
                  <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </div>

              <aside className="controls">
                <div className="panel">
                  <p className="p-label">GENRE PRESETS</p>
                  <div className="genre-grid">
                    <button onClick={()=>setTargetLufs("-14.0")}>Jazz HipHop</button>
                    <button onClick={()=>setTargetLufs("-9.0")}>Trap</button>
                    <button onClick={()=>setTargetLufs("-16.0")}>Ambient</button>
                  </div>
                </div>
                <div className="panel" style={{marginTop:'20px'}}>
                  <p className="p-label">SETTINGS</p>
                  <div className="row"><label>Target LUFS: {targetLufs}</label><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /></div>
                  <div className="row"><label>True Peak: {truePeak} dB</label><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /></div>
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
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 14px; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0 40px; }
        .logo { font-weight: 900; color: var(--acc); margin:0; }
        .main-grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
        .meter-row { display: flex; gap: 15px; font-size: 0.75rem; font-family: monospace; color: #888; margin-top: 5px; }
        .canvas-container { position: relative; width: 100%; height: 180px; background: rgba(0,0,0,0.2); border-radius: 10px; overflow: hidden; cursor: pointer; }
        canvas { width: 100%; height: 100%; }
        .playback-bar { position: absolute; top:0; bottom:0; width: 2px; background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.8); pointer-events: none; }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 8px 16px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 0.75rem; }
        .play-btn.dl { background: #3b82f6; color: #fff; text-decoration: none; }
        .dropzone { display: block; padding: 20px; border: 1.5px dashed var(--brd); text-align: center; border-radius: 10px; cursor: pointer; color: #666; font-size: 0.8rem; }
        .file-list { list-style: none; padding: 0; margin: 15px 0; }
        .file-list li { padding: 12px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 5px; }
        .file-list li.active { background: rgba(74,222,128,0.1); color: var(--acc); border: 1px solid var(--acc); }
        .btn-main { width: 100%; padding: 18px; background: var(--acc); color: #000; border: none; border-radius: 10px; font-weight: 900; cursor: pointer; margin-top: 10px; }
        .genre-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
        .genre-grid button { background: #222; border: 1px solid #333; color: #eee; padding: 8px; border-radius: 6px; font-size: 0.7rem; cursor: pointer; }
        input[type="range"] { width: 100%; accent-color: var(--acc); }
        .no-file { position: absolute; inset:0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); color: #666; font-size: 0.8rem; }
        .login-hero { text-align: center; padding: 100px 0; }
        .login-hero h1 { font-size: 4rem; letter-spacing: -3px; font-weight: 900; }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 20px 50px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
      `}} />
    </main>
  )
}

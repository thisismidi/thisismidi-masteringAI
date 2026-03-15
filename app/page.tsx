'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

// 1. Supabase 설정
const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)

// 엔진 주소 (허깅페이스 Direct URL)
const ENGINE_URL = "https://thisismidi-thisismidi-mastering-engine.hf.space/master"

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE') 
  const [isLightMode, setIsLightMode] = useState(false)
  
  // 1번 기능: 여러 곡 결과 저장
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) 
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 3번 기능: 실시간 시각화 상태
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

  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // --- [인증 및 세션] ---
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

  // --- [파형 그리기 로직] ---
  const drawStaticWaveform = async (file: File, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const arrayBuffer = await file.arrayBuffer()
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      const rawData = audioBuffer.getChannelData(0)
      const samples = canvas.width
      const blockSize = Math.floor(rawData.length / samples)
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      for (let i = 0; i < samples; i++) {
        let min = 1.0, max = -1.0
        for (let j = 0; j < blockSize; j++) {
          const val = rawData[i * blockSize + j]
          if (val < min) min = val; if (val > max) max = val
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2)
        ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke()
      await audioCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) {
      drawStaticWaveform(files[activeIndex], origCanvas.current, '#4ade80')
    }
  }, [files, activeIndex, isLightMode])

  // --- [실시간 미터링 & 재생바 (3번)] ---
  const startVisualizing = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 256
    const source = ctx.createMediaElementSource(audioElement)
    source.connect(analyzer)
    analyzer.connect(ctx.destination)

    const update = () => {
      const dataArray = new Uint8Array(analyzer.frequencyBinCount)
      analyzer.getByteTimeDomainData(dataArray)
      let sumSquares = 0
      for (let i = 0; i < dataArray.length; i++) {
        const norm = (dataArray[i] - 128) / 128
        sumSquares += norm * norm
      }
      const rms = Math.sqrt(sumSquares / dataArray.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : -100
      
      if (type === 'orig') setOrigDb(Math.round(db * 10) / 10)
      else setMastDb(Math.round(db * 10) / 10)
      
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  // --- [마스터링 실행] ---
  const runMastering = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    const currentFile = files[activeIndex]
    const formData = new FormData()
    formData.append("file", currentFile)
    formData.append("target_lufs", targetLufs)
    formData.append("true_peak", truePeak)
    
    try {
      const response = await fetch(ENGINE_URL, { method: "POST", body: formData })
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      setMasteredUrls(prev => ({ ...prev, [activeIndex]: url }))
      setIsProcessing(false)
      
      // 마스터링 완료 후 파형 그리기
      setTimeout(() => {
        if (mastCanvas.current) {
          const masteredFile = new File([blob], "mastered.wav", { type: "audio/wav" })
          drawStaticWaveform(masteredFile, mastCanvas.current, '#3b82f6')
        }
      }, 100)
    } catch (error) {
      alert("서버 연결 실패. 다시 시도해 주세요.")
      setIsProcessing(false)
    }
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
      <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e) => setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setOrigDuration(e.currentTarget.duration)} />
      <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e) => setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setMastDuration(e.currentTarget.duration)} />

      <div className="container" style={{maxWidth:'1200px', margin:'0 auto', padding:'20px'}}>
        <header style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 style={{color:'var(--acc)', fontSize:'1.5rem', fontWeight:900, margin:0}}>THISISMIDI <span style={{opacity:0.3}}>.</span></h1>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            {user && <span style={{fontSize:'0.7rem', color:'#888', marginRight:'10px'}}>TIER: <b style={{color: isPro ? '#3b82f6' : 'var(--txt)'}}>{tier}</b></span>}
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
          </div>
        </header>

        {!user ? (
          <div style={{textAlign:'center', padding:'100px 0'}}>
            <h1 style={{fontSize:'3.5rem', letterSpacing:'-2px', marginBottom:'20px', fontWeight:900}}>Mastering, <br/>Redefined.</h1>
            <button onClick={() => supabase.auth.signInWithOAuth({provider:'google'})} className="btn-login">Start with Google</button>
          </div>
        ) : (
          <div className="dash">
            <section className="panel" style={{marginBottom:'20px', padding:'0'}}>
              <div style={{padding:'15px 20px', borderBottom:'1px solid var(--brd)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <h2 style={{fontSize:'0.9rem', margin:0, fontWeight:'bold'}}>Track Queue</h2>
                <span style={{fontSize:'0.7rem', color:'#888', background:'var(--bg)', padding:'4px 8px', borderRadius:'4px'}}>{files.length} / {isPro ? 15 : 1} tracks</span>
              </div>
              <div style={{padding:'20px'}}>
                <input type="file" id="u-file" hidden accept="audio/*" multiple={isPro} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                <label htmlFor="u-file" className="dropzone">Drop files or <b style={{color:'var(--acc)'}}>Click to Upload</b></label>
                <ul className="file-list">
                  {files.map((f, i) => (
                    <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => setActiveIndex(i)}>
                      <span>{i + 1}. {f.name}</span>
                      {masteredUrls[i] && <span className="badge-done">DONE</span>}
                    </li>
                  ))}
                </ul>
                <button onClick={runMastering} className="render-btn" disabled={files.length === 0 || isProcessing}>
                  {isProcessing ? 'PROCESSING AUDIO...' : 'START MASTERING'}
                </button>
              </div>
            </section>

            <div className="main-grid">
              <div className="monitors">
                {/* ORIGINAL MONITOR */}
                <div className="panel" style={{marginBottom:'20px'}}>
                  <div className="monitor-header">
                    <p className="p-label">ORIGINAL WAVEFORM {origIsPlaying && <span className="meter">{origDb} dB</span>}</p>
                    <button onClick={() => togglePlay('orig')} className="play-btn">{origIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                  </div>
                  <div className="canvas-container">
                    <canvas ref={origCanvas} width={700} height={180} />
                    <div className="play-bar" style={{left: `${(origTime/origDuration)*100}%`}} />
                  </div>
                </div>

                {/* MASTERED MONITOR */}
                <div className="panel">
                  <div className="monitor-header">
                    <p className="p-label">MASTERED WAVEFORM {mastIsPlaying && <span className="meter" style={{color:'#3b82f6'}}>{mastDb} dB</span>}</p>
                    <div style={{display:'flex', gap:'10px'}}>
                      <button onClick={() => togglePlay('mast')} className="play-btn" disabled={!masteredUrls[activeIndex]}>{mastIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`}><button className="play-btn" style={{background:'#3b82f6'}}>⬇ DOWNLOAD</button></a>}
                    </div>
                  </div>
                  <div className="canvas-container">
                    <canvas ref={mastCanvas} width={700} height={180} />
                    {!masteredUrls[activeIndex] && <div className="no-file">{isProcessing ? 'Processing...' : 'No mastered file yet'}</div>}
                    <div className="play-bar" style={{left: `${(mastTime/mastDuration)*100}%`}} />
                  </div>
                </div>
              </div>

              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">MASTERING SETTINGS</p>
                  <div className="row">
                    <div className="row-label"><label>Target LUFS</label><span>{targetLufs}</span></div>
                    <input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} />
                  </div>
                  <div className="row">
                    <div className="row-label"><label>True Peak</label><span>{truePeak} dB</span></div>
                    <input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} />
                  </div>
                </div>
                <div className="panel" style={{opacity: isPro ? 1 : 0.3}}>
                  <p className="p-label">PRO FEATURES {!isPro && '🔒'}</p>
                  <div className="row" style={{fontSize:'0.75rem', color:'#666'}}>장르 프리셋 기능이 곧 업데이트 됩니다.</div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        .light-mode { --bg: #f5f5f7; --p: #fff; --brd: #d2d2d7; --txt: #1c1c1e; --acc: #0071e3; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; transition: 0.2s; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 12px; padding: 20px; }
        .monitor-header { display: flex; justify-content: space-between; align-items: center; marginBottom: 15px; }
        .p-label { font-size: 0.65rem; font-weight: bold; color: #888; margin: 0; display: flex; align-items: center; }
        .meter { margin-left: 10px; color: var(--acc); font-family: monospace; font-size: 0.8rem; }
        .canvas-container { position: relative; width: 100%; height: 180px; background: rgba(0,0,0,0.2); border-radius: 8px; overflow: hidden; margin-top: 15px; }
        canvas { width: 100%; height: 100%; display: block; }
        .play-bar { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; pointer-events: none; transition: 0.1s linear; }
        .no-file { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; alignItems: center; justifyContent: center; color: #555; font-size: 0.8rem; background: rgba(0,0,0,0.5); }
        .main-grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.7rem; font-weight: bold; }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 6px 14px; border-radius: 6px; font-weight: bold; font-size: 0.7rem; cursor: pointer; }
        .play-btn:disabled { opacity: 0.2; }
        .dropzone { display: block; padding: 20px; border: 1px dashed var(--brd); text-align: center; border-radius: 8px; color: #666; font-size: 0.8rem; cursor: pointer; }
        .file-list { list-style: none; padding: 0; margin: 15px 0; max-height: 150px; overflow-y: auto; }
        .file-list li { padding: 10px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 5px; border: 1px solid transparent; }
        .file-list li.active { background: rgba(74,222,128,0.1); border-color: var(--acc); color: var(--acc); }
        .badge-done { background: var(--acc); color: #000; padding: 2px 6px; border-radius: 4px; font-size: 0.6rem; font-weight: bold; }
        .render-btn { width: 100%; background: var(--acc); color: #000; border: none; padding: 16px; border-radius: 10px; font-weight: 900; cursor: pointer; margin-top: 10px; }
        .row { margin-bottom: 15px; }
        .row-label { display: flex; justify-content: space-between; font-size: 0.75rem; color: #888; margin-bottom: 8px; }
        input[type="range"] { width: 100%; accent-color: var(--acc); cursor: pointer; }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 18px 48px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
      `}} />
    </main>
  )
}

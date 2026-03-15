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
  
  // 파일 및 결과 저장소 (1번 기능: 여러 곡 관리)
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) // 인덱스별 결과물 저장
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 플레이어 및 시각화 상태 (3번 기능: 실시간 정보)
  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDb, setOrigDb] = useState(-100)
  const [mastDb, setMastDb] = useState(-100)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  
  // Web Audio API 분석용 Ref
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyzerRef = useRef<AnalyserNode | null>(null)
  const rafIdRef = useRef<number | null>(null)

  // 엔진 파라미터
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // --- [로그인 및 세션 관리] ---
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

  // --- [실시간 미터링 로직 (3번)] ---
  const startMetering = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 256
    const source = ctx.createMediaElementSource(audioElement)
    source.connect(analyzer)
    analyzer.connect(ctx.destination)
    analyzerRef.current = analyzer

    const bufferLength = analyzer.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const update = () => {
      analyzer.getByteTimeDomainData(dataArray)
      let sumSquares = 0
      for (let i = 0; i < bufferLength; i++) {
        const norm = (dataArray[i] - 128) / 128
        sumSquares += norm * norm
      }
      const rms = Math.sqrt(sumSquares / bufferLength)
      const db = rms > 0 ? 20 * Math.log10(rms) : -100
      
      if (type === 'orig') setOrigDb(Math.round(db * 10) / 10)
      else setMastDb(Math.round(db * 10) / 10)
      
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  const stopMetering = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    setOrigDb(-100); setMastDb(-100)
  }

  // --- [파형 그리기 및 재생바 (3번)] ---
  const drawWaveform = async (url: string, canvas: HTMLCanvasElement, color: string, currentTime: number) => {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 1. 파형 데이터 로드 및 그리기 (기존 로직 최적화)
    const resp = await fetch(url)
    const arrayBuffer = await resp.arrayBuffer()
    const audioCtx = new AudioContext()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const rawData = audioBuffer.getChannelData(0)
    const samples = 1000
    const blockSize = Math.floor(rawData.length / samples)
    const filteredData = []
    for (let i = 0; i < samples; i++) filteredData.push(Math.abs(rawData[i * blockSize]))

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = color
    filteredData.forEach((val, i) => {
      const height = val * canvas.height * 0.8
      ctx.fillRect(i * (canvas.width / samples), (canvas.height - height) / 2, 1.5, height)
    })

    // 2. 하얀색 재생 바 그리기 (3번 기능의 핵심)
    const duration = audioBuffer.duration
    const x = (currentTime / duration) * canvas.width
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(x, 0, 2, canvas.height)
    await audioCtx.close()
  }

  // --- [마스터링 실행 (1번 통합)] ---
  const runMastering = async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    const currentFile = files[activeIndex]
    const formData = new FormData()
    formData.append("file", currentFile)
    formData.append("target_lufs", targetLufs)
    formData.append("true_peak", truePeak)
    
    try {
      const response = await fetch('https://thisismidi-thisismidi-mastering-engine.hf.space/master', { method: "POST", body: formData })
      if (!response.ok) throw new Error("Engine Error")
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      
      // 해당 인덱스에 결과물 저장 (1번 기능)
      setMasteredUrls(prev => ({ ...prev, [activeIndex]: url }))
      setIsProcessing(false)
    } catch (error) {
      alert("마스터링 실패. 파일이나 서버를 확인해주세요.")
      setIsProcessing(false)
    }
  }

  // --- [곡 변경 및 재생 제어] ---
  const handleFileClick = (index: number) => {
    stopMetering()
    setOrigIsPlaying(false); setMastIsPlaying(false)
    setActiveIndex(index)
  }

  const togglePlay = (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return

    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); stopMetering(); }
      else { audio.play(); startMetering(audio, 'orig'); mastAudioRef.current?.pause(); setMastIsPlaying(false); }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); stopMetering(); }
      else { audio.play(); startMetering(audio, 'mast'); origAudioRef.current?.pause(); setOrigIsPlaying(false); }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <header className="header">
        <h1 className="logo">THISISMIDI <span className="dot">.</span></h1>
        <div className="header-right">
          <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
          {user ? <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button> : <button onClick={() => supabase.auth.signInWithOAuth({provider:'google'})} className="btn-ui">LOGIN</button>}
        </div>
      </header>

      <div className="container">
        {/* Track Queue (1번 기능: 여러 곡 리스트) */}
        <section className="panel queue">
          <h3>Track Queue ({files.length} / {isPro ? 15 : 1})</h3>
          <input type="file" id="u-file" hidden accept="audio/*" multiple={isPro} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          <label htmlFor="u-file" className="dropzone">Click or Drop Audio Files</label>
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => handleFileClick(i)}>
                <span>{i + 1}. {f.name}</span>
                {masteredUrls[i] && <span className="badge-done">DONE</span>}
              </li>
            ))}
          </ul>
        </section>

        <div className="main-grid">
          {/* Waveform & Meters (3번 기능: 시각화) */}
          <section className="visualizer">
            <div className="panel">
              <div className="panel-header">
                <p>ORIGINAL {origIsPlaying && <span className="meter-val">{origDb} dB</span>}</p>
                <button onClick={() => togglePlay('orig')} className="btn-play">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
              </div>
              <canvas ref={origCanvas} width={800} height={150} onClick={() => drawWaveform(URL.createObjectURL(files[activeIndex]), origCanvas.current!, '#4ade80', origTime)} />
              <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e) => setOrigTime(e.currentTarget.currentTime)} />
            </div>

            <div className="panel">
              <div className="panel-header">
                <p>MASTERED {mastIsPlaying && <span className="meter-val" style={{color:'#3b82f6'}}>{mastDb} dB</span>}</p>
                <button onClick={() => togglePlay('mast')} className="btn-play" disabled={!masteredUrls[activeIndex]}>PLAY</button>
              </div>
              <canvas ref={mastCanvas} width={800} height={150} />
              <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e) => setMastTime(e.currentTarget.currentTime)} />
              {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`} className="btn-download">DOWNLOAD WAV</a>}
            </div>
          </section>

          {/* Controls */}
          <aside className="controls panel">
            <p className="p-label">MASTERING SETTINGS</p>
            <div className="row">
              <label>Target LUFS: {targetLufs}</label>
              <input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e) => setTargetLufs(e.target.value)} />
            </div>
            <div className="row">
              <label>True Peak: {truePeak} dB</label>
              <input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e) => setTruePeak(e.target.value)} />
            </div>
            <button onClick={runMastering} className="btn-main" disabled={isProcessing || files.length === 0}>
              {isProcessing ? 'PROCESSING...' : 'START MASTERING'}
            </button>
          </aside>
        </div>
      </div>

      <style jsx>{`
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        .dark-mode { background: var(--bg); color: var(--txt); }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; display: grid; grid-template-rows: auto 1fr; gap: 20px; }
        .header { display: flex; justify-content: space-between; padding: 20px 40px; align-items: center; }
        .logo { font-weight: 900; color: var(--acc); }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 12px; padding: 20px; }
        .main-grid { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
        .dropzone { display: block; padding: 30px; border: 2px dashed var(--brd); text-align: center; border-radius: 10px; cursor: pointer; color: #666; }
        .file-list { list-style: none; padding: 0; margin-top: 20px; }
        .file-list li { padding: 12px; border-bottom: 1px solid #222; cursor: pointer; display: flex; justify-content: space-between; }
        .file-list li.active { background: #222; color: var(--acc); border-left: 3px solid var(--acc); }
        .badge-done { font-size: 0.6rem; background: var(--acc); color: #000; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        .btn-play { background: #fff; color: #000; border: none; padding: 6px 15px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .meter-val { font-family: monospace; margin-left: 15px; color: var(--acc); font-weight: bold; }
        canvas { width: 100%; background: #000; border-radius: 8px; margin: 10px 0; }
        .btn-main { width: 100%; padding: 20px; background: var(--acc); border: none; border-radius: 10px; font-weight: 900; cursor: pointer; }
        .btn-main:disabled { opacity: 0.3; }
        .btn-download { display: block; text-align: center; background: #3b82f6; color: #fff; padding: 10px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; }
      `}</style>
    </main>
  )
}

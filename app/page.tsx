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
  
  // 데이터 및 마스터링 상태
  const [files, setFiles] = useState<File[]>([])
  const [masteredUrls, setMasteredUrls] = useState<{[key: number]: string}>({}) 
  const [activeIndex, setActiveIndex] = useState<number>(0)
  const [isProcessing, setIsProcessing] = useState(false)

  // 실시간 미터링 (LUFS & dBTP)
  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)

  // 플레이어 및 시각화 상태
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

  // Pro 버전 파라미터 유지
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [warmth, setWarmth] = useState("0")
  const [stereoWidth, setStereoWidth] = useState("100")
  const [monoBass, setMonoBass] = useState("0")

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  // 브라우저 탭 타이틀 변경
  useEffect(() => {
    document.title = "THISISMIDI Mastering AI";
  }, []);

  // --- [핵심: 파형 그리기 로직 (로딩 즉시 실행)] ---
  const drawWaveform = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const arrayBuffer = (typeof file === 'string') ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer)
      const rawData = audioBuffer.getChannelData(0)
      const samples = canvas.width
      const blockSize = Math.floor(rawData.length / samples)
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5
      for (let i = 0; i < samples; i++) {
        let min = 1.0, max = -1.0
        for (let j = 0; j < blockSize; j++) {
          const val = rawData[i * blockSize + j]; if (val < min) min = val; if (val > max) max = val
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await tempCtx.close()
    } catch (e) { console.error("Waveform Error:", e) }
  }

  // 곡 로딩 시 오리지널 파형 즉시 출력
  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) {
      drawWaveform(files[activeIndex], origCanvas.current, isLightMode ? '#0071e3' : '#4ade80')
    }
    if (masteredUrls[activeIndex] && mastCanvas.current) {
      drawWaveform(masteredUrls[activeIndex], mastCanvas.current, '#3b82f6')
    }
  }, [files, activeIndex, isLightMode, masteredUrls])

  // --- [핵심: 실시간 분석 및 소리 재생 로직] ---
  const startAnalyzing = (audioElement: HTMLAudioElement, type: 'orig' | 'mast') => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtxRef.current; if (ctx.state === 'suspended') ctx.resume()
    
    // 오디오 소스 노드 중복 생성 방지 (소리 안 나오는 문제 해결)
    let source = sourceNodes.current.get(audioElement)
    if (!source) {
      source = ctx.createMediaElementSource(audioElement)
      sourceNodes.current.set(audioElement, source)
    }

    const analyzer = ctx.createAnalyser(); analyzer.fftSize = 2048
    source.connect(analyzer); analyzer.connect(ctx.destination)

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

  // 구간 이동 (Seeking) - 정확한 위치 이동 보장
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, audioRef: React.RefObject<HTMLAudioElement>, duration: number) => {
    if (!audioRef.current || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const targetTime = (x / rect.width) * duration
    audioRef.current.currentTime = targetTime
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return

    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play(); startAnalyzing(audio, 'orig');
        mastAudioRef.current?.pause(); setMastIsPlaying(false);
      }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); }
      else { 
        await audio.play(); startAnalyzing(audio, 'mast');
        origAudioRef.current?.pause(); setOrigIsPlaying(false);
      }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  // --- [나머지 필수 로직 유지] ---
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
        <header className="header" style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 className="logo" style={{color:'var(--acc)', fontWeight:900, fontSize:'1.4rem', margin:0}}>THISISMIDI <span className="dot" style={{opacity:0.3}}>.</span></h1>
          <div className="header-right" style={{display:'flex', gap:'10px'}}>
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user && <button onClick={() => supabase.auth.signOut()} className="btn-ui">LOGOUT</button>}
          </div>
        </header>

        {user ? (
          <div className="dash" style={{display:'flex', flexDirection:'column', gap:'20px'}}>
            <section className="panel">
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:'15px'}}>
                <h2 style={{fontSize:'0.9rem', fontWeight:'bold', margin:0}}>Track Queue</h2>
                <span style={{fontSize:'0.7rem', color:'#888'}}>{files.length} tracks</span>
              </div>
              <input type="file" id="u-file" hidden multiple onChange={(e)=>setFiles(Array.from(e.target.files || []))} />
              <label htmlFor="u-file" className="dropzone" style={{display:'block', padding:'25px', border:'1px dashed var(--brd)', borderRadius:'10px', textAlign:'center', cursor:'pointer', color:'#666', fontSize:'0.8rem'}}>Drop or <b style={{color:'var(--acc)'}}>Click to Upload</b></label>
              <ul className="file-list" style={{listStyle:'none', padding:0, margin:'15px 0'}}>
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => { setActiveIndex(i); setOrigIsPlaying(false); setMastIsPlaying(false); }} style={{padding:'12px', borderRadius:'8px', cursor:'pointer', display:'flex', justifyContent:'space-between', marginBottom:'5px', background: activeIndex === i ? 'rgba(74,222,128,0.1)' : 'transparent', border: activeIndex === i ? '1px solid var(--acc)' : '1px solid transparent'}}>
                    <span style={{fontSize:'0.85rem'}}>{i+1}. {f.name}</span>
                    {masteredUrls[i] && <span style={{fontSize:'0.6rem', background:'var(--acc)', color:'#000', padding:'2px 6px', borderRadius:'4px', fontWeight:'bold'}}>DONE</span>}
                  </li>
                ))}
              </ul>
              <button onClick={runMastering} className="btn-main" disabled={isProcessing || files.length === 0} style={{width:'100%', padding:'18px', background:'var(--acc)', color:'#000', border:'none', borderRadius:'10px', fontWeight:900, cursor:'pointer'}}>{isProcessing ? 'PROCESSING...' : 'START MASTERING'}</button>
            </section>

            <div className="main-grid" style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'20px'}}>
              <div className="monitors">
                {/* ORIGINAL MONITOR */}
                <div className="panel monitor-card" style={{marginBottom:'20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <div>
                      <p className="p-label" style={{fontSize:'0.65rem', fontWeight:'bold', color:'#888', margin:0}}>ORIGINAL SOURCE</p>
                      <div style={{display:'flex', gap:'12px', fontSize:'0.75rem', fontFamily:'monospace', marginTop:'4px'}}>
                        <span style={{color:'var(--acc)'}}>LUFS: <b>{origLufs}</b></span>
                        <span style={{color: origTp > 0 ? '#ff4d4d' : 'inherit'}}>TP: <b>{origTp} dBTP</b></span>
                      </div>
                    </div>
                    <button onClick={()=>togglePlay('orig')} className="play-btn" style={{background:'var(--txt)', color:'var(--bg)', border:'none', padding:'7px 14px', borderRadius:'7px', fontWeight:'bold', cursor:'pointer'}}>{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                  </div>
                  <div className="canvas-container" onClick={(e)=>handleSeek(e, origAudioRef, origDuration)} style={{position:'relative', height:'180px', background:'rgba(0,0,0,0.05)', borderRadius:'10px', overflow:'hidden', cursor:'pointer', border:'1px solid var(--brd)'}}>
                    <canvas ref={origCanvas} width={700} height={180} style={{width:'100%', height:'100%'}} />
                    <div className="playback-bar" style={{position:'absolute', top:0, bottom:0, width:'2px', background:'#fff', left:`${(origTime/origDuration)*100}%`, pointerEvents:'none', boxShadow:'0 0 10px #fff'}} />
                  </div>
                  <audio ref={origAudioRef} src={files[activeIndex] ? URL.createObjectURL(files[activeIndex]) : ''} onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} />
                </div>

                {/* MASTERED MONITOR */}
                <div className="panel monitor-card">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <div>
                      <p className="p-label" style={{fontSize:'0.65rem', fontWeight:'bold', color:'#3b82f6', margin:0}}>MASTERED OUTPUT</p>
                      <div style={{display:'flex', gap:'12px', fontSize:'0.75rem', fontFamily:'monospace', marginTop:'4px'}}>
                        <span style={{color:'#3b82f6'}}>LUFS: <b>{mastLufs}</b></span>
                        <span style={{color: mastTp > 0 ? '#ff4d4d' : '#3b82f6'}}>TP: <b>{mastTp} dBTP</b></span>
                      </div>
                    </div>
                    <div style={{display:'flex', gap:'8px'}}>
                      <button onClick={()=>togglePlay('mast')} className="play-btn" disabled={!masteredUrls[activeIndex]} style={{background:'var(--txt)', color:'var(--bg)', border:'none', padding:'7px 14px', borderRadius:'7px', fontWeight:'bold', cursor:'pointer'}}>{mastIsPlaying ? 'STOP' : 'PLAY'}</button>
                      {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={`Mastered_${files[activeIndex].name}`} style={{background:'#3b82f6', color:'#fff', padding:'7px 14px', borderRadius:'7px', fontWeight:'bold', textDecoration:'none', fontSize:'0.75rem'}}>DOWNLOAD</a>}
                    </div>
                  </div>
                  <div className="canvas-container" onClick={(e)=>handleSeek(e, mastAudioRef, mastDuration)} style={{position:'relative', height:'180px', background:'rgba(0,0,0,0.05)', borderRadius:'10px', overflow:'hidden', cursor:'pointer', border:'1px solid var(--brd)'}}>
                    <canvas ref={mastCanvas} width={700} height={180} style={{width:'100%', height:'100%'}} />
                    <div className="playback-bar" style={{position:'absolute', top:0, bottom:0, width:'2px', background:'#fff', left:`${(mastTime/mastDuration)*100}%`, pointerEvents:'none', boxShadow:'0 0 10px #fff'}} />
                    {!masteredUrls[activeIndex] && <div className="no-file-msg" style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#999', fontSize:'0.8rem', background:'rgba(0,0,0,0.03)'}}>{isProcessing ? 'Processing...' : 'Ready to Master'}</div>}
                  </div>
                  <audio ref={mastAudioRef} src={masteredUrls[activeIndex] || ''} onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)} />
                </div>
              </div>

              {/* PRO SETTINGS */}
              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label" style={{fontSize:'0.65rem', fontWeight:'bold', color:'#888', marginBottom:'15px'}}>PRO SETTINGS</p>
                  <div style={{marginBottom:'15px'}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.75rem', marginBottom:'8px'}}><label>Warmth</label><span>{warmth}%</span></div>
                    <input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} style={{width:'100%', accentColor:'var(--acc)'}} disabled={!isPro} />
                  </div>
                  <div style={{marginBottom:'15px'}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.75rem', marginBottom:'8px'}}><label>Stereo Width</label><span>{stereoWidth}%</span></div>
                    <input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} style={{width:'100%', accentColor:'var(--acc)'}} disabled={!isPro} />
                  </div>
                  <div style={{marginBottom:'15px'}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.75rem', marginBottom:'8px'}}><label>Mono Bass</label><span>{monoBass}%</span></div>
                    <input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} style={{width:'100%', accentColor:'var(--acc)'}} disabled={!isPro} />
                  </div>
                </div>
                <div className="panel">
                  <p className="p-label" style={{fontSize:'0.65rem', fontWeight:'bold', color:'#888', marginBottom:'15px'}}>LOUDNESS</p>
                  <div style={{marginBottom:'15px'}}>
                    <div style={{display:'flex', justifyContent:'space-between', fontSize:'0.75rem', marginBottom:'8px'}}><label>Target LUFS</label><span>{targetLufs}</span></div>
                    <input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} style={{width:'100%', accentColor:'var(--acc)'}} />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        ) : (
          <div className="login-hero" style={{textAlign:'center', padding:'100px 0'}}>
            <h1 style={{fontSize:'4rem', letterSpacing:'-3px', fontWeight:900, lineHeight:1}}>Mastering, <br/>Redefined.</h1>
            <button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} style={{background:'var(--txt)', color:'var(--bg)', border:'none', padding:'20px 50px', borderRadius:'50px', fontWeight:'bold', fontSize:'1.1rem', marginTop:'20px', cursor:'pointer'}}>Start with Google</button>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0b0b0b; --p: #161616; --brd: #2a2a2a; --txt: #fff; --acc: #4ade80; }
        .light-mode { --bg: #ffffff; --p: #ffffff; --brd: #e1e1e1; --txt: #000000; --acc: #0071e3; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; transition: 0.3s; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 14px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.7rem; font-weight: bold; }
        input[type="range"] { width: 100%; accent-color: var(--acc); cursor: pointer; }
      `}} />
    </main>
  )
}

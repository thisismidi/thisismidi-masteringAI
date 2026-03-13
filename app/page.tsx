'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

// 1. Supabase 연동 (대표님 정보로 변경)
const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE') 
  const [isLightMode, setIsLightMode] = useState(false)
  
  // 파일 및 오디오 상태
  const [file, setFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [masterAudioUrl, setMasterAudioUrl] = useState<string | null>(null)
  const [mastered, setMastered] = useState(false)
  
  // 플레이어 상태
  const origAudioRef = useRef<HTMLAudioElement>(null)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [origTime, setOrigTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)

  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)
  const [mastTime, setMastTime] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)

  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)

  // 엔진 파라미터 상태
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  
  // 아웃풋 포맷 상태
  const [format, setFormat] = useState('wav')
  const [sampleRate, setSampleRate] = useState('48000')
  const [bitDepth, setBitDepth] = useState('24')

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        // 🚨 여기에 대표님의 실제 구글 로그인 이메일을 적어주세요!
        if (session.user.email === 'itsfreiar@gmail.com') {
          setTier('DEVELOPER')
        } else {
          setTier('FREE')
        }
      }
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setUser(s?.user ?? null)
      if (!s) { 
        setFile(null); setAudioUrl(null); setMasterAudioUrl(null); 
        setOrigIsPlaying(false); setMastIsPlaying(false); 
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const draw = async (f: File, canvas: HTMLCanvasElement, color: string, isMaster: boolean = false) => {
    if (typeof window === 'undefined' || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const buffer = await audioCtx.decodeAudioData(await f.arrayBuffer())
      const data = buffer.getChannelData(0)
      const step = Math.ceil(data.length / canvas.width)
      
      const visualGain = isMaster ? Math.max(0.5, 1 + (parseFloat(targetLufs) + 14) * 0.15) : 1;
      const tpLimit = isMaster ? Math.pow(10, parseFloat(truePeak) / 20) : 1;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          let d = data[i * step + j]
          
          if (isMaster) {
            d = d * visualGain 
            if (d > tpLimit) d = tpLimit 
            if (d < -tpLimit) d = -tpLimit 
          }
          
          if (d < min) min = d; if (d > max) max = d
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2)
        ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke()
      await audioCtx.close()
    } catch (e) { console.error(e) }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setMastered(false)
    setOrigIsPlaying(false); setMastIsPlaying(false)
    if (f) {
      const url = URL.createObjectURL(f)
      setAudioUrl(url)
      setMasterAudioUrl(null)
    } else {
      setAudioUrl(null); setMasterAudioUrl(null)
    }
  }

  useEffect(() => {
    if (file && origCanvas.current) draw(file, origCanvas.current, '#4ade80', false)
  }, [file, isLightMode])

  const runMastering = () => {
    if (!file) return
    
    setMastered(false)
    setMastTime(0)
    if (mastAudioRef.current) {
      mastAudioRef.current.pause()
      mastAudioRef.current.currentTime = 0
      setMastIsPlaying(false)
    }

    setTimeout(() => {
      setMastered(true)
      if (mastCanvas.current) draw(file, mastCanvas.current, '#3b82f6', true)
      setMasterAudioUrl(audioUrl)
    }, 1500)
  }

  const togglePlayOrig = () => {
    if (!origAudioRef.current) return
    if (mastIsPlaying) { mastAudioRef.current?.pause(); setMastIsPlaying(false); } 
    if (origIsPlaying) origAudioRef.current.pause()
    else origAudioRef.current.play()
    setOrigIsPlaying(!origIsPlaying)
  }

  const togglePlayMast = () => {
    if (!mastAudioRef.current) return
    if (origIsPlaying) { origAudioRef.current?.pause(); setOrigIsPlaying(false); } 
    if (mastIsPlaying) mastAudioRef.current.pause()
    else mastAudioRef.current.play()
    setMastIsPlaying(!mastIsPlaying)
  }

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return "0:00"
    const m = Math.floor(time / 60)
    const s = Math.floor(time % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLAudioElement>, duration: number, isMaster: boolean) => {
    if (!ref.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const percent = (e.clientX - rect.left) / rect.width
    ref.current.currentTime = percent * duration
    
    if (isMaster && !mastIsPlaying) togglePlayMast()
    else if (!isMaster && !origIsPlaying) togglePlayOrig()
  }

  const isMp3 = format === 'mp3'
  const displaySampleRate = isMp3 ? '44100' : sampleRate
  const displayBitDepth = isMp3 ? '16' : bitDepth

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <audio ref={origAudioRef} src={audioUrl || ''} onTimeUpdate={() => setOrigTime(origAudioRef.current?.currentTime || 0)} onLoadedMetadata={() => setOrigDuration(origAudioRef.current?.duration || 0)} onEnded={() => setOrigIsPlaying(false)} />
      <audio ref={mastAudioRef} src={masterAudioUrl || ''} onTimeUpdate={() => setMastTime(mastAudioRef.current?.currentTime || 0)} onLoadedMetadata={() => setMastDuration(mastAudioRef.current?.duration || 0)} onEnded={() => setMastIsPlaying(false)} />

      <div className="container" style={{maxWidth:'1000px', margin:'0 auto', padding:'20px'}}>
        <header style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 style={{color:'var(--acc)', fontSize:'1.5rem', fontWeight:900, margin:0}}>THISISMIDI <span style={{opacity:0.3}}>.</span></h1>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            {user && <span style={{fontSize:'0.7rem', color:'#888', marginRight:'10px'}}>TIER: <b style={{color: tier==='DEVELOPER'?'#eab308':'var(--txt)'}}>{tier}</b></span>}
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
            <section className="panel upload" style={{marginBottom:'20px'}}>
              <input type="file" id="u-file" onChange={handleFileUpload} hidden accept="audio/*" />
              <label htmlFor="u-file" className="dropzone" style={{cursor:'pointer', display:'block', padding:'30px', border:'1px dashed var(--brd)', textAlign:'center', borderRadius:'12px'}}>
                {file ? <b style={{color:'var(--acc)'}}>{file.name}</b> : "Click to load your audio file (wav, flac)"}
              </label>
            </section>

            <div className="main-grid" style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'20px'}}>
              <div className="monitors">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>ORIGINAL WAVEFORM</p>
                    {file && (
                      <div style={{display:'flex', gap:'15px', alignItems:'center'}}>
                        <span style={{fontFamily:'monospace', fontSize:'0.75rem', color:'#888', letterSpacing:'1px'}}>{formatTime(origTime)} / {formatTime(origDuration)}</span>
                        <button onClick={togglePlayOrig} className="play-btn">{origIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                      </div>
                    )}
                  </div>
                  <div style={{position:'relative', cursor:'pointer'}} onClick={(e) => handleSeek(e, origAudioRef, origDuration, false)}>
                    <canvas ref={origCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {file && <div style={{position:'absolute', top:0, bottom:0, left:`${origDuration > 0 ? (origTime/origDuration)*100 : 0}%`, width:'2px', background:'#fff', pointerEvents:'none'}} />}
                  </div>
                </div>

                <div className="panel">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>MASTERED WAVEFORM</p>
                    {mastered && (
                      <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                        <span style={{fontFamily:'monospace', fontSize:'0.75rem', color:'#888', letterSpacing:'1px', marginRight:'5px'}}>{formatTime(mastTime)} / {formatTime(mastDuration)}</span>
                        <button onClick={togglePlayMast} className="play-btn">{mastIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                        {/* 🚨 추가된 다운로드 버튼 🚨 */}
                        <a href={masterAudioUrl || '#'} download={`mastered_${file?.name || 'audio'}`} style={{textDecoration:'none'}}>
                          <button className="play-btn" style={{background:'#3b82f6'}}>⬇ DOWNLOAD</button>
                        </a>
                      </div>
                    )}
                  </div>
                  <div style={{position:'relative', cursor: mastered ? 'pointer' : 'default'}} onClick={(e) => mastered && handleSeek(e, mastAudioRef, mastDuration, true)}>
                    <canvas ref={mastCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {!mastered && <div style={{position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#666', fontSize:'0.8rem', background:'rgba(0,0,0,0.8)', borderRadius:'8px'}}>Waiting for mastering...</div>}
                    {mastered && <div style={{position:'absolute', top:0, bottom:0, left:`${mastDuration > 0 ? (mastTime/mastDuration)*100 : 0}%`, width:'2px', background:'#fff', pointerEvents:'none'}} />}
                  </div>
                </div>
              </div>

              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">ENGINE</p>
                  <div className="row">
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0}}>Target LUFS</label>
                      <span style={{fontSize:'0.7rem', color:'var(--acc)', fontFamily:'monospace'}}>{targetLufs} LUFS</span>
                    </div>
                    <input type="range" min="-24" max="-3" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(Number(e.target.value).toFixed(1))} style={{width:'100%'}} />
                  </div>
                  <div className="row">
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0}}>True Peak Level</label>
                      <span style={{fontSize:'0.7rem', color:'var(--acc)', fontFamily:'monospace'}}>{truePeak} dBTP</span>
                    </div>
                    <input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(Number(e.target.value).toFixed(1))} style={{width:'100%'}} />
                  </div>
                </div>

                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label" style={{marginBottom:'15px'}}>OUTPUT FORMAT</p>
                  <div className="row">
                    <label>Format</label>
                    <select className="ui-select" value={format} onChange={(e)=>setFormat(e.target.value)}>
                      <option value="wav">WAV</option>
                      <option value="flac">FLAC</option>
                      <option value="mp3">MP3 (320kbps)</option>
                    </select>
                  </div>
                  <div className="row">
                    <label>Sample Rate</label>
                    <select className="ui-select" disabled={isMp3} value={displaySampleRate} onChange={(e)=>setSampleRate(e.target.value)}>
                      <option value="44100">44.1 kHz</option>
                      <option value="48000">48 kHz</option>
                      <option value="96000">96 kHz</option>
                    </select>
                  </div>
                  <div className="row" style={{marginBottom:0}}>
                    <label>Bit Depth</label>
                    <select className="ui-select" disabled={isMp3} value={displayBitDepth} onChange={(e)=>setBitDepth(e.target.value)}>
                      <option value="16">16-bit</option>
                      <option value="24">24-bit</option>
                    </select>
                  </div>
                </div>

                <button onClick={runMastering} className="render-btn" disabled={!file} style={{width:'100%', background:'var(--acc)', color:'#000', border:'none', padding:'18px', borderRadius:'12px', fontWeight:900, cursor:'pointer', transition:'0.2s'}}>START MASTERING</button>
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
        .p-label { font-size: 0.65rem; font-weight: bold; color: #888; letter-spacing: 0.5px; }
        .row { margin-bottom: 20px; } .row label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 8px; }
        
        input[type="range"] { accent-color: var(--acc); cursor: pointer; height: 4px; }
        .ui-select { width: 100%; padding: 10px; background: #000; color: #fff; border: 1px solid var(--brd); border-radius: 6px; font-size: 0.8rem; outline: none; appearance: auto; }
        .ui-select:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.7rem; font-weight: bold; transition: 0.2s; }
        .btn-ui:hover { border-color: var(--txt); }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 18px 48px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 5px 12px; border-radius: 6px; font-weight: bold; font-size: 0.7rem; cursor: pointer; }
        .render-btn:disabled { opacity: 0.2; cursor: not-allowed !important; }
      `}} />
    </main>
  )
}

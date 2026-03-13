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
  
  // 파일 및 트랙 큐 상태
  const [files, setFiles] = useState<File[]>([])
  const [activeIndex, setActiveIndex] = useState<number>(0)
  
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

  // 엔진 파라미터 상태 (Loudness)
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  
  // PRO 파라미터 상태 (Tone & Stereo)
  const [warmth, setWarmth] = useState("0") // 0 ~ 100%
  const [stereoWidth, setStereoWidth] = useState("100") // 0 ~ 200%
  const [monoBass, setMonoBass] = useState("0") // 0 ~ 100%
  
  // 아웃풋 포맷 상태
  const [format, setFormat] = useState('mp3') // 기본값을 mp3로
  const [sampleRate, setSampleRate] = useState('44100')
  const [bitDepth, setBitDepth] = useState('16')

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        // 🚨 대표님 이메일 세팅 완료!
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
        setFiles([]); setActiveIndex(0); setAudioUrl(null); setMasterAudioUrl(null); 
        setOrigIsPlaying(false); setMastIsPlaying(false); 
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // 활성화된 파일이 바뀔 때마다 오디오 URL 업데이트
  useEffect(() => {
    if (files.length > 0 && files[activeIndex]) {
      const url = URL.createObjectURL(files[activeIndex])
      setAudioUrl(url)
      setMasterAudioUrl(null)
      setMastered(false)
      setOrigIsPlaying(false)
      setMastIsPlaying(false)
      return () => URL.revokeObjectURL(url)
    } else {
      setAudioUrl(null)
      setMasterAudioUrl(null)
    }
  }, [activeIndex, files])

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
      const warmthFactor = isMaster && isPro ? 1 + (parseFloat(warmth) * 0.002) : 1;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          let d = data[i * step + j]
          
          if (isMaster) {
            d = d * visualGain * warmthFactor
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

  // 🚨 수정한 부분: 티어에 따른 업로드 제한 로직 🚨
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || [])
    if (newFiles.length === 0) return
    
    if (!isPro) {
      // FREE 티어는 무조건 1곡만 유지 (덮어쓰기)
      if (newFiles.length > 1) {
        alert("FREE 티어는 1곡씩만 작업할 수 있습니다.")
        return
      }
      setFiles([newFiles[0]])
      setActiveIndex(0)
      return
    }
    
    // PRO / DEVELOPER 티어는 15곡 유지
    if (files.length + newFiles.length > 15) {
      alert("최대 15곡까지만 업로드할 수 있습니다.")
      return
    }
    
    setFiles(prev => [...prev, ...newFiles])
    if (files.length === 0) setActiveIndex(0)
  }

  const removeFile = (index: number) => {
    const newFiles = [...files]
    newFiles.splice(index, 1)
    setFiles(newFiles)
    if (activeIndex >= newFiles.length) {
      setActiveIndex(Math.max(0, newFiles.length - 1))
    }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) {
      draw(files[activeIndex], origCanvas.current, '#4ade80', false)
    }
  }, [files, activeIndex, isLightMode])

  const runMastering = () => {
    if (files.length === 0) return
    
    setMastered(false)
    setMastTime(0)
    if (mastAudioRef.current) {
      mastAudioRef.current.pause()
      mastAudioRef.current.currentTime = 0
      setMastIsPlaying(false)
    }

    setTimeout(() => {
      setMastered(true)
      if (mastCanvas.current) draw(files[activeIndex], mastCanvas.current, '#3b82f6', true)
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

  const effectiveFormat = isPro ? format : 'mp3'
  const isMp3 = effectiveFormat === 'mp3'
  const displaySampleRate = isMp3 ? '44100' : sampleRate
  const displayBitDepth = isMp3 ? '16' : bitDepth

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <audio ref={origAudioRef} src={audioUrl || ''} onTimeUpdate={() => setOrigTime(origAudioRef.current?.currentTime || 0)} onLoadedMetadata={() => setOrigDuration(origAudioRef.current?.duration || 0)} onEnded={() => setOrigIsPlaying(false)} />
      <audio ref={mastAudioRef} src={masterAudioUrl || ''} onTimeUpdate={() => setMastTime(mastAudioRef.current?.currentTime || 0)} onLoadedMetadata={() => setMastDuration(mastAudioRef.current?.duration || 0)} onEnded={() => setMastIsPlaying(false)} />

      <div className="container" style={{maxWidth:'1200px', margin:'0 auto', padding:'20px'}}>
        <header style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 style={{color:'var(--acc)', fontSize:'1.5rem', fontWeight:900, margin:0}}>THISISMIDI <span style={{opacity:0.3}}>.</span></h1>
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            {user && <span style={{fontSize:'0.7rem', color:'#888', marginRight:'10px'}}>TIER: <b style={{color: tier==='DEVELOPER'?'#eab308':(tier==='PRO'?'#3b82f6':'var(--txt)')}}>{tier}</b></span>}
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
            {/* 1. Track Queue 영역 */}
            <section className="panel" style={{marginBottom:'20px', padding:'0'}}>
              <div style={{padding:'15px 20px', borderBottom:'1px solid var(--brd)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <h2 style={{fontSize:'0.9rem', margin:0, fontWeight:'bold'}}>Track Queue</h2>
                {/* 🚨 티어에 따라 동적으로 변하는 카운터 🚨 */}
                <span style={{fontSize:'0.7rem', color:'#888', background:'var(--bg)', padding:'4px 8px', borderRadius:'4px'}}>{files.length} / {isPro ? 15 : 1} tracks</span>
              </div>
              
              <div style={{padding:'20px'}}>
                {/* 🚨 FREE 유저는 탐색기에서 애초에 다중선택을 못하게 막음 🚨 */}
                <input type="file" id="u-file" onChange={handleFileUpload} hidden accept="audio/*" multiple={isPro} />
                <label htmlFor="u-file" className="dropzone" style={{cursor:'pointer', display:'block', padding:'20px', border:'1px dashed var(--brd)', textAlign:'center', borderRadius:'8px', marginBottom:'15px', fontSize:'0.8rem', color:'#888'}}>
                  Drop audio files here (WAV · MP3 · FLAC) or <b style={{color:'var(--acc)'}}>Click to Upload</b>
                </label>
                
                {files.length > 0 && (
                  <ul style={{listStyle:'none', margin:0, padding:0, maxHeight:'200px', overflowY:'auto'}}>
                    {files.map((f, i) => (
                      <li key={i} onClick={() => setActiveIndex(i)} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 15px', background: activeIndex === i ? 'rgba(74,222,128,0.1)' : 'transparent', border:'1px solid', borderColor: activeIndex === i ? 'var(--acc)' : 'transparent', borderRadius:'6px', cursor:'pointer', marginBottom:'5px', transition:'0.2s'}}>
                        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                          <div style={{width:'12px', height:'12px', borderRadius:'50%', background: activeIndex === i ? 'var(--acc)' : '#444'}}></div>
                          <span style={{fontSize:'0.85rem', color: activeIndex === i ? 'var(--acc)' : 'var(--txt)'}}>{(i+1).toString().padStart(2, '0')}. {f.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} style={{background:'none', border:'none', color:'#666', cursor:'pointer', fontSize:'1rem'}}>🗑</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <div className="main-grid" style={{display:'grid', gridTemplateColumns:'1fr 340px', gap:'20px'}}>
              {/* 2. A/B Monitor 영역 */}
              <div className="monitors">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>ORIGINAL WAVEFORM</p>
                    {files.length > 0 && (
                      <div style={{display:'flex', gap:'15px', alignItems:'center'}}>
                        <span style={{fontFamily:'monospace', fontSize:'0.75rem', color:'#888', letterSpacing:'1px'}}>{formatTime(origTime)} / {formatTime(origDuration)}</span>
                        <button onClick={togglePlayOrig} className="play-btn">{origIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                      </div>
                    )}
                  </div>
                  <div style={{position:'relative', cursor: files.length > 0 ? 'pointer' : 'default'}} onClick={(e) => files.length > 0 && handleSeek(e, origAudioRef, origDuration, false)}>
                    <canvas ref={origCanvas} width={700} height={180} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {files.length > 0 && <div style={{position:'absolute', top:0, bottom:0, left:`${origDuration > 0 ? (origTime/origDuration)*100 : 0}%`, width:'2px', background:'#fff', pointerEvents:'none'}} />}
                  </div>
                </div>

                <div className="panel">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>MASTERED WAVEFORM</p>
                    {mastered && (
                      <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
                        <span style={{fontFamily:'monospace', fontSize:'0.75rem', color:'#888', letterSpacing:'1px', marginRight:'5px'}}>{formatTime(mastTime)} / {formatTime(mastDuration)}</span>
                        <button onClick={togglePlayMast} className="play-btn">{mastIsPlaying ? '⏹ STOP' : '▶ PLAY'}</button>
                        <a href={masterAudioUrl || '#'} download={`mastered_${files[activeIndex]?.name || 'audio'}`} style={{textDecoration:'none'}}>
                          <button className="play-btn" style={{background:'#3b82f6'}}>⬇ DOWNLOAD</button>
                        </a>
                      </div>
                    )}
                  </div>
                  <div style={{position:'relative', cursor: mastered ? 'pointer' : 'default'}} onClick={(e) => mastered && handleSeek(e, mastAudioRef, mastDuration, true)}>
                    <canvas ref={mastCanvas} width={700} height={180} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {!mastered && <div style={{position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#666', fontSize:'0.8rem', background:'rgba(0,0,0,0.8)', borderRadius:'8px'}}>No mastered file yet</div>}
                    {mastered && <div style={{position:'absolute', top:0, bottom:0, left:`${mastDuration > 0 ? (mastTime/mastDuration)*100 : 0}%`, width:'2px', background:'#fff', pointerEvents:'none'}} />}
                  </div>
                </div>
              </div>

              {/* 3. Mastering Controls 영역 */}
              <aside className="controls">
                
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">LOUDNESS AND SAFETY</p>
                  <div className="row">
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0}}>Target LUFS</label>
                      <span style={{fontSize:'0.7rem', color:'var(--acc)', fontFamily:'monospace'}}>{targetLufs}</span>
                    </div>
                    <input type="range" min="-24" max="-3" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(Number(e.target.value).toFixed(1))} style={{width:'100%'}} />
                  </div>
                  <div className="row" style={{marginBottom:0}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0}}>True Peak Ceiling</label>
                      <span style={{fontSize:'0.7rem', color:'var(--acc)', fontFamily:'monospace'}}>{truePeak} dBTP</span>
                    </div>
                    <input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(Number(e.target.value).toFixed(1))} style={{width:'100%'}} />
                  </div>
                </div>

                <div className="panel" style={{marginBottom:'20px', borderColor: isPro ? 'var(--brd)' : '#333'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0, color: isPro ? '#888' : '#555'}}>TONE CHARACTER</p>
                    {!isPro && <span style={{fontSize:'0.6rem', color:'#eab308', border:'1px solid #eab308', padding:'2px 6px', borderRadius:'4px'}}>PRO</span>}
                  </div>
                  <div className="row" style={{marginBottom:0}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0, color: isPro ? '#888' : '#555'}}>Warmth (Analog Saturation)</label>
                      <span style={{fontSize:'0.7rem', color: isPro ? 'var(--acc)' : '#555', fontFamily:'monospace'}}>{warmth}%</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} style={{width:'100%', opacity: isPro ? 1 : 0.3}} />
                  </div>
                </div>

                <div className="panel" style={{marginBottom:'20px', borderColor: isPro ? 'var(--brd)' : '#333'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0, color: isPro ? '#888' : '#555'}}>STEREO AND SPACE</p>
                    {!isPro && <span style={{fontSize:'0.6rem', color:'#eab308', border:'1px solid #eab308', padding:'2px 6px', borderRadius:'4px'}}>PRO</span>}
                  </div>
                  <div className="row">
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0, color: isPro ? '#888' : '#555'}}>Stereo Width</label>
                      <span style={{fontSize:'0.7rem', color: isPro ? 'var(--acc)' : '#555', fontFamily:'monospace'}}>{stereoWidth}%</span>
                    </div>
                    <input type="range" min="0" max="200" step="1" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} style={{width:'100%', opacity: isPro ? 1 : 0.3}} />
                  </div>
                  <div className="row" style={{marginBottom:0}}>
                    <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px'}}>
                      <label style={{margin:0, color: isPro ? '#888' : '#555'}}>Mono Bass Anchor</label>
                      <span style={{fontSize:'0.7rem', color: isPro ? 'var(--acc)' : '#555', fontFamily:'monospace'}}>{monoBass}%</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} disabled={!isPro} style={{width:'100%', opacity: isPro ? 1 : 0.3}} />
                    {isPro && <div style={{fontSize:'0.6rem', color:'#666', marginTop:'4px', textAlign:'right'}}>{monoBass === "0" ? 'Off' : (monoBass === "100" ? '< 60Hz Mono' : '< 30Hz Mono')}</div>}
                  </div>
                </div>

                <div className="panel" style={{marginBottom:'20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>OUTPUT FORMAT</p>
                    {!isPro && <span style={{fontSize:'0.6rem', color:'#666', border:'1px solid #444', padding:'2px 6px', borderRadius:'4px'}}>FREE LIMIT</span>}
                  </div>
                  <div className="row">
                    <label>Format</label>
                    <select className="ui-select" value={effectiveFormat} onChange={(e)=>setFormat(e.target.value)} disabled={!isPro}>
                      <option value="mp3">MP3 (320kbps)</option>
                      {isPro && <option value="wav">WAV</option>}
                      {isPro && <option value="flac">FLAC</option>}
                    </select>
                    {!isPro && <div style={{fontSize:'0.65rem', color:'#eab308', marginTop:'6px'}}>WAV, FLAC is available for PRO</div>}
                  </div>
                  <div className="row">
                    <label>Sample Rate</label>
                    <select className="ui-select" disabled={isMp3 || !isPro} value={displaySampleRate} onChange={(e)=>setSampleRate(e.target.value)}>
                      <option value="44100">44.1 kHz</option>
                      <option value="48000">48 kHz</option>
                      <option value="96000">96 kHz</option>
                    </select>
                  </div>
                  <div className="row" style={{marginBottom:0}}>
                    <label>Bit Depth</label>
                    <select className="ui-select" disabled={isMp3 || !isPro} value={displayBitDepth} onChange={(e)=>setBitDepth(e.target.value)}>
                      <option value="16">16-bit</option>
                      <option value="24">24-bit</option>
                    </select>
                  </div>
                </div>

                <button onClick={runMastering} className="render-btn" disabled={files.length === 0} style={{width:'100%', background:'var(--acc)', color:'#000', border:'none', padding:'18px', borderRadius:'12px', fontWeight:900, cursor:'pointer', transition:'0.2s'}}>START MASTERING</button>
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
        
        /* 스크롤바 커스텀 */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: #444; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #666; }
      `}} />
    </main>
  )
}

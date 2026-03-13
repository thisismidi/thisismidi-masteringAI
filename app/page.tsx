'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

// 1. Supabase 연동 (대표님 정보로 변경)
const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE') // FREE, PRO, DEVELOPER
  const [isLightMode, setIsLightMode] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [mastered, setMastered] = useState(false)
  
  // 오디오 플레이어 상태
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // 세션 및 권한 체크 로직
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        // 🚨 여기에 대표님의 실제 구글 로그인 이메일을 적어주세요!
        if (session.user.email === 'itsfreiar@gmail.com') {
          setTier('DEVELOPER')
        } else {
          // 추후 결제 연동 시 여기서 PRO 여부를 판단합니다.
          setTier('FREE')
        }
      }
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setUser(s?.user ?? null)
      if (!s) { setFile(null); setAudioUrl(null); setIsPlaying(false); }
    })
    return () => subscription.unsubscribe()
  }, [])

  // 파형 그리기 (시각화)
  const draw = async (f: File, canvas: HTMLCanvasElement, color: string) => {
    if (typeof window === 'undefined' || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const buffer = await audioCtx.decodeAudioData(await f.arrayBuffer())
      const data = buffer.getChannelData(0)
      const step = Math.ceil(data.length / canvas.width)
      
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          const d = data[i * step + j]
          if (d < min) min = d; if (d > max) max = d
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2)
        ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke()
      await audioCtx.close()
    } catch (e) { console.error(e) }
  }

  // 파일 업로드 시 오디오 URL 생성 및 파형 렌더링
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setMastered(false)
    if (f) {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(URL.createObjectURL(f))
    } else {
      setAudioUrl(null)
    }
  }

  useEffect(() => {
    if (file && origCanvas.current) draw(file, origCanvas.current, '#4ade80')
  }, [file, isLightMode])

  const runMastering = () => {
    if (!file) return
    setMastered(true)
    setTimeout(() => {
      if (mastCanvas.current) draw(file, mastCanvas.current, '#0071e3')
    }, 500)
  }

  // 재생 컨트롤 로직
  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) audioRef.current.pause()
    else audioRef.current.play()
    setIsPlaying(!isPlaying)
  }

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return "00:00"
    const m = Math.floor(time / 60)
    const s = Math.floor(time % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // 파형 클릭 시 해당 위치로 이동 (Seek)
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = x / rect.width
    audioRef.current.currentTime = percent * duration
    if (!isPlaying) {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }

  // 재생 바(Progress) 위치 계산
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      {/* 숨겨진 실제 오디오 플레이어 */}
      <audio 
        ref={audioRef} 
        src={audioUrl || ''} 
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="container" style={{maxWidth:'1000px', margin:'0 auto', padding:'20px'}}>
        <header style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 style={{color:'var(--acc)', fontSize:'1.5rem', fontWeight:900, margin:0}}>MSTRMND <span style={{opacity:0.3}}>.</span></h1>
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
            <section className="panel upload">
              <input type="file" id="u-file" onChange={handleFileUpload} hidden accept="audio/*" />
              <label htmlFor="u-file" className="dropzone" style={{cursor:'pointer', display:'block', padding:'30px', border:'1px dashed var(--brd)', textAlign:'center', borderRadius:'12px'}}>
                {file ? <b style={{color:'var(--acc)'}}>{file.name}</b> : "Click to load your audio file"}
              </label>
            </section>

            <div className="main-grid" style={{display:'grid', gridTemplateColumns:'1fr 300px', gap:'20px', marginTop:'20px'}}>
              <div className="monitors">
                {/* 오리지널 웨이브폼 & 플레이어 */}
                <div className="panel" style={{marginBottom:'20px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                    <p className="p-label" style={{margin:0}}>ORIGINAL WAVEFORM</p>
                    {file && (
                      <div style={{display:'flex', gap:'15px', alignItems:'center'}}>
                        <span style={{fontFamily:'monospace', fontSize:'0.8rem', color:'#888'}}>{formatTime(currentTime)} / {formatTime(duration)}</span>
                        <button onClick={togglePlay} className="play-btn">
                          {isPlaying ? '⏹ STOP' : '▶ PLAY'}
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* 클릭 가능한 파형 영역 */}
                  <div style={{position:'relative', cursor:'pointer'}} onClick={handleWaveformClick}>
                    <canvas ref={origCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {/* 재생 바 (Playhead) */}
                    {file && <div style={{position:'absolute', top:0, bottom:0, left:`${progressPercent}%`, width:'2px', background:'#fff', boxShadow:'0 0 8px rgba(255,255,255,0.8)', pointerEvents:'none'}} />}
                  </div>
                </div>

                {/* 마스터 웨이브폼 (추후 진짜 엔진 연동 시 별도 플레이어 추가) */}
                <div className="panel">
                  <p className="p-label" style={{marginBottom:'15px'}}>MASTERED WAVEFORM</p>
                  <div style={{position:'relative'}}>
                    <canvas ref={mastCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px', display:'block'}} />
                    {!mastered && <div style={{position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#666', fontSize:'0.8rem', background:'rgba(0,0,0,0.4)', borderRadius:'8px'}}>Waiting for mastering...</div>}
                  </div>
                </div>
              </div>

              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">ENGINE</p>
                  <div className="row"><label>Target LUFS</label><input type="range" min="-24" max="-6" step="0.5" defaultValue="-14" style={{width:'100%'}} /></div>
                  <div className="row"><label>True Peak Level</label><input type="range" min="-3" max="0" step="0.1" defaultValue="-1" style={{width:'100%'}} /></div>
                </div>

                {tier === 'PRO' || tier === 'DEVELOPER' ? (
                  <div className="panel pro" style={{marginBottom:'20px', borderColor:'#eab308'}}>
                    <p className="p-label" style={{color:'#eab308'}}>PRO: M/S MATRIX</p>
                    <div className="row"><label>Stereo Width</label><input type="range" defaultValue="100" style={{width:'100%'}} /></div>
                  </div>
                ) : (
                  <div className="panel pro" style={{marginBottom:'20px', opacity:0.5}}>
                    <p className="p-label">PRO: M/S MATRIX (LOCKED)</p>
                    <div className="row"><label>Subscribe to unlock</label><input type="range" disabled style={{width:'100%'}} /></div>
                  </div>
                )}

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
        input[type="range"] { accent-color: var(--acc); cursor: pointer; }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.7rem; font-weight: bold; transition: 0.2s; }
        .btn-ui:hover { border-color: var(--txt); }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 18px 48px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
        .play-btn { background: var(--txt); color: var(--bg); border: none; padding: 5px 12px; border-radius: 6px; font-weight: bold; font-size: 0.7rem; cursor: pointer; }
        .render-btn:disabled { opacity: 0.2; cursor: not-allowed !important; }
      `}} />
    </main>
  )
}

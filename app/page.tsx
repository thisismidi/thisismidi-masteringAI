'use client'

import { createClient } from '@supabase/supabase-js'
import { useState, useEffect, useRef } from 'react'

const supabaseUrl = 'https://vjjowuamlwnuagaacind.supabase.co'
const supabaseKey = 'sb_publishable_6dZKot10ye-Ii1OEw1d_Mg_ZFodzHjE'
const supabase = createClient(supabaseUrl, supabaseKey)

export default function Home() {
  const [user, setUser] = useState<any>(null)
  const [tier, setTier] = useState('FREE')
  const [isLightMode, setIsLightMode] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [mastered, setMastered] = useState(false)
  const [format, setFormat] = useState('wav')
  const [sampleRate, setSampleRate] = useState('48000')
  const [bitDepth, setBitDepth] = useState('24')

  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        setTier(session.user.email === 'itsfreiar@gmail.com' ? 'DEVELOPER' : 'FREE')
      }
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setUser(s?.user ?? null)
      if (!s) { setFile(null); setMastered(false); }
    })
    return () => subscription.unsubscribe()
  }, [])

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

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="container" style={{maxWidth:'1000px', margin:'0 auto', padding:'20px'}}>
        <header style={{display:'flex', justifyContent:'space-between', marginBottom:'40px', alignItems:'center'}}>
          <h1 style={{color:'var(--acc)', fontSize:'1.5rem', fontWeight:900, margin:0}}>MSTRMND <span style={{opacity:0.3}}>.</span></h1>
          <div style={{display:'flex', gap:'10px'}}>
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-ui">
              {isLightMode ? 'DARK' : 'LIGHT'}
            </button>
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
              <input type="file" id="u-file" onChange={(e) => {setFile(e.target.files?.[0] || null); setMastered(false)}} hidden accept="audio/*" />
              <label htmlFor="u-file" className="dropzone" style={{cursor:'pointer', display:'block', padding:'40px', border:'1px dashed var(--brd)', textAlign:'center', borderRadius:'12px'}}>
                {file ? <b style={{color:'var(--acc)'}}>{file.name}</b> : "Click to load your audio file"}
              </label>
            </section>

            <div className="main-grid" style={{display:'grid', gridTemplateColumns:'1fr 300px', gap:'20px', marginTop:'20px'}}>
              <div className="monitors">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">ORIGINAL WAVEFORM</p>
                  <canvas ref={origCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px'}} />
                </div>
                <div className="panel">
                  <p className="p-label">MASTERED WAVEFORM</p>
                  <canvas ref={mastCanvas} width={700} height={120} style={{width:'100%', background:'rgba(0,0,0,0.2)', borderRadius:'8px'}} />
                  {!mastered && <div style={{textAlign:'center', opacity:0.2, marginTop:'-70px', fontSize:'0.8rem'}}>Waiting for mastering...</div>}
                </div>
              </div>

              <aside className="controls">
                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">ENGINE</p>
                  <div className="row"><label>Target LUFS</label><input type="range" min="-24" max="-6" step="0.5" defaultValue="-14" style={{width:'100%'}} /></div>
                  <div className="row"><label>True Peak Level</label><input type="range" min="-3" max="0" step="0.1" defaultValue="-1" style={{width:'100%'}} /></div>
                </div>

                {tier !== 'FREE' && (
                  <div className="panel pro" style={{marginBottom:'20px'}}>
                    <p className="p-label" style={{color:'#eab308'}}>PRO: M/S MATRIX</p>
                    <div className="row"><label>Stereo Width</label><input type="range" defaultValue="100" style={{width:'100%'}} /></div>
                  </div>
                )}

                <div className="panel" style={{marginBottom:'20px'}}>
                  <p className="p-label">OUTPUT FORMAT</p>
                  <select onChange={(e)=>setFormat(e.target.value)} style={{width:'100%', padding:'10px', background:'var(--bg)', color:'var(--txt)', border:'1px solid var(--brd)', borderRadius:'8px', marginBottom:'10px', outline:'none'}}>
                    <option value="wav">WAV (Lossless)</option>
                    <option value="flac">FLAC</option>
                    <option value="mp3">MP3 (320kbps)</option>
                  </select>
                  <div className="sel-row" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px'}}>
                    <select disabled={format==='mp3'} value={format==='mp3'?'44100':sampleRate} onChange={(e)=>setSampleRate(e.target.value)} style={{padding:'8px', background:'var(--bg)', color:'var(--txt)', border:'1px solid var(--brd)', borderRadius:'8px', fontSize:'0.7rem', outline:'none'}}>
                      <option value="44100">44.1 kHz</option><option value="48000">48.0 kHz</option><option value="96000">96.0 kHz</option>
                    </select>
                    <select disabled={format==='mp3'} value={format==='mp3'?'16':bitDepth} onChange={(e)=>setBitDepth(e.target.value)} style={{padding:'8px', background:'var(--bg)', color:'var(--txt)', border:'1px solid var(--brd)', borderRadius:'8px', fontSize:'0.7rem', outline:'none'}}>
                      <option value="16">16-bit</option><option value="24">24-bit</option>
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
        :root { --bg: #000; --p: #111; --brd: #222; --txt: #fff; --acc: #4ade80; }
        .light-mode { --bg: #f5f5f7; --p: #fff; --brd: #d2d2d7; --txt: #1c1c1e; --acc: #0071e3; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, sans-serif; transition: 0.2s; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 16px; padding: 20px; }
        .p-label { font-size: 0.65rem; font-weight: bold; color: #666; margin-bottom: 15px; letter-spacing: 0.5px; }
        .row { margin-bottom: 20px; } .row label { display: block; font-size: 0.75rem; color: #888; margin-bottom: 8px; }
        input[type="range"] { accent-color: var(--acc); cursor: pointer; }
        .btn-ui { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: bold; transition: 0.2s; }
        .btn-ui:hover { border-color: var(--txt); }
        .btn-login { background: var(--txt); color: var(--bg); border: none; padding: 18px 48px; border-radius: 50px; font-weight: bold; cursor: pointer; font-size: 1.1rem; }
        .render-btn:disabled { opacity: 0.2; cursor: not-allowed !important; }
      `}} />
    </main>
  )
}

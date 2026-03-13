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

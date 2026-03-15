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
  const [currentOrigUrl, setCurrentOrigUrl] = useState<string>('')

  const [origLufs, setOrigLufs] = useState(-70)
  const [origTp, setOrigTp] = useState(-70)
  const [mastLufs, setMastLufs] = useState(-70)
  const [mastTp, setMastTp] = useState(-70)

  const origMeterData = useRef({ sum: 0, samples: 0, maxPeak: 0 })
  const mastMeterData = useRef({ sum: 0, samples: 0, maxPeak: 0 })

  const [origTime, setOrigTime] = useState(0)
  const [mastTime, setMastTime] = useState(0)
  const [origDuration, setOrigDuration] = useState(0)
  const [mastDuration, setMastDuration] = useState(0)
  const [origIsPlaying, setOrigIsPlaying] = useState(false)
  const [mastIsPlaying, setMastIsPlaying] = useState(false)

  // 🎛️ 마스터링 파라미터
  const [targetLufs, setTargetLufs] = useState("-14.0")
  const [truePeak, setTruePeak] = useState("-1.0")
  const [outputTrim, setOutputTrim] = useState("0.0")
  const [warmth, setWarmth] = useState("0")
  const [treble, setTreble] = useState("0") 
  const [stereoWidth, setStereoWidth] = useState("100")
  const [spaceDepth, setSpaceDepth] = useState("0") 
  const [monoBass, setMonoBass] = useState("0")
  const [glueComp, setGlueComp] = useState("0") 

  const [outFormat, setOutFormat] = useState("MP3")
  const [outSampleRate, setOutSampleRate] = useState("44100")
  const [outBitDepth, setOutBitDepth] = useState("16")

  const origAudioRef = useRef<HTMLAudioElement>(null)
  const mastAudioRef = useRef<HTMLAudioElement>(null)
  const origCanvas = useRef<HTMLCanvasElement>(null)
  const mastCanvas = useRef<HTMLCanvasElement>(null)
  
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceNodes = useRef<Map<HTMLAudioElement, any>>(new Map())
  const rafIdRef = useRef<number | null>(null)

  const isPro = tier === 'PRO' || tier === 'DEVELOPER'

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "00:00"
    const m = Math.floor(time / 60).toString().padStart(2, '0')
    const s = Math.floor(time % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  useEffect(() => {
    document.title = "THISISMIDI Mastering AI"
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      handleUser(session?.user ?? null)
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => handleUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const handleUser = (u: any) => {
    setUser(u)
    if (u?.email === 'itsfreiar@gmail.com') {
      setTier('DEVELOPER')
    } else if (u?.app_metadata?.is_pro) {
      setTier('PRO')
    } else {
      setTier('FREE')
    }
  }

  useEffect(() => {
    if (!isPro) {
      setOutFormat("MP3"); setOutSampleRate("44100"); setOutBitDepth("16")
    }
  }, [isPro])

  useEffect(() => {
    if (files[activeIndex]) {
      const url = URL.createObjectURL(files[activeIndex])
      setCurrentOrigUrl(url)
      origMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
      mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
      setOrigLufs(-70); setOrigTp(-70); setMastLufs(-70); setMastTp(-70);
      return () => URL.revokeObjectURL(url) 
    } else {
      setCurrentOrigUrl('')
    }
  }, [files, activeIndex])

  // 🚨 [추가] 파일 업로드 시 티어에 따른 제한 로직 (1곡 vs 15곡)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || [])
    const limit = isPro ? 15 : 1
    
    if (selected.length > limit) {
      alert(isPro 
        ? `PRO 요금제는 한 번에 최대 15곡까지만 처리할 수 있습니다.` 
        : `무료 버전은 한 번에 1곡만 마스터링할 수 있습니다. 🔒\nPRO로 업그레이드하고 최대 15곡 일괄(Batch) 마스터링을 이용해 보세요!`)
      setFiles(selected.slice(0, limit))
    } else {
      setFiles(selected)
    }
    
    setActiveIndex(0)
    setMasteredUrls({})
    setOrigIsPlaying(false)
    setMastIsPlaying(false)
  }

  const ensureAudioRouting = (audio: HTMLAudioElement) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    const ctx = audioCtxRef.current
    if (!sourceNodes.current.has(audio)) {
      try {
        const source = ctx.createMediaElementSource(audio)
        const analyzer = ctx.createAnalyser()
        analyzer.fftSize = 2048
        source.connect(analyzer)
        analyzer.connect(ctx.destination) 
        sourceNodes.current.set(audio, { source, analyzer })
      } catch (e) { console.error(e) }
    }
    return sourceNodes.current.get(audio)?.analyzer
  }

  const startAnalyzing = (audio: HTMLAudioElement, type: 'orig' | 'mast') => {
    const analyzer = ensureAudioRouting(audio)
    if (!analyzer) return
    const update = () => {
      const data = new Float32Array(analyzer.fftSize)
      analyzer.getFloatTimeDomainData(data)
      let peak = 0, sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i]); if (v > peak) peak = v
        sum += data[i] * data[i]
      }
      const meter = type === 'orig' ? origMeterData.current : mastMeterData.current
      meter.sum += sum
      meter.samples += data.length
      if (peak > meter.maxPeak) meter.maxPeak = peak

      const tp = meter.maxPeak > 0 ? 20 * Math.log10(meter.maxPeak) : -70
      const avgRms = Math.sqrt(meter.sum / meter.samples)
      const lufs = avgRms > 0 ? 20 * Math.log10(avgRms) - 0.691 : -70
      
      if (type === 'orig') { setOrigLufs(Math.round(lufs * 10) / 10); setOrigTp(Math.round(tp * 10) / 10); }
      else { setMastLufs(Math.round(lufs * 10) / 10); setMastTp(Math.round(tp * 10) / 10); }
      
      rafIdRef.current = requestAnimationFrame(update)
    }
    update()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>, audioRef: React.RefObject<HTMLAudioElement | null>, duration: number, type: 'orig' | 'mast') => {
    if (!audioRef || !audioRef.current || !duration || duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.nativeEvent.offsetX
    const targetTime = (clickX / rect.width) * duration
    audioRef.current.currentTime = targetTime

    if (type === 'orig') origMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
    if (type === 'mast') mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 }
  }

  const togglePlay = async (type: 'orig' | 'mast') => {
    const audio = type === 'orig' ? origAudioRef.current : mastAudioRef.current
    if (!audio) return
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume()

    if (type === 'orig') {
      if (origIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); } 
      else { 
        mastAudioRef.current?.pause(); setMastIsPlaying(false);
        try { await audio.play(); startAnalyzing(audio, 'orig') } catch (e) { console.error(e) }
      }
      setOrigIsPlaying(!origIsPlaying)
    } else {
      if (mastIsPlaying) { audio.pause(); if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current); } 
      else { 
        origAudioRef.current?.pause(); setOrigIsPlaying(false);
        try { await audio.play(); startAnalyzing(audio, 'mast') } catch (e) { console.error(e) }
      }
      setMastIsPlaying(!mastIsPlaying)
    }
  }

  const drawWave = async (file: File | string, canvas: HTMLCanvasElement, color: string) => {
    if (!canvas || !file) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      const buf = (typeof file === 'string') ? await (await fetch(file)).arrayBuffer() : await file.arrayBuffer()
      const tCtx = new AudioContext()
      const audioBuf = await tCtx.decodeAudioData(buf)
      const data = audioBuf.getChannelData(0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      const step = Math.floor(data.length / canvas.width)
      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) {
          const v = data[i * step + j]; if (v < min) min = v; if (v > max) max = v
        }
        ctx.moveTo(i, (1 + min) * canvas.height / 2); ctx.lineTo(i, (1 + max) * canvas.height / 2)
      }
      ctx.stroke(); await tCtx.close()
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (files[activeIndex] && origCanvas.current) drawWave(files[activeIndex], origCanvas.current, isLightMode ? '#10b981' : '#4ade80') 
    if (masteredUrls[activeIndex] && mastCanvas.current) drawWave(masteredUrls[activeIndex], mastCanvas.current, isLightMode ? '#2563eb' : '#3b82f6') 
  }, [files, activeIndex, isLightMode, masteredUrls])

  // 🚨 [변경] 단일 마스터링에서 전체 큐(Queue) 일괄 마스터링(Batch)으로 업그레이드
  const runBatchMastering = async () => {
    if (files.length === 0) return; 
    setIsProcessing(true);

    // 올라온 곡들을 하나씩 순서대로 백엔드에 요청합니다.
    for (let i = 0; i < files.length; i++) {
      setActiveIndex(i); // 유저가 작업 진행률을 볼 수 있게 선택 곡을 자동으로 변경
      
      const formData = new FormData()
      formData.append("file", files[i])
      formData.append("out_format", outFormat) 
      formData.append("out_sample_rate", outSampleRate) 
      formData.append("out_bit_depth", outBitDepth)

      formData.append("target_lufs", targetLufs)
      formData.append("true_peak", truePeak)
      formData.append("output_trim", outputTrim)
      
      formData.append("warmth", warmth)
      formData.append("treble", treble)

      formData.append("stereo_width", stereoWidth)
      formData.append("space_depth", spaceDepth)
      formData.append("mono_bass", monoBass)
      formData.append("glue_comp", glueComp)

      try {
        const resp = await fetch(ENGINE_URL, { method: "POST", body: formData })
        if (!resp.ok) throw new Error("엔진 오류");
        const blob = await resp.blob(); 
        
        setMasteredUrls(p => ({ ...p, [i]: URL.createObjectURL(blob) }))
        mastMeterData.current = { sum: 0, samples: 0, maxPeak: 0 } 
      } catch (e) { 
        alert(`[${files[i].name}] 마스터링 중 오류가 발생했습니다.`)
      }
    }
    
    setIsProcessing(false);
  }

  const getDownloadName = () => {
    if (!files[activeIndex]) return 'Mastered.mp3'
    const nameWithoutExt = files[activeIndex].name.split('.').slice(0, -1).join('.')
    return `${nameWithoutExt}_Mastered.${outFormat.toLowerCase()}`
  }

  return (
    <main className={isLightMode ? 'light-mode' : 'dark-mode'}>
      <div className="workspace">
        <header className="main-header">
          <div className="brand">THISISMIDI <span className="accent">.</span></div>
          <div className="user-area">
            {user && <span className="tier-label">{tier}</span>}
            <button onClick={() => setIsLightMode(!isLightMode)} className="btn-icon">{isLightMode ? 'DARK' : 'LIGHT'}</button>
            {user ? <button onClick={() => supabase.auth.signOut()} className="btn-text">LOGOUT</button> : <button onClick={() => supabase.auth.signInWithOAuth({provider:'google'})} className="btn-text">LOGIN</button>}
          </div>
        </header>

        {!user ? (
          <div className="auth-hero"><h1>Mastering, <br/>Simplified.</h1><button onClick={()=>supabase.auth.signInWithOAuth({provider:'google'})} className="btn-prime">Start with Google</button></div>
        ) : (
          <div className="vertical-layout">
            
            <section className="panel queue-panel">
              <div className="panel-top"><h3>Track Queue</h3><span>{files.length} tracks {isPro ? '(Max 15)' : '(Max 1)'}</span></div>
              <div className="upload-container">
                {/* 🚨 업로드 제한 핸들러 적용 */}
                <input type="file" id="u-file" hidden multiple onChange={handleFileUpload} accept="audio/*" />
                <label htmlFor="u-file" className="drop-area">Drop audio files here (WAV, MP3, etc)</label>
                <div className="action-row">
                  <label htmlFor="u-file" className="btn-sub">UPLOAD</label>
                  {/* 🚨 곡 갯수에 따라 버튼 텍스트 변경 */}
                  <button onClick={runBatchMastering} className="btn-prime" disabled={isProcessing || files.length === 0}>
                    {isProcessing ? 'PROCESSING...' : (files.length > 1 ? `MASTER ALL ${files.length} TRACKS` : 'START MASTERING')}
                  </button>
                </div>
              </div>
              <ul className="track-list">
                {files.map((f, i) => (
                  <li key={i} className={activeIndex === i ? 'active' : ''} onClick={() => { setActiveIndex(i); setOrigIsPlaying(false); setMastIsPlaying(false); }}>
                    <input type="checkbox" checked={activeIndex === i} readOnly />
                    <span className="name">{i+1}. {f.name}</span>
                    {masteredUrls[i] && <span style={{fontSize:'0.7rem', color:'var(--acc)', marginLeft:'auto', fontWeight:'bold'}}>✓ DONE</span>}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel monitor-panel">
              <div className="panel-top"><h3>A/B Monitor</h3><span className="selected-info">Selected: {files[activeIndex]?.name || 'None'}</span></div>
              
              <div className="monitor-row">
                <div className="m-controls">
                  <p className="m-label" style={{color: 'var(--acc)'}}>Original</p>
                  <div className="stats">LUFS: {origLufs}<br/>TP: {origTp}</div>
                  <button onClick={()=>togglePlay('orig')} className="btn-p">{origIsPlaying ? 'STOP' : 'PLAY'}</button>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="time-display">{formatTime(origTime)} / {formatTime(origDuration)}</div>
                  <div className="wave-box" onClick={(e) => handleSeek(e, origAudioRef, origDuration, 'orig')}>
                    <canvas ref={origCanvas} width={1000} height={140} />
                    <div className="seeker" style={{left: origDuration > 0 ? `${(origTime/origDuration)*100}%` : '0'}} />
                  </div>
                </div>
                <audio 
                  ref={origAudioRef} 
                  src={currentOrigUrl} 
                  onTimeUpdate={(e)=>setOrigTime(e.currentTarget.currentTime)} 
                  onLoadedMetadata={(e)=>setOrigDuration(e.currentTarget.duration)} 
                  onEnded={() => setOrigIsPlaying(false)}
                />
              </div>

              <div className="monitor-row mt-20">
                <div className="m-controls">
                  <p className="m-label color-m">Mastered</p>
                  <div className="stats">LUFS: {mastLufs}<br/>TP: {mastTp}</div>
                  <div style={{display:'flex', flexDirection:'column', gap:'5px'}}>
                    <button onClick={()=>togglePlay('mast')} className="btn-p" disabled={!masteredUrls[activeIndex]}>{mastIsPlaying ? 'STOP' : 'PLAY'}</button>
                    {masteredUrls[activeIndex] && <a href={masteredUrls[activeIndex]} download={getDownloadName()} className="btn-p download" style={{textAlign:'center'}}>DOWNLOAD</a>}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="time-display">{formatTime(mastTime)} / {formatTime(mastDuration)}</div>
                  <div className="wave-box" onClick={(e) => handleSeek(e, mastAudioRef, mastDuration, 'mast')}>
                    <canvas ref={mastCanvas} width={1000} height={140} />
                    <div className="seeker" style={{left: mastDuration > 0 ? `${(mastTime/mastDuration)*100}%` : '0'}} />
                    {!masteredUrls[activeIndex] && <div className="no-file-overlay">No mastered file yet</div>}
                  </div>
                </div>
                <audio 
                  ref={mastAudioRef} 
                  src={masteredUrls[activeIndex] || ''} 
                  onTimeUpdate={(e)=>setMastTime(e.currentTarget.currentTime)} 
                  onLoadedMetadata={(e)=>setMastDuration(e.currentTarget.duration)}
                  onEnded={() => setMastIsPlaying(false)} 
                />
              </div>
            </section>

            <section className="panel controls-panel">
              <div className="panel-top"><h3>Mastering Controls {!isPro && '(Pro Features Locked 🔒)'}</h3></div>
              <div className="control-groups-wrapper">
                
                <div className="control-group">
                  <p className="g-title">Output Format {!isPro && <span style={{color:'var(--acc)', fontSize:'0.7rem', fontWeight:'normal'}}>(Free Tier Locked)</span>}</p>
                  <div className="sel-box">
                    <label>Format</label>
                    <select className="styled-select" value={outFormat} onChange={(e) => setOutFormat(e.target.value)} disabled={!isPro}>
                      <option value="MP3">MP3</option>
                      {isPro && <option value="WAV">WAV</option>}
                      {isPro && <option value="FLAC">FLAC</option>}
                    </select>
                  </div>
                  <div className="sel-box">
                    <label>Sample Rate</label>
                    <select className="styled-select" value={outSampleRate} onChange={(e) => setOutSampleRate(e.target.value)} disabled={!isPro}>
                      <option value="44100">44.1 kHz</option>
                      {isPro && <option value="48000">48 kHz</option>}
                      {isPro && <option value="96000">96 kHz</option>}
                    </select>
                  </div>
                  <div className="sel-box">
                    <label>Bit Depth</label>
                    <select className="styled-select" value={outBitDepth} onChange={(e) => setOutBitDepth(e.target.value)} disabled={!isPro}>
                      <option value="16">16-bit</option>
                      {isPro && <option value="24">24-bit</option>}
                      {isPro && <option value="32">32-bit float</option>}
                    </select>
                  </div>
                </div>

                <div className="control-group">
                  <p className="g-title">Loudness and Safety</p>
                  <div className="sld-row"><label>Target LUFS</label><input type="range" min="-24" max="-6" step="0.5" value={targetLufs} onChange={(e)=>setTargetLufs(e.target.value)} /><span>{targetLufs}</span></div>
                  <div className="sld-row"><label>True Peak Ceiling</label><input type="range" min="-3" max="0" step="0.1" value={truePeak} onChange={(e)=>setTruePeak(e.target.value)} /><span>{truePeak} dBTP</span></div>
                  <div className="sld-row"><label>Output Trim</label><input type="range" min="-6" max="6" step="0.1" value={outputTrim} onChange={(e)=>setOutputTrim(e.target.value)} disabled={!isPro} /><span>{outputTrim} dB</span></div>
                </div>
                
                <div className="control-group">
                  <p className="g-title">Tone Character</p>
                  <div className="sld-row"><label>Warmth</label><input type="range" min="0" max="100" value={warmth} onChange={(e)=>setWarmth(e.target.value)} disabled={!isPro} /><span>{warmth}%</span></div>
                  <div className="sld-row"><label>Treble</label><input type="range" min="0" max="100" value={treble} onChange={(e)=>setTreble(e.target.value)} disabled={!isPro} /><span>{treble}%</span></div>
                </div>
                
                <div className="control-group">
                  <p className="g-title">Stereo, Space & Dynamics</p>
                  <div className="sld-row"><label>Stereo Width</label><input type="range" min="0" max="200" value={stereoWidth} onChange={(e)=>setStereoWidth(e.target.value)} disabled={!isPro} /><span>{stereoWidth}%</span></div>
                  <div className="sld-row"><label>Space Depth</label><input type="range" min="0" max="100" value={spaceDepth} onChange={(e)=>setSpaceDepth(e.target.value)} disabled={!isPro} /><span>{spaceDepth}%</span></div>
                  <div className="sld-row"><label>Mono Bass Anchor</label><input type="range" min="0" max="100" value={monoBass} onChange={(e)=>setMonoBass(e.target.value)} disabled={!isPro} /><span>{monoBass}%</span></div>
                  <div className="sld-row" style={{marginTop: '25px', paddingTop: '15px', borderTop: '1px dashed var(--brd)'}}><label style={{color:'var(--acc)'}}>Vari-Mu Glue</label><input type="range" min="0" max="100" value={glueComp} onChange={(e)=>setGlueComp(e.target.value)} disabled={!isPro} /><span>{glueComp}%</span></div>
                </div>

              </div>
            </section>

          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        :root { --bg: #0d0d0d; --p: #161616; --brd: #262626; --txt: #e5e5e5; --acc: #4ade80; --sec: #888; }
        .light-mode { --bg: #f5f5f7; --p: #ffffff; --brd: #e5e5e7; --txt: #1d1d1f; --acc: #10b981; --sec: #86868b; }
        body { margin: 0; background: var(--bg); color: var(--txt); font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .workspace { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .main-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
        .brand { font-size: 1.4rem; font-weight: 900; letter-spacing: -1px; }
        .accent { color: var(--acc); }
        .user-area { display: flex; align-items: center; gap: 15px; }
        .tier-label { font-size: 0.7rem; font-weight: 800; background: var(--brd); padding: 5px 12px; border-radius: 50px; color: var(--sec); }
        .btn-icon, .btn-text { background: none; border: 1px solid var(--brd); color: var(--txt); padding: 7px 14px; border-radius: 8px; cursor: pointer; font-size: 0.75rem; font-weight: 700; transition: 0.2s; }
        .btn-icon:hover, .btn-text:hover { background: var(--brd); }
        .vertical-layout { display: flex; flex-direction: column; gap: 30px; width: 100%; }
        .panel { background: var(--p); border: 1px solid var(--brd); border-radius: 12px; padding: 25px; box-shadow: 0 4px 30px rgba(0,0,0,0.1); }
        .panel-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--brd); padding-bottom: 15px; margin-bottom: 20px; }
        .panel-top h3 { font-size: 1rem; margin: 0; font-weight: 800; letter-spacing: -0.5px; }
        .panel-top span { font-size: 0.8rem; color: var(--sec); }
        .upload-container { background: rgba(0,0,0,0.05); border: 1px solid var(--brd); border-radius: 8px; padding: 20px; margin-bottom: 15px; }
        .drop-area { display: flex; height: 80px; border: 1px dashed var(--sec); border-radius: 6px; align-items: center; justify-content: center; font-size: 0.85rem; color: var(--sec); margin-bottom: 15px; cursor: pointer; transition: 0.2s; }
        .drop-area:hover { border-color: var(--acc); color: var(--txt); }
        .action-row { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; }
        .btn-prime { background: var(--acc); color: #000; border: none; padding: 12px; border-radius: 6px; font-weight: 800; cursor: pointer; font-size: 0.9rem; transition: 0.2s; }
        .btn-sub { background: var(--txt); color: var(--bg); border: none; padding: 12px; border-radius: 6px; font-weight: 800; cursor: pointer; text-align: center; font-size: 0.9rem; display: block; }
        .track-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
        .track-list li { padding: 12px 15px; border-radius: 6px; display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 0.85rem; border: 1px solid var(--brd); background: rgba(0,0,0,0.02); }
        .track-list li.active { background: rgba(74,222,128,0.1); border-color: var(--acc); }
        .monitor-row { display: flex; gap: 20px; align-items: center; }
        .m-controls { width: 120px; flex-shrink: 0; }
        .m-label { font-size: 0.85rem; font-weight: 800; margin: 0 0 8px 0; }
        .color-m { color: #3b82f6; }
        .stats { font-size: 0.7rem; color: var(--sec); font-family: monospace; margin-bottom: 12px; line-height: 1.4; }
        .btn-p { width: 100%; padding: 8px; border: none; background: var(--txt); color: var(--bg); border-radius: 6px; font-size: 0.75rem; font-weight: 800; cursor: pointer; transition: 0.2s; }
        .btn-p.download { background: #3b82f6; color: #fff; text-decoration: none; }
        .btn-p:disabled { opacity: 0.3; cursor: not-allowed; }
        .time-display { text-align: right; font-size: 0.7rem; font-family: "SF Mono", monospace; color: var(--sec); margin-bottom: 6px; font-weight: bold; }
        .wave-box { width: 100%; height: 160px; background: rgba(0,0,0,0.05); border: 1px solid var(--brd); border-radius: 8px; position: relative; overflow: hidden; cursor: pointer; }
        canvas { width: 100%; height: 100%; display: block; }
        .seeker { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 10px rgba(255,255,255,0.8); pointer-events: none; }
        .no-file-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; font-size: 0.85rem; color: var(--sec); font-weight: 600; }
        .control-groups-wrapper { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 30px; }
        .control-group { background: rgba(0,0,0,0.02); padding: 20px; border-radius: 8px; border: 1px solid var(--brd); }
        .g-title { font-size: 0.85rem; font-weight: 800; margin-bottom: 20px; color: var(--txt); border-bottom: 1px solid var(--brd); padding-bottom: 10px; }
        .sel-box { margin-bottom: 15px; }
        .sel-box label { font-size: 0.75rem; font-weight: 600; color: var(--sec); display: block; margin-bottom: 5px; }
        .styled-select { background: var(--bg); color: var(--txt); border: 1px solid var(--brd); padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; width: 100%; cursor: pointer; appearance: none; -webkit-appearance: none; }
        .styled-select:disabled { opacity: 0.4; cursor: not-allowed; }
        .sld-row { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
        .sld-row label { font-size: 0.8rem; width: 120px; font-weight: 600; color: var(--sec); }
        .sld-row input { flex: 1; accent-color: var(--acc); cursor: pointer; }
        .sld-row span { width: 65px; font-size: 0.75rem; text-align: right; color: var(--acc); font-family: monospace; font-weight: bold; }
        .mt-20 { margin-top: 20px; }
        .auth-hero { text-align: center; padding: 150px 0; }
        .auth-hero h1 { font-size: 4rem; letter-spacing: -3px; line-height: 0.9; margin-bottom: 40px; font-weight: 900; }
      `}} />
    </main>
  )
}

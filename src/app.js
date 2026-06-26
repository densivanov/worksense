import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { motion, AnimatePresence, useReducedMotion, animate as fmAnimate } from 'framer-motion'
import htm from 'htm'
const html = htm.bind(React.createElement)
const M = motion

// ════════════════════════════════ BRIDGE ════════════════════════════════
const SERVER = 'http://localhost:3456'
let _mode = 'ls'
const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI

async function detectMode() {
  if (window.electronAPI) { _mode = 'electron'; return }
  try {
    const r = await fetch(SERVER + '/api/data', { signal: AbortSignal.timeout(800) })
    if (r.ok || r.status === 200) { _mode = 'server'; return }
  } catch (e) {}
  _mode = 'ls'
}
async function bridgeLoad() {
  if (_mode === 'electron') return await window.electronAPI.loadData()
  if (_mode === 'server') { try { return await (await fetch(SERVER + '/api/data')).json() } catch (e) { return null } }
  const raw = localStorage.getItem('ws_v1'); if (raw) { try { return JSON.parse(raw) } catch (e) {} }
  return null
}
async function bridgeSave(data) {
  if (_mode === 'electron') { await window.electronAPI.saveData(data); return }
  if (_mode === 'server') { try { await fetch(SERVER + '/api/data', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }) } catch (e) {} return }
  try { localStorage.setItem('ws_v1', JSON.stringify(data)) } catch (e) {}
}
async function fetchClaudeStats() {
  if (_mode === 'electron') return await window.electronAPI.readClaudeStats()
  if (_mode === 'server') { try { return await (await fetch(SERVER + '/api/claude-stats')).json() } catch (e) { return [] } }
  return []
}
const winMin = () => window.electronAPI?.minimize()
const winMax = () => window.electronAPI?.maximize()
const winClose = () => window.electronAPI?.close()

// ════════════════════════════════ UTILS ═════════════════════════════════
const pad = n => String(n).padStart(2,'0')
const fmtMs = ms => { const s = Math.floor(ms/1000); return `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}` }
const fmtShort = ms => { const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000); return h>0 ? `${h}h ${m}m` : `${m}m` }
const fmtHM = ms => `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m`
const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fmtDateTime = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fmtNum = n => n>=1e6 ? (n/1e6).toFixed(1)+'M' : n>=1e3 ? (n/1e3).toFixed(1)+'K' : String(Math.round(n))
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
const sameDay = (ts, ref=Date.now()) => dayKey(ts)===dayKey(ref)
const weekStart = () => { const d = new Date(); const wd = d.getDay(); const back = wd===0?6:wd-1; d.setDate(d.getDate()-back); d.setHours(0,0,0,0); return d.getTime() }
const weekDaysElapsed = () => { const wd = new Date().getDay(); return wd===0?7:wd }
function fmtDayLabel(dk) {
  const [y,m,d] = dk.split('-').map(Number)
  const date = new Date(y,m-1,d), today = new Date(); today.setHours(0,0,0,0)
  const yest = new Date(today); yest.setDate(yest.getDate()-1)
  if (date.getTime()===today.getTime()) return 'Today'
  if (date.getTime()===yest.getTime()) return 'Yesterday'
  return date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})
}

const TOOLS = {
  'Claude Code': { ch:'#c2f24a' }, 'Claude.ai': { ch:'#b18cff' }, 'Cursor': { ch:'#62d4c4' },
  'ChatGPT': { ch:'#34d6a8' }, 'Copilot': { ch:'#ff7a5c' }, 'Gemini': { ch:'#ffb74d' }, 'Other': { ch:'#8a8a92' }
}
const tc = t => (TOOLS[t] || TOOLS['Other']).ch

// Примерная стоимость, USD за 1M токенов (грубая прикидка, не точный счёт)
const COST = { 'Claude Code':3.5, 'Claude.ai':5, 'Cursor':2, 'ChatGPT':5, 'Copilot':1.5, 'Gemini':2, 'Other':3 }
const costOf = (tool, tokens) => (tokens/1e6) * (COST[tool] ?? COST['Other'])
const sumCost = logs => logs.reduce((a,l)=>a+costOf(l.tool, l.tokens), 0)
const fmtUSD = n => n>=100 ? '$'+Math.round(n) : '$'+n.toFixed(2)

function buildWeeklySummary(data) {
  const start = weekStart(), wd = weekDaysElapsed()
  const sess = data.sessions.filter(s => s.start >= start)
  const totalMs = sess.reduce((a,s)=>a+s.duration,0)
  const daysWorked = new Set(sess.map(s=>dayKey(s.start))).size
  const byLabel = {}; sess.forEach(s => byLabel[s.label] = (byLabel[s.label]||0) + s.duration)
  const top = Object.entries(byLabel).sort((a,b)=>b[1]-a[1]).slice(0,5)
  const prevStart = start - 7*86400000
  const prevMs = data.sessions.filter(s=>s.start>=prevStart && s.start<start).reduce((a,s)=>a+s.duration,0)
  const logs = data.aiLogs.filter(l=>l.ts>=start)
  const tok = logs.reduce((a,l)=>a+l.tokens,0)
  const monLabel = new Date(start).toLocaleDateString('en-US',{month:'long',day:'numeric'})
  const lines = []
  lines.push(`WorkSense, week of ${monLabel}`)
  lines.push(`Total: ${fmtShort(totalMs)} across ${daysWorked} day${daysWorked!==1?'s':''} (avg ${(totalMs/wd/3600000).toFixed(1)}h/day)`)
  if (prevMs > 0) { const diff = Math.round((totalMs-prevMs)/prevMs*100); lines.push(`vs last week: ${diff>=0?'+':''}${diff}%`) }
  if (top.length) { lines.push(''); lines.push('Top work:'); top.forEach(([l,ms])=>lines.push(`  - ${l}: ${fmtShort(ms)}`)) }
  if (tok > 0) { lines.push(''); lines.push(`AI usage: ${fmtNum(tok)} tokens (approx ${fmtUSD(sumCost(logs))})`) }
  return lines.join('\n')
}
const CC = { t1:'#f1f1ee', t2:'#9b9ba4', t3:'#64646d', accent:'#c2f24a', accentS:'rgba(194,242,74,0.85)', surf:'#1a1a1f', line:'rgba(255,255,255,0.09)', grid:'rgba(255,255,255,0.05)', faint:'rgba(255,255,255,0.05)', ink16:'rgba(255,255,255,0.16)' }
const EASE = [0.22, 1, 0.36, 1]

// ════════════════════════════════ ICONS ═════════════════════════════════
const Ic = {
  min: html`<svg viewBox="0 0 12 12" fill="none"><path d="M2 6h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  max: html`<svg viewBox="0 0 12 12" fill="none"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.4" stroke="currentColor" stroke-width="1.2"/></svg>`,
  close: html`<svg viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  x: html`<svg viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  play: html`<svg viewBox="0 0 14 14" fill="currentColor"><path d="M3 2.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L3.92 1.7A.6.6 0 0 0 3 2.2Z"/></svg>`,
  stop: html`<svg viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.6"/></svg>`,
  pause: html`<svg viewBox="0 0 14 14" fill="currentColor"><rect x="3.4" y="2.8" width="2.6" height="8.4" rx="1"/><rect x="8" y="2.8" width="2.6" height="8.4" rx="1"/></svg>`,
  plus: html`<svg viewBox="0 0 14 14" fill="none"><path d="M7 2.6v8.8M2.6 7h8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  sync: html`<svg viewBox="0 0 14 14" fill="none"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 2v2.8H8.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: html`<svg viewBox="0 0 14 14" fill="none"><path d="M9.4 2.5l2.1 2.1M8.5 3.4l-5.2 5.2-.7 2.5 2.5-.7 5.2-5.2a1.1 1.1 0 0 0 0-1.5l-.6-.6a1.1 1.1 0 0 0-1.5 0Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  copy: html`<svg viewBox="0 0 14 14" fill="none"><rect x="4.6" y="4.6" width="6.4" height="6.4" rx="1.4" stroke="currentColor" stroke-width="1.2"/><path d="M9 4.3V3.6A1.4 1.4 0 0 0 7.6 2.2H3.9A1.4 1.4 0 0 0 2.5 3.6v3.7A1.4 1.4 0 0 0 3.9 8.7h.7" stroke="currentColor" stroke-width="1.2"/></svg>`
}

// ════════════════════════════════ CHART ═════════════════════════════════
function ChartCanvas({ build, deps }) {
  const ref = useRef(null), chart = useRef(null)
  useEffect(() => {
    if (!ref.current || !window.Chart) return
    chart.current = new window.Chart(ref.current.getContext('2d'), build())
    return () => { chart.current?.destroy() }
  }, deps)
  return html`<canvas ref=${ref}></canvas>`
}
function cOpts(ttFn, maxY, sfx) {
  const o = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuart' },
    plugins: { legend: { display: false },
      tooltip: { backgroundColor: CC.surf, borderColor: CC.line, borderWidth: 1, titleColor: CC.t2, bodyColor: CC.t1, padding: 9, cornerRadius: 8, displayColors: false,
        titleFont: { family: 'Manrope', size: 11 }, bodyFont: { family: 'JetBrains Mono', size: 12 }, callbacks: { label: c => ' ' + ttFn(c.raw) } } },
    scales: {
      x: { grid: { display: false }, border: { color: CC.line }, ticks: { color: CC.t3, font: { size: 10, family: 'Manrope' } } },
      y: { grid: { color: CC.grid }, border: { display: false }, ticks: { color: CC.t3, font: { size: 10, family: 'JetBrains Mono' }, callback: v => v + sfx }, min: 0 }
    }
  }
  if (maxY !== undefined) o.scales.y.max = maxY
  return o
}

// ════════════════════════════════ NUMBER ════════════════════════════════
function AnimatedNumber({ value, format }) {
  const [disp, setDisp] = useState(value)
  const prev = useRef(value), reduce = useReducedMotion()
  useEffect(() => {
    if (reduce || prev.current === value) { setDisp(value); prev.current = value; return }
    const controls = fmAnimate(prev.current, value, { duration: 0.6, ease: EASE, onUpdate: v => setDisp(v) })
    prev.current = value
    return () => controls.stop()
  }, [value])
  return html`<span>${format ? format(disp) : Math.round(disp)}</span>`
}

// ════════════════════════════════ APP ═══════════════════════════════════
const VIEWS = [ { id:'dashboard', label:'Dashboard' }, { id:'sessions', label:'Sessions' }, { id:'ai', label:'AI Activity' } ]

function App() {
  const reduce = useReducedMotion()
  const [ready, setReady] = useState(false)
  const [electron, setElectron] = useState(false)
  const [view, setView] = useState('dashboard')
  const [data, setData] = useState({ sessions: [], aiLogs: [] })
  const [rev, setRev] = useState(0)
  const [range, setRange] = useState(14)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [report, setReport] = useState(null)
  const [claudeBanner, setClaudeBanner] = useState(null)

  // timer
  const [timer, setTimer] = useState({ active:false, paused:false, startTime:null, accMs:0 })
  const [elapsed, setElapsed] = useState(0)
  const tickRef = useRef(null)
  const sinputRef = useRef(null)

  const toastTimer = useRef(null)
  const showToast = useCallback((node) => {
    setToast(node); clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }, [])

  // load
  useEffect(() => { (async () => {
    await detectMode(); setElectron(_mode === 'electron')
    const d = await bridgeLoad()
    if (d) setData({ sessions: d.sessions || [], aiLogs: d.aiLogs || [] })
    setReady(true)
  })() }, [])

  // persist (skip first)
  const firstSave = useRef(true)
  useEffect(() => {
    if (!ready) return
    if (firstSave.current) { firstSave.current = false; return }
    bridgeSave(data)
  }, [data, ready])

  const bump = () => setRev(r => r + 1)
  const addSession = s => { setData(d => ({ ...d, sessions: [...d.sessions, s] })); bump() }
  const updateSession = s => { setData(d => ({ ...d, sessions: d.sessions.map(x => x.id===s.id ? s : x) })); bump() }
  const removeSession = id => { setData(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== id) })); bump() }
  const addLog = l => { setData(d => ({ ...d, aiLogs: [...d.aiLogs, l] })); bump() }
  const removeLog = id => { setData(d => ({ ...d, aiLogs: d.aiLogs.filter(l => l.id !== id) })); bump() }

  // ── timer control ──
  const startTimer = () => {
    const t = { active:true, paused:false, startTime:Date.now(), accMs:0 }
    setTimer(t); setElapsed(0)
    clearInterval(tickRef.current)
    tickRef.current = setInterval(() => setElapsed(Date.now() - t.startTime + 0), 250)
  }
  const stopTimer = () => {
    setTimer(prev => {
      if (!prev.active) return prev
      const totalMs = prev.paused ? prev.accMs : prev.accMs + (Date.now() - prev.startTime)
      const label = (sinputRef.current?.value || '').trim() || 'Work Session'
      clearInterval(tickRef.current)
      addSession({ id: Date.now().toString(), label, start: Date.now()-totalMs, end: Date.now(), duration: totalMs })
      if (sinputRef.current) sinputRef.current.value = ''
      window.electronAPI?.timerUpdate({ running:false, time:'00:00:00' })
      setElapsed(0)
      return { active:false, paused:false, startTime:null, accMs:0 }
    })
  }
  const togglePause = () => {
    setTimer(prev => {
      if (!prev.active) return prev
      if (!prev.paused) {
        clearInterval(tickRef.current)
        const acc = prev.accMs + (Date.now() - prev.startTime)
        setElapsed(acc)
        window.electronAPI?.timerUpdate({ running:false, time:fmtMs(acc) })
        return { ...prev, paused:true, accMs:acc, startTime:null }
      } else {
        const st = Date.now()
        clearInterval(tickRef.current)
        tickRef.current = setInterval(() => setElapsed(prev.accMs + (Date.now() - st)), 250)
        return { ...prev, paused:false, startTime:st }
      }
    })
  }
  const toggleTimer = () => { timer.active ? stopTimer() : startTimer() }

  useEffect(() => {
    if (timer.active && !timer.paused) window.electronAPI?.timerUpdate({ running:true, time:fmtMs(elapsed) })
  }, [elapsed, timer.active, timer.paused])

  // ── claude banner ──
  useEffect(() => { if (!ready || _mode === 'ls') return; (async () => {
    try {
      const stats = await fetchClaudeStats()
      const todayTok = stats.filter(s => sameDay(new Date(s.date+'T12:00:00').getTime())).reduce((a,s)=>a+s.tokens,0)
      const logged = data.aiLogs.filter(l => l.tool==='Claude Code' && sameDay(l.ts) && l.auto).reduce((a,l)=>a+l.tokens,0)
      setClaudeBanner(todayTok > 0 && todayTok > logged ? todayTok : null)
    } catch (e) { setClaudeBanner(null) }
  })() }, [ready, rev])

  const syncClaude = async () => {
    if (_mode === 'ls') { showToast('Run server.js to enable Claude Code sync'); return }
    showToast('Syncing Claude Code…')
    try {
      const stats = await fetchClaudeStats()
      let added = 0, newLogs = []
      for (const day of stats) {
        const dayTs = new Date(day.date+'T12:00:00').getTime()
        const already = data.aiLogs.filter(l => l.tool==='Claude Code' && l.auto && dayKey(l.ts)===day.date).reduce((a,l)=>a+l.tokens,0)
        const newTok = day.tokens - already
        if (newTok > 0) { newLogs.push({ id:`cc-${day.date}-${Date.now()}`, tool:'Claude Code', tokens:newTok, note:`Auto-synced (${day.requests} req)`, ts:dayTs, auto:true }); added += newTok }
      }
      if (added > 0) { setData(d => ({ ...d, aiLogs: [...d.aiLogs, ...newLogs] })); bump(); showToast(html`Synced <span class="tk">${fmtNum(added)}</span> tokens`) }
      else showToast('Already up to date')
      setClaudeBanner(null)
    } catch (e) { showToast('Sync failed') }
  }

  const logAI = (tool, tokens, note) => {
    addLog({ id: Date.now().toString(), tool, tokens, note, ts: Date.now() })
    showToast(html`Logged <span class="tk">${fmtNum(tokens)}</span> ${tool} tokens`)
  }
  const closeModal = () => { setModal(false); setEditTarget(null) }
  const openNew = () => { setEditTarget(null); setModal(true) }
  const openEdit = (s) => { setEditTarget(s); setModal(true) }
  const submitManual = (s) => {
    if (editTarget) { updateSession(s); showToast(html`Updated <span class="tk">${fmtShort(s.duration)}</span>`) }
    else { addSession(s); showToast(html`Added <span class="tk">${fmtShort(s.duration)}</span>`) }
    closeModal()
  }
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download:`worksense-${dayKey(Date.now())}.json` })
    a.click(); URL.revokeObjectURL(a.href); showToast('Data exported')
  }
  const exportCSV = () => {
    const esc = c => { const s = String(c==null?'':c); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s }
    const rows = [['date','start','end','duration_min','label'],
      ...[...data.sessions].sort((a,b)=>a.start-b.start).map(s => [dayKey(s.start), fmtTime(s.start), s.end?fmtTime(s.end):'', Math.round(s.duration/60000), s.label])]
    const csv = rows.map(r => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download:`worksense-sessions-${dayKey(Date.now())}.csv` })
    a.click(); URL.revokeObjectURL(a.href); showToast('Sessions exported to CSV')
  }
  const openReport = () => setReport(buildWeeklySummary(data))

  // ── keyboard ──
  useEffect(() => {
    const h = e => {
      const k = e.key
      if ((e.ctrlKey||e.metaKey) && k==='Enter') toggleTimer()
      if ((e.ctrlKey||e.metaKey) && k===' ') { e.preventDefault(); togglePause() }
      if ((e.ctrlKey||e.metaKey) && k==='1') setView('dashboard')
      if ((e.ctrlKey||e.metaKey) && k==='2') setView('sessions')
      if ((e.ctrlKey||e.metaKey) && k==='3') setView('ai')
      if ((e.ctrlKey||e.metaKey) && (k==='l'||k==='L')) { e.preventDefault(); setEditTarget(null); setModal(true) }
      if (k==='Escape') { setModal(false); setEditTarget(null); setReport(null) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const running = timer.active && !timer.paused
  const clockStr = timer.active ? fmtMs(elapsed) : '00:00:00'

  return html`
    <div id="app">
      <${TopBar} electron=${electron} running=${running} clock=${clockStr} />
      <div id="shell">
        <${Sidebar} view=${view} setView=${setView} />
        <div id="main">
          <${AnimatePresence} mode="wait">
            ${view==='dashboard' && html`<${ViewWrap} key="d">
              <${Dashboard} data=${data} rev=${rev} range=${range} setRange=${setRange}
                timer=${timer} elapsed=${elapsed} clockStr=${clockStr} running=${running}
                toggleTimer=${toggleTimer} togglePause=${togglePause} openModal=${openNew}
                sinputRef=${sinputRef} claudeBanner=${claudeBanner} syncClaude=${syncClaude} reduce=${reduce} />
            <//>`}
            ${view==='sessions' && html`<${ViewWrap} key="s">
              <${Sessions} data=${data} removeSession=${removeSession} openModal=${openNew} openEdit=${openEdit}
                exportData=${exportData} exportCSV=${exportCSV} openReport=${openReport} reduce=${reduce} />
            <//>`}
            ${view==='ai' && html`<${ViewWrap} key="a">
              <${AIView} data=${data} rev=${rev} range=${range} logAI=${logAI} removeLog=${removeLog} syncClaude=${syncClaude} reduce=${reduce} />
            <//>`}
          <//>
        </div>
      </div>

      <${AnimatePresence}>
        ${modal && html`<${ManualModal} key="m" editing=${editTarget} onClose=${closeModal} onSubmit=${submitManual} showToast=${showToast} />`}
      <//>
      <${AnimatePresence}>
        ${report && html`<${ReportModal} key="r" text=${report} onClose=${()=>setReport(null)} showToast=${showToast} />`}
      <//>
      <${AnimatePresence}>
        ${toast && html`<${M.div} key="t" class="toast" initial=${{ opacity:0, y:20, x:'-50%' }} animate=${{ opacity:1, y:0, x:'-50%' }} exit=${{ opacity:0, y:12, x:'-50%' }} transition=${{ duration:0.28, ease:EASE }}>${toast}<//>`}
      <//>
    </div>`
}

// ── Top bar ──
function TopBar({ electron, running, clock }) {
  return html`<div id="topbar">
    <div class="brand"><span class="brand-mark"></span>WorkSense</div>
    <div class=${'topclock' + (running?' run':'')}>
      ${running && html`<${M.span} class="live-dot" animate=${{ opacity:[1,0.35,1], scale:[1,0.85,1] }} transition=${{ duration:1.7, repeat:Infinity, ease:'easeInOut' }} />`}
      <span class="clk">${clock}</span>
    </div>
    ${electron && html`<div class="wc">
      <button class="wb" onClick=${winMin}>${Ic.min}</button>
      <button class="wb" onClick=${winMax}>${Ic.max}</button>
      <button class="wb close" onClick=${winClose}>${Ic.close}</button>
    </div>`}
  </div>`
}

// ── Sidebar with shared-layout active pill ──
function Sidebar({ view, setView }) {
  return html`<aside id="sidebar">
    <nav class="side-nav">
      ${VIEWS.map((v, i) => html`
        <button class=${'nb' + (view===v.id?' active':'')} key=${v.id} onClick=${()=>setView(v.id)}>
          ${view===v.id && html`<${M.span} class="nav-pill" layoutId="navpill" transition=${{ type:'spring', stiffness:520, damping:40 }} />`}
          <span class="idx">${'0'+(i+1)}</span><span>${v.label}</span>
        </button>`)}
    </nav>
    <div class="side-foot">
      <div class="kbd-row"><kbd>Ctrl</kbd><kbd>↵</kbd><span>start / stop</span></div>
      <div class="kbd-row"><kbd>Ctrl</kbd><kbd>Spc</kbd><span>pause</span></div>
      <div class="kbd-row"><kbd>Ctrl</kbd><kbd>L</kbd><span>log session</span></div>
    </div>
  </aside>`
}

function ViewWrap({ children }) {
  return html`<${M.div} class="view" initial=${{ opacity:0, y:14 }} animate=${{ opacity:1, y:0 }} exit=${{ opacity:0, y:-10 }} transition=${{ duration:0.32, ease:EASE }}>${children}<//>`
}

// ── Dashboard ──
function Dashboard({ data, rev, range, setRange, timer, elapsed, clockStr, running, toggleTimer, togglePause, openModal, sinputRef, claudeBanner, syncClaude, reduce }) {
  const stats = useMemo(() => {
    const todaySess = data.sessions.filter(s => sameDay(s.start))
    const todayMs = todaySess.reduce((a,s)=>a+s.duration,0)
    const wkMs = data.sessions.filter(s => s.start >= weekStart()).reduce((a,s)=>a+s.duration,0)
    const todayLogs = data.aiLogs.filter(l => sameDay(l.ts))
    const todayTok = todayLogs.reduce((a,l)=>a+l.tokens,0)
    const days = new Set(data.sessions.map(s => dayKey(s.start)))
    let streak = 0; const d = new Date()
    for (let i=0;i<365;i++){ if (days.has(dayKey(d.getTime()))) { streak++; d.setDate(d.getDate()-1) } else break }
    const todayCost = sumCost(todayLogs)
    return { todaySess, todayMs, wkMs, todayLogs, todayTok, todayCost, streak, weekDays: weekDaysElapsed() }
  }, [rev])

  const stagger = reduce ? {} : { animate:'show', initial:'hidden', variants:{ show:{ transition:{ staggerChildren:0.06, delayChildren:0.05 } } } }
  const item = reduce ? {} : { variants:{ hidden:{ opacity:0, y:16 }, show:{ opacity:1, y:0, transition:{ duration:0.4, ease:EASE } } } }

  const paused = timer.active && timer.paused
  const heroCls = 'hero' + (running?' run':'') + (paused?' paused':'')

  return html`<${M.div} ...${stagger}>
    <${M.section} class=${heroCls} ...${item}>
      <div class="hero-glow"></div>
      <div class="hero-clock">
        <div class="eyebrow">${running?'Recording':paused?'Paused':'Ready to track'}</div>
        <div class="big">${clockStr}</div>
      </div>
      <div class="hero-controls">
        <input class="sinput" ref=${sinputRef} type="text" placeholder="What are you working on?" maxlength="100" />
        <div class="tcontrols">
          <${M.button} class=${'btn grow ' + (timer.active?'btn-stop':'btn-accent')} whileHover=${{ scale:1.02 }} whileTap=${{ scale:0.97 }} onClick=${toggleTimer}>
            ${timer.active?Ic.stop:Ic.play}${timer.active?'Stop':'Start'}<//>
          ${timer.active && html`<${M.button} class="btn btn-soft" whileHover=${{ scale:1.02 }} whileTap=${{ scale:0.97 }} onClick=${togglePause}>${paused?Ic.play:Ic.pause}${paused?'Resume':'Pause'}<//>`}
          <${M.button} class="btn btn-ghost" whileHover=${{ scale:1.02 }} whileTap=${{ scale:0.97 }} onClick=${openModal} title="Log a past session (Ctrl+L)">${Ic.plus}Log<//>
        </div>
      </div>
    <//>

    <${AnimatePresence}>
      ${claudeBanner && html`<${M.div} key="cb" class="cbanner" initial=${{ opacity:0, height:0, marginBottom:0 }} animate=${{ opacity:1, height:'auto', marginBottom:18 }} exit=${{ opacity:0, height:0, marginBottom:0 }}>
        <span>Claude Code: <b>${fmtNum(claudeBanner)}</b> tokens detected today</span>
        <${M.button} class="btn btn-sync" whileTap=${{ scale:0.96 }} onClick=${syncClaude}>${Ic.sync}Sync Tokens<//>
      <//>`}
    <//>

    <${M.section} class="ledger" ...${item}>
      <${Stat} label="Today" value=${stats.todayMs} format=${fmtHM} sub=${`${stats.todaySess.length} session${stats.todaySess.length!==1?'s':''}`} />
      <${Stat} label="This Week" value=${stats.wkMs} format=${v=>`${(v/3600000).toFixed(1)}h`} sub=${`avg ${(stats.wkMs/stats.weekDays/3600000).toFixed(1)}h/day`} />
      <${Stat} label="AI Tokens Today" value=${stats.todayTok} format=${fmtNum} sub=${`${stats.todayLogs.length} req · ≈ ${fmtUSD(stats.todayCost)}`} />
      <${Stat} label="Work Streak" value=${stats.streak} format=${v=>String(Math.round(v))} sub="days in a row" />
    <//>

    <${M.div} class="grid2" ...${item}>
      <div class="card">
        <div class="ctitle"><span class="lbl">Today's Timeline</span><span class="note">${stats.todayMs>0?`${(stats.todayMs/3600000).toFixed(1)}h`:''}</span></div>
        <div class="chart-wrap"><${ChartCanvas} deps=${[rev]} build=${() => hourlyConfig(data)} /></div>
      </div>
      <div class="card">
        <div class="ctitle">
          <span class="lbl">Activity · Last ${range} Days</span>
          <${RangeToggle} range=${range} setRange=${setRange} />
        </div>
        <div class="chart-wrap"><${ChartCanvas} deps=${[rev, range]} build=${() => weeklyConfig(data, range)} /></div>
      </div>
    <//>

    <${M.div} class="grid2" ...${item}>
      <div class="card">
        <div class="ctitle"><span class="lbl">Recent Sessions</span></div>
        <div class="list scroll"><${RecentList} data=${data} reduce=${reduce} /></div>
      </div>
      <div class="card">
        <div class="ctitle"><span class="lbl">AI Usage Breakdown</span></div>
        <${Donut} data=${data} rev=${rev} id="d1" />
      </div>
    <//>

    <${M.div} class="card" ...${item}>
      <${Heatmap} data=${data} rev=${rev} />
    <//>
  <//>`
}

function Stat({ label, value, format, sub }) {
  return html`<div class="lcell"><div class="spark"></div>
    <div class="eyebrow">${label}</div>
    <div class="lval"><${AnimatedNumber} value=${value} format=${format} /></div>
    <div class="lsub">${sub}</div>
  </div>`
}

function RangeToggle({ range, setRange }) {
  return html`<div class="rtoggle">
    ${[7,14,30].map(n => html`<button key=${n} class=${'rb'+(range===n?' active':'')} onClick=${()=>setRange(n)}>
      ${range===n && html`<${M.span} class="rb-pill" layoutId="rangepill" transition=${{ type:'spring', stiffness:520, damping:40 }} />`}${n}d
    </button>`)}
  </div>`
}

function RecentList({ data, reduce }) {
  const all = [...data.sessions].reverse().slice(0, 8)
  if (!all.length) return html`<div class="empty">No sessions yet</div>`
  return html`${all.map((s, i) => html`<${M.div} class="row" key=${s.id}
    initial=${reduce?false:{ opacity:0, x:-10 }} animate=${{ opacity:1, x:0 }} transition=${{ duration:0.3, delay:i*0.035, ease:EASE }}>
    <span class="dot"></span>
    <span class="name">${s.label}</span>
    <span class="rng">${fmtTime(s.start)}${s.end?'–'+fmtTime(s.end):''}</span>
    <span class="dur">${fmtShort(s.duration)}</span>
  <//>`)}`
}

// ── Donut ──
function Donut({ data, rev, id }) {
  const entries = useMemo(() => {
    const by = {}; data.aiLogs.forEach(l => { by[l.tool] = (by[l.tool]||0) + l.tokens })
    return Object.entries(by).sort((a,b)=>b[1]-a[1])
  }, [rev])
  const total = entries.reduce((a,e)=>a+e[1],0)
  return html`<div class="donut-wrap" style=${{ height:'132px' }}>
    <div class="donut-canvas"><${ChartCanvas} deps=${[rev]} build=${() => donutConfig(entries)} /></div>
    <div class="donut-legend">
      ${entries.length===0 ? html`<div class="empty" style=${{ padding:0, fontSize:'12px' }}>No AI activity logged</div>`
        : entries.slice(0,6).map(([t,v]) => html`<${M.div} class="dl" key=${t} initial=${{ opacity:0, x:8 }} animate=${{ opacity:1, x:0 }} transition=${{ duration:0.3, ease:EASE }}>
            <span class="sw" style=${{ background:tc(t) }}></span><span class="nm">${t}</span><span class="pc">${((v/total)*100).toFixed(0)}%</span>
          <//>`)}
    </div>
  </div>`
}

// ── Heatmap ──
function Heatmap({ data, rev }) {
  const reduce = useReducedMotion()
  const { weeks, monthLabels, totalH, COLORS, todayKey, todayTs, GAP } = useMemo(() => {
    const GAP = 3, WEEKS = 52
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const COLORS = ['rgba(255,255,255,0.05)','rgba(194,242,74,0.18)','rgba(194,242,74,0.34)','rgba(194,242,74,0.55)','rgba(194,242,74,0.78)','#c2f24a']
    const todayTs = new Date(); todayTs.setHours(23,59,59,999)
    const start = new Date(); start.setDate(start.getDate()-WEEKS*7); start.setDate(start.getDate()-start.getDay()); start.setHours(0,0,0,0)
    const dayH = {}; data.sessions.forEach(s => { const k = dayKey(s.start); dayH[k] = (dayH[k]||0) + s.duration/3600000 })
    const weeks = []; const cur = new Date(start)
    while (cur <= todayTs) { const wk = []; for (let d=0; d<7; d++){ const dt = new Date(cur); wk.push({ key:dayKey(dt.getTime()), h:dayH[dayKey(dt.getTime())]||0, future: dt>todayTs }); cur.setDate(cur.getDate()+1) } weeks.push(wk) }
    const UNIT = 12 + GAP
    const monthLabels = []; weeks.forEach((wk, wi) => { const k = wk[1].key, dd = Number(k.split('-')[2]); if (wi===0 || dd<=7) monthLabels.push({ x: wi*UNIT, label: MO[Number(k.split('-')[1])-1] }) })
    const totalH = Object.values(dayH).reduce((a,v)=>a+v,0)
    return { weeks, monthLabels, totalH, COLORS, todayKey: dayKey(Date.now()), todayTs, GAP }
  }, [rev])
  const lvl = h => !h?0:h<1?1:h<3?2:h<5?3:h<7?4:5
  const gridW = weeks.length*(12+GAP)
  return html`<div>
    <div class="ctitle"><span class="lbl">Activity Heatmap · Past Year</span><span class="note">${totalH>0?`${Math.round(totalH)}h total`:''}</span></div>
    <div style=${{ display:'flex', gap:'6px', alignItems:'flex-start' }}>
      <div style=${{ display:'flex', flexDirection:'column', gap:GAP+'px', paddingTop:'20px', flexShrink:0 }}>
        ${['','Mon','','Wed','','Fri',''].map((l,i) => html`<div class="hm-day-label" key=${i}>${l}</div>`)}
      </div>
      <div style=${{ overflowX:'auto', flex:1, minWidth:0 }}>
        <div style=${{ position:'relative', height:'18px', width:gridW+'px', marginBottom:'4px' }}>
          ${monthLabels.map((m,i) => html`<span key=${i} style=${{ position:'absolute', left:m.x+'px', fontSize:'10px', color:'var(--t3)', fontFamily:'var(--fm)' }}>${m.label}</span>`)}
        </div>
        <${M.div} style=${{ display:'flex', gap:GAP+'px' }} initial=${reduce?false:{ opacity:0 }} animate=${{ opacity:1 }} transition=${{ duration:0.5, ease:EASE }}>
          ${weeks.map((wk, wi) => html`<div key=${wi} style=${{ display:'flex', flexDirection:'column', gap:GAP+'px' }}>
            ${wk.map((d,di) => html`<div key=${di} class=${'hm-cell'+(d.key===todayKey?' hm-today':'')} title=${d.future?'':(d.h>0?`${d.key}: ${d.h.toFixed(1)}h`:`${d.key}: no work`)} style=${{ background: d.future?'transparent':COLORS[lvl(d.h)] }}></div>`)}
          </div>`)}
        <//>
        <div style=${{ display:'flex', alignItems:'center', gap:'4px', marginTop:'12px', justifyContent:'flex-end' }}>
          <span style=${{ fontSize:'10px', color:'var(--t3)', fontFamily:'var(--fm)' }}>Less</span>
          ${COLORS.map((c,i) => html`<div key=${i} class="hm-cell" style=${{ background:c }}></div>`)}
          <span style=${{ fontSize:'10px', color:'var(--t3)', fontFamily:'var(--fm)' }}>More</span>
        </div>
      </div>
    </div>
  </div>`
}

// ── Sessions view ──
function Sessions({ data, removeSession, openModal, openEdit, exportData, exportCSV, openReport, reduce }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase()
    const src = term ? data.sessions.filter(s => s.label.toLowerCase().includes(term)) : data.sessions
    const g = {}; [...src].reverse().forEach(s => { const k = dayKey(s.start); (g[k] ||= []).push(s) }); return g
  }, [data.sessions, q])
  const keys = Object.keys(groups)
  return html`<div>
    <div class="vhead">
      <div><div class="vtitle">Work Sessions</div><div class="vsub">Every tracked and logged work block.</div></div>
      <div style=${{ display:'flex', gap:'8px', flexWrap:'wrap', justifyContent:'flex-end' }}>
        <${M.button} class="btn btn-accent btn-sm" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${openModal}>${Ic.plus}Add Session<//>
        <${M.button} class="btn btn-soft btn-sm" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${openReport}>Weekly Summary<//>
        <${M.button} class="btn btn-ghost btn-sm" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${exportCSV}>CSV<//>
        <${M.button} class="btn btn-ghost btn-sm" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${exportData}>JSON<//>
      </div>
    </div>
    <input class="finp" style=${{ width:'100%', marginBottom:'18px' }} placeholder="Search by label" value=${q} onChange=${e=>setQ(e.target.value)} />
    ${keys.length===0 ? html`<div class="empty" style=${{ padding:'48px' }}>${q.trim()?'Nothing matches your search.':'No sessions yet. Start the timer.'}</div>`
      : keys.map(dk => html`<div class="daygrp" key=${dk}>
          <div class="daylbl"><span class="dayname">${fmtDayLabel(dk)}</span><span class="daytot">${fmtShort(groups[dk].reduce((a,s)=>a+s.duration,0))}</span></div>
          <div class="list">
            ${groups[dk].map((s,i) => html`<${M.div} class="row" key=${s.id} layout
              initial=${reduce?false:{ opacity:0, y:8 }} animate=${{ opacity:1, y:0 }} transition=${{ duration:0.28, delay:Math.min(i*0.025,0.3), ease:EASE }}>
              <span class="dot"></span>
              <span class="name">${s.label}</span>
              <span class="rng">${fmtTime(s.start)}${s.end?'–'+fmtTime(s.end):''}</span>
              <span class="dur">${fmtShort(s.duration)}</span>
              <button class="del" title="Edit" onClick=${()=>openEdit(s)}>${Ic.edit}</button>
              <button class="del" title="Delete" onClick=${()=>removeSession(s.id)}>${Ic.x}</button>
            <//>`)}
          </div>
        </div>`)}
  </div>`
}

// ── AI view ──
function AIView({ data, rev, range, logAI, removeLog, syncClaude, reduce }) {
  const [tool, setTool] = useState('Claude Code')
  const tokRef = useRef(null), noteRef = useRef(null)
  const submit = () => {
    const t = parseInt(tokRef.current?.value)
    if (!t || t<=0) { tokRef.current?.focus(); return }
    logAI(tool, t, (noteRef.current?.value||'').trim())
    tokRef.current.value = ''; noteRef.current.value = ''
  }
  const all = [...data.aiLogs].reverse()
  const rangeStart = (()=>{ const d=new Date(); d.setDate(d.getDate()-(range-1)); d.setHours(0,0,0,0); return d.getTime() })()
  const rangeCost = sumCost(data.aiLogs.filter(l=>l.ts>=rangeStart))
  return html`<div>
    <div class="vhead">
      <div><div class="vtitle">AI Activity</div><div class="vsub">Token usage across your AI tools. Cost is a rough estimate.</div></div>
      <${M.button} class="btn btn-sync" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${syncClaude}>${Ic.sync}Sync Claude Code<//>
    </div>

    <div class="card" style=${{ marginBottom:'16px' }}>
      <div class="ctitle"><span class="lbl">Log Usage</span></div>
      <div class="frow">
        <div class="fg"><label class="flabel">Tool</label>
          <select class="fsel" style=${{ minWidth:'152px' }} value=${tool} onChange=${e=>setTool(e.target.value)}>
            ${Object.keys(TOOLS).map(t => html`<option key=${t}>${t}</option>`)}
          </select>
        </div>
        <div class="fg"><label class="flabel">Tokens</label>
          <input class="finp" ref=${tokRef} type="number" placeholder="42350" min="1" style=${{ width:'130px' }} onKeyDown=${e=>e.key==='Enter'&&submit()} />
        </div>
        <div class="fg" style=${{ flex:1 }}><label class="flabel">Note (optional)</label>
          <input class="finp" ref=${noteRef} type="text" placeholder="What were you building?" onKeyDown=${e=>e.key==='Enter'&&submit()} />
        </div>
        <${M.button} class="btn btn-accent" whileHover=${{ scale:1.03 }} whileTap=${{ scale:0.96 }} onClick=${submit}>Log<//>
      </div>
    </div>

    <div class="grid2" style=${{ marginBottom:'16px' }}>
      <div class="card">
        <div class="ctitle"><span class="lbl">Token Trend · Last ${range} Days</span><span class="note">≈ ${fmtUSD(rangeCost)}</span></div>
        <div class="chart-wrap"><${ChartCanvas} deps=${[rev, range]} build=${() => trendConfig(data, range)} /></div>
      </div>
      <div class="card">
        <div class="ctitle"><span class="lbl">By Tool</span></div>
        <${Donut} data=${data} rev=${rev} id="d2" />
      </div>
    </div>

    <div class="card">
      <div class="ctitle"><span class="lbl">Activity Log</span><span class="note">${all.length?`${all.length} entr${all.length===1?'y':'ies'}`:''}</span></div>
      <div class="list scroll" style=${{ maxHeight:'320px' }}>
        ${all.length===0 ? html`<div class="empty">No AI activity logged yet.</div>`
          : all.map((l,i) => html`<${M.div} class="row" key=${l.id} layout
              initial=${reduce?false:{ opacity:0, y:8 }} animate=${{ opacity:1, y:0 }} transition=${{ duration:0.26, delay:Math.min(i*0.02,0.25), ease:EASE }}>
              <span class="badge" style=${{ color:tc(l.tool), borderColor:tc(l.tool), background:tc(l.tool)+'1f' }}>${l.tool}</span>
              <span class="tok">${fmtNum(l.tokens)}</span>
              <span class="anote">${l.note||''}</span>
              <span class="ats">${fmtDateTime(l.ts)}</span>
              <button class="del" onClick=${()=>removeLog(l.id)}>${Ic.x}</button>
            <//>`)}
      </div>
    </div>
  </div>`
}

// ── Manual / edit modal ──
function ManualModal({ editing, onClose, onSubmit, showToast }) {
  const init = editing
    ? { date: dayKey(editing.start), start: fmtTime(editing.start), end: fmtTime(editing.end || editing.start + editing.duration), label: editing.label }
    : { date: new Date().toISOString().slice(0,10), start: '09:00', end: '10:00', label: '' }
  const [date, setDate] = useState(init.date)
  const [start, setStart] = useState(init.start)
  const [end, setEnd] = useState(init.end)
  const [label, setLabel] = useState(init.label)
  const labelRef = useRef(null)
  useEffect(() => { setTimeout(() => labelRef.current?.focus(), 80) }, [])

  const startTs = new Date(`${date}T${start}`).getTime()
  const endTs = new Date(`${date}T${end}`).getTime()
  const preview = !date||!start||!end ? '' : (endTs<=startTs ? 'End must be after start' : `Duration: ${fmtShort(endTs-startTs)}`)

  const submit = () => {
    if (!date||!start||!end) { showToast('Fill in date and times'); return }
    if (isNaN(startTs)||isNaN(endTs)) { showToast('Invalid date or time'); return }
    if (endTs<=startTs) { showToast('End time must be after start time'); return }
    if (startTs>Date.now()) { showToast('Session cannot be in the future'); return }
    onSubmit({ id: editing ? editing.id : 'manual-'+Date.now(), label: label.trim()||'Work Session', start:startTs, end:endTs, duration:endTs-startTs, manual:true })
  }
  return html`<${M.div} class="overlay" initial=${{ opacity:0 }} animate=${{ opacity:1 }} exit=${{ opacity:0 }} transition=${{ duration:0.18 }} onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <${M.div} class="modal" initial=${{ opacity:0, scale:0.94, y:10 }} animate=${{ opacity:1, scale:1, y:0 }} exit=${{ opacity:0, scale:0.96, y:8 }} transition=${{ type:'spring', stiffness:380, damping:30 }}>
      <div class="modal-title">${editing ? 'Edit Session' : 'Log Work Session'}</div>
      <div class="fg" style=${{ marginBottom:'12px' }}><label class="flabel">Date</label>
        <input class="finp" type="date" value=${date} onChange=${e=>setDate(e.target.value)} style=${{ width:'100%' }} /></div>
      <div class="modal-grid">
        <div class="fg"><label class="flabel">Start Time</label><input class="finp" type="time" value=${start} onChange=${e=>setStart(e.target.value)} /></div>
        <div class="fg"><label class="flabel">End Time</label><input class="finp" type="time" value=${end} onChange=${e=>setEnd(e.target.value)} /></div>
      </div>
      <div class="ml-dur" style=${{ color: (preview.startsWith('End')?'var(--red)':'var(--t3)') }}>${preview}</div>
      <div class="fg"><label class="flabel">Label</label>
        <input class="finp" ref=${labelRef} type="text" value=${label} placeholder="What did you work on?" onChange=${e=>setLabel(e.target.value)} onKeyDown=${e=>e.key==='Enter'&&submit()} style=${{ width:'100%' }} /></div>
      <div class="modal-foot">
        <${M.button} class="btn btn-ghost btn-sm" whileTap=${{ scale:0.96 }} onClick=${onClose}>Cancel<//>
        <${M.button} class="btn btn-accent btn-sm" whileTap=${{ scale:0.96 }} onClick=${submit}>${editing ? 'Save' : 'Add Session'}<//>
      </div>
    <//>
  <//>`
}

// ── Weekly report modal ──
function ReportModal({ text, onClose, showToast }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); showToast('Copied to clipboard') }
    catch (e) { showToast('Copy failed') }
  }
  return html`<${M.div} class="overlay" initial=${{ opacity:0 }} animate=${{ opacity:1 }} exit=${{ opacity:0 }} transition=${{ duration:0.18 }} onClick=${e=>e.target===e.currentTarget&&onClose()}>
    <${M.div} class="modal" style=${{ width:'480px' }} initial=${{ opacity:0, scale:0.94, y:10 }} animate=${{ opacity:1, scale:1, y:0 }} exit=${{ opacity:0, scale:0.96, y:8 }} transition=${{ type:'spring', stiffness:380, damping:30 }}>
      <div class="modal-title">Weekly Summary</div>
      <textarea class="finp" readonly value=${text} style=${{ width:'100%', height:'210px', resize:'none', fontFamily:'var(--fm)', fontSize:'12.5px', lineHeight:'1.65', whiteSpace:'pre', overflow:'auto' }}></textarea>
      <div class="modal-foot">
        <${M.button} class="btn btn-ghost btn-sm" whileTap=${{ scale:0.96 }} onClick=${onClose}>Close<//>
        <${M.button} class="btn btn-accent btn-sm" whileTap=${{ scale:0.96 }} onClick=${copy}>${Ic.copy}Copy<//>
      </div>
    <//>
  <//>`
}

// ════════════════════════════ CHART CONFIGS ═════════════════════════════
function hourlyConfig(data) {
  const labels = [], d = []
  for (let h=6; h<=22; h++) {
    labels.push(h<12?`${h}a`:h===12?'12p':`${h-12}p`)
    let mins = 0
    data.sessions.filter(s => sameDay(s.start)).forEach(s => { const sH = new Date(s.start).getHours(), eH = new Date(s.end||Date.now()).getHours(); if (h>=sH && h<=eH) mins += Math.min(60, s.duration/60000) })
    d.push(Math.min(60, Math.round(mins)))
  }
  return { type:'bar', data:{ labels, datasets:[{ data:d, backgroundColor: d.map(v=>v>0?CC.accentS:CC.faint), borderRadius:3, borderSkipped:false }] }, options: cOpts(v=>`${v} min`, 60, 'm') }
}
function weeklyConfig(data, n) {
  const DN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const labels = [], d = []
  for (let i=n-1; i>=0; i--) { const dt = new Date(); dt.setDate(dt.getDate()-i); dt.setHours(0,0,0,0)
    labels.push(n<=7?DN[dt.getDay()]:`${dt.getDate()} ${MN[dt.getMonth()]}`)
    d.push(+(data.sessions.filter(s=>dayKey(s.start)===dayKey(dt.getTime())).reduce((a,s)=>a+s.duration,0)/3600000).toFixed(2)) }
  const opts = cOpts(v=>`${v.toFixed(1)} h`, undefined, 'h')
  if (n>14) { opts.scales.x.ticks.maxTicksLimit = 12; opts.scales.x.ticks.autoSkip = true }
  return { type:'bar', data:{ labels, datasets:[{ data:d, backgroundColor: d.map((_,i)=>i===n-1?CC.accentS:CC.ink16), borderRadius:3, borderSkipped:false }] }, options: opts }
}
function trendConfig(data, n) {
  const DN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const labels = [], d = []
  for (let i=n-1; i>=0; i--) { const dt = new Date(); dt.setDate(dt.getDate()-i)
    labels.push(n<=7?DN[dt.getDay()]:`${dt.getDate()} ${MN[dt.getMonth()]}`)
    d.push(data.aiLogs.filter(l=>dayKey(l.ts)===dayKey(dt.getTime())).reduce((a,l)=>a+l.tokens,0)) }
  const opts = cOpts(v=>`${fmtNum(v)} tokens`, undefined, '')
  if (n>14) { opts.scales.x.ticks.maxTicksLimit = 12; opts.scales.x.ticks.autoSkip = true }
  return { type:'line', data:{ labels, datasets:[{ data:d, tension:0.32, fill:true, borderColor:CC.accent, borderWidth:2, backgroundColor:'rgba(194,242,74,0.08)', pointBackgroundColor:CC.accent, pointBorderColor:CC.surf, pointBorderWidth:1.5, pointRadius:n>14?0:3, pointHoverRadius:5 }] }, options: opts }
}
function donutConfig(entries) {
  if (!entries.length) return { type:'doughnut', data:{ datasets:[{ data:[1], backgroundColor:[CC.faint], borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:true, cutout:'70%', plugins:{ legend:{display:false}, tooltip:{enabled:false} } } }
  const total = entries.reduce((a,e)=>a+e[1],0)
  return { type:'doughnut', data:{ labels: entries.map(e=>e[0]), datasets:[{ data: entries.map(e=>e[1]), backgroundColor: entries.map(e=>tc(e[0])), borderColor:CC.surf, borderWidth:3, hoverBorderWidth:3 }] },
    options:{ responsive:true, maintainAspectRatio:true, cutout:'70%', animation:{ animateRotate:true, duration:700 }, plugins:{ legend:{display:false}, tooltip:{ backgroundColor:CC.surf, borderColor:CC.line, borderWidth:1, titleColor:CC.t2, bodyColor:CC.t1, padding:9, cornerRadius:8, displayColors:false, bodyFont:{family:'JetBrains Mono',size:12}, callbacks:{ label:c=>` ${fmtNum(c.raw)} (${((c.raw/total)*100).toFixed(0)}%)` } } } } }
}

createRoot(document.getElementById('root')).render(html`<${App} />`)

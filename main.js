const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
let tray

const dataFile = path.join(app.getPath('userData'), 'worksense-data.json')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#070a10',
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  })

  mainWindow.loadFile('index.html')

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Закрытие окна сворачивает в трей, реальный выход только из меню трея
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide() }
  })

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ── Data persistence ──────────────────────────────────────────
ipcMain.handle('load-data', async () => {
  try {
    if (fs.existsSync(dataFile)) {
      return JSON.parse(fs.readFileSync(dataFile, 'utf-8'))
    }
  } catch (e) { console.error('load-data error:', e) }
  return null
})

ipcMain.handle('save-data', async (event, data) => {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('save-data error:', e); return false }
})

// ── Claude Code auto-sync ─────────────────────────────────────
ipcMain.handle('read-claude-stats', async (event, sinceDate) => {
  const since = sinceDate ? new Date(sinceDate) : (() => {
    const d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0,0,0,0); return d
  })()

  const claudeDir = path.join(app.getPath('home'), '.claude', 'projects')
  if (!fs.existsSync(claudeDir)) return []

  // Aggregate tokens by day
  const dayMap = {}

  try {
    const projects = fs.readdirSync(claudeDir)
    for (const proj of projects) {
      const projDir = path.join(claudeDir, proj)
      let stat
      try { stat = fs.statSync(projDir) } catch(e) { continue }
      if (!stat.isDirectory()) continue

      const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
      for (const file of files) {
        const filePath = path.join(projDir, file)
        let content
        try { content = fs.readFileSync(filePath, 'utf-8') } catch(e) { continue }

        const lines = content.split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'assistant') continue
            const usage = obj.message && obj.message.usage
            if (!usage) continue

            const ts = new Date(obj.timestamp)
            if (ts < since) continue

            // Total tokens = input + output + cache_creation + cache_read
            const total =
              (usage.input_tokens || 0) +
              (usage.output_tokens || 0) +
              (usage.cache_creation_input_tokens || 0) +
              (usage.cache_read_input_tokens || 0)
            if (total === 0) continue

            const key = ts.toISOString().slice(0, 10) // YYYY-MM-DD
            if (!dayMap[key]) dayMap[key] = { tokens: 0, requests: 0, ts: ts.getTime() }
            dayMap[key].tokens += total
            dayMap[key].requests += 1
          } catch(e) { /* skip malformed line */ }
        }
      }
    }
  } catch(e) { console.error('claude-stats error:', e) }

  return Object.entries(dayMap).map(([date, d]) => ({ date, tokens: d.tokens, requests: d.requests }))
})

// ── Window controls ───────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize())
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window-close', () => mainWindow && mainWindow.close())

ipcMain.on('timer-update', (event, status) => {
  if (tray) {
    tray.setToolTip(status.running ? `WorkSense ● ${status.time}` : 'WorkSense — Idle')
  }
})

// ── Tray + фоновый режим ──────────────────────────────────────
function showWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() }
  else createWindow()
}

function createTray() {
  if (tray) return
  let img
  try { img = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }) }
  catch (e) { img = nativeImage.createEmpty() }
  tray = new Tray(img)
  tray.setToolTip('WorkSense')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть WorkSense', click: showWindow },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit() } }
  ]))
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
}

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

// Окно сворачивается в трей, приложение продолжает работать в фоне.
// Полный выход только через пункт «Выход» в меню трея.
app.on('window-all-closed', () => {})

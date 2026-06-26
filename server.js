const http = require('http')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const PORT    = 3456
const dataFile = path.join(__dirname, 'worksense-data.json')

// ── Claude Code JSONL reader ────────────────────────────────
function readClaudeStats() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(claudeDir)) return []

  const since = new Date()
  since.setDate(since.getDate() - 29)
  since.setHours(0, 0, 0, 0)

  const dayMap = {}

  try {
    const projects = fs.readdirSync(claudeDir)
    for (const proj of projects) {
      const projDir = path.join(claudeDir, proj)
      try { if (!fs.statSync(projDir).isDirectory()) continue } catch(e) { continue }

      const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
      for (const file of files) {
        let content
        try { content = fs.readFileSync(path.join(projDir, file), 'utf-8') } catch(e) { continue }

        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            if (obj.type !== 'assistant') continue
            const usage = obj.message && obj.message.usage
            if (!usage) continue

            const ts = new Date(obj.timestamp)
            if (ts < since) continue

            const total =
              (usage.input_tokens || 0) +
              (usage.output_tokens || 0) +
              (usage.cache_creation_input_tokens || 0) +
              (usage.cache_read_input_tokens || 0)
            if (total === 0) continue

            const key = ts.toISOString().slice(0, 10)
            if (!dayMap[key]) dayMap[key] = { tokens: 0, requests: 0 }
            dayMap[key].tokens   += total
            dayMap[key].requests += 1
          } catch(e) { /* skip */ }
        }
      }
    }
  } catch(e) { console.error('Claude stats error:', e.message) }

  return Object.entries(dayMap).map(([date, d]) => ({ date, tokens: d.tokens, requests: d.requests }))
}

// ── HTTP server ─────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const server = http.createServer((req, res) => {
  cors(res)

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  // GET /api/data
  if (req.method === 'GET' && req.url === '/api/data') {
    try {
      const data = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf-8') : 'null'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(data)
    } catch(e) {
      res.writeHead(500); return res.end(JSON.stringify({ error: e.message }))
    }
  }

  // POST /api/data
  if (req.method === 'POST' && req.url === '/api/data') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        fs.writeFileSync(dataFile, body, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // GET /api/claude-stats
  if (req.method === 'GET' && req.url === '/api/claude-stats') {
    const stats = readClaudeStats()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(stats))
  }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(html)
    } catch(e) {
      res.writeHead(404); return res.end('index.html not found')
    }
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  WorkSense running at http://localhost:${PORT}\n`)

  // Auto-open browser
  const open = process.platform === 'win32'
    ? `start http://localhost:${PORT}`
    : process.platform === 'darwin'
    ? `open http://localhost:${PORT}`
    : `xdg-open http://localhost:${PORT}`

  require('child_process').exec(open)
})

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`  Port ${PORT} is busy. Kill the old process or change PORT in server.js`)
  } else {
    console.error(e)
  }
  process.exit(1)
})

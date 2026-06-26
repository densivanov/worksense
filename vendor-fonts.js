// Скачивает шрифты Google локально, чтобы они не тянулись из сети.
// Запускать один раз при смене набора шрифтов: node vendor-fonts.js
const https = require('https')
const fs = require('fs')
const path = require('path')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'

function get(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return get(r.headers.location, headers).then(resolve, reject)
      }
      const chunks = []
      r.on('data', d => chunks.push(d))
      r.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

;(async () => {
  fs.mkdirSync(path.join('assets', 'fonts'), { recursive: true })
  const css = (await get(CSS_URL, { 'User-Agent': UA })).toString('utf8')
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map(m => m[1]))]
  let out = css
  let i = 0
  for (const u of urls) {
    const fn = 'f' + (i++) + '.woff2'
    fs.writeFileSync(path.join('assets', 'fonts', fn), await get(u, { 'User-Agent': UA }))
    out = out.split(u).join('fonts/' + fn)
  }
  fs.writeFileSync(path.join('assets', 'fonts.css'), out)
  console.log('fonts vendored:', urls.length, 'woff2 files into assets/fonts/')
})().catch(e => { console.error(e); process.exit(1) })

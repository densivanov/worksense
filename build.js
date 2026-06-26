// Сборка фронтенда в один локальный бандл, чтобы приложение работало без интернета.
// React, Framer Motion и htm собираются в assets/app.js, Chart.js копируется рядом.
const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

fs.mkdirSync('assets', { recursive: true })

esbuild.build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['chrome110'],
  outfile: 'assets/app.js',
  logLevel: 'info'
}).then(() => {
  const chart = path.join('node_modules', 'chart.js', 'dist', 'chart.umd.js')
  fs.copyFileSync(chart, path.join('assets', 'chart.umd.min.js'))
  console.log('build done: assets/app.js + assets/chart.umd.min.js')
}).catch(e => { console.error(e); process.exit(1) })

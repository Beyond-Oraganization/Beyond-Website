// Serves the Beyond-Website folder the way GitHub Pages does: the site at /Beyond-Website/, so the built app is at
// /Beyond-Website/app/ (its real path), on http://localhost (a secure context, so it can be installed), with text
// files gzipped as Pages sends them.
//   node scripts/serve-app.mjs [port]
import { createReadStream, statSync } from 'node:fs'
import http from 'node:http'
import { createGzip } from 'node:zlib'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const port = Number(process.argv[2] ?? 4300)
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain', '.pdf': 'application/pdf',
}

export function serve(listenPort = port) {
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (!path.startsWith('/Beyond-Website/')) {
      res.writeHead(302, { Location: '/Beyond-Website/app/' })
      return res.end()
    }
    let file = normalize(join(root, path.slice('/Beyond-Website/'.length)))
    if (!file.startsWith(root)) {
      res.writeHead(403)
      return res.end()
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
      statSync(file)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('Not found')
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && /^(text\/|application\/(json|manifest\+json|xml)|image\/svg)/.test(type)
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) })
    const stream = createReadStream(file)
    if (gzip) stream.pipe(createGzip()).pipe(res)
    else stream.pipe(res)
  })
  return new Promise((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve(server)))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve()
  console.log(`Serving the site on http://localhost:${port}/Beyond-Website/ (the app at /Beyond-Website/app/)`)
}

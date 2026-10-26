#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientAddress, IP_LIMITS, WindowCounter } from './limits.ts'
import { createRelay, type Relay, type RelayOptions } from './relay.ts'

// The phone page sits beside src/ and dist/ alike.
const PHONE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'phone')
const STATIC: Record<string, string> = {
  '/phone.js': 'text/javascript; charset=utf-8',
  '/phone.css': 'text/css; charset=utf-8',
}
const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

/** The relay plus the HTTP side: the phone page, `/<CODE>` links and a health check. */
export function createJoinServer(options: RelayOptions): { server: Server; relay: Relay } {
  const relay = createRelay(options)
  const requests = new WindowCounter(IP_LIMITS.requestsPerMinute, 60_000, options.now ?? Date.now)
  const sweep = setInterval(() => requests.sweep(), 60_000)
  sweep.unref()
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://join').pathname
    if (path !== '/healthz' && !requests.hit(clientAddress(req, options.trustProxy))) {
      res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '60' })
      return res.end('Too many requests')
    }
    try {
      if (path === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('ok')
      }
      const type = STATIC[path]
      if (type) {
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=300', ...SECURITY })
        return res.end(await readFile(join(PHONE_DIR, path.slice(1))))
      }
      // The page itself: the code form at /, a room at /<CODE>. It reads the code from its URL.
      if (path === '/' || /^\/[A-Za-z0-9]{3,12}\/?$/.test(path)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SECURITY })
        return res.end(await readFile(join(PHONE_DIR, 'index.html')))
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('Server error')
    }
  })
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))
  return { server, relay }
}

// Run as a program (also through the npm bin symlink), not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8080)
  const hostTokens = (process.env.JOIN_HOST_TOKENS ?? '').split(',').map(t => t.trim()).filter(Boolean)
  const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`
  if (!hostTokens.length) console.warn('JOIN_HOST_TOKENS is empty: no host can open a room.')
  const { server, relay } = createJoinServer({ hostTokens, publicUrl })
  server.listen(port, () => console.log(`join listening on :${port}, public URL ${publicUrl}`))
  // Sockets first: the HTTP server only finishes closing once they are gone.
  const stop = () => { relay.close(); server.close(() => process.exit(0)) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

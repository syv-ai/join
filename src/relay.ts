import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { type WebSocket, WebSocketServer } from 'ws'
import {
  CODE_ALPHABET, CODE_LENGTH, LIMITS, parseHostMessage, parseParticipantMessage,
  type RelayToHost, type RelayToParticipant,
} from './protocol.ts'
import { clientAddress, IP_LIMITS, PARTICIPANTS_PER_ROOM, ROOMS_PER_TOKEN, WindowCounter } from './limits.ts'
import { Room, type Send } from './room.ts'

export interface RelayOptions {
  /** Tokens that may open rooms. */
  hostTokens: string[]
  /** Base of the join URL handed to hosts, e.g. https://join.syv.ai. */
  publicUrl: string
  /** Whose X-Forwarded-For to believe: by default, a peer on a private network (a reverse proxy). */
  trustProxy?: boolean | 'private'
  now?: () => number
}

export interface Relay {
  /** Takes an HTTP upgrade for `/host` or `/p/<code>`; anything else is refused. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  rooms: Map<string, Room>
  close(): void
}

/** Close codes, in the 4000 range WebSocket leaves to applications. */
export const CLOSE = { badMessage: 4400, unauthorized: 4401, unknownRoom: 4404, takenOver: 4409, tooFast: 4429, full: 4413 } as const

const HEARTBEAT_MS = 10_000

const sender = <T>(ws: WebSocket): Send<T> => message => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function tokenMatches(token: string, tokens: string[]): boolean {
  const given = Buffer.from(token)
  return token.length > 0 && tokens.some(t => {
    const known = Buffer.from(t)
    return known.length === given.length && timingSafeEqual(known, given)
  })
}

export function createRelay(options: RelayOptions): Relay {
  const now = options.now ?? Date.now
  const tokens = options.hostTokens.map(t => t.trim()).filter(Boolean)
  const publicUrl = options.publicUrl.replace(/\/+$/, '')
  const rooms = new Map<string, Room>()
  /** Codes of closed rooms, reserved until the time given, so a stale resume can't revive them. */
  const tombstones = new Map<string, number>()
  // Room above the screen cap, so an oversized screen reaches the parser and gets an error reply
  // instead of ws closing the socket (which a host would answer by reconnecting and re-sending it).
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.hostScreen * 2 })
  const alive = new WeakMap<WebSocket, boolean>()
  const hostSockets = new WeakMap<Send<RelayToHost>, WebSocket>()
  /** Which token opened each room, so one token can't hold unlimited rooms. */
  const roomTokens = new Map<string, string>()
  const open = new Map<string, number>()
  const connects = new WindowCounter(IP_LIMITS.connectsPerMinute, 60_000, now)
  const unknownRooms = new WindowCounter(IP_LIMITS.unknownRoomsPerMinute, 60_000, now)
  const failedAuths = new WindowCounter(IP_LIMITS.failedAuths, IP_LIMITS.failedAuthWindowMs, now)

  const newCode = () => {
    for (;;) {
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
      if (!rooms.has(code) && !tombstones.has(code)) return code
    }
  }

  function host(ws: WebSocket, bearer: string, ip: string) {
    let token = tokenMatches(bearer, tokens) ? bearer : ''
    let authorized = !!token
    const refuse = () => {
      failedAuths.hit(ip)
      ws.close(CLOSE.unauthorized, 'Unauthorized')
    }
    if (bearer && !authorized) return refuse()
    const send = sender<RelayToHost>(ws)
    hostSockets.set(send, ws)
    let room: Room | null = null
    ws.on('message', (data) => {
      const message = parseHostMessage(data.toString())
      if ('error' in message) return send({ type: 'error', reason: message.error })
      if (message.type === 'auth') {
        if (!authorized && tokenMatches(message.token, tokens)) { authorized = true; token = message.token }
        if (!authorized) refuse()
        return
      }
      if (!authorized) return refuse()
      switch (message.type) {
        case 'open': {
          if (room) room.detachHost(send)
          const { resume } = message
          const existing = resume && rooms.get(resume.code)
          if (existing && existing.secret === resume.secret) {
            room = existing
          } else {
            let held = 0
            for (const owner of roomTokens.values()) if (owner === token) held++
            if (held >= ROOMS_PER_TOKEN) {
              room = null
              return send({ type: 'error', reason: 'Too many open rooms' })
            }
            room = resume && !existing && !tombstones.has(resume.code) && /^[A-Z0-9]+$/.test(resume.code)
              ? new Room(resume.code, resume.secret, message.locale, now)
              : new Room(newCode(), randomBytes(24).toString('base64url'), message.locale, now)
            rooms.set(room.code, room)
            roomTokens.set(room.code, token)
          }
          const { previous } = room.attachHost(send)
          if (previous) {
            previous({ type: 'taken-over' })
            hostSockets.get(previous)?.close(CLOSE.takenOver, 'Taken over')
          }
          send({ type: 'opened', code: room.code, secret: room.secret, joinUrl: `${publicUrl}/${room.code}` })
          send({ type: 'count', n: room.count() })
          room.replay()
          return
        }
        case 'close':
          if (!room || !room.isHost(send)) return
          room.close()
          rooms.delete(room.code)
          roomTokens.delete(room.code)
          tombstones.set(room.code, now() + LIMITS.roomTtlMs)
          room = null
          return
      }
      if (!room || !room.isHost(send)) return send({ type: 'error', reason: 'No room open' })
      switch (message.type) {
        case 'screen': {
          const { at, deadline } = room.setScreen(message.screen)
          return send({ type: 'screen-set', screenId: message.screen.id, at, ...(deadline === undefined ? {} : { deadline }) })
        }
        case 'state': return room.setState(message.screenId, message.state)
        case 'to': return room.sendTo(message.pid, message.payload)
      }
    })
    ws.on('close', () => room?.detachHost(send))
  }

  function participant(ws: WebSocket, code: string, ip: string) {
    const send = sender<RelayToParticipant>(ws)
    const room = rooms.get(code)
    // Unknown is not closed: after a relay restart a room is unknown until its host reclaims it.
    // Many unknown codes from one address is someone guessing.
    if (!room) return ws.close(unknownRooms.hit(ip) ? CLOSE.unknownRoom : CLOSE.tooFast, 'Unknown room')
    let pid: string | null = null
    // A token bucket: bursts of a few taps are fine, a sustained flood is not.
    let tokensLeft = LIMITS.messagesPerSecond * 2, refilledAt = now()
    ws.on('message', (data) => {
      const t = now()
      tokensLeft = Math.min(LIMITS.messagesPerSecond * 2, tokensLeft + (t - refilledAt) / 1000 * LIMITS.messagesPerSecond)
      refilledAt = t
      if (--tokensLeft < 0) return ws.close(CLOSE.tooFast, 'Too many messages')
      const message = parseParticipantMessage(data.toString())
      if ('error' in message) return ws.close(CLOSE.badMessage, message.error)
      if (rooms.get(code) !== room) return send({ type: 'room-closed' })
      if (message.type === 'hello') {
        if (pid) return
        if (!room.has(message.pid) && room.size >= PARTICIPANTS_PER_ROOM) return ws.close(CLOSE.full, 'Room full')
        pid = room.addParticipant(message.pid, message.name, send).pid
        return
      }
      if (!pid) return ws.close(CLOSE.badMessage, 'hello first')
      if (message.type === 'answer') room.acceptAnswer(pid, message.screenId, message.value)
      else room.rename(pid, message.name)
    })
    ws.on('close', () => { if (pid) room.removeParticipant(pid, send) })
  }

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = clientAddress(req, options.trustProxy)
    open.set(ip, (open.get(ip) ?? 0) + 1)
    ws.on('close', () => {
      const left = (open.get(ip) ?? 1) - 1
      if (left > 0) open.set(ip, left)
      else open.delete(ip)
    })
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
    ws.on('error', () => ws.terminate())
    const path = new URL(req.url ?? '/', 'http://relay').pathname
    if (path === '/host') {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
      return host(ws, bearer, ip)
    }
    const code = /^\/p\/([A-Za-z0-9]+)$/.exec(path)?.[1]
    if (code) return participant(ws, code.toUpperCase(), ip)
    ws.close(CLOSE.badMessage, 'Unknown path')
  })

  // Phones on mobile networks vanish without closing; pings find them and keep proxies from idling out.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue }
      alive.set(ws, false)
      ws.ping()
    }
  }, HEARTBEAT_MS)
  const sweep = setInterval(() => {
    const t = now()
    for (const [code, room] of rooms) if (room.expired()) { rooms.delete(code); roomTokens.delete(code) }
    connects.sweep(); unknownRooms.sweep(); failedAuths.sweep()
    for (const [code, until] of tombstones) if (until < t) tombstones.delete(code)
  }, 60_000)
  heartbeat.unref()
  sweep.unref()

  return {
    rooms,
    handleUpgrade(req, socket, head) {
      const path = new URL(req.url ?? '/', 'http://relay').pathname
      if (path !== '/host' && !path.startsWith('/p/')) return socket.destroy()
      const ip = clientAddress(req, options.trustProxy)
      const limited = (open.get(ip) ?? 0) >= IP_LIMITS.connections || !connects.hit(ip)
        || (path === '/host' && failedAuths.over(ip))
      if (limited) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return socket.destroy()
      }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    },
    close() {
      clearInterval(heartbeat)
      clearInterval(sweep)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
  }
}

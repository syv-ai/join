import WebSocket from 'ws'
import type { HostToRelay, Locale, RelayToHost } from './protocol.ts'
import { CLOSE } from './relay.ts'

export type HostStatus = 'connecting' | 'connected' | 'error'
export type HostEvent = RelayToHost | { type: 'status'; status: HostStatus; error?: string }

export interface HostClientOptions {
  /** The relay's http(s) base, such as https://join.syv.ai. */
  url: string
  token: string
  locale: Locale
  /** A room to reclaim, such as one saved before a restart. */
  resume?: { code: string; secret: string }
  onEvent: (event: HostEvent) => void
}

export interface HostClient {
  send(message: HostToRelay): void
  /** Disconnects for good. The room stays open on the relay; send `close` first to end it. */
  close(): void
}

const BACKOFF_MS = { first: 500, max: 10_000 }

/**
 * A host connection that survives relay restarts and network drops: it
 * reconnects with backoff, reclaims its room, and re-sends the current screen
 * and state. Other messages sent while disconnected are delivered once the room
 * is open again. It never throws on network errors; it reports a status.
 */
export function connectHost(options: HostClientOptions): HostClient {
  const endpoint = `${options.url.replace(/\/+$/, '').replace(/^http/, 'ws')}/host`
  let resume = options.resume
  let ws: WebSocket | null = null
  let open = false
  let stopped = false
  let delay = BACKOFF_MS.first
  let timer: NodeJS.Timeout | undefined
  // Screen and state are latest-wins; everything else is queued in order.
  let screen: Extract<HostToRelay, { type: 'screen' }> | null = null
  let state: Extract<HostToRelay, { type: 'state' }> | null = null
  let lastSent: HostToRelay['type'] | null = null
  const queue: HostToRelay[] = []

  const emit = (event: HostEvent) => {
    try { options.onEvent(event) } catch { /* a listener's bug must not break the connection */ }
  }
  const write = (message: HostToRelay) => {
    lastSent = message.type
    ws!.send(JSON.stringify(message))
  }

  function connect() {
    if (stopped) return
    emit({ type: 'status', status: 'connecting' })
    const socket = new WebSocket(endpoint, { headers: { authorization: `Bearer ${options.token}` } })
    ws = socket
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'open', locale: options.locale, ...(resume ? { resume } : {}) }))
    })
    socket.on('message', (data) => {
      let message: RelayToHost
      try { message = JSON.parse(data.toString()) } catch { return }
      if (message.type === 'opened') {
        resume = { code: message.code, secret: message.secret }
        open = true
        delay = BACKOFF_MS.first
        emit({ type: 'status', status: 'connected' })
        emit(message)
        if (screen) write(screen)
        if (state) write(state)
        for (const queued of queue.splice(0)) write(queued)
        return
      }
      // The relay names no message in an error, but it answers in order: a screen it refused is dropped
      // so a reconnect doesn't send it again.
      if (message.type === 'error' && lastSent === 'screen') screen = null
      if (message.type === 'taken-over') stopped = true
      emit(message)
    })
    socket.on('error', () => { /* 'close' follows and decides what to do */ })
    socket.on('close', (code) => {
      open = false
      if (ws === socket) ws = null
      if (code === CLOSE.unauthorized) {
        stopped = true
        return emit({ type: 'status', status: 'error', error: 'unauthorized' })
      }
      if (stopped) return
      emit({ type: 'status', status: 'connecting' })
      timer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, BACKOFF_MS.max)
    })
  }

  connect()

  return {
    send(message) {
      if (message.type === 'screen') { screen = message; if (state && state.screenId !== message.screen.id) state = null }
      else if (message.type === 'state') state = message
      if (open && ws) return write(message)
      if (message.type !== 'screen' && message.type !== 'state') queue.push(message)
    },
    close() {
      stopped = true
      clearTimeout(timer)
      ws?.close()
    },
  }
}

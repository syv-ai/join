import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { Log } from '../src/log.ts'
import { createRelay, type Relay } from '../src/relay.ts'

export const TOKEN = 'test-token'

export async function startRelay(port = 0, log?: Log): Promise<{ relay: Relay; server: Server; url: string; port: number; stop(): Promise<void> }> {
  const relay = createRelay({ hostTokens: [TOKEN], publicUrl: 'https://join.test', log })
  const server = createServer((_, res) => res.end('ok'))
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  const actual = (server.address() as AddressInfo).port
  return {
    relay, server, port: actual, url: `ws://127.0.0.1:${actual}`,
    stop: () => { relay.close(); return new Promise(resolve => server.close(() => resolve())) },
  }
}

/** A socket that records what it receives and can wait for a message type. */
export interface Client {
  ws: WebSocket
  messages: any[]
  send(message: object): void
  next(type: string, timeoutMs?: number): Promise<any>
  closed: Promise<{ code: number }>
}

export function connect(url: string, headers: Record<string, string> = {}): Promise<Client> {
  const ws = new WebSocket(url, { headers })
  const messages: any[] = []
  const waiters: { type: string; resolve: (m: any) => void; seen: number }[] = []
  const closed = new Promise<{ code: number }>(resolve => ws.on('close', code => resolve({ code })))
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString())
    messages.push(message)
    for (const waiter of [...waiters]) if (message.type === waiter.type) {
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(message)
    }
  })
  const client: Client = {
    ws, messages, closed,
    send: m => ws.send(JSON.stringify(m)),
    next: (type, timeoutMs = 2000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs)
      waiters.push({ type, seen: messages.length, resolve: m => { clearTimeout(timer); resolve(m) } })
    }),
  }
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client))
    ws.once('error', reject)
  })
}

export async function openHost(url: string, open: object = { type: 'open', locale: 'da' }) {
  const host = await connect(`${url}/host`, { authorization: `Bearer ${TOKEN}` })
  const opened = host.next('opened')
  host.send(open)
  return { host, opened: await opened }
}

export async function joinPhone(url: string, code: string, hello: object = { type: 'hello' }) {
  const phone = await connect(`${url}/p/${code}`)
  const welcome = phone.next('welcome')
  phone.send(hello)
  return { phone, welcome: await welcome }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

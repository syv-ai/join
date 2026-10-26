import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import WebSocket from 'ws'
import { clientAddress, IP_LIMITS, isPrivate, ROOMS_PER_TOKEN, WindowCounter } from '../src/limits.ts'
import { CLOSE } from '../src/relay.ts'
import { connect, startRelay, TOKEN } from './helpers.ts'

const stops: (() => Promise<void>)[] = []
after(() => Promise.all(stops.map(stop => stop())))
async function relay() {
  const r = await startRelay()
  stops.push(r.stop)
  return r
}
const req = (peer: string, forwarded?: string) => ({ socket: { remoteAddress: peer }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} }) as any

test('the client address comes from X-Forwarded-For only behind a private proxy, and only its last entry', () => {
  assert.equal(clientAddress(req('172.18.0.5', 'spoofed, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientAddress(req('::ffff:10.0.1.2', '198.51.100.7')), '198.51.100.7')
  assert.equal(clientAddress(req('203.0.113.50', '1.1.1.1')), '203.0.113.50', 'a public peer cannot claim another address')
  assert.equal(clientAddress(req('172.18.0.5', '1.1.1.1'), false), '172.18.0.5')
  assert.equal(clientAddress(req('172.18.0.5')), '172.18.0.5')
  for (const a of ['127.0.0.1', '::1', '192.168.1.4', '172.31.255.1', 'fd12:3456::1']) assert.equal(isPrivate(a), true, a)
  for (const a of ['8.8.8.8', '172.32.0.1', '2a01:4f8::1']) assert.equal(isPrivate(a), false, a)
})

test('a window counter allows its limit, then refuses until the window passes', () => {
  const clock = { t: 0 }
  const counter = new WindowCounter(3, 1000, () => clock.t)
  assert.deepEqual([1, 2, 3, 4].map(() => counter.hit('a')), [true, true, true, false])
  assert.equal(counter.hit('b'), true)
  clock.t = 1001
  assert.equal(counter.hit('a'), true)
  counter.sweep()
})

/** An upgrade that the relay may refuse with HTTP 429 before any WebSocket exists. */
function tryConnect(url: string, headers: Record<string, string>) {
  return new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(url, { headers })
    ws.on('open', () => { resolve('open'); ws.close() })
    ws.on('unexpected-response', (_, res) => resolve(res.statusCode ?? 0))
    ws.on('error', () => {})
  })
}

test('an address that keeps sending wrong host tokens is shut out of /host, but its phones still join', async () => {
  const { url } = await relay()
  const attacker = { 'x-forwarded-for': '203.0.113.66' }
  for (let i = 0; i < IP_LIMITS.failedAuths; i++) {
    const bad = await connect(`${url}/host`, { ...attacker, authorization: 'Bearer wrong' })
    assert.equal((await bad.closed).code, CLOSE.unauthorized)
  }
  assert.equal(await tryConnect(`${url}/host`, { ...attacker, authorization: `Bearer ${TOKEN}` }), 429)
  assert.equal(await tryConnect(`${url}/host`, { 'x-forwarded-for': '203.0.113.67', authorization: `Bearer ${TOKEN}` }), 'open')
})

test('guessing room codes from one address is cut off', async () => {
  const { url } = await relay()
  const guesser = { 'x-forwarded-for': '203.0.113.77' }
  let last = 0
  for (let i = 0; i <= IP_LIMITS.unknownRoomsPerMinute; i++) last = (await (await connect(`${url}/p/ZZZZ${i % 10}`, guesser)).closed).code
  assert.equal(last, CLOSE.tooFast)
  const other = await connect(`${url}/p/ZZZZZ`, { 'x-forwarded-for': '203.0.113.78' })
  assert.equal((await other.closed).code, CLOSE.unknownRoom)
})

test(`one token holds at most ${ROOMS_PER_TOKEN} open rooms`, async () => {
  const { url } = await relay()
  const hosts = []
  for (let i = 0; i < ROOMS_PER_TOKEN; i++) {
    const h = await connect(`${url}/host`, { authorization: `Bearer ${TOKEN}` })
    const opened = h.next('opened')
    h.send({ type: 'open', locale: 'da' })
    await opened
    hosts.push(h)
  }
  const extra = await connect(`${url}/host`, { authorization: `Bearer ${TOKEN}` })
  const error = extra.next('error')
  extra.send({ type: 'open', locale: 'da' })
  assert.match((await error).reason, /Too many open rooms/)
  for (const h of [...hosts, extra]) h.ws.close()
})

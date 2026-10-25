import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectHost, type HostEvent } from '../src/host-client.ts'
import { LIMITS } from '../src/protocol.ts'
import { joinPhone, sleep, startRelay, TOKEN } from './helpers.ts'

const choice = (id = 'q1') => ({ id, kind: 'choice' as const, content: { text: 'Hvad?', images: [] }, options: ['A', 'B'] })

function host(url: string, token = TOKEN) {
  const events: HostEvent[] = []
  const waiters: { match: (e: HostEvent) => boolean; resolve: (e: any) => void }[] = []
  const client = connectHost({
    url: url.replace(/^ws/, 'http'), token, locale: 'da',
    onEvent: (event) => {
      events.push(event)
      for (const w of [...waiters]) if (w.match(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event) }
    },
  })
  const next = (match: (e: HostEvent) => boolean, ms = 4000) => new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms)
    waiters.push({ match, resolve: (e) => { clearTimeout(t); resolve(e) } })
  })
  return { client, events, next }
}
const isType = (type: string) => (e: HostEvent) => e.type === type
const isStatus = (status: string) => (e: HostEvent) => e.type === 'status' && e.status === status

test('the client reclaims its room after a relay restart and delivers a screen sent while down', async () => {
  const first = await startRelay()
  const h = host(first.url)
  const opened = await h.next(isType('opened'))
  const port = first.port
  await first.stop()
  await h.next(isStatus('connecting'))
  h.client.send({ type: 'screen', screen: choice('while-down') })

  const second = await startRelay(port)
  const again = await h.next(isType('opened'))
  assert.equal(again.code, opened.code)
  await sleep(100)
  const { welcome } = await joinPhone(second.url, opened.code)
  assert.equal(welcome.screen.id, 'while-down')
  h.client.close()
  await second.stop()
})

test('a taken-over client stops reconnecting', async () => {
  const relay = await startRelay()
  const a = host(relay.url)
  const opened = await a.next(isType('opened'))
  const b = connectHost({ url: relay.url.replace(/^ws/, 'http'), token: TOKEN, locale: 'da', resume: { code: opened.code, secret: opened.secret }, onEvent: () => {} })
  await a.next(isType('taken-over'))
  await sleep(1500)
  assert.equal(a.events.filter(isStatus('connected')).length, 1)
  b.close()
  await relay.stop()
})

test('a bad token reports one unauthorized error and does not retry', async () => {
  const relay = await startRelay()
  const h = host(relay.url, 'wrong')
  h.client.send({ type: 'screen', screen: choice() })
  const error = await h.next(isStatus('error'))
  assert.equal(error.error, 'unauthorized')
  await sleep(1500)
  assert.equal(h.events.filter(isStatus('connecting')).length, 1)
  await relay.stop()
})

test('a screen the relay refuses is reported and not sent again after a reconnect', async () => {
  const first = await startRelay()
  const h = host(first.url)
  const opened = await h.next(isType('opened'))
  h.client.send({ type: 'screen', screen: { ...choice('huge'), content: { text: '', images: ['x'.repeat(LIMITS.hostScreen)] } } })
  await h.next(isType('error'))
  const port = first.port
  await first.stop()
  const second = await startRelay(port)
  await h.next(isType('opened'))
  await sleep(100)
  const { welcome } = await joinPhone(second.url, opened.code)
  assert.equal(welcome.screen, null)
  h.client.close()
  await second.stop()
})

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { shortIp } from '../src/log.ts'
import { createJoinServer } from '../src/server.ts'
import { connect, joinPhone, openHost, sleep, startRelay, TOKEN } from './helpers.ts'

test('addresses are shortened to their network', () => {
  assert.equal(shortIp('203.0.113.57'), '203.0.113.0')
  assert.equal(shortIp('::ffff:198.51.100.7'), '198.51.100.0')
  assert.equal(shortIp('2a01:4f8:1:2::5'), '2a01:4f8:1::')
  assert.equal(shortIp('2a01:4f8:1:2:3:4:5:6'), '2a01:4f8:1::')
})

test('connections, rooms and refusals are logged with short addresses; answers and names never are', async () => {
  const lines: { event: string; [k: string]: unknown }[] = []
  const { url, stop } = await startRelay(0, (event, fields) => lines.push({ event, ...fields }))
  const { host, opened } = await openHost(url)
  host.send({ type: 'screen', screen: { id: 'q.0', kind: 'text', content: { text: 'Hemmeligt spørgsmål', images: [] }, maxEntries: 3, maxLength: 30 } })
  const { phone } = await joinPhone(url, opened.code, { type: 'hello', name: 'Lone Jensen' })
  phone.send({ type: 'answer', screenId: 'q.0', value: 'mit private svar' })
  phone.send({ type: 'rename', name: 'Anders And' })
  const bad = await connect(`${url}/host`, { authorization: 'Bearer wrong', 'x-forwarded-for': '203.0.113.57' })
  await bad.closed
  host.send({ type: 'close' })
  await sleep(200)
  await stop()

  const events = lines.map(l => l.event)
  for (const e of ['room-opened', 'connect', 'auth-failed', 'room-closed', 'disconnect']) assert.ok(events.includes(e), e)
  assert.equal(lines.find(l => l.event === 'auth-failed')!.ip, '203.0.113.0')
  assert.ok(lines.filter(l => l.event === 'connect').every(l => typeof l.ip === 'string' && /\.0$|::$/.test(l.ip as string)))
  const all = JSON.stringify(lines)
  for (const secret of ['mit private svar', 'Lone Jensen', 'Anders And', 'Hemmeligt', TOKEN, 'wrong']) assert.ok(!all.includes(secret), secret)
})

test('HTTP requests are logged, except the health check', async () => {
  const lines: { event: string; [k: string]: unknown }[] = []
  const { server, relay } = createJoinServer({ hostTokens: [TOKEN], publicUrl: 'https://join.test', log: (event, fields) => lines.push({ event, ...fields }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await fetch(`${base}/healthz`); await fetch(`${base}/ABCDE`); await fetch(`${base}/nope/x`)
  await sleep(50)
  relay.close(); await new Promise(resolve => server.close(resolve))
  assert.deepEqual(lines.filter(l => l.event === 'http').map(l => [l.path, l.status]), [['/ABCDE', 200], ['/nope/x', 404]])
})

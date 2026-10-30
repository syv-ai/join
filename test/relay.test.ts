import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { LIMITS } from '../src/protocol.ts'
import { CLOSE } from '../src/relay.ts'
import { connect, joinPhone, openHost, sleep, startRelay, TOKEN } from './helpers.ts'

const stops: (() => Promise<void>)[] = []
after(() => Promise.all(stops.map(stop => stop())))
async function relay(port?: number) {
  const r = await startRelay(port)
  stops.push(r.stop)
  return r
}
const choice = { id: 'q1', kind: 'choice', content: { text: 'Hvad?', images: [] }, options: ['A', 'B'] }

test('a host opens a room, a phone joins and answers, the host receives it', async () => {
  const { url } = await relay()
  const { host, opened } = await openHost(url)
  assert.match(opened.code, /^[A-Z2-9]{5}$/)
  assert.equal(opened.joinUrl, `https://join.test/${opened.code}`)
  host.send({ type: 'screen', screen: choice })
  assert.equal((await host.next('screen-set')).screenId, 'q1')
  const { phone, welcome } = await joinPhone(url, opened.code.toLowerCase())
  assert.deepEqual(welcome.screen, choice)
  const answer = host.next('answer')
  phone.send({ type: 'answer', screenId: 'q1', value: 1 })
  assert.equal((await answer).value, 1)
})

test('a host without a valid token is closed with 4401', async () => {
  const { url } = await relay()
  const bad = await connect(`${url}/host`, { authorization: 'Bearer nope' })
  bad.send({ type: 'open', locale: 'da' })
  assert.equal((await bad.closed).code, CLOSE.unauthorized)
  const byMessage = await connect(`${url}/host`)
  byMessage.send({ type: 'auth', token: TOKEN })
  const opened = byMessage.next('opened')
  byMessage.send({ type: 'open', locale: 'da' })
  assert.ok((await opened).code)
})

test('after a relay restart, resume restores the code and a returning phone keeps pid and name', async () => {
  const first = await relay()
  const { opened } = await openHost(first.url)
  const { welcome } = await joinPhone(first.url, opened.code)
  const port = first.port
  await first.stop()
  stops.splice(stops.indexOf(first.stop), 1)

  const second = await relay(port)
  const { opened: again } = await openHost(second.url, { type: 'open', locale: 'da', resume: { code: opened.code, secret: opened.secret } })
  assert.equal(again.code, opened.code)
  const { welcome: back } = await joinPhone(second.url, opened.code, { type: 'hello', pid: welcome.pid, name: welcome.name })
  assert.equal(back.pid, welcome.pid)
  assert.equal(back.name, welcome.name)
})

test('a second host with the secret takes over; the first is told and closed', async () => {
  const { url } = await relay()
  const { host: first, opened } = await openHost(url)
  const takenOver = first.next('taken-over')
  const { host: second } = await openHost(url, { type: 'open', locale: 'da', resume: { code: opened.code, secret: opened.secret } })
  await takenOver
  assert.equal((await first.closed).code, CLOSE.takenOver)
  const { phone } = await joinPhone(url, opened.code)
  const answer = second.next('answer')
  phone.send({ type: 'answer', screenId: 'q1', value: 0 })
  assert.equal((await answer).value, 0)
})

test('a wrong secret gets a new room, not the old one', async () => {
  const { url } = await relay()
  const { opened } = await openHost(url)
  const { opened: other } = await openHost(url, { type: 'open', locale: 'da', resume: { code: opened.code, secret: 'wrong' } })
  assert.notEqual(other.code, opened.code)
})

test('a flooding phone is closed while another keeps working', async () => {
  const { url } = await relay()
  const { host, opened } = await openHost(url)
  const { phone: flood } = await joinPhone(url, opened.code)
  const { phone: calm } = await joinPhone(url, opened.code)
  for (let i = 0; i < 100; i++) flood.send({ type: 'answer', screenId: 'q1', value: i })
  assert.equal((await flood.closed).code, CLOSE.tooFast)
  await sleep(50)
  const answer = new Promise<any>((resolve) => {
    host.ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'answer' && m.value === 'calm') resolve(m) })
  })
  calm.send({ type: 'answer', screenId: 'q1', value: 'calm' })
  assert.equal((await answer).value, 'calm')
})

test('a malformed phone message closes only that phone', async () => {
  const { url } = await relay()
  const { opened } = await openHost(url)
  const { phone } = await joinPhone(url, opened.code)
  phone.ws.send('not json')
  assert.equal((await phone.closed).code, CLOSE.badMessage)
})

test('an oversized host screen gets an error and the host stays connected', async () => {
  const { url } = await relay()
  const { host } = await openHost(url)
  const error = host.next('error')
  host.send({ type: 'screen', screen: { ...choice, content: { text: '', images: ['x'.repeat(LIMITS.hostScreen)] } } })
  assert.match((await error).reason, /large/)
  host.send({ type: 'screen', screen: choice })
  assert.equal((await host.next('screen-set')).screenId, 'q1')
})

test('a burst of 100 messages from the host all arrive', async () => {
  const { url } = await relay()
  const { host, opened } = await openHost(url)
  const { phone, welcome } = await joinPhone(url, opened.code)
  for (let i = 0; i < 100; i++) host.send({ type: 'to', pid: welcome.pid, payload: { correct: true, points: i } })
  await sleep(300)
  assert.equal(phone.messages.filter(m => m.type === 'to').length, 100)
})

test('close tells phones, and a later resume with that code gets a new code', async () => {
  const { url, relay: r } = await relay()
  const { host, opened } = await openHost(url)
  const { phone } = await joinPhone(url, opened.code)
  const closed = phone.next('room-closed')
  host.send({ type: 'close' })
  await closed
  assert.equal(r.rooms.has(opened.code), false)
  const { opened: again } = await openHost(url, { type: 'open', locale: 'da', resume: { code: opened.code, secret: opened.secret } })
  assert.notEqual(again.code, opened.code)
  const late = await connect(`${url}/p/${opened.code}`)
  assert.equal((await late.closed).code, CLOSE.unknownRoom)
})

test('a quiz screen comes back with its deadline', async () => {
  const { url } = await relay()
  const { host } = await openHost(url)
  host.send({ type: 'screen', screen: { ...choice, id: 'z', kind: 'quiz', seconds: 20 } })
  const set = await host.next('screen-set')
  assert.equal(set.deadline - set.at, 20_000)
})

test('100 phones join one room and every answer arrives', async () => {
  const { url } = await relay()
  const { host, opened } = await openHost(url)
  host.send({ type: 'screen', screen: choice })
  const phones = await Promise.all(Array.from({ length: 100 }, () => joinPhone(url, opened.code)))
  let answers = 0
  const all = new Promise<void>(resolve => host.ws.on('message', (d) => {
    if (JSON.parse(d.toString()).type === 'answer' && ++answers === 100) resolve()
  }))
  for (const { phone } of phones) phone.send({ type: 'answer', screenId: 'q1', value: 0 })
  await all
  assert.equal(answers, 100)
  for (const { phone } of phones) phone.ws.close()
})

test('a quiz shown as a wait screen first gets no deadline, and a thanks screen leaves the room open', async () => {
  const { url } = await relay()
  const { host, opened } = await openHost(url)
  const { phone } = await joinPhone(url, opened.code)
  const shown = async (screen: object) => {
    const arrived = phone.next('screen')
    host.send({ type: 'screen', screen })
    return (await arrived).screen
  }
  const options = ['2020', '2021', '2022']
  const set = host.next('screen-set')
  assert.deepEqual((await shown({ id: 'quiz1', kind: 'wait', content: { text: 'Hvornår?', images: [] }, options })).options, options)
  assert.equal((await set).deadline, undefined)
  assert.equal((await shown({ id: 'thanks', kind: 'thanks', content: { text: '', images: [] } })).kind, 'thanks')
  assert.equal((await shown(choice)).id, 'q1')
  assert.equal(phone.ws.readyState, phone.ws.OPEN)
})

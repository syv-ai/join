import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, type Screen } from '../src/protocol.ts'
import { Room } from '../src/room.ts'

const clock = (start = 1_000) => {
  const c = { t: start, now: () => c.t }
  return c
}
const inbox = () => {
  const messages: any[] = []
  const send = (m: object) => { messages.push(m) }
  return { messages, send, of: (type: string) => messages.filter(m => m.type === type) }
}
const choice: Screen = { id: 'q1', kind: 'choice', content: { text: 'Hvad?', images: [] }, options: ['A', 'B'] }

test('an answer reaches the host stamped with the relay clock', () => {
  const c = clock(), room = new Room('ABCDE', 's', 'da', c.now), host = inbox(), phone = inbox()
  room.attachHost(host.send)
  const { pid, name } = room.addParticipant(undefined, undefined, phone.send)
  c.t = 5_000
  room.acceptAnswer(pid, 'q1', 1)
  assert.deepEqual(host.of('answer'), [{ type: 'answer', pid, name, screenId: 'q1', value: 1, at: 5_000 }])
})

test('answers without a host are buffered, replayed in order with their own times, and capped', () => {
  const c = clock(), room = new Room('ABCDE', 's', 'da', c.now), phone = inbox()
  const { pid } = room.addParticipant(undefined, undefined, phone.send)
  for (const [t, v] of [[10, 'a'], [20, 'b'], [30, 'c']] as const) { c.t = t; room.acceptAnswer(pid, 'q1', v) }
  const host = inbox()
  room.attachHost(host.send)
  room.replay()
  assert.deepEqual(host.of('answer').map(m => [m.value, m.at]), [['a', 10], ['b', 20], ['c', 30]])

  room.detachHost(host.send)
  for (let i = 0; i < LIMITS.answerBuffer + 5; i++) room.acceptAnswer(pid, 'q1', i)
  const next = inbox()
  room.attachHost(next.send)
  room.replay()
  const values = next.of('answer').map(m => m.value)
  assert.equal(values.length, LIMITS.answerBuffer)
  assert.equal(values[0], 5)
})

test('a second host takes over and the first is handed back to be told', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), first = inbox(), second = inbox()
  assert.equal(room.attachHost(first.send).previous, undefined)
  assert.equal(room.attachHost(second.send).previous, first.send)
  const phone = inbox()
  const { pid } = room.addParticipant(undefined, undefined, phone.send)
  room.acceptAnswer(pid, 'q1', 1)
  assert.equal(first.of('answer').length, 0)
  assert.equal(second.of('answer').length, 1)
  // The old host's socket closing later must not detach the new one.
  room.detachHost(first.send)
  room.acceptAnswer(pid, 'q1', 2)
  assert.equal(second.of('answer').length, 2)
})

test('a phone that reconnects keeps its pid and name and is not counted twice', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), host = inbox()
  room.attachHost(host.send)
  const phone = inbox()
  const first = room.addParticipant(undefined, undefined, phone.send)
  room.removeParticipant(first.pid, phone.send)
  const again = inbox()
  assert.deepEqual(room.addParticipant(first.pid, 'ignored-name', again.send), first)
  assert.deepEqual(host.of('count').map(m => m.n), [1, 0, 1])
  assert.equal(host.of('joined').length, 1)
})

test('a phone back after a relay restart keeps the pid and name it remembers', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), phone = inbox()
  assert.deepEqual(room.addParticipant('p-old', 'marvelous-otter', phone.send), { pid: 'p-old', name: 'marvelous-otter' })
})

test('a new phone is welcomed with the current screen and state', () => {
  const room = new Room('ABCDE', 's', 'en', clock().now)
  room.setScreen(choice)
  room.setState('q1', { items: [] })
  const phone = inbox()
  const { pid, name } = room.addParticipant(undefined, undefined, phone.send)
  assert.deepEqual(phone.of('welcome'), [{ type: 'welcome', pid, name, locale: 'en', screen: choice, state: { items: [] }, now: 1_000 }])
})

test('state for an old screen is not shown to phones joining a new one', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now)
  room.setScreen(choice)
  room.setState('q1', { items: [] })
  room.setScreen({ ...choice, id: 'q2' })
  const phone = inbox()
  room.addParticipant(undefined, undefined, phone.send)
  assert.equal(phone.of('welcome')[0].state, undefined)
})

test('an answer for a screen that is not current is still forwarded', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), host = inbox()
  room.attachHost(host.send)
  room.setScreen(choice)
  const { pid } = room.addParticipant(undefined, undefined, inbox().send)
  room.acceptAnswer(pid, 'old', 0)
  assert.equal(host.of('answer')[0].screenId, 'old')
})

test('a quiz screen gets its deadline from the relay clock', () => {
  const c = clock(50_000), room = new Room('ABCDE', 's', 'da', c.now), phone = inbox()
  room.addParticipant(undefined, undefined, phone.send)
  const set = room.setScreen({ id: 'quiz1', kind: 'quiz', content: { text: '?', images: [] }, options: ['A', 'B'], seconds: 20 })
  assert.deepEqual(set, { at: 50_000, deadline: 70_000 })
  assert.equal(phone.of('screen')[0].screen.deadline, 70_000)
})

test('rename reaches the host and the phone', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), host = inbox(), phone = inbox()
  room.attachHost(host.send)
  const { pid } = room.addParticipant(undefined, undefined, phone.send)
  room.rename(pid, 'Lone')
  assert.deepEqual(host.of('renamed'), [{ type: 'renamed', pid, name: 'Lone' }])
  assert.deepEqual(phone.of('renamed'), [{ type: 'renamed', name: 'Lone' }])
})

test('a phone names itself once; a later rename is refused and the phone told its name', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), host = inbox(), phone = inbox()
  room.attachHost(host.send)
  const { pid } = room.addParticipant(undefined, undefined, phone.send)
  room.rename(pid, 'Lone')
  room.rename(pid, 'Anders')
  assert.deepEqual(host.of('renamed').map(m => m.name), ['Lone'])
  assert.deepEqual(phone.of('renamed').map(m => m.name), ['Lone', 'Lone'])
})

test('a phone back after a relay restart with its chosen name keeps it fixed', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), host = inbox(), phone = inbox()
  room.attachHost(host.send)
  room.addParticipant('p-old', 'Lone', phone.send)
  room.rename('p-old', 'Anders')
  assert.equal(host.of('renamed').length, 0)
})

test('a room expires 12 h after its host leaves, never while a host is attached', () => {
  const c = clock(0), room = new Room('ABCDE', 's', 'da', c.now), host = inbox()
  room.attachHost(host.send)
  c.t = LIMITS.roomTtlMs * 2
  assert.equal(room.expired(), false)
  room.detachHost(host.send)
  c.t += LIMITS.roomTtlMs - 1
  assert.equal(room.expired(), false)
  c.t += 2
  assert.equal(room.expired(), true)
})

test('closing tells every connected phone', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), a = inbox(), b = inbox()
  room.addParticipant(undefined, undefined, a.send)
  room.addParticipant(undefined, undefined, b.send)
  room.close()
  assert.equal(a.of('room-closed').length, 1)
  assert.equal(b.of('room-closed').length, 1)
})

test('a quiz re-sent with its deadline keeps it instead of restarting the clock', () => {
  const c = clock(90_000), room = new Room('ABCDE', 's', 'da', c.now)
  const set = room.setScreen({ id: 'quiz1', kind: 'quiz', content: { text: '?', images: [] }, options: ['A'], seconds: 20, deadline: 75_000 })
  assert.deepEqual(set, { at: 90_000, deadline: 75_000 })
})

test('a phone that comes back is welcomed with the last message sent to it for the current screen', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), first = inbox()
  room.setScreen({ ...choice, id: 'quiz1', kind: 'quiz', seconds: 20 })
  const { pid } = room.addParticipant(undefined, undefined, first.send)
  room.removeParticipant(pid, first.send)
  room.sendTo(pid, { correct: true, points: 900 })
  const again = inbox()
  room.addParticipant(pid, undefined, again.send)
  assert.deepEqual(again.of('welcome')[0].to, { correct: true, points: 900 })
})

test('a message for one phone is not replayed once the screen has changed', () => {
  const room = new Room('ABCDE', 's', 'da', clock().now), first = inbox()
  room.setScreen(choice)
  const { pid } = room.addParticipant(undefined, undefined, first.send)
  room.sendTo(pid, 'hello')
  room.setScreen(choice)
  const same = inbox()
  room.addParticipant(pid, undefined, same.send)
  assert.equal(same.of('welcome')[0].to, 'hello', 'the same screen re-sent keeps it')
  room.setScreen({ ...choice, id: 'q2' })
  const next = inbox()
  room.addParticipant(pid, undefined, next.send)
  assert.equal(next.of('welcome')[0].to, undefined)
})

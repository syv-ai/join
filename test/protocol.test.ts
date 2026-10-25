import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIMITS, parseHostMessage, parseParticipantMessage } from '../src/protocol.ts'

const screen = (extra: object = {}) => ({ id: 'k3f9xy', kind: 'choice', content: { text: 'Hvad?', images: [] }, options: ['A', 'B'], ...extra })

test('a phone answer, rename and hello parse', () => {
  assert.deepEqual(parseParticipantMessage(JSON.stringify({ type: 'answer', screenId: 's', value: 1 })), { type: 'answer', screenId: 's', value: 1 })
  assert.deepEqual(parseParticipantMessage(JSON.stringify({ type: 'rename', name: 'Lone' })), { type: 'rename', name: 'Lone' })
  assert.deepEqual(parseParticipantMessage(JSON.stringify({ type: 'hello' })), { type: 'hello' })
  assert.deepEqual(parseParticipantMessage(JSON.stringify({ type: 'hello', pid: 'p1', name: 'marvelous-otter' })), { type: 'hello', pid: 'p1', name: 'marvelous-otter' })
})

test('bad phone input is an error, never a throw', () => {
  for (const raw of ['not json', '[]', 'null', JSON.stringify({ type: 'nope' }), JSON.stringify({ type: 'answer', value: 1 })])
    assert.ok('error' in parseParticipantMessage(raw), raw)
  assert.ok('error' in parseParticipantMessage(JSON.stringify({ type: 'rename', name: 'x'.repeat(41) })))
  assert.ok('error' in parseParticipantMessage(JSON.stringify({ type: 'hello', name: 'x'.repeat(41) })))
  const big = JSON.stringify({ type: 'answer', screenId: 's', value: 'x'.repeat(LIMITS.participantMessage) })
  assert.ok('error' in parseParticipantMessage(big))
})

test('a host screen parses, and one over the screen cap is an error', () => {
  const ok = parseHostMessage(JSON.stringify({ type: 'screen', screen: screen() }))
  assert.equal('error' in ok, false)
  const huge = JSON.stringify({ type: 'screen', screen: screen({ content: { text: '', images: ['x'.repeat(LIMITS.hostScreen)] } }) })
  assert.ok('error' in parseHostMessage(huge))
})

test('host messages are checked by shape', () => {
  assert.deepEqual(parseHostMessage(JSON.stringify({ type: 'open', locale: 'da' })), { type: 'open', locale: 'da' })
  assert.ok('error' in parseHostMessage(JSON.stringify({ type: 'open', locale: 'fr' })))
  assert.ok('error' in parseHostMessage(JSON.stringify({ type: 'screen', screen: screen({ kind: 'poll' }) })))
  assert.ok('error' in parseHostMessage(JSON.stringify({ type: 'to', payload: {} })))
  assert.deepEqual(parseHostMessage(JSON.stringify({ type: 'close' })), { type: 'close' })
})

test('a message with its own "error" field is still read by its type', () => {
  assert.deepEqual(parseParticipantMessage(JSON.stringify({ type: 'rename', name: 'Lone', error: 'x' })), { type: 'rename', name: 'Lone' })
})

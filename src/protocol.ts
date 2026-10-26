/**
 * The wire format between a host, the relay and participants' phones: JSON
 * messages over WebSocket. Everything that crosses a socket is one of the
 * types below, and everything that arrives is checked by `parseHostMessage` or
 * `parseParticipantMessage` before it is used. No Node imports, so browser code
 * can import this file as `@syv/join/protocol`.
 */

export const LIMITS = {
  /** Largest message a phone may send, in bytes. */
  participantMessage: 2048,
  /** Largest screen a host may send (question images travel inside it), in bytes. */
  hostScreen: 1_572_864,
  /** Messages per second a phone may send, sustained. Hosts are not limited. */
  messagesPerSecond: 10,
  /** Answers a room holds while no host is connected; the oldest are dropped. */
  answerBuffer: 10_000,
  renameLength: 40,
  /** How long a room outlives its host's last connection, and a closed code stays reserved. */
  roomTtlMs: 12 * 3600_000,
} as const

/** Room codes avoid letters and digits that look alike (I/1, O/0). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5

export type Locale = 'da' | 'en'

export type ScreenKind = 'wait' | 'choice' | 'text' | 'list' | 'quiz' | 'thanks'

/** What phones show. The host decides it; the phone page renders exactly these kinds. */
export interface Screen {
  id: string
  kind: ScreenKind
  /** The question as written on the slide. Images are data URLs. */
  content: { text: string; images: string[] }
  options?: string[]
  /** choice: more than one option may be picked. */
  multi?: boolean
  /** text: entries per phone, and characters per entry. */
  maxEntries?: number
  maxLength?: number
  /** quiz: set by the host. */
  seconds?: number
  /** quiz: relay time (ms) the answers close. The relay sets it; a host re-sending a running quiz passes it back. */
  deadline?: number
}

/** The `to` payload a phone renders after answering a quiz. */
export interface QuizFeedback { correct: boolean; points: number }

/** The `state` for a `list` screen (Q&A). Phones remember their own upvotes. */
export interface ListState { items: { id: string; text: string; votes: number }[] }

export type HostToRelay =
  | { type: 'auth'; token: string }
  | { type: 'open'; locale: Locale; resume?: { code: string; secret: string } }
  | { type: 'screen'; screen: Screen }
  | { type: 'state'; screenId: string; state: unknown }
  | { type: 'to'; pid: string; payload: unknown }
  | { type: 'close' }

export type RelayToHost =
  | { type: 'opened'; code: string; secret: string; joinUrl: string }
  | { type: 'screen-set'; screenId: string; at: number; deadline?: number }
  | { type: 'joined' | 'renamed'; pid: string; name: string }
  | { type: 'left'; pid: string; name: string }
  | { type: 'count'; n: number }
  | { type: 'answer'; pid: string; name: string; screenId: string; value: unknown; at: number }
  | { type: 'taken-over' }
  | { type: 'error'; reason: string }

export type ParticipantToRelay =
  | { type: 'hello'; pid?: string; name?: string }
  | { type: 'answer'; screenId: string; value: unknown }
  | { type: 'rename'; name: string }

export type RelayToParticipant =
  // `now` is the relay's clock when sent, so a phone can count down to a quiz deadline whatever its own clock says.
  | { type: 'welcome'; pid: string; name: string; locale: Locale; screen: Screen | null; state?: unknown; now: number }
  | { type: 'screen'; screen: Screen; now: number }
  | { type: 'state'; screenId: string; state: unknown }
  | { type: 'to'; payload: unknown }
  | { type: 'renamed'; name: string }
  | { type: 'room-closed' }

type Parsed<T> = T | { error: string }

const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).length

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const optional = (value: unknown, check: (v: unknown) => boolean) => value === undefined || check(value)
const isName = (value: unknown) => isString(value) && value.trim().length > 0 && value.length <= LIMITS.renameLength
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) > 0

/** The message as an object with a string `type`, or why it isn't one. */
function parseJson(raw: string, limit: number): Record<string, unknown> & { type: string } | string {
  if (bytes(raw) > limit) return 'Message too large'
  let value: unknown
  try { value = JSON.parse(raw) } catch { return 'Not JSON' }
  if (!isObject(value) || !isString(value.type)) return 'Not a message'
  return value as Record<string, unknown> & { type: string }
}

const SCREEN_KINDS: readonly string[] = ['wait', 'choice', 'text', 'list', 'quiz', 'thanks']

function isScreen(value: unknown): value is Screen {
  if (!isObject(value) || !isString(value.id) || !isString(value.kind) || !SCREEN_KINDS.includes(value.kind)) return false
  const content = value.content
  if (!isObject(content) || !isString(content.text) || !Array.isArray(content.images) || !content.images.every(isString)) return false
  return optional(value.options, v => Array.isArray(v) && v.every(isString))
    && optional(value.multi, v => typeof v === 'boolean')
    && optional(value.maxEntries, isCount)
    && optional(value.maxLength, isCount)
    && optional(value.seconds, isCount)
    && optional(value.deadline, v => Number.isFinite(v))
}

export function parseHostMessage(raw: string): Parsed<HostToRelay> {
  // A screen carries images, so the host's limit is the screen cap plus room for the envelope.
  const message = parseJson(raw, LIMITS.hostScreen + 4096)
  if (typeof message === 'string') return { error: message }
  switch (message.type) {
    case 'auth':
      return isString(message.token) ? { type: 'auth', token: message.token } : { error: 'Invalid auth' }
    case 'open': {
      if (message.locale !== 'da' && message.locale !== 'en') return { error: 'Invalid locale' }
      const resume = message.resume
      if (resume === undefined) return { type: 'open', locale: message.locale }
      if (!isObject(resume) || !isString(resume.code) || !isString(resume.secret)) return { error: 'Invalid resume' }
      return { type: 'open', locale: message.locale, resume: { code: resume.code, secret: resume.secret } }
    }
    case 'screen':
      if (bytes(JSON.stringify(message.screen ?? null)) > LIMITS.hostScreen) return { error: 'Screen too large' }
      return isScreen(message.screen) ? { type: 'screen', screen: message.screen } : { error: 'Invalid screen' }
    case 'state':
      return isString(message.screenId) ? { type: 'state', screenId: message.screenId, state: message.state } : { error: 'Invalid state' }
    case 'to':
      return isString(message.pid) ? { type: 'to', pid: message.pid, payload: message.payload } : { error: 'Invalid to' }
    case 'close':
      return { type: 'close' }
    default:
      return { error: `Unknown message type ${message.type}` }
  }
}

export function parseParticipantMessage(raw: string): Parsed<ParticipantToRelay> {
  const message = parseJson(raw, LIMITS.participantMessage)
  if (typeof message === 'string') return { error: message }
  switch (message.type) {
    case 'hello':
      if (!optional(message.pid, isString) || !optional(message.name, isName)) return { error: 'Invalid hello' }
      return {
        type: 'hello',
        ...(message.pid === undefined ? {} : { pid: message.pid as string }),
        ...(message.name === undefined ? {} : { name: message.name as string }),
      }
    case 'answer':
      return isString(message.screenId) && 'value' in message
        ? { type: 'answer', screenId: message.screenId, value: message.value }
        : { error: 'Invalid answer' }
    case 'rename':
      return isName(message.name) ? { type: 'rename', name: (message.name as string).trim() } : { error: 'Invalid name' }
    default:
      return { error: `Unknown message type ${message.type}` }
  }
}

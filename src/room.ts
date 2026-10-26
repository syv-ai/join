import { randomUUID } from 'node:crypto'
import { randomName } from './names.ts'
import { LIMITS, type Locale, type RelayToHost, type RelayToParticipant, type Screen } from './protocol.ts'

export type Send<T> = (message: T) => void
type HostSend = Send<RelayToHost>
type PhoneSend = Send<RelayToParticipant>

interface Participant { name: string; send: PhoneSend | null }

/**
 * One room: its host, its participants and the screen they see. The relay owns
 * sockets; a room only sees `send` callbacks, so its rules are tested without a
 * network. Participants are kept after they disconnect, so a phone that comes
 * back keeps its name.
 */
export class Room {
  private host: HostSend | null = null
  private hostLeftAt: number
  private readonly participants = new Map<string, Participant>()
  private screen: Screen | null = null
  private state: { screenId: string; state: unknown } | null = null
  private buffer: Extract<RelayToHost, { type: 'answer' }>[] = []

  readonly code: string
  readonly secret: string
  readonly locale: Locale
  private readonly now: () => number

  constructor(code: string, secret: string, locale: Locale, now: () => number) {
    this.code = code
    this.secret = secret
    this.locale = locale
    this.now = now
    this.hostLeftAt = now()
  }

  /** Makes `send` the host. A host already attached is returned, to be told it was taken over. */
  attachHost(send: HostSend): { previous?: HostSend } {
    const previous = this.host ?? undefined
    this.host = send
    return previous ? { previous } : {}
  }

  isHost(send: HostSend): boolean {
    return this.host === send
  }

  /** Detaches `send` if it is still the host; a host that was taken over detaches nothing. */
  detachHost(send: HostSend): void {
    if (this.host !== send) return
    this.host = null
    this.hostLeftAt = this.now()
  }

  /** Delivers the answers buffered while no host was attached, oldest first. */
  replay(): void {
    if (!this.host) return
    const buffered = this.buffer
    this.buffer = []
    for (const answer of buffered) this.host(answer)
  }

  /** Adds or reconnects a phone. A known pid keeps its name; an unknown one keeps what the phone remembers. */
  addParticipant(pid: string | undefined, name: string | undefined, send: PhoneSend): { pid: string; name: string } {
    const known = pid === undefined ? undefined : this.participants.get(pid)
    const id = pid ?? randomUUID()
    const participant = known ?? { name: name ?? randomName(this.locale), send: null }
    participant.send = send
    this.participants.set(id, participant)
    send({
      type: 'welcome', pid: id, name: participant.name, locale: this.locale, screen: this.screen, now: this.now(),
      ...(this.state && this.state.screenId === this.screen?.id ? { state: this.state.state } : {}),
    })
    if (!known) this.host?.({ type: 'joined', pid: id, name: participant.name })
    this.host?.({ type: 'count', n: this.count() })
    return { pid: id, name: participant.name }
  }

  /** Marks a phone disconnected, if `send` is still its connection. */
  removeParticipant(pid: string, send: PhoneSend): void {
    const participant = this.participants.get(pid)
    if (!participant || participant.send !== send) return
    participant.send = null
    this.host?.({ type: 'left', pid, name: participant.name })
    this.host?.({ type: 'count', n: this.count() })
  }

  rename(pid: string, name: string): void {
    const participant = this.participants.get(pid)
    if (!participant) return
    participant.name = name
    participant.send?.({ type: 'renamed', name })
    this.host?.({ type: 'renamed', pid, name })
  }

  /**
   * Shows `screen` on every phone. A quiz gets its deadline here, from the relay's clock, unless
   * the host sends one it was given before (a reconnect re-sends the running quiz; its clock goes on).
   */
  setScreen(screen: Screen): { at: number; deadline?: number } {
    const at = this.now()
    const deadline = screen.kind !== 'quiz' || !screen.seconds ? undefined
      : typeof screen.deadline === 'number' ? screen.deadline
      : at + screen.seconds * 1000
    this.screen = deadline === undefined ? screen : { ...screen, deadline }
    this.broadcast({ type: 'screen', screen: this.screen, now: at })
    return deadline === undefined ? { at } : { at, deadline }
  }

  setState(screenId: string, state: unknown): void {
    this.state = { screenId, state }
    this.broadcast({ type: 'state', screenId, state })
  }

  sendTo(pid: string, payload: unknown): void {
    this.participants.get(pid)?.send?.({ type: 'to', payload })
  }

  /** Stamps an answer with the relay's clock and passes it to the host, or holds it until one attaches. */
  acceptAnswer(pid: string, screenId: string, value: unknown): void {
    const participant = this.participants.get(pid)
    if (!participant) return
    const answer = { type: 'answer' as const, pid, name: participant.name, screenId, value, at: this.now() }
    if (this.host) return this.host(answer)
    this.buffer.push(answer)
    if (this.buffer.length > LIMITS.answerBuffer) this.buffer.splice(0, this.buffer.length - LIMITS.answerBuffer)
  }

  close(): void {
    this.broadcast({ type: 'room-closed' })
    for (const participant of this.participants.values()) participant.send = null
  }

  expired(): boolean {
    return this.host === null && this.now() - this.hostLeftAt > LIMITS.roomTtlMs
  }

  count(): number {
    let n = 0
    for (const participant of this.participants.values()) if (participant.send) n++
    return n
  }

  private broadcast(message: RelayToParticipant): void {
    for (const participant of this.participants.values()) participant.send?.(message)
  }
}

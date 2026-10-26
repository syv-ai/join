import type { IncomingMessage } from 'node:http'

/**
 * Limits per client address. A whole venue can share one public address (100
 * phones behind one NAT, all reconnecting after a relay restart), so these stop
 * floods and guessing, not crowds: every number is well above what one room of
 * people produces.
 */
export const IP_LIMITS = {
  /** Open WebSocket connections at once. */
  connections: 1000,
  /** New WebSocket connections per minute. */
  connectsPerMinute: 1200,
  /** HTTP requests (the phone page, its files, health checks) per minute. */
  requestsPerMinute: 3000,
  /** Joins for a room that doesn't exist per minute: room codes can't be guessed in bulk. */
  unknownRoomsPerMinute: 60,
  /** Rejected host tokens before the address is shut out of /host. */
  failedAuths: 10,
  failedAuthWindowMs: 10 * 60_000,
} as const

/** Open rooms one host token may hold. */
export const ROOMS_PER_TOKEN = 50
/** Phones one room may hold. */
export const PARTICIPANTS_PER_ROOM = 2000

/**
 * The client's address. Behind a reverse proxy (Traefik on Coolify) the socket
 * is the proxy's, and the proxy appends the real client to X-Forwarded-For; only
 * that last entry is trusted, since a client can send the header itself.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean | 'private' = 'private'): string {
  const peer = req.socket.remoteAddress ?? 'unknown'
  if (trustProxy === true || (trustProxy === 'private' && isPrivate(peer))) {
    const forwarded = req.headers['x-forwarded-for']
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map(s => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  return peer
}

/**
 * A loopback or private-network address: where a reverse proxy on the same host or Docker network
 * connects from. A client on the internet can't come from one, so its forwarded header can be trusted.
 */
export function isPrivate(address: string): boolean {
  const v4 = address.replace(/^::ffff:/, '')
  if (/^(127|10)\./.test(v4) || /^192\.168\./.test(v4) || /^172\.(1[6-9]|2\d|3[01])\./.test(v4)) return true
  return address === '::1' || /^f[cd][0-9a-f]{2}:/i.test(address)
}

/** Counts events per key in a sliding window; `hit` says whether the key is still under its limit. */
export class WindowCounter {
  private readonly hits = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(limit: number, windowMs: number, now: () => number) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** Records an event for `key`; false once `key` has gone over the limit in the window. */
  hit(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter(at => t - at < this.windowMs)
    recent.push(t)
    this.hits.set(key, recent)
    return recent.length <= this.limit
  }

  /** Whether `key` is over the limit now, without recording anything. */
  over(key: string): boolean {
    const t = this.now()
    return (this.hits.get(key) ?? []).filter(at => t - at < this.windowMs).length >= this.limit
  }

  /** Forgets keys with nothing in the window, so the map doesn't grow without end. */
  sweep(): void {
    const t = this.now()
    for (const [key, times] of this.hits) if (!times.some(at => t - at < this.windowMs)) this.hits.delete(key)
  }
}

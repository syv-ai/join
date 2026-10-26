/**
 * Request and connection logs: one JSON line per event on stdout, which Coolify
 * (or any container host) shows and keeps. They say what happened and from
 * roughly where, never what anyone answered or called themselves.
 */
export type Log = (event: string, fields: Record<string, string | number | boolean | undefined>) => void

export const quiet: Log = () => {}

export const stdoutLog: Log = (event, fields) => {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), event, ...fields })}\n`)
}

/**
 * An address shortened so it points at a network, not a person: an IPv4 address loses its last
 * part (203.0.113.0), an IPv6 address keeps its /48 prefix. Enough to see a flood from one place.
 */
export function shortIp(address: string): string {
  const v4 = address.replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.0')
  if (address.includes(':')) {
    const head = address.split('::')[0]!.split(':').filter(Boolean).slice(0, 3)
    return `${head.join(':')}::`
  }
  return 'unknown'
}

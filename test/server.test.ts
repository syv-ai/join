import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { createJoinServer } from '../src/server.ts'
import { joinPhone, openHost, TOKEN } from './helpers.ts'

test('the server answers health, serves the page for a code, and upgrades phones to the relay', async () => {
  const { server, relay } = createJoinServer({ hostTokens: [TOKEN], publicUrl: 'https://join.test' })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const health = await fetch(`${base}/healthz`)
    assert.equal(health.status, 200)
    assert.equal(await health.text(), 'ok')
    const page = await fetch(`${base}/abcde`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /phone\.js/)
    assert.equal((await fetch(`${base}/phone.js`)).status, 200)
    assert.equal((await fetch(`${base}/nope/deeper`)).status, 404)
    const ws = base.replace(/^http/, 'ws')
    const { opened } = await openHost(ws)
    const { welcome } = await joinPhone(ws, opened.code)
    assert.ok(welcome.pid)
  } finally {
    relay.close()
    await new Promise(resolve => server.close(resolve))
  }
})

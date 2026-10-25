# join

A small relay for audience participation. A host (a presentation, a workshop tool, a check-in
desk) opens a room and gets a short code. People join from their phones at `<server>/<CODE>`,
see whatever the host shows them and answer. The relay only passes messages along: it knows
nothing about polls or quizzes, keeps rooms in memory only, and writes nothing to disk.

It was built for [prezzi](https://github.com/syv-ai/prezzi), where a slide can be a poll, a
word cloud, Q&A or a quiz. Syv runs one at `join.syv.ai`. You can run your own.

## Running it

```bash
docker build -t join .
docker run -p 8080:8080 \
  -e JOIN_HOST_TOKENS=some-long-random-token \
  -e PUBLIC_URL=https://join.example.com \
  join
```

Or without Docker: `npm ci && npm run build && JOIN_HOST_TOKENS=… node dist/server.js`.

| Variable | Meaning |
|---|---|
| `JOIN_HOST_TOKENS` | Comma-separated tokens that may open rooms. Phones never need one. Empty means no host can open a room. |
| `PUBLIC_URL` | The address phones use, such as `https://join.example.com`. Hosts get `<PUBLIC_URL>/<CODE>` back to show as a link or QR code. Defaults to `http://localhost:<PORT>`. |
| `PORT` | Port to listen on. Defaults to `8080`. |

Put it behind HTTPS with WebSocket support (any reverse proxy that passes `Upgrade` headers).
`GET /healthz` answers `ok` for health checks. A single instance holds every room, so run one
replica; a restart loses rooms, and hosts reclaim them automatically (see below).

## How it works

Everything is JSON over WebSocket. The types live in [`src/protocol.ts`](src/protocol.ts).

- **Host**: connects to `/host` with `Authorization: Bearer <token>`, sends
  `{type:'open', locale:'da'|'en'}` and gets `{type:'opened', code, secret, joinUrl}`. It then
  sends `screen` messages (what phones show), `state` (live data for the current screen, such as
  a Q&A list) and `to` (a message for one phone), and receives `joined`, `left`, `renamed`,
  `count` and `answer` messages. `close` ends the room.
- **Phone**: the page at `/<CODE>` connects to `/p/<CODE>`, gets a random name such as
  `marvelous-otter` (it can rename), and answers the current screen. Screen kinds: `wait`,
  `choice`, `text`, `list`, `quiz`, `thanks`.
- **Relay**: stamps every answer with its own clock (`at`) and sets a quiz's `deadline`, so
  timing is fair across phones.

**Staying up during a talk.** A host that reconnects with `open` plus `resume: {code, secret}`
gets its room back, also after a relay restart. Answers sent while no host is connected are held
(up to 10 000) and delivered on reconnect. Phones remember their id and name and reconnect on
their own. A second host that resumes the same room takes it over; the first is told
`taken-over`. A closed room's code is not reused for 12 hours, and an abandoned room is freed
12 hours after its host's last connection.

**Limits.** Phone messages up to 2 KB and about 10 per second; host screens up to 1.5 MB
(question images travel inside them as data URLs); renames up to 40 characters.

## Using it from Node

```ts
import { connectHost } from '@syv/join'

const host = connectHost({
  url: 'https://join.example.com', token, locale: 'da',
  onEvent: (event) => { /* opened, answer, count, status … */ },
})
host.send({ type: 'screen', screen: { id: 'q1', kind: 'choice', content: { text: 'Hvad?', images: [] }, options: ['A', 'B'] } })
```

`connectHost` reconnects with backoff, reclaims its room and re-sends the current screen. The
protocol types are also exported on their own as `@syv/join/protocol`, with no Node imports, for
browser code.

## Developing

```bash
npm ci
npm test                         # node --test, needs Node 22.6+ to run .ts directly
JOIN_HOST_TOKENS=dev node src/server.ts
node test/manual-host.ts http://localhost:8080 dev   # step through every screen kind on a phone
```

## Privacy

The relay keeps rooms, names and the current screen in memory while a room exists, and nothing
on disk. It does not log answers. What a host does with the answers it receives is up to the
host.

## License

MIT

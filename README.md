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
  `choice`, `text`, `list`, `quiz`, `thanks`. A `wait` with `options` is a quiz about to start:
  phones show its question and options under "Gør dig klar" until the `quiz` screen with the same
  id arrives. `thanks` doesn't end anything: phones stay connected, so the host can show another
  screen after it. Only `close` ends the room, and phones then say the session is over.
- **Relay**: stamps every answer with its own clock (`at`) and sets a quiz's `deadline`, so
  timing is fair across phones.

**Staying up during a talk.** A host that reconnects with `open` plus `resume: {code, secret}`
gets its room back, also after a relay restart. Answers sent while no host is connected are held
(up to 10 000) and delivered on reconnect. Phones remember their id and name and reconnect on
their own, at once when the page is looked at again. A phone that comes back is welcomed with
the current screen, its `state`, and the last `to` the host sent it while that screen was up, so
a result sent while it was away isn't lost; it then re-sends its own answers to that screen,
which a host should treat as possible repeats. A second host that resumes the same room takes it over; the first is told
`taken-over`. A closed room's code is not reused for 12 hours, and an abandoned room is freed
12 hours after its host's last connection.

**Limits.** Phone messages up to 2 KB and about 10 per second; host screens up to 1.5 MB
(question images travel inside them as data URLs); renames up to 40 characters.

Per client address, set high enough for a whole venue behind one NAT: 1000 open connections,
1200 new connections and 3000 HTTP requests a minute, 60 joins for unknown room codes a minute
(room codes can't be guessed in bulk), and 10 wrong host tokens per 10 minutes before the
address is shut out of `/host`. One host token holds at most 50 open rooms, and a room at most
2000 phones. Over a limit, an upgrade or request gets HTTP 429 and an open socket closes with
4429 (4413 for a full room). Limits are in [`src/limits.ts`](src/limits.ts).

Behind a reverse proxy the relay reads the client address from the last `X-Forwarded-For`
entry, but only when the connection comes from a loopback or private address (where a proxy
on the same host or Docker network connects from), so a client can't claim another address.

## Logs

The server writes one JSON line per event to stdout, which a container host such as Coolify
shows and keeps: `listening`, `http` (every request except `/healthz`, with status and time),
`connect` and `disconnect` (host or phone, room code, close code, seconds connected),
`room-opened`, `room-closed`, `room-taken-over`, `room-expired`, `unknown-room`, `auth-failed`
and `refused` (which limit, see above). Addresses are shortened to their network
(`203.0.113.0`, an IPv6 /48), so a flood from one place shows without pointing at a person.
Answers, names, question text and tokens are never logged.

```json
{"time":"2026-10-26T09:56:54.342Z","event":"http","method":"GET","path":"/ABCDE","status":200,"ms":2,"ip":"203.0.113.0"}
```

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
on disk. Its logs hold events with shortened addresses, never answers or names (see Logs). What a host does with the answers it receives is up to the
host.

## License

MIT

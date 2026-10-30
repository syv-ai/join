// A scripted host for checking the phone page by hand:
//   node test/manual-host.ts [http://localhost:8080] [token]
// It opens a room, prints the join URL, and shows each screen kind in turn (Enter for the next).
import { createInterface } from 'node:readline/promises'
import { connectHost } from '../src/host-client.ts'
import type { Screen } from '../src/protocol.ts'

const [url = 'http://localhost:8080', token = 'dev'] = process.argv.slice(2)
const content = (text: string) => ({ text, images: [] as string[] })
const screens: Screen[] = [
  { id: 'wait', kind: 'wait', content: content('') },
  { id: 'poll', kind: 'choice', content: content('Hvad bruger I AI til i dag?'), options: ['Skrivning', 'Research', 'Kode', 'Slet ikke'] },
  { id: 'multi', kind: 'choice', content: content('Vælg alle der passer'), options: ['Mail', 'Møder', 'Rapporter'], multi: true },
  { id: 'cloud', kind: 'text', content: content('Ét ord om AI'), maxEntries: 3, maxLength: 30 },
  { id: 'qa', kind: 'list', content: content('Spørgsmål til oplægget'), maxLength: 200 },
  { id: 'quiz', kind: 'wait', content: content('Hvornår kom ChatGPT?'), options: ['2020', '2021', '2022', '2023'] },
  { id: 'quiz', kind: 'quiz', content: content('Hvornår kom ChatGPT?'), options: ['2020', '2021', '2022', '2023'], seconds: 20 },
  { id: 'thanks', kind: 'thanks', content: content('') },
]
const qa: { id: string; text: string; votes: Set<string> }[] = []
const state = () => ({ items: qa.map(i => ({ id: i.id, text: i.text, votes: i.votes.size })).sort((a, b) => b.votes - a.votes) })

const host = connectHost({
  url, token, locale: 'da',
  onEvent: (event) => {
    if (event.type === 'opened') console.log(`Room ${event.code}: ${event.joinUrl}`)
    else if (event.type === 'answer') {
      console.log(`answer from ${event.name} on ${event.screenId}:`, JSON.stringify(event.value))
      const value = event.value as any
      if (event.screenId === 'qa' && value?.add) qa.push({ id: String(qa.length + 1), text: String(value.add), votes: new Set() })
      if (event.screenId === 'qa' && value?.vote) {
        const item = qa.find(i => i.id === value.vote)
        if (item) value.on ? item.votes.add(event.pid) : item.votes.delete(event.pid)
      }
      if (event.screenId === 'qa') host.send({ type: 'state', screenId: 'qa', state: state() })
      if (event.screenId === 'quiz') host.send({ type: 'to', pid: event.pid, payload: { correct: value === 2, points: value === 2 ? 870 : 0 } })
    } else console.log(event)
  },
})
const rl = createInterface({ input: process.stdin, output: process.stdout })
for (const screen of screens) {
  await rl.question(`Enter to show "${screen.id}" `)
  host.send({ type: 'screen', screen })
  if (screen.id === 'qa') host.send({ type: 'state', screenId: 'qa', state: state() })
}
await rl.question('Enter to close the room ')
host.send({ type: 'close' })
setTimeout(() => process.exit(0), 300)

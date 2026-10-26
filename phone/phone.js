// The phone page: join a room by code, then show whatever screen the host sends.
// Plain DOM, no framework. All text from the host is set as text, never as HTML.
'use strict'

const STRINGS = {
  da: {
    enterCode: 'Indtast koden fra skærmen', join: 'Deltag', unknownRoom: 'Rummet findes ikke. Tjek koden.',
    connecting: 'Forbinder…', reconnecting: 'Forbinder igen…', look: 'Kig på skærmen', thanks: 'Tak for i dag',
    closed: 'Sessionen er slut. Tak fordi du var med.', send: 'Send', sent: 'Svar sendt', change: 'Du kan ændre dit svar.',
    entriesLeft: n => n === 1 ? 'Du kan sende 1 svar mere.' : `Du kan sende ${n} svar mere.`, noMore: 'Tak for dine svar.',
    yourWord: 'Dit svar', ask: 'Stil et spørgsmål', noQuestions: 'Ingen spørgsmål endnu.',
    locked: 'Svar låst', timeUp: 'Tiden er gået', right: points => `Rigtigt! +${points}`, wrong: 'Forkert',
    chooseName: 'Vælg dit navn', nameHint: 'Navnet ses af oplægsholderen og kan stå på quizzens topliste. Det kan ikke ændres bagefter.',
    nameLabel: 'Dit navn', continue: 'Fortsæt',
    notFound: 'Rummet findes ikke', notFoundHint: 'Det er måske lukket.',
    dataTab: 'Din data', dataTitle: 'Sådan behandler vi dine data',
    data: [
      ['Du er anonym', 'Vi spørger ikke om navn, mail eller login. Det navn, du vælger, ses af oplægsholderen og kan stå på quizzens topliste. Skriv ikke personlige oplysninger i dine svar.'],
      ['Det gemmes', 'Dine svar, dit navn og tidspunkterne gemmes hos oplægsholderen, så resultaterne kan bruges efter oplægget. Der gemmes ingen IP-adresse eller oplysninger om din telefon sammen med dem.'],
      ['Undervejs', 'Svarene går gennem Syv.ai’s server join.syv.ai. Den holder dem kun i hukommelsen, mens rummet er åbent (højst 12 timer), og skriver dem aldrig til disk.'],
      ['Driftslog', 'Serveren logger forbindelser med en forkortet netværksadresse (fx 203.0.113.0) for at kunne stoppe misbrug. Den logger aldrig svar eller navne.'],
      ['På din telefon', 'Browseren husker et tilfældigt id, dit navn og dine svar i dette rum, så du kan komme tilbage efter et afbrud. Ryd browserens data for at slette dem.'],
    ],
  },
  en: {
    enterCode: 'Enter the code on the screen', join: 'Join', unknownRoom: 'That room does not exist. Check the code.',
    connecting: 'Connecting…', reconnecting: 'Reconnecting…', look: 'Look at the screen', thanks: 'Thank you',
    closed: 'The session has ended. Thanks for joining.', send: 'Send', sent: 'Answer sent', change: 'You can change your answer.',
    entriesLeft: n => n === 1 ? 'You can send 1 more answer.' : `You can send ${n} more answers.`, noMore: 'Thanks for your answers.',
    yourWord: 'Your answer', ask: 'Ask a question', noQuestions: 'No questions yet.',
    locked: 'Answer locked', timeUp: "Time's up", right: points => `Correct! +${points}`, wrong: 'Wrong',
    chooseName: 'Choose your name', nameHint: 'The presenter sees it, and it can appear on the quiz leaderboard. It can’t be changed afterwards.',
    nameLabel: 'Your name', continue: 'Continue',
    notFound: 'This room does not exist', notFoundHint: 'It may have closed.',
    dataTab: 'Your data', dataTitle: 'How we handle your data',
    data: [
      ['You are anonymous', 'We don’t ask for your name, email or a login. The name you choose is seen by the presenter and can appear on the quiz leaderboard. Don’t put personal details in your answers.'],
      ['What is kept', 'Your answers, your name and the times are kept by the presenter, so the results can be used after the talk. No IP address or details about your phone are kept with them.'],
      ['On the way', 'Answers pass through Syv.ai’s server join.syv.ai. It holds them in memory only while the room is open (at most 12 hours) and never writes them to disk.'],
      ['Server log', 'The server logs connections with a shortened network address (such as 203.0.113.0) to stop abuse. It never logs answers or names.'],
      ['On your phone', 'Your browser remembers a random id, your name and your answers in this room, so you can come back after a dropped connection. Clear the browser’s data to delete them.'],
    ],
  },
}

const CLOSE = { badMessage: 4400, unknownRoom: 4404, tooFast: 4429 }
const $ = selector => document.querySelector(selector)
const stage = $('[data-stage]')
const banner = $('[data-banner]')
const nameLabel = $('[data-name]')
const dataTab = $('[data-data-tab]')
const dataPanel = $('[data-data-panel]')

let locale = (navigator.language || 'da').toLowerCase().startsWith('da') ? 'da' : 'en'
let t = STRINGS[locale]
const code = (location.pathname.match(/^\/([A-Za-z0-9]{3,12})\/?$/) || [])[1]?.toUpperCase()

// Storage can be missing or throw (private mode); the page then just forgets on reload.
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} },
}
const key = suffix => `join:${code}:${suffix}`

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'text') node.textContent = value
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value)
    else if (value === true) node.setAttribute(name, '')
    else if (value !== false && value != null) node.setAttribute(name, value)
  }
  for (const child of children) if (child) node.append(child)
  return node
}
const show = (...nodes) => stage.replaceChildren(...nodes.filter(Boolean))

// ---- joining ---------------------------------------------------------------

function showNotFound() {
  document.body.classList.add('is-landing')
  $('[data-code]').textContent = ''
  banner.hidden = true
  show(el('div', { class: 'landing not-found' },
    logo('logo-large'),
    el('p', { class: 'not-found-code', text: '404' }),
    el('h1', { class: 'landing-title', text: t.notFound }),
    el('p', { class: 'note', text: t.notFoundHint })))
}

function logo(size) {
  const picture = el('picture', { class: `logo ${size}` },
    el('source', { srcset: '/logo-dark.png', media: '(prefers-color-scheme: light)' }))
  picture.append(el('img', { src: '/logo-light.png', alt: 'Syv.ai' }))
  return picture
}

function showJoinForm(message) {
  document.body.classList.add('is-landing')
  const input = el('input', { inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: '12', 'aria-label': t.enterCode, placeholder: 'ABCDE' })
  const form = el('form', { class: 'join', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (value) location.href = `/${value}`
  } }, logo('logo-large'), el('p', { class: 'note', text: message || t.enterCode }), input, el('button', { class: 'primary', type: 'submit', text: t.join }))
  show(form)
  input.focus()
}

// ---- connection ------------------------------------------------------------

let ws = null
let me = store.get(key('me')) // { pid, name }
let screen = null
let listState = null
let clockOffset = 0 // relay time minus our time
let delay = 500
let tick = null
// After a relay restart, phones reconnect before the host has reclaimed the room. A phone that has
// been in the room keeps trying instead of reporting it unknown.
let welcomed = false
/** The name step is showing: screens arrive but wait behind it. */
let naming = false
/** Welcomed on the current connection: only then may answers go out (hello comes first). */
let inRoom = false

function connect() {
  banner.hidden = !ws
  banner.textContent = t.reconnecting
  if (!ws) show(el('p', { class: 'hint', text: t.connecting }))
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/p/${code}`)
  ws = socket
  // The name goes along only once chosen: the relay treats a name in hello as the phone's fixed one.
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ...(me ? { pid: me.pid, ...(store.get(key('named')) ? { name: me.name } : {}) } : {}) }))
  socket.onmessage = (event) => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    receive(message)
  }
  socket.onclose = (event) => {
    inRoom = false
    if (event.code === CLOSE.unknownRoom && !welcomed) return showNotFound()
    if (screen?.kind === 'thanks') return
    banner.hidden = false
    banner.textContent = t.reconnecting
    setTimeout(connect, event.code === CLOSE.tooFast ? 5000 : delay)
    delay = Math.min(delay * 2, 10_000)
  }
}

// Answers tapped while the connection is down wait here and go out once the room has us back,
// so a phone never shows an answer as sent that the host never got.
const outbox = []
function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN && inRoom) ws.send(JSON.stringify(message))
  else outbox.push(message)
}

function receive(message) {
  switch (message.type) {
    case 'welcome':
      welcomed = true
      inRoom = true
      delay = 500
      banner.hidden = true
      locale = message.locale === 'en' ? 'en' : 'da'
      t = STRINGS[locale]
      document.documentElement.lang = locale
      dataTab.textContent = t.dataTab
      me = { pid: message.pid, name: message.name }
      store.set(key('me'), me)
      showName()
      for (const queued of outbox.splice(0)) ws.send(JSON.stringify(queued))
      clockOffset = message.now - Date.now()
      listState = message.state ?? null
      screen = message.screen
      // A phone new to this room names itself first; the name is then fixed for the session.
      if (!store.get(key('named'))) return showNameStep()
      render(message.screen)
      return
    case 'screen':
      clockOffset = message.now - Date.now()
      listState = null
      render(message.screen)
      return
    case 'state':
      if (!screen || message.screenId !== screen.id) return
      listState = message.state
      // A list redraws only its items: someone may be typing a question.
      if (naming) return
      if (screen.kind === 'list' && stage.querySelector('[data-items]')) renderItems(screen)
      else render(screen)
      return
    case 'to':
      if (screen?.kind === 'quiz' && message.payload && typeof message.payload.correct === 'boolean') {
        store.set(key(`feedback:${screen.id}`), message.payload)
        render(screen)
      }
      return
    case 'renamed':
      me = { ...me, name: message.name }
      store.set(key('me'), me)
      showName()
      return
    case 'room-closed':
      render({ id: 'thanks', kind: 'thanks', content: { text: '', images: [] } })
      return
  }
}

// ---- name ------------------------------------------------------------------

function showName() {
  nameLabel.hidden = false
  nameLabel.textContent = me.name
}

function showNameStep() {
  naming = true
  document.body.classList.add('is-landing')
  const input = el('input', { value: me.name, maxlength: '40', 'aria-label': t.nameLabel, autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'go' })
  const form = el('form', { class: 'landing name-step', onsubmit: (event) => {
    event.preventDefault()
    const name = input.value.trim().replace(/\s+/g, ' ') || me.name
    // Always sent, even unchanged: the relay takes one name per phone, so this fixes it.
    send({ type: 'rename', name })
    me = { ...me, name }
    store.set(key('me'), me)
    store.set(key('named'), true)
    naming = false
    document.body.classList.remove('is-landing')
    showName()
    render(screen)
  } }, logo('logo-large'), el('h1', { class: 'landing-title', text: t.chooseName }), el('p', { class: 'note', text: t.nameHint }),
    input, el('button', { class: 'primary', type: 'submit', text: t.continue }))
  show(form)
  input.select()
}

// ---- screens ---------------------------------------------------------------

function question(content) {
  const images = (content?.images ?? []).filter(src => typeof src === 'string' && src.startsWith('data:image/'))
  return [
    content?.text ? el('p', { class: 'question', text: content.text }) : null,
    images.length ? el('div', { class: 'question-images' }, ...images.map(src => el('img', { src, alt: '' }))) : null,
  ]
}

function render(next) {
  screen = next
  if (naming) return
  clearInterval(tick)
  if (!screen || screen.kind === 'wait') return show(el('p', { class: 'big', text: t.look }))
  if (screen.kind === 'thanks') {
    banner.hidden = true
    return show(el('p', { class: 'big', text: t.thanks }), el('p', { class: 'note', text: t.closed }))
  }
  const view = { choice: renderChoice, text: renderText, list: renderList, quiz: renderQuiz }[screen.kind]
  if (view) view(screen)
  else show(el('p', { class: 'big', text: t.look }))
}

function renderChoice(s) {
  const picked = store.get(key(`answer:${s.id}`)) // number | number[]
  const selected = new Set(Array.isArray(picked) ? picked : picked == null ? [] : [picked])
  const buttons = (s.options ?? []).map((label, index) => el('button', {
    class: 'option', type: 'button', 'aria-pressed': String(selected.has(index)), text: label,
    onclick: () => {
      if (s.multi) {
        selected.has(index) ? selected.delete(index) : selected.add(index)
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(selected.has(i))))
        return
      }
      store.set(key(`answer:${s.id}`), index)
      send({ type: 'answer', screenId: s.id, value: index })
      renderChoice(s)
    },
  }))
  const submit = s.multi
    ? el('button', { class: 'primary', type: 'button', text: t.send, onclick: () => {
        const value = [...selected].sort((a, b) => a - b)
        store.set(key(`answer:${s.id}`), value)
        send({ type: 'answer', screenId: s.id, value })
        renderChoice(s)
      } })
    : null
  show(...question(s.content), el('div', { class: 'options' }, ...buttons), submit,
    picked != null ? el('p', { class: 'note', text: `${t.sent}. ${t.change}` }) : null)
}

function renderText(s) {
  const max = s.maxEntries ?? 1
  const sent = store.get(key(`answer:${s.id}`)) ?? []
  const left = max - sent.length
  const input = el('input', { maxlength: String(s.maxLength ?? 30), 'aria-label': t.yourWord, placeholder: t.yourWord, autocomplete: 'off', enterkeyhint: 'send' })
  const form = left > 0
    ? el('form', { class: 'field', onsubmit: (event) => {
        event.preventDefault()
        const value = input.value.trim()
        if (!value) return
        store.set(key(`answer:${s.id}`), [...sent, value])
        send({ type: 'answer', screenId: s.id, value })
        renderText(s)
        stage.querySelector('input')?.focus()
      } }, input, el('button', { class: 'primary', type: 'submit', text: t.send }))
    : null
  show(...question(s.content), form,
    sent.length ? el('div', { class: 'sent' }, ...sent.map(word => el('span', { class: 'chip', text: word }))) : null,
    el('p', { class: 'note', text: left > 0 ? t.entriesLeft(left) : t.noMore }))
}

function renderList(s) {
  const input = el('input', { maxlength: String(s.maxLength ?? 200), 'aria-label': t.ask, placeholder: t.ask, autocomplete: 'off', enterkeyhint: 'send' })
  const form = el('form', { class: 'field', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    send({ type: 'answer', screenId: s.id, value: { add: value } })
    input.value = ''
  } }, input, el('button', { class: 'primary', type: 'submit', text: t.send }))
  show(...question(s.content), form, el('div', { 'data-items': '' }))
  renderItems(s)
}

function renderItems(s) {
  const holder = stage.querySelector('[data-items]')
  if (!holder) return
  const votes = new Set(store.get(key(`votes:${s.id}`)) ?? [])
  const items = Array.isArray(listState?.items) ? listState.items : []
  holder.replaceChildren(items.length
    ? el('div', { class: 'items' }, ...items.map(item => el('div', { class: 'item' },
        el('span', { class: 'item-text', text: item.text }),
        el('button', { class: 'vote', type: 'button', 'aria-pressed': String(votes.has(item.id)), text: `▲ ${item.votes}`, onclick: () => {
          const on = !votes.has(item.id)
          on ? votes.add(item.id) : votes.delete(item.id)
          store.set(key(`votes:${s.id}`), [...votes])
          send({ type: 'answer', screenId: s.id, value: { vote: item.id, on } })
          renderItems(s)
        } }))))
    : el('p', { class: 'note', text: t.noQuestions }))
}

function renderQuiz(s) {
  clearInterval(tick)
  const picked = store.get(key(`answer:${s.id}`))
  const feedback = store.get(key(`feedback:${s.id}`))
  const remaining = () => Math.max(0, Math.ceil(((s.deadline ?? 0) - (Date.now() + clockOffset)) / 1000))
  const over = remaining() === 0
  const buttons = (s.options ?? []).map((label, index) => el('button', {
    class: 'option', type: 'button', 'aria-pressed': String(picked === index), text: label, disabled: picked != null || over,
    onclick: () => {
      if (store.get(key(`answer:${s.id}`)) != null || remaining() === 0) return
      store.set(key(`answer:${s.id}`), index)
      send({ type: 'answer', screenId: s.id, value: index })
      renderQuiz(s)
    },
  }))
  const timer = el('p', { class: 'timer', text: String(remaining()) })
  const status = feedback
    ? el('p', { class: `feedback ${feedback.correct ? 'good' : 'bad'}`, text: feedback.correct ? t.right(feedback.points) : t.wrong })
    : el('p', { class: 'note', text: picked != null ? t.locked : over ? t.timeUp : '' })
  show(feedback || over ? null : timer, ...question(s.content), el('div', { class: 'options quiz' }, ...buttons), status)
  if (!feedback && !over) {
    tick = setInterval(() => {
      const left = remaining()
      timer.textContent = String(left)
      if (left === 0) renderQuiz(s)
    }, 250)
  }
}

// ---- your data ---------------------------------------------------------------

function setupDataPanel() {
  dataTab.textContent = t.dataTab
  const render = () => dataPanel.replaceChildren(
    el('h2', { text: t.dataTitle }),
    ...t.data.map(([title, text]) => el('section', {}, el('h3', { text: title }), el('p', { text }))))
  dataTab.onclick = () => {
    const open = dataTab.getAttribute('aria-expanded') !== 'true'
    if (open) render()
    dataTab.setAttribute('aria-expanded', String(open))
    dataPanel.hidden = !open
    document.body.classList.toggle('data-open', open)
  }
}

// ---- start -----------------------------------------------------------------

setupDataPanel()

if (!code) {
  showJoinForm()
} else {
  $('[data-code]').textContent = code
  connect()
}

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
    rename: 'Dit navn', save: 'Gem', name: name => `${name} ✎`,
  },
  en: {
    enterCode: 'Enter the code on the screen', join: 'Join', unknownRoom: 'That room does not exist. Check the code.',
    connecting: 'Connecting…', reconnecting: 'Reconnecting…', look: 'Look at the screen', thanks: 'Thank you',
    closed: 'The session has ended. Thanks for joining.', send: 'Send', sent: 'Answer sent', change: 'You can change your answer.',
    entriesLeft: n => n === 1 ? 'You can send 1 more answer.' : `You can send ${n} more answers.`, noMore: 'Thanks for your answers.',
    yourWord: 'Your answer', ask: 'Ask a question', noQuestions: 'No questions yet.',
    locked: 'Answer locked', timeUp: "Time's up", right: points => `Correct! +${points}`, wrong: 'Wrong',
    rename: 'Your name', save: 'Save', name: name => `${name} ✎`,
  },
}

const CLOSE = { badMessage: 4400, unknownRoom: 4404, tooFast: 4429 }
const $ = selector => document.querySelector(selector)
const stage = $('[data-stage]')
const banner = $('[data-banner]')
const nameButton = $('[data-name]')

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

function showJoinForm(message) {
  const input = el('input', { inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', maxlength: '12', 'aria-label': t.enterCode, placeholder: 'ABCDE' })
  const form = el('form', { class: 'join', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (value) location.href = `/${value}`
  } }, el('p', { class: 'note', text: message || t.enterCode }), input, el('button', { class: 'primary', type: 'submit', text: t.join }))
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

function connect() {
  banner.hidden = !ws
  banner.textContent = t.reconnecting
  if (!ws) show(el('p', { class: 'hint', text: t.connecting }))
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/p/${code}`)
  ws = socket
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ...(me ? { pid: me.pid, name: me.name } : {}) }))
  socket.onmessage = (event) => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    receive(message)
  }
  socket.onclose = (event) => {
    if (event.code === CLOSE.unknownRoom && !welcomed) return showJoinForm(t.unknownRoom)
    if (screen?.kind === 'thanks') return
    banner.hidden = false
    banner.textContent = t.reconnecting
    setTimeout(connect, event.code === CLOSE.tooFast ? 5000 : delay)
    delay = Math.min(delay * 2, 10_000)
  }
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function receive(message) {
  switch (message.type) {
    case 'welcome':
      welcomed = true
      delay = 500
      banner.hidden = true
      locale = message.locale === 'en' ? 'en' : 'da'
      t = STRINGS[locale]
      document.documentElement.lang = locale
      me = { pid: message.pid, name: message.name }
      store.set(key('me'), me)
      showName()
      clockOffset = message.now - Date.now()
      listState = message.state ?? null
      render(message.screen)
      return
    case 'screen':
      clockOffset = message.now - Date.now()
      listState = null
      render(message.screen)
      return
    case 'state':
      if (screen && message.screenId === screen.id) { listState = message.state; render(screen) }
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
  nameButton.hidden = false
  nameButton.textContent = t.name(me.name)
  nameButton.onclick = () => {
    const input = el('input', { value: me.name, maxlength: '40', 'aria-label': t.rename })
    const form = el('form', { class: 'field', onsubmit: (event) => {
      event.preventDefault()
      const name = input.value.trim()
      if (name && name !== me.name) send({ type: 'rename', name })
      render(screen)
    } }, input, el('button', { class: 'primary', type: 'submit', text: t.save }))
    show(el('p', { class: 'note', text: t.rename }), form)
    input.select()
  }
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
  const votes = new Set(store.get(key(`votes:${s.id}`)) ?? [])
  const items = Array.isArray(listState?.items) ? listState.items : []
  const input = el('input', { maxlength: String(s.maxLength ?? 200), 'aria-label': t.ask, placeholder: t.ask, autocomplete: 'off', enterkeyhint: 'send' })
  const form = el('form', { class: 'field', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    send({ type: 'answer', screenId: s.id, value: { add: value } })
    input.value = ''
  } }, input, el('button', { class: 'primary', type: 'submit', text: t.send }))
  const list = items.length
    ? el('div', { class: 'items' }, ...items.map(item => el('div', { class: 'item' },
        el('span', { class: 'item-text', text: item.text }),
        el('button', { class: 'vote', type: 'button', 'aria-pressed': String(votes.has(item.id)), text: `▲ ${item.votes}`, onclick: () => {
          const on = !votes.has(item.id)
          on ? votes.add(item.id) : votes.delete(item.id)
          store.set(key(`votes:${s.id}`), [...votes])
          send({ type: 'answer', screenId: s.id, value: { vote: item.id, on } })
          renderList(s)
        } }))))
    : el('p', { class: 'note', text: t.noQuestions })
  show(...question(s.content), form, list)
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

// ---- start -----------------------------------------------------------------

if (!code) {
  showJoinForm()
} else {
  $('[data-code]').textContent = code
  connect()
}

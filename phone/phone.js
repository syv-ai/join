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
    close: 'Luk',
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
    close: 'Close',
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

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** A short tick under the finger where the phone supports it (Android); silent elsewhere. */
const haptic = (pattern = 10) => { try { navigator.vibrate?.(pattern) } catch {} }

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

// ---- views -----------------------------------------------------------------
// The stage holds one view at a time. A new view (another question, the name step) fades in over
// the old one; showing the same view again just replaces its content, so taps within a question
// update in place instead of redrawing the screen.

let viewKey = ''
const currentView = () => stage.lastElementChild

function show(key, ...nodes) {
  const content = nodes.filter(Boolean)
  if (key === viewKey && currentView()) return currentView().replaceChildren(...content)
  viewKey = key
  const next = el('div', { class: 'view' }, ...content)
  const old = [...stage.children]
  if (!old.length || reducedMotion()) return stage.replaceChildren(next)
  for (const view of old) {
    view.classList.add('view-leave')
    view.setAttribute('aria-hidden', 'true')
    setTimeout(() => view.remove(), 200)
  }
  next.classList.add('view-enter')
  stage.append(next)
}

/** Shows or hides a note line with a fade, keeping its place so nothing below jumps. */
function setNote(node, text) {
  node.textContent = text
  node.classList.toggle('note-shown', !!text)
}

function setBanner(text) {
  if (text) banner.textContent = text
  banner.classList.toggle('banner-shown', !!text)
}

// ---- joining ---------------------------------------------------------------

function logo(size) {
  const picture = el('picture', { class: `logo ${size}` },
    el('source', { srcset: '/logo-dark.png', media: '(prefers-color-scheme: light)' }))
  picture.append(el('img', { src: '/logo-light.png', alt: 'Syv.ai' }))
  return picture
}

function showNotFound() {
  document.body.classList.add('is-landing')
  $('[data-code]').textContent = ''
  setBanner(null)
  show('404', el('div', { class: 'landing not-found' },
    logo('logo-large'),
    el('p', { class: 'not-found-code', text: '404' }),
    el('h1', { class: 'landing-title', text: t.notFound }),
    el('p', { class: 'note note-shown', text: t.notFoundHint })))
}

function showJoinForm() {
  document.body.classList.add('is-landing')
  const input = el('input', { inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '12', 'aria-label': t.enterCode, placeholder: 'ABCDE', enterkeyhint: 'go' })
  const form = el('form', { class: 'landing join', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (value) location.href = `/${value}`
  } }, logo('logo-large'), el('p', { class: 'note note-shown', text: t.enterCode }), input, el('button', { class: 'primary', type: 'submit', text: t.join }))
  show('join', form)
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
  if (ws) setBanner(t.reconnecting)
  else show('connecting', el('div', { class: 'waiting' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('p', { class: 'hint', text: t.connecting })))
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
    setBanner(t.reconnecting)
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
      setBanner(null)
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
      if (naming) return
      // A list redraws only its items: someone may be typing a question.
      if (screen.kind === 'list' && currentView()?.querySelector('[data-items]')) renderItems(screen)
      else render(screen)
      return
    case 'to':
      if (screen?.kind === 'quiz' && message.payload && typeof message.payload.correct === 'boolean') {
        store.set(key(`feedback:${screen.id}`), message.payload)
        if (!naming) revealQuiz(message.payload)
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
  const input = el('input', { value: me.name, maxlength: '40', 'aria-label': t.nameLabel, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go' })
  const form = el('form', { class: 'landing name-step', onsubmit: (event) => {
    event.preventDefault()
    const name = input.value.trim().replace(/\s+/g, ' ') || me.name
    // Always sent, even unchanged: the relay takes one name per phone, so this fixes it.
    send({ type: 'rename', name })
    me = { ...me, name }
    store.set(key('me'), me)
    store.set(key('named'), true)
    naming = false
    input.blur()
    document.body.classList.remove('is-landing')
    showName()
    haptic()
    render(screen)
  } }, logo('logo-large'), el('h1', { class: 'landing-title', text: t.chooseName }), el('p', { class: 'note note-shown', text: t.nameHint }),
    input, el('button', { class: 'primary', type: 'submit', text: t.continue }))
  show('name', form)
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
  if (!screen || screen.kind === 'wait')
    return show('wait', el('div', { class: 'waiting' }, el('span', { class: 'pulse', 'aria-hidden': 'true' }), el('p', { class: 'big', text: t.look })))
  if (screen.kind === 'thanks') {
    setBanner(null)
    return show('thanks', el('p', { class: 'big', text: t.thanks }), el('p', { class: 'note note-shown', text: t.closed }))
  }
  const view = { choice: renderChoice, text: renderText, list: renderList, quiz: renderQuiz }[screen.kind]
  if (view) view(screen)
  else show('wait', el('p', { class: 'big', text: t.look }))
}

function renderChoice(s) {
  const picked = store.get(key(`answer:${s.id}`)) // number | number[]
  const selected = new Set(Array.isArray(picked) ? picked : picked == null ? [] : [picked])
  const note = el('p', { class: 'note' })
  const paint = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(selected.has(i))))
  const confirm = (value) => {
    store.set(key(`answer:${s.id}`), value)
    send({ type: 'answer', screenId: s.id, value })
    haptic()
    setNote(note, `${t.sent} ✓ ${t.change}`)
  }
  const buttons = (s.options ?? []).map((label, index) => el('button', {
    class: 'option', type: 'button', text: label,
    onclick: () => {
      if (s.multi) {
        selected.has(index) ? selected.delete(index) : selected.add(index)
        paint()
        submit.disabled = !selected.size
        return
      }
      selected.clear()
      selected.add(index)
      paint()
      confirm(index)
    },
  }))
  const submit = el('button', { class: 'primary', type: 'button', text: t.send, onclick: () => confirm([...selected].sort((a, b) => a - b)) })
  submit.disabled = !selected.size
  paint()
  if (picked != null) setNote(note, `${t.sent} ✓ ${t.change}`)
  show(`choice:${s.id}`, ...question(s.content), el('div', { class: 'options' }, ...buttons), s.multi ? submit : null, note)
}

function renderText(s) {
  const max = s.maxEntries ?? 1
  const sent = [...(store.get(key(`answer:${s.id}`)) ?? [])]
  const chips = el('div', { class: 'sent' }, ...sent.map(word => el('span', { class: 'chip', text: word })))
  const note = el('p', { class: 'note note-shown' })
  const input = el('input', { maxlength: String(s.maxLength ?? 30), 'aria-label': t.yourWord, placeholder: t.yourWord, autocomplete: 'off', enterkeyhint: 'send' })
  const button = el('button', { class: 'primary', type: 'submit', text: t.send })
  const update = () => {
    const left = max - sent.length
    note.textContent = left > 0 ? t.entriesLeft(left) : t.noMore
    input.disabled = button.disabled = left <= 0
    form.classList.toggle('field-done', left <= 0)
  }
  const form = el('form', { class: 'field', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value || sent.length >= max) return
    sent.push(value)
    store.set(key(`answer:${s.id}`), sent)
    send({ type: 'answer', screenId: s.id, value })
    haptic()
    chips.append(el('span', { class: 'chip chip-new', text: value }))
    input.value = ''
    update()
    if (sent.length < max) input.focus()
    else input.blur()
  } }, input, button)
  update()
  show(`text:${s.id}`, ...question(s.content), form, chips, note)
}

function renderList(s) {
  const input = el('input', { maxlength: String(s.maxLength ?? 200), 'aria-label': t.ask, placeholder: t.ask, autocomplete: 'off', enterkeyhint: 'send' })
  const form = el('form', { class: 'field', onsubmit: (event) => {
    event.preventDefault()
    const value = input.value.trim()
    if (!value) return
    send({ type: 'answer', screenId: s.id, value: { add: value } })
    haptic()
    input.value = ''
  } }, input, el('button', { class: 'primary', type: 'submit', text: t.send }))
  show(`list:${s.id}`, ...question(s.content), form, el('div', { 'data-items': '' }))
  renderItems(s)
}

/** Q&A items, kept by id across updates so a question that gains votes glides to its new place. */
function renderItems(s) {
  const holder = currentView()?.querySelector('[data-items]')
  if (!holder) return
  const votes = new Set(store.get(key(`votes:${s.id}`)) ?? [])
  const items = Array.isArray(listState?.items) ? listState.items : []
  if (!items.length) return holder.replaceChildren(el('p', { class: 'note note-shown', text: t.noQuestions }))
  let list = holder.querySelector('.items')
  if (!list) holder.replaceChildren(list = el('div', { class: 'items' }))
  const before = new Map([...list.children].map(node => [node.dataset.id, node.getBoundingClientRect().top]))
  const existing = new Map([...list.children].map(node => [node.dataset.id, node]))
  const nodes = items.map((item) => {
    let node = existing.get(item.id)
    if (!node) {
      const vote = el('button', { class: 'vote', type: 'button', onclick: () => {
        const on = !votes.has(item.id)
        on ? votes.add(item.id) : votes.delete(item.id)
        store.set(key(`votes:${s.id}`), [...votes])
        send({ type: 'answer', screenId: s.id, value: { vote: item.id, on } })
        haptic()
        vote.setAttribute('aria-pressed', String(on))
      } })
      node = el('div', { class: `item${before.size ? ' item-new' : ''}`, 'data-id': item.id }, el('span', { class: 'item-text', text: item.text }), vote)
    }
    const vote = node.querySelector('.vote')
    const label = `▲ ${item.votes}`
    if (vote.textContent !== label) {
      if (vote.textContent && !reducedMotion()) vote.animate([{ transform: 'scale(1.18)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' })
      vote.textContent = label
    }
    vote.setAttribute('aria-pressed', String(votes.has(item.id)))
    return node
  })
  list.replaceChildren(...nodes)
  if (reducedMotion()) return
  for (const node of nodes) {
    const top = before.get(node.dataset.id)
    const dy = top === undefined ? 0 : top - node.getBoundingClientRect().top
    if (dy) node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
  }
}

function renderQuiz(s) {
  clearInterval(tick)
  const picked = store.get(key(`answer:${s.id}`))
  const feedback = store.get(key(`feedback:${s.id}`))
  const totalMs = (s.seconds ?? 20) * 1000
  const leftMs = () => Math.max(0, (s.deadline ?? 0) - (Date.now() + clockOffset))
  const status = el('p', { class: 'note' })
  const buttons = (s.options ?? []).map((label, index) => el('button', {
    class: 'option', type: 'button', text: label,
    onclick: () => {
      if (store.get(key(`answer:${s.id}`)) != null || leftMs() === 0) return
      store.set(key(`answer:${s.id}`), index)
      send({ type: 'answer', screenId: s.id, value: index })
      haptic()
      lock(index)
      setNote(status, t.locked)
    },
  }))
  const options = el('div', { class: 'options quiz' }, ...buttons)
  const lock = (choice) => {
    options.classList.add('quiz-locked')
    buttons.forEach((b, i) => { b.disabled = true; b.setAttribute('aria-pressed', String(i === choice)) })
  }
  if (picked != null || leftMs() === 0) lock(picked)
  if (feedback) setStatusFeedback(status, feedback)
  else if (picked != null) setNote(status, t.locked)
  else if (leftMs() === 0) setNote(status, t.timeUp)

  // The bar drains in one smooth CSS transition to the deadline; the number ticks beside it.
  const bar = el('span', { class: 'timer-bar' })
  const number = el('span', { class: 'timer-num', text: String(Math.ceil(leftMs() / 1000)) })
  const timer = el('div', { class: 'timer', role: 'timer' }, el('span', { class: 'timer-track' }, bar), number)
  const running = !feedback && leftMs() > 0
  show(`quiz:${s.id}`, running ? timer : null, ...question(s.content), options, status)
  if (!running) return
  bar.style.transform = `scaleX(${leftMs() / totalMs})`
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `transform ${leftMs()}ms linear`
    bar.style.transform = 'scaleX(0)'
  }))
  tick = setInterval(() => {
    const left = leftMs()
    number.textContent = String(Math.ceil(left / 1000))
    timer.classList.toggle('timer-urgent', left <= 5000)
    if (left > 0) return
    clearInterval(tick)
    timer.classList.add('timer-done')
    lock(store.get(key(`answer:${s.id}`)))
    if (!store.get(key(`feedback:${s.id}`))) setNote(status, store.get(key(`answer:${s.id}`)) != null ? t.locked : t.timeUp)
  }, 200)
}

function setStatusFeedback(node, feedback) {
  node.className = `feedback ${feedback.correct ? 'good' : 'bad'}`
  node.textContent = feedback.correct ? t.right(feedback.points) : t.wrong
}

/** Right or wrong, when the host reveals it: in place, with a pop and a buzz. */
function revealQuiz(feedback) {
  const view = currentView()
  const status = view?.querySelector('.note, .feedback')
  if (!status || viewKey !== `quiz:${screen.id}`) return render(screen)
  clearInterval(tick)
  view.querySelector('.timer')?.remove()
  setStatusFeedback(status, feedback)
  status.classList.add('feedback-in')
  haptic(feedback.correct ? [15, 60, 15] : 40)
}

// ---- your data ---------------------------------------------------------------
// A bottom sheet: the tab opens it; it closes on a downward drag or flick, a tap on the dimmed
// page behind it, the close button or Escape. Focus moves into it and back to the tab.

function setupDataPanel() {
  dataTab.textContent = t.dataTab
  const backdrop = el('div', { class: 'sheet-backdrop', hidden: true })
  document.body.append(backdrop)
  dataPanel.setAttribute('role', 'dialog')
  dataPanel.setAttribute('aria-modal', 'true')
  dataPanel.setAttribute('aria-labelledby', 'data-title')
  let open = false

  const fill = () => {
    const close = el('button', { class: 'sheet-close', type: 'button', 'aria-label': t.close, text: '×', onclick: () => setOpen(false) })
    dataPanel.replaceChildren(
      el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
      el('div', { class: 'sheet-head' }, el('h2', { id: 'data-title', tabindex: '-1', text: t.dataTitle }), close),
      el('div', { class: 'sheet-body' }, ...t.data.map(([title, text]) => el('section', {}, el('h3', { text: title }), el('p', { text })))))
  }
  const setOpen = (next) => {
    if (next === open) return
    open = next
    dataTab.setAttribute('aria-expanded', String(open))
    document.body.classList.toggle('sheet-open', open)
    dataPanel.style.transform = ''
    if (open) {
      fill()
      dataPanel.hidden = backdrop.hidden = false
      requestAnimationFrame(() => { dataPanel.classList.add('sheet-shown'); backdrop.classList.add('sheet-shown') })
      dataPanel.querySelector('#data-title').focus({ preventScroll: true })
    } else {
      dataPanel.classList.remove('sheet-shown')
      backdrop.classList.remove('sheet-shown')
      setTimeout(() => { if (!open) dataPanel.hidden = backdrop.hidden = true }, reducedMotion() ? 0 : 280)
      dataTab.focus({ preventScroll: true })
    }
  }
  dataTab.onclick = () => setOpen(!open)
  backdrop.onclick = () => setOpen(false)
  document.addEventListener('keydown', (event) => {
    if (!open) return
    if (event.key === 'Escape') setOpen(false)
    // Keep Tab inside the sheet while it is open.
    if (event.key === 'Tab') {
      const focusable = [...dataPanel.querySelectorAll('button, [tabindex="0"]')]
      if (!focusable.length) return
      const first = focusable[0], last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  })

  // Drag down to close: the sheet follows the finger from its grip or header, or from anywhere
  // once its text is scrolled to the top. Far enough, or a quick flick, and it closes; else it springs back.
  let drag = null
  dataPanel.addEventListener('pointerdown', (event) => {
    const body = dataPanel.querySelector('.sheet-body')
    const fromBody = body?.contains(event.target)
    if (event.target.closest('.sheet-close') || (fromBody && body.scrollTop > 0)) return
    drag = { id: event.pointerId, y: event.clientY, dy: 0, at: performance.now(), v: 0, moved: false }
  })
  dataPanel.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const dy = Math.max(0, event.clientY - drag.y)
    if (!drag.moved && dy < 6) return
    if (!drag.moved) { drag.moved = true; dataPanel.setPointerCapture(event.pointerId); dataPanel.classList.add('sheet-dragging') }
    const now = performance.now()
    drag.v = (dy - drag.dy) / Math.max(1, now - drag.at)
    drag.dy = dy
    drag.at = now
    dataPanel.style.transform = `translateY(${dy}px)`
    backdrop.style.opacity = String(Math.max(0, 1 - dy / dataPanel.offsetHeight))
  })
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return
    const { moved, dy, v } = drag
    drag = null
    dataPanel.classList.remove('sheet-dragging')
    backdrop.style.opacity = ''
    if (!moved) return
    if (dy > dataPanel.offsetHeight * 0.3 || v > 0.6) {
      dataPanel.style.transform = 'translateY(100%)'
      setOpen(false)
    } else {
      dataPanel.style.transform = ''
    }
  }
  dataPanel.addEventListener('pointerup', end)
  dataPanel.addEventListener('pointercancel', end)
}

// ---- start -----------------------------------------------------------------

setupDataPanel()

if (!code) {
  showJoinForm()
} else {
  $('[data-code]').textContent = code
  connect()
}

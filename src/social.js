import { createClient } from '@supabase/supabase-js'
import './social.css'
import introLogo from './assets/nitra-logo.jpg?inline'

const app = document.querySelector('#socialApp')
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null
const WALL_KEY = 'nitra-space-redesign-wall'
const EVENTS_KEY = 'nitra-space-redesign-events'
const POLL_VOTER_KEY = 'nitra-space-poll-voter'
const ANALYTICS_SESSION_KEY = 'nitra-space-analytics-session'
const ADMIN_PASSWORD_HASH = 'a6c60fccaf9154e44aafeed3bd70ead686eaf25b30bd9efe61afa105722ebddd'
let scrollObserver
let introTimerStarted = false
let pollOpenTimer
let analyticsChannel

const legacyDemoWallIds = new Set(['w1', 'w2', 'w3'])

const legacyDemoEventIds = new Set(['e1', 'e2', 'partner-studentevents-youniverse-2026'])
const adminEntryRequested = new URLSearchParams(location.search).get('admin') === '1'

const state = {
  wall: readList(WALL_KEY, []).filter(item => !legacyDemoWallIds.has(item.id)),
  events: readList(EVENTS_KEY, []).filter(item => !legacyDemoEventIds.has(item.id)),
  adminOpen: false,
  adminGateOpen: adminEntryRequested,
  adminAuthenticated: false,
  adminPassword: '',
  adminError: '',
  pollAdminOpen: false,
  analyticsOpen: false,
  analyticsLoading: false,
  analyticsDate: localDateKey(),
  analytics: null,
  analyticsError: '',
  onlineCount: 0,
  editingEventId: null,
  composerOpen: false,
  introVisible: true,
  poll: null,
  pollOpen: false,
  pollChoice: '',
  pollSubmitting: false,
  pollError: '',
  pollHistory: [],
  pollHistoryLoading: false,
  pollHistoryError: '',
  activeSection: adminEntryRequested ? 'events' : (['board', 'events', 'future'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'board'),
  theme: localStorage.getItem('nitra-space-redesign-theme') || 'light'
}

const localEventDrafts = state.events.slice()
const localWallDrafts = state.wall.slice()

const studentEventsOfficialEvent = {
  id: 'official-studentevents-youniverse-2026',
  organizer: 'Student Events',
  title: 'YOUNIVERSE Festival',
  performer: 'Line-up bude oznámený',
  date: '2026-10-23T00:00',
  place: 'Agrokomplex, Nitra',
  link: 'https://www.instagram.com/studentevents.sk/',
  image: ''
}

if (!state.events.some(item => item.id === studentEventsOfficialEvent.id)) {
  state.events.push(studentEventsOfficialEvent)
}

localStorage.setItem(EVENTS_KEY, JSON.stringify(state.events))

function readList(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(value) ? value : fallback
  } catch {
    return fallback
  }
}

function save() {
  localStorage.setItem(WALL_KEY, JSON.stringify(state.wall))
  localStorage.setItem(EVENTS_KEY, JSON.stringify(state.events.map(item => ({ ...item, image: '' }))))
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]))
}

function initials(name = '') {
  return name.trim().slice(0, 1).toUpperCase() || 'N'
}

function safeEventLink(value = '') {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function pollVoterId() {
  let value = localStorage.getItem(POLL_VOTER_KEY) || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    value = crypto.randomUUID()
    localStorage.setItem(POLL_VOTER_KEY, value)
  }
  return value
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date)
}

function analyticsSessionId() {
  let value = localStorage.getItem(ANALYTICS_SESSION_KEY) || ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    value = crypto.randomUUID()
    localStorage.setItem(ANALYTICS_SESSION_KEY, value)
  }
  return value
}

async function recordAnalytics(event, target = null) {
  if (!supabase) return
  const { error } = await supabase.rpc('record_nitra_analytics', {
    p_session_id: analyticsSessionId(), p_event: event, p_target: target
  })
  if (error) console.error('[analytics] Záznam zlyhal:', error.message)
}

function startOnlinePresence() {
  if (!supabase || analyticsChannel) return
  analyticsChannel = supabase.channel('nitra-space-public-online', {
    config: { presence: { key: analyticsSessionId() } }
  })
  analyticsChannel
    .on('presence', { event: 'sync' }, () => {
      state.onlineCount = Object.keys(analyticsChannel.presenceState()).length
      const counter = document.querySelector('#analyticsOnlineCount')
      if (counter) counter.textContent = String(state.onlineCount)
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await analyticsChannel.track({ online_at: new Date().toISOString() })
      }
    })
}

async function loadAdminAnalytics(day = state.analyticsDate) {
  if (!supabase || !state.adminAuthenticated) return
  state.analyticsLoading = true
  state.analyticsError = ''
  render()
  const { data, error } = await supabase.rpc('get_nitra_analytics', {
    p_password: state.adminPassword,
    p_day: day
  })
  state.analyticsLoading = false
  if (error) {
    state.analyticsError = 'Štatistiky sa nepodarilo načítať.'
  } else {
    state.analytics = data
  }
  render()
}

async function loadPoll() {
  if (!supabase) return
  const { data, error } = await supabase.rpc('get_active_nitra_poll', { p_voter_id: pollVoterId() })
  if (error) {
    console.error('[poll] Načítanie ankety zlyhalo:', error.message)
    return
  }
  if (!data?.id) return
  state.poll = data
  state.pollChoice = data.selected_option || ''
  render()
  if (data.selected_option) return
  const seenKey = `nitra-space-poll-seen:${data.id}`
  if (!sessionStorage.getItem(seenKey) && !pollOpenTimer) {
    pollOpenTimer = window.setTimeout(() => {
      state.pollOpen = true
      render()
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 700 : 3200)
  }
}

async function loadPollHistory() {
  if (!supabase || !state.adminAuthenticated) return
  state.pollHistoryLoading = true
  state.pollHistoryError = ''
  render()
  const { data, error } = await supabase.rpc('manage_nitra_poll_history', {
    p_password: state.adminPassword, p_action: 'list', p_poll_id: null
  })
  state.pollHistoryLoading = false
  if (error) state.pollHistoryError = 'Históriu ankiet sa nepodarilo načítať.'
  else state.pollHistory = Array.isArray(data) ? data : []
  render()
}

function pollModal() {
  if (!state.pollOpen || !state.poll) return ''
  const options = Array.isArray(state.poll.options) ? state.poll.options : []
  const total = Number(state.poll.total_votes || 0)
  const voted = Boolean(state.poll.selected_option)
  return `
    <button class="poll-backdrop" data-poll-close aria-label="Zavrieť anketu"></button>
    <section class="poll-modal" role="dialog" aria-modal="true" aria-labelledby="pollTitle">
      <button class="poll-close" data-poll-close aria-label="Zavrieť">×</button>
      <span class="poll-kicker">NITRA ROZHODUJE</span>
      <h2 id="pollTitle">${escapeHtml(state.poll.question)}</h2>
      <p class="poll-subtitle">${voted ? `Ďakujeme. Hlasovalo už ${total} ľudí.` : 'Vyber jednu možnosť. Hlasovanie je anonymné.'}</p>
      <div class="poll-options">
        ${options.map(option => {
          const votes = Number(option.votes || 0)
          const percent = total ? Math.round(votes / total * 100) : 0
          const selected = state.pollChoice === option.id
          return `<button type="button" class="poll-option ${selected ? 'selected' : ''} ${voted ? 'result' : ''}" data-poll-option="${escapeHtml(option.id)}" ${voted ? 'disabled' : ''}><span><b>${escapeHtml(option.label)}</b>${voted ? `<strong>${percent}%</strong>` : '<i></i>'}</span>${voted ? `<em style="--poll-result:${percent}%"></em>` : ''}</button>`
        }).join('')}
      </div>
      <p class="poll-error" aria-live="polite" ${state.pollError ? '' : 'hidden'}>${escapeHtml(state.pollError)}</p>
      ${voted ? '<button class="poll-submit done" type="button" data-poll-close>HOTOVO</button>' : `<button class="poll-submit" type="button" data-poll-submit ${!state.pollChoice || state.pollSubmitting ? 'disabled' : ''}>${state.pollSubmitting ? 'ODOSIELAM…' : 'HLASOVAŤ'}</button>`}
      <small class="poll-footnote">Bez mena, účtu a osobných údajov.</small>
    </section>`
}

function eventSourceLabel(value = '') {
  const link = safeEventLink(value)
  if (!link) return ''
  const url = new URL(link)
  if (url.hostname.includes('instagram.com')) {
    const username = url.pathname.split('/').filter(Boolean)[0]
    return username ? `Instagram · @${username}` : 'Instagram'
  }
  return url.hostname.replace(/^www\./, '')
}

function pollResultsCard() {
  if (!state.poll?.selected_option) return ''
  const options = Array.isArray(state.poll.options) ? state.poll.options : []
  const total = Number(state.poll.total_votes || 0)
  return `<section class="page-poll-results" aria-label="Výsledky aktuálnej ankety">
    <div><span>AKTUÁLNA ANKETA</span><strong>${escapeHtml(state.poll.question)}</strong><small>${total} ${total === 1 ? 'hlas' : 'hlasov'}</small></div>
    <div class="page-poll-options">${options.map(option => {
      const votes = Number(option.votes || 0)
      const percent = total ? Math.round(votes / total * 100) : 0
      return `<article class="${state.poll.selected_option === option.id ? 'selected' : ''}"><span><b>${escapeHtml(option.label)}</b><strong>${percent}%</strong></span><i style="--poll-result:${percent}%"></i></article>`
    }).join('')}</div>
  </section>`
}

function eventFromRow(row) {
  return {
    id: row.id,
    organizer: row.organizer,
    title: row.title,
    performer: row.performer,
    date: row.event_date,
    place: row.place,
    link: row.link || '',
    image: row.image_data || ''
  }
}

function eventToPayload(item) {
  const parsedDate = new Date(item.date)
  return {
    organizer: item.organizer,
    title: item.title,
    performer: item.performer,
    event_date: Number.isNaN(parsedDate.getTime()) ? item.date : parsedDate.toISOString(),
    place: item.place,
    link: item.link || '',
    image_data: item.image || ''
  }
}

async function loadEvents() {
  if (!supabase) return
  const { data, error } = await supabase
    .from('nitra_events')
    .select('id, organizer, title, performer, event_date, place, link, image_data')
    .order('event_date', { ascending: true })

  if (error) {
    console.error('[events] Nepodarilo sa načítať eventy zo Supabase:', error.message)
    return
  }

  state.events = data.map(eventFromRow)
  try { save() } catch {}
  render()
}

async function manageRemoteEvent(action, item = {}, id = null) {
  if (!supabase) return { data: null, error: null }
  return supabase.rpc('manage_nitra_event', {
    p_password: state.adminPassword,
    p_action: action,
    p_event: action === 'delete' ? {} : eventToPayload(item),
    p_event_id: id
  })
}

async function syncLocalEventDrafts() {
  if (!supabase || !localEventDrafts.length) return
  const remoteIds = new Set(state.events.map(item => item.id))
  const drafts = localEventDrafts.filter(item =>
    !remoteIds.has(item.id) &&
    item.id !== studentEventsOfficialEvent.id &&
    !legacyDemoEventIds.has(item.id)
  )

  for (const draft of drafts) {
    const normalized = {
      ...draft,
      organizer: draft.organizer || 'Organizátor eventu',
      performer: draft.performer || 'Bude oznámené'
    }
    const { error } = await manageRemoteEvent('insert', normalized, draft.id)
    if (error) throw error
  }

  localEventDrafts.splice(0)
  await loadEvents()
}

function wallFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: new Date(row.created_at).getTime()
  }
}

async function loadWallPosts() {
  if (!supabase) return
  const { data, error } = await supabase
    .from('nitra_wall_posts')
    .select('id, name, body, created_at')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) {
    console.error('[wall] Nepodarilo sa načítať nástenku zo Supabase:', error.message)
    return
  }

  state.wall = data.map(wallFromRow)
  try { save() } catch {}
  render()
}

async function syncLocalWallDrafts() {
  if (!supabase || !localWallDrafts.length) return
  const remoteIds = new Set(state.wall.map(item => item.id))
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const drafts = localWallDrafts.filter(item =>
    uuidPattern.test(item.id) &&
    !remoteIds.has(item.id) &&
    !legacyDemoWallIds.has(item.id)
  )

  for (const draft of drafts) {
    const createdAt = new Date(draft.createdAt)
    const { error } = await supabase.from('nitra_wall_posts').insert({
      id: draft.id,
      name: String(draft.name || '').trim().slice(0, 30),
      body: String(draft.body || '').trim().slice(0, 180),
      created_at: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString()
    })
    if (error && error.code !== '23505') throw error
  }

  localWallDrafts.splice(0)
  await loadWallPosts()
}

async function passwordHash(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function relativeTime(timestamp) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 60) return `pred ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `pred ${hours} h`
  return new Date(timestamp).toLocaleDateString('sk-SK')
}

function eventDate(value) {
  const date = new Date(value)
  const options = date.getHours() === 0 && date.getMinutes() === 0
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  return new Intl.DateTimeFormat('sk-SK', options).format(date)
}

function eventInputDate(value = '') {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function wallItems() {
  return state.wall.slice(0, 12).map(item => `
    <article class="wall-note">
      <span class="avatar">${escapeHtml(initials(item.name))}</span>
      <div><div class="note-meta"><strong>${escapeHtml(item.name)}</strong><div class="note-controls"><time>${relativeTime(item.createdAt)}</time>${state.adminAuthenticated ? `<button type="button" data-wall-delete="${escapeHtml(item.id)}" aria-label="Vymazať odkaz od ${escapeHtml(item.name)}">VYMAZAŤ</button>` : ''}</div></div><p>${escapeHtml(item.body)}</p></div>
    </article>
  `).join('')
}

function eventItems() {
  return state.events
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(item => {
      const organizer = item.organizer || 'Organizátor eventu'
      const performer = item.performer || 'Bude oznámené'
      const hasImage = typeof item.image === 'string' && item.image.startsWith('data:image/')
      const link = safeEventLink(item.link)
      const sourceLabel = eventSourceLabel(link)
      const media = hasImage ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">` : `<div class="event-placeholder"><small>NITRA SPACE EVENT</small><b>${new Date(item.date).getDate()}</b><span>${new Date(item.date).toLocaleDateString('sk-SK', { month: 'long' })}</span><strong>${escapeHtml(item.title)}</strong></div>`
      return `
        <article class="event-post">
          <header class="event-post-header"><span class="event-avatar">${escapeHtml(initials(organizer))}</span><div>${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(organizer)}</a>` : `<strong>${escapeHtml(organizer)}</strong>`}<small>${escapeHtml(item.place)}</small></div>${link ? `<a class="event-open" href="${escapeHtml(link)}" target="_blank" rel="noreferrer" aria-label="Otvoriť event">↗</a>` : '<span></span>'}</header>
          ${link ? `<a class="event-media event-media-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${media}</a>` : `<div class="event-media">${media}</div>`}
          <div class="event-caption"><p>${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.title)}</strong></a>` : `<strong>${escapeHtml(item.title)}</strong>`}</p><div class="event-details"><p><b>Dátum</b><span>${eventDate(item.date)}</span></p><p><b>Lokalita</b><span>${escapeHtml(item.place)}</span></p><p><b>Interpreti</b><span>${escapeHtml(performer)}</span></p>${link ? `<p><b>Zdroj</b><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel)} ↗</a></p>` : ''}</div></div>
          ${state.adminAuthenticated ? `<div class="event-admin-actions"><button type="button" data-event-edit="${escapeHtml(item.id)}">UPRAVIŤ</button><button type="button" data-event-delete="${escapeHtml(item.id)}">VYMAZAŤ</button></div>` : ''}
        </article>`
    }).join('')
}

function prepareEventImage(file) {
  if (!file || !file.size) return Promise.resolve('')
  if (file.type && !file.type.startsWith('image/')) return Promise.reject(new Error('Vyber obrázok vo formáte JPG, PNG, WEBP alebo HEIC.'))
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      const targetWidth = 600
      const targetHeight = 750
      const targetRatio = targetWidth / targetHeight
      const sourceRatio = image.width / image.height
      let sourceX = 0
      let sourceY = 0
      let sourceWidth = image.width
      let sourceHeight = image.height

      if (sourceRatio > targetRatio) {
        sourceWidth = image.height * targetRatio
        sourceX = (image.width - sourceWidth) / 2
      } else {
        sourceHeight = image.width / targetRatio
        sourceY = (image.height - sourceHeight) / 2
      }

      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      canvas.getContext('2d').drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('Fotku sa nepodarilo spracovať.'))
          return
        }
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Fotku sa nepodarilo načítať.'))
        reader.readAsDataURL(blob)
      }, 'image/jpeg', .7)
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Tento formát fotky prehliadač nepodporuje. Skús JPG alebo PNG.')) }
    image.src = url
  })
}

function boardSection() {
  return `
    <section class="section-view board-view" aria-label="Nástenka">
      <div class="quick-bubbles" aria-label="Rýchle odkazy">
        <a href="https://tellonym.me/nitraspace" target="_blank" rel="noreferrer"><span class="bubble-icon">?</span><strong>Tellonym</strong><small>Ak niekoho z mesta hľadáš, napíš</small></a>
        <a href="/chat"><span class="bubble-icon">•••</span><strong>Chat</strong><small>Ak sa chceš zoznámiť s niekým</small></a>
        <button type="button" data-section="future"><span class="bubble-icon">✦</span><strong>Čo chystáme</strong><small>Pozri si nové funkcie</small></button>
      </div>
      ${pollResultsCard()}
      <div class="feed-label"><div><strong>Odkazy z Nitry</strong><small>Čo práve píšu ľudia v meste</small></div><span>${state.wall.length}</span></div>
      <div class="wall-list" id="wallList">${wallItems()}</div>
      <button class="compose-fab" type="button" data-compose-open aria-label="Pridať nový odkaz">＋</button>
      ${state.composerOpen ? `
        <button class="compose-backdrop" type="button" data-compose-close aria-label="Zavrieť formulár"></button>
        <section class="compose-sheet" aria-label="Nový odkaz">
          <div class="compose-heading"><div><span class="eyebrow">NÁSTENKA</span><h2>Pridaj odkaz</h2></div><button type="button" data-compose-close aria-label="Zavrieť">×</button></div>
          <form class="wall-form" id="wallForm">
            <label><span>Tvoje meno</span><input name="name" maxlength="30" placeholder="Ako sa voláš?" required autofocus></label>
            <label><span>Odkaz</span><textarea name="body" maxlength="180" placeholder="Čo chceš odkázať Nitre?" required></textarea></label>
            <div class="form-footer"><small><b id="charCount">0</b>/180</small><button type="submit">ZVEREJNIŤ</button></div>
          </form>
        </section>` : ''}
    </section>`
}

function analyticsPanel() {
  if (!state.adminAuthenticated || !state.analyticsOpen) return ''
  const labels = {
    tellonym: 'Tellonym', chat: 'Náhodný chat', section_board: 'Nástenka',
    section_events: 'Eventy', section_future: 'Čo chystáme', wall_compose: 'Pridanie odkazu',
    event_link: 'Otvorenie eventu', poll_vote: 'Hlasovanie v ankete'
  }
  const clicks = Array.isArray(state.analytics?.clicks) ? state.analytics.clicks : []
  return `
    <section class="analytics-panel" aria-labelledby="analyticsTitle">
      <div class="analytics-head"><div><span>IBA PRE ADMINA</span><h2 id="analyticsTitle">Štatistiky webu</h2></div><button type="button" data-analytics-refresh>OBNOVIŤ</button></div>
      <form class="analytics-date" id="analyticsDateForm"><label>Deň<input type="date" name="day" value="${escapeHtml(state.analyticsDate)}" max="${localDateKey()}"></label><button type="submit">ZOBRAZIŤ</button></form>
      ${state.analyticsLoading ? '<p class="analytics-status">Načítavam štatistiky…</p>' : `
        <div class="analytics-cards">
          <article><strong>${Number(state.analytics?.unique_visitors || 0)}</strong><span>ľudí za deň</span></article>
          <article><strong>${Number(state.analytics?.pageviews || 0)}</strong><span>otvorení stránky</span></article>
          <article class="online"><strong id="analyticsOnlineCount">${state.onlineCount}</strong><span>práve online</span></article>
        </div>
        <div class="analytics-clicks"><h3>Na čo klikali</h3>${clicks.length ? clicks.map(item => `<div><span>${escapeHtml(labels[item.target] || item.target)}</span><strong>${Number(item.clicks || 0)}</strong></div>`).join('') : '<p>Zatiaľ bez kliknutí v tento deň.</p>'}</div>
      `}
      ${state.analyticsError ? `<p class="admin-error">${escapeHtml(state.analyticsError)}</p>` : ''}
      <small>Počítanie je anonymné. Neukladá IP adresy, mená ani e-maily.</small>
    </section>`
}

function pollHistoryPanel() {
  if (!state.adminAuthenticated || !state.pollAdminOpen) return ''
  if (state.pollHistoryLoading) return '<section class="poll-history"><p>Načítavam ankety…</p></section>'
  return `<section class="poll-history" aria-labelledby="pollHistoryTitle">
    <div class="poll-history-head"><div><span>ADMIN</span><h3 id="pollHistoryTitle">Ankety</h3></div><button type="button" data-poll-history-refresh>OBNOVIŤ</button></div>
    ${state.pollHistoryError ? `<p class="admin-error">${escapeHtml(state.pollHistoryError)}</p>` : ''}
    ${state.pollHistory.length ? state.pollHistory.map(poll => {
      const total = Number(poll.total_votes || 0)
      const options = Array.isArray(poll.options) ? poll.options : []
      return `<article class="poll-history-item ${poll.active ? 'active' : ''}">
        <div class="poll-history-title"><div>${poll.active ? '<span>PRÁVE PREBIEHA</span>' : '<span>UKONČENÁ</span>'}<strong>${escapeHtml(poll.question)}</strong><small>${new Date(poll.created_at).toLocaleDateString('sk-SK')} · ${total} hlasov</small></div><button type="button" data-poll-delete="${escapeHtml(poll.id)}">VYMAZAŤ</button></div>
        <div class="poll-history-options">${options.map(option => `<span><b>${escapeHtml(option.label)}</b><strong>${Number(option.votes || 0)}</strong></span>`).join('')}</div>
      </article>`
    }).join('') : '<p>Zatiaľ neexistuje žiadna anketa.</p>'}
  </section>`
}

function eventsSection() {
  const editingEvent = state.events.find(item => item.id === state.editingEventId)
  const adminButtonText = state.adminOpen
    ? 'ZAVRIEŤ FORMULÁR'
    : state.adminGateOpen
      ? 'ZAVRIEŤ'
      : state.adminAuthenticated
        ? '＋ NOVÝ EVENT'
        : '＋ PRIDAŤ EVENT AKO ADMIN'
  return `
    <section class="section-view events-view" aria-labelledby="eventsTitle">
      <div class="event-titlebar"><span class="event-title-icon">◇</span><div><h1 id="eventsTitle">Eventy v Nitre</h1><p>Koncerty, stretnutia a dianie v meste.</p></div></div>
      ${state.adminAuthenticated ? `<div class="admin-mode"><span><i></i> Admin režim aktívny</span><button type="button" data-admin-lock>ZAMKNÚŤ</button></div>` : ''}
      <div class="event-list" id="eventList">${eventItems()}</div>
      <div class="admin-create-actions"><button class="admin-toggle" data-admin-toggle>${adminButtonText}</button>${state.adminAuthenticated ? `<button class="poll-admin-toggle" type="button" data-poll-admin-toggle>${state.pollAdminOpen ? 'ZAVRIEŤ ANKETU' : '＋ NOVÁ ANKETA'}</button><button class="analytics-admin-toggle" type="button" data-analytics-toggle>${state.analyticsOpen ? 'ZAVRIEŤ ŠTATISTIKY' : 'ŠTATISTIKY'}</button>` : ''}</div>
      ${state.adminGateOpen ? `
        <form class="admin-access" id="adminAccessForm">
          <span class="admin-lock">⌁</span>
          <div><h2>Admin prístup</h2><p>Pre vytvorenie eventu zadaj heslo.</p></div>
          <label>Heslo<input name="password" type="password" autocomplete="current-password" placeholder="Zadaj admin heslo" required autofocus></label>
          ${state.adminError ? `<p class="admin-error">${escapeHtml(state.adminError)}</p>` : ''}
          <button type="submit">POKRAČOVAŤ</button>
        </form>` : ''}
      ${state.adminOpen ? `
        <form class="admin-form" id="eventForm">
          <div class="admin-label"><span>ADMIN</span><small>${editingEvent ? 'Úprava eventu' : 'Nový event'}</small></div>
          <label>Názov organizácie<input name="organizer" maxlength="80" value="${escapeHtml(editingEvent?.organizer || '')}" placeholder="Napr. Nitra Space, klub alebo organizátor" required></label>
          <label>Názov eventu<input name="title" maxlength="70" value="${escapeHtml(editingEvent?.title || '')}" required></label>
          <label>Interpreti / kto hrá alebo vystupuje<input name="performer" maxlength="120" value="${escapeHtml(editingEvent?.performer || '')}" placeholder="Napr. DJ Miro, kapela, moderátor..." required></label>
          <div class="split"><label>Dátum a čas<input name="date" type="datetime-local" value="${escapeHtml(eventInputDate(editingEvent?.date || ''))}" required></label><label>Miesto<input name="place" maxlength="80" value="${escapeHtml(editingEvent?.place || '')}" required></label></div>
          <label>Link na event<input name="link" type="url" value="${escapeHtml(editingEvent?.link || '')}" placeholder="https://..." required></label>
          <label class="image-upload"><span>Fotka eventu · pomer 4:5</span><div class="image-upload-preview" id="eventImagePreview">${editingEvent?.image ? `<img src="${escapeHtml(editingEvent.image)}" alt="Aktuálna fotka eventu"><small>Aktuálna fotka · výberom súboru ju nahradíš</small>` : '<strong>4:5</strong><small>Vyber fotografiu alebo plagát</small>'}</div><input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"><small class="selected-file" id="selectedEventFile">${editingEvent?.image ? 'Ak nevyberieš novú fotku, pôvodná zostane.' : 'JPG, PNG, WEBP alebo HEIC'}</small></label>
          <button type="submit">${editingEvent ? 'ULOŽIŤ ZMENY' : 'ZVEREJNIŤ EVENT'}</button>
        </form>` : ''}
      ${state.adminAuthenticated && state.pollAdminOpen ? `
        <form class="admin-form poll-admin-form" id="pollAdminForm">
          <div class="admin-label"><span>ADMIN</span><small>Nová anketa</small></div>
          <label>Otázka<input name="question" maxlength="180" placeholder="Na čo sa chceš ľudí opýtať?" required></label>
          <label>Odpoveď 1<input name="option1" maxlength="80" required></label>
          <label>Odpoveď 2<input name="option2" maxlength="80" required></label>
          <label>Odpoveď 3 · voliteľná<input name="option3" maxlength="80"></label>
          <label>Odpoveď 4 · voliteľná<input name="option4" maxlength="80"></label>
          <small>Po zverejnení sa predchádzajúca anketa automaticky ukončí.</small>
          <button type="submit">ZVEREJNIŤ ANKETU</button>
        </form>` : ''}
      ${pollHistoryPanel()}
      ${analyticsPanel()}
    </section>`
}

function futureSection() {
  return `
    <section class="section-view future-view" aria-labelledby="futureTitle">
      <div class="section-heading"><span class="eyebrow">PRIPRAVUJEME</span><h1 id="futureTitle">Čo chystáme</h1><p>Nitra Space Social — lokálna sociálna sieť pre skutočné spojenia.</p></div>
      <div class="product-preview">
        <div class="preview-top"><strong>Nitra Space</strong><span><i></i> 124 online</span></div>
        <div class="notes-preview"><div><b>L</b><span>Kto ide von?</span></div><div><b>N</b><span>Coffee?</span></div><div><b>S</b><span>Som v centre</span></div></div>
        <div class="matching-demo">
          <div class="matching-label"><span>MATCHING</span><small>2 km od teba</small></div>
          <div class="matching-photo"><span>N</span><div><strong>Nina, 21</strong><small>Centrum Nitry</small></div></div>
          <div class="matching-info"><p>Hudba, káva a večerné prechádzky mestom.</p><div><span>Hudba</span><span>Coffee</span><span>Fotografia</span></div></div>
          <div class="matching-actions"><button type="button" aria-label="Preskočiť">×</button><button type="button" aria-label="Spoznať">♡</button></div>
        </div>
        <div class="preview-nav"><span>⌂</span><span>⌕</span><span>♡</span><span>▱</span><span>○</span></div>
      </div>
      <div class="feature-list"><span>Profily</span><span>Ľudia v okolí</span><span>Matching</span><span>Súkromné správy</span><span>Poznámky</span><span>Eventy</span></div>
      <div class="roadmap"><div><span>Aktuálne tvoríme prvú verziu</span><b>72%</b></div><progress value="72" max="100">72%</progress><small>Čistý dizajn, súkromie a funkcie pre ľudí z Nitry.</small></div>
    </section>`
}

function render() {
  document.documentElement.dataset.theme = state.theme
  document.documentElement.style.colorScheme = state.theme
  const sections = { board: boardSection, events: eventsSection, future: futureSection }
  app.innerHTML = `
    ${state.introVisible ? `<div class="intro-splash" role="status" aria-label="Načítava sa Nitra Space"><div class="intro-logo-stage"><img class="intro-logo-base" src="${introLogo}" alt="Nitra Space"><img class="intro-logo-fragment fragment-left" src="${introLogo}" alt="" aria-hidden="true"><img class="intro-logo-fragment fragment-right" src="${introLogo}" alt="" aria-hidden="true"></div></div>` : ''}
    <header class="site-header">
      <strong class="brand">Nitra Space</strong>
      <div class="header-side"><button class="theme-button" data-theme-toggle aria-label="Prepnúť farebný režim">${state.theme === 'dark' ? '☀' : '☾'}</button></div>
    </header>
    <main class="app-content">${sections[state.activeSection]()}</main>
    <nav class="bottom-nav" aria-label="Hlavné sekcie">
      <button class="${state.activeSection === 'board' ? 'active' : ''}" data-section="board" aria-label="Nástenka"><span class="nav-icon">⌂</span><small>Nástenka</small></button>
      <button class="${state.activeSection === 'events' ? 'active' : ''}" data-section="events" aria-label="Eventy"><span class="nav-icon">◇</span><small>Eventy</small></button>
      <button class="${state.activeSection === 'future' ? 'active' : ''}" data-section="future" aria-label="Čo chystáme"><span class="nav-icon">◎</span><small>Čo chystáme</small></button>
    </nav>
    ${pollModal()}
  `
  bind()
  if (state.introVisible && !introTimerStarted) {
    introTimerStarted = true
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 550 : 2750
    window.setTimeout(() => {
      state.introVisible = false
      document.querySelector('.intro-splash')?.remove()
    }, duration)
  }
}

function setupScrollAnimations() {
  scrollObserver?.disconnect()
  const elements = document.querySelectorAll('.wall-note, .event-post, .product-preview, .feature-list, .roadmap')
  if (!('IntersectionObserver' in window)) {
    elements.forEach(element => element.classList.add('is-visible'))
    return
  }
  scrollObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      scrollObserver.unobserve(entry.target)
    })
  }, { threshold: .12, rootMargin: '0px 0px -35px' })
  elements.forEach((element, index) => {
    element.classList.add('scroll-reveal')
    element.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * 55}ms`)
    scrollObserver.observe(element)
  })
}

function bind() {
  document.querySelectorAll('[data-poll-close]').forEach(button => button.addEventListener('click', () => {
    if (state.poll?.id) sessionStorage.setItem(`nitra-space-poll-seen:${state.poll.id}`, '1')
    state.pollOpen = false
    render()
  }))

  document.querySelectorAll('[data-poll-option]').forEach(button => button.addEventListener('click', () => {
    if (state.poll?.selected_option) return
    state.pollChoice = button.dataset.pollOption
    state.pollError = ''
    document.querySelectorAll('[data-poll-option]').forEach(option => option.classList.toggle('selected', option === button))
    const submitButton = document.querySelector('[data-poll-submit]')
    if (submitButton) submitButton.disabled = false
    const errorMessage = document.querySelector('.poll-error')
    if (errorMessage) {
      errorMessage.textContent = ''
      errorMessage.hidden = true
    }
  }))

  document.querySelector('[data-poll-submit]')?.addEventListener('click', async () => {
    if (!supabase || !state.poll?.id || !state.pollChoice || state.pollSubmitting) return
    const submitButton = document.querySelector('[data-poll-submit]')
    state.pollSubmitting = true
    state.pollError = ''
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = 'ODOSIELAM…'
    }
    const { data, error } = await supabase.rpc('vote_nitra_poll', {
      p_poll_id: state.poll.id,
      p_option_id: state.pollChoice,
      p_voter_id: pollVoterId()
    })
    state.pollSubmitting = false
    if (error || !data?.id) {
      state.pollError = 'Hlas sa nepodarilo odoslať. Skús to znova.'
      console.error('[poll] Hlasovanie zlyhalo:', error?.message || 'Supabase nevrátil výsledok ankety.')
      const errorMessage = document.querySelector('.poll-error')
      if (errorMessage) {
        errorMessage.textContent = state.pollError
        errorMessage.hidden = false
      }
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = 'HLASOVAŤ'
      }
    } else {
      state.poll = data
      state.pollChoice = data?.selected_option || state.pollChoice
      sessionStorage.setItem(`nitra-space-poll-seen:${state.poll.id}`, '1')
      state.pollOpen = false
      document.querySelector('.poll-modal')?.classList.add('closing')
      document.querySelector('.poll-backdrop')?.classList.add('closing')
      window.setTimeout(render, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160)
    }
  })

  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => {
    state.activeSection = button.dataset.section
    history.replaceState(null, '', `#${state.activeSection}`)
    state.adminOpen = false
    state.adminGateOpen = false
    state.adminError = ''
    state.editingEventId = null
    state.composerOpen = false
    state.pollAdminOpen = false
    window.scrollTo({ top: 0, behavior: 'auto' })
    render()
  }))

  document.querySelector('[data-compose-open]')?.addEventListener('click', () => {
    state.composerOpen = true
    render()
  })

  document.querySelectorAll('[data-compose-close]').forEach(button => button.addEventListener('click', () => {
    state.composerOpen = false
    render()
  }))

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('nitra-space-redesign-theme', state.theme)
    render()
  })

  const wallBody = document.querySelector('#wallForm textarea')
  wallBody?.addEventListener('input', () => { document.querySelector('#charCount').textContent = wallBody.value.length })
  document.querySelector('#wallForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const body = String(form.get('body') || '').trim()
    if (!name || !body) return

    if (supabase) {
      const { data, error } = await supabase
        .from('nitra_wall_posts')
        .insert({ name, body })
        .select('id, name, body, created_at')
        .single()
      if (error) {
        alert(error.message || 'Odkaz sa nepodarilo zverejniť.')
        return
      }
      state.wall.unshift(wallFromRow(data))
    } else {
      state.wall.unshift({ id: crypto.randomUUID(), name, body, createdAt: Date.now() })
    }

    state.wall = state.wall.slice(0, 30)
    state.composerOpen = false
    save()
    render()
    document.querySelector('#wallList')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })

  document.querySelectorAll('[data-wall-delete]').forEach(button => button.addEventListener('click', async () => {
    if (!state.adminAuthenticated) return
    const item = state.wall.find(wallItem => wallItem.id === button.dataset.wallDelete)
    if (!item || !confirm(`Naozaj chceš vymazať odkaz od „${item.name}“?`)) return

    if (supabase) {
      const { error } = await supabase.rpc('delete_nitra_wall_post', {
        p_password: state.adminPassword,
        p_post_id: item.id
      })
      if (error) {
        alert(error.message || 'Odkaz sa nepodarilo vymazať.')
        return
      }
    }

    state.wall = state.wall.filter(wallItem => wallItem.id !== item.id)
    save()
    render()
  }))

  const eventImageInput = document.querySelector('#eventForm input[name="image"]')
  eventImageInput?.addEventListener('change', () => {
    const file = eventImageInput.files?.[0]
    const fileLabel = document.querySelector('#selectedEventFile')
    const preview = document.querySelector('#eventImagePreview')
    if (!file || !preview) return
    if (file.type && !file.type.startsWith('image/')) {
      eventImageInput.value = ''
      if (fileLabel) fileLabel.textContent = 'Vyber obrázok vo formáte JPG, PNG, WEBP alebo HEIC.'
      return
    }

    const previewUrl = URL.createObjectURL(file)
    preview.innerHTML = `<img src="${previewUrl}" alt="Náhľad vybratej fotky"><small>Náhľad vybratej fotky · automaticky sa oreže na 4:5</small>`
    preview.querySelector('img')?.addEventListener('load', () => URL.revokeObjectURL(previewUrl), { once: true })
    if (fileLabel) fileLabel.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} kB`
  })

  document.querySelector('[data-analytics-toggle]')?.addEventListener('click', () => {
    state.analyticsOpen = !state.analyticsOpen
    state.adminOpen = false
    state.pollAdminOpen = false
    state.editingEventId = null
    if (state.analyticsOpen) loadAdminAnalytics()
    else render()
  })

  document.querySelector('#analyticsDateForm')?.addEventListener('submit', event => {
    event.preventDefault()
    state.analyticsDate = String(new FormData(event.currentTarget).get('day') || localDateKey())
    loadAdminAnalytics(state.analyticsDate)
  })

  document.querySelector('[data-analytics-refresh]')?.addEventListener('click', () => loadAdminAnalytics())

  document.querySelector('[data-poll-admin-toggle]')?.addEventListener('click', () => {
    state.pollAdminOpen = !state.pollAdminOpen
    state.analyticsOpen = false
    state.adminOpen = false
    state.editingEventId = null
    if (state.pollAdminOpen) loadPollHistory()
    else render()
  })

  document.querySelector('[data-poll-history-refresh]')?.addEventListener('click', () => loadPollHistory())

  document.querySelectorAll('[data-poll-delete]').forEach(button => button.addEventListener('click', async () => {
    if (!supabase || !state.adminAuthenticated) return
    const pollId = button.dataset.pollDelete
    if (!confirm('Naozaj chceš túto anketu aj s hlasmi vymazať?')) return
    button.disabled = true
    const { data, error } = await supabase.rpc('manage_nitra_poll_history', {
      p_password: state.adminPassword, p_action: 'delete', p_poll_id: pollId
    })
    if (error) {
      alert(error.message || 'Anketu sa nepodarilo vymazať.')
      button.disabled = false
      return
    }
    state.pollHistory = Array.isArray(data) ? data : []
    if (state.poll?.id === pollId) {
      state.poll = null
      state.pollOpen = false
      state.pollChoice = ''
    }
    render()
  }))

  document.querySelector('#pollAdminForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!supabase || !state.adminAuthenticated) return
    const submitButton = event.currentTarget.querySelector('button[type="submit"]')
    const form = new FormData(event.currentTarget)
    const question = String(form.get('question') || '').trim()
    const options = ['option1', 'option2', 'option3', 'option4']
      .map(name => String(form.get(name) || '').trim())
      .filter(Boolean)
    if (!question || options.length < 2) return
    submitButton.disabled = true
    submitButton.textContent = 'ZVEREJŇUJEM…'
    const { data, error } = await supabase.rpc('manage_nitra_poll', {
      p_password: state.adminPassword,
      p_question: question,
      p_options: options
    })
    if (error) {
      alert(error.message || 'Anketu sa nepodarilo vytvoriť.')
      submitButton.disabled = false
      submitButton.textContent = 'ZVEREJNIŤ ANKETU'
      return
    }
    state.poll = data
    state.pollChoice = ''
    state.pollOpen = false
    state.pollAdminOpen = true
    sessionStorage.removeItem(`nitra-space-poll-seen:${data.id}`)
    loadPollHistory()
  })

  document.querySelector('[data-admin-toggle]')?.addEventListener('click', () => {
    if (state.adminOpen || state.adminGateOpen) {
      state.adminOpen = false
      state.adminGateOpen = false
      state.editingEventId = null
    } else if (state.adminAuthenticated) {
      state.adminOpen = true
      state.editingEventId = null
    } else {
      state.adminGateOpen = true
    }
    state.adminError = ''
    render()
    document.querySelector('#adminAccessForm, #eventForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  document.querySelector('#adminAccessForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') || '')
    const hash = await passwordHash(password)
    if (hash !== ADMIN_PASSWORD_HASH) {
      state.adminError = 'Nesprávne heslo.'
      render()
      return
    }
    state.adminGateOpen = false
    state.adminError = ''
    state.adminAuthenticated = true
    state.adminPassword = password
    state.adminOpen = true
    try {
      await syncLocalEventDrafts()
    } catch (error) {
      console.error('[events] Prenos lokálnych eventov zlyhal:', error.message)
      state.adminError = 'Lokálne eventy sa nepodarilo synchronizovať. Skús to znova.'
    }
    render()
    document.querySelector('#eventForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  document.querySelector('[data-admin-lock]')?.addEventListener('click', () => {
    state.adminAuthenticated = false
    state.adminPassword = ''
    state.adminOpen = false
    state.pollAdminOpen = false
    state.pollHistory = []
    state.analyticsOpen = false
    state.analytics = null
    state.adminGateOpen = false
    state.editingEventId = null
    render()
  })

  document.querySelectorAll('[data-event-edit]').forEach(button => button.addEventListener('click', () => {
    state.editingEventId = button.dataset.eventEdit
    state.adminOpen = true
    render()
    document.querySelector('#eventForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }))

  document.querySelectorAll('[data-event-delete]').forEach(button => button.addEventListener('click', async () => {
    const item = state.events.find(eventItem => eventItem.id === button.dataset.eventDelete)
    if (!item || !confirm(`Naozaj chceš vymazať event „${item.title}“?`)) return

    if (supabase) {
      const { error } = await manageRemoteEvent('delete', {}, item.id)
      if (error) {
        alert(error.message || 'Event sa nepodarilo vymazať.')
        return
      }
    }

    state.events = state.events.filter(eventItem => eventItem.id !== item.id)
    state.editingEventId = null
    save()
    render()
  }))

  document.querySelector('#eventForm')?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const submitButton = event.currentTarget.querySelector('button[type="submit"]')
    submitButton.disabled = true
    submitButton.textContent = 'SPRACÚVAM FOTKU…'
    let image = ''
    try {
      image = await prepareEventImage(form.get('image'))
    } catch (error) {
      console.error('[events] Spracovanie fotky zlyhalo:', error)
      alert(error.message)
      submitButton.disabled = false
      submitButton.textContent = 'ZVEREJNIŤ EVENT'
      return
    }
    const existingEvent = state.events.find(item => item.id === state.editingEventId)
    const eventData = {
      id: crypto.randomUUID(),
      organizer: String(form.get('organizer') || '').trim(),
      title: String(form.get('title') || '').trim(),
      performer: String(form.get('performer') || '').trim(),
      date: String(form.get('date') || ''),
      place: String(form.get('place') || '').trim(),
      link: safeEventLink(form.get('link')),
      image: image || existingEvent?.image || ''
    }

    if (supabase) {
      const action = existingEvent ? 'update' : 'insert'
      const eventId = existingEvent?.id || null
      const { data, error } = await manageRemoteEvent(action, eventData, eventId)
      if (error) {
        console.error('[events] Uloženie eventu do Supabase zlyhalo:', error)
        alert(error.message || 'Event sa nepodarilo uložiť.')
        submitButton.disabled = false
        submitButton.textContent = existingEvent ? 'ULOŽIŤ ZMENY' : 'ZVEREJNIŤ EVENT'
        return
      }

      const savedEvent = eventFromRow(data)
      state.events = existingEvent
        ? state.events.map(item => item.id === existingEvent.id ? savedEvent : item)
        : [...state.events, savedEvent]
      try { save() } catch {}
      state.adminOpen = false
      state.editingEventId = null
      render()
      return
    }

    const previousEvents = state.events.slice()
    if (existingEvent) {
      state.events = state.events.map(item => item.id === existingEvent.id ? { ...eventData, id: existingEvent.id } : item)
    } else {
      state.events.push(eventData)
    }
    try {
      save()
    } catch {
      state.events = previousEvents
      alert('Fotku sa nepodarilo uložiť. Skús menší JPG alebo PNG obrázok.')
      submitButton.disabled = false
      submitButton.textContent = existingEvent ? 'ULOŽIŤ ZMENY' : 'ZVEREJNIŤ EVENT'
      return
    }
    state.adminOpen = false
    state.editingEventId = null
    render()
  })

  setupScrollAnimations()
}

render()
recordAnalytics('pageview')
startOnlinePresence()
document.addEventListener('click', event => {
  const target = event.target.closest('a, button')
  if (!target) return
  let analyticsTarget = ''
  if (target.matches('a[href*="tellonym.me/nitraspace"]')) analyticsTarget = 'tellonym'
  else if (target.matches('a[href="/chat"]')) analyticsTarget = 'chat'
  else if (target.dataset.section) analyticsTarget = `section_${target.dataset.section}`
  else if (target.matches('[data-compose-open]')) analyticsTarget = 'wall_compose'
  else if (target.matches('.event-media-link, .event-open') || target.closest('.event-caption')) analyticsTarget = 'event_link'
  else if (target.matches('[data-poll-submit]')) analyticsTarget = 'poll_vote'
  if (analyticsTarget) recordAnalytics('click', analyticsTarget)
}, { capture: true })
Promise.all([loadEvents(), loadWallPosts(), loadPoll()])
  .then(syncLocalWallDrafts)
  .catch(error => console.error('[wall] Prenos lokálnych odkazov zlyhal:', error.message))
window.addEventListener('focus', () => {
  loadEvents()
  loadWallPosts()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadEvents()
    loadWallPosts()
  }
})

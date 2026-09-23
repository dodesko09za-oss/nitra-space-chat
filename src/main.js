import { createClient } from '@supabase/supabase-js'
import './style.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  document.querySelector('#app').innerHTML = `
    <main class="fatal">
      <section class="fatal-card">
        <h1>Nitra Space Chat</h1>
        <p>Chýbajú premenné VITE_SUPABASE_URL alebo VITE_SUPABASE_ANON_KEY.</p>
        <p>Skontroluj súbor <code>.env</code> a reštartuj Vite.</p>
      </section>
    </main>`
  throw new Error('Missing Supabase environment variables.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } }
})

const sessionKey = 'nitra-space-chat-session'
let sessionId = sessionStorage.getItem(sessionKey)
if (!sessionId) {
  sessionId = crypto.randomUUID()
  sessionStorage.setItem(sessionKey, sessionId)
}

let roomId = null
let channel = null
let state = 'home'
let isStopping = false
let partnerPresent = false
let messages = []
let onlineCount = 1
let onlineChannel = null
let partnerTyping = false
let localTypingSent = false
let typingStopTimer = null
let partnerTypingTimer = null
let lastTypingBroadcastAt = 0

const typingIdleDelay = 1200
const typingHeartbeatDelay = 800
const partnerTypingFallbackDelay = 2200

const app = document.querySelector('#app')
const themeKey = 'nitra-space-chat-theme'
const requestedReturnPath = new URLSearchParams(window.location.search).get('return')
const returnPath = requestedReturnPath?.startsWith('/') && !requestedReturnPath.startsWith('//')
  ? requestedReturnPath
  : null
let viewportFrame = null
let viewportScrollTimer = null

function scheduleScrollToBottom() {
  if (state === 'home') return
  if (viewportFrame) cancelAnimationFrame(viewportFrame)

  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null
    scrollMessages()
    clearTimeout(viewportScrollTimer)
    viewportScrollTimer = setTimeout(scrollMessages, 150)
  })
}

function updateVisualViewport() {
  const viewport = window.visualViewport
  const viewportHeight = viewport?.height || window.innerHeight
  const viewportTop = viewport?.offsetTop || 0

  document.documentElement.style.setProperty('--visual-height', `${Math.round(viewportHeight)}px`)
  document.documentElement.style.setProperty('--visual-top', `${Math.round(viewportTop)}px`)

  if (document.activeElement?.id === 'message') scheduleScrollToBottom()
}

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(themeKey)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'dark' ? '#0a0a0a' : '#f7f7f8'
  )
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem(themeKey, nextTheme)
  applyTheme(nextTheme)
  updateThemeButtons()
}

function updateThemeButtons() {
  const isDark = document.documentElement.dataset.theme === 'dark'
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', isDark ? 'Zapnúť svetlý režim' : 'Zapnúť tmavý režim')
    button.setAttribute('title', isDark ? 'Svetlý režim' : 'Tmavý režim')
    button.innerHTML = isDark
      ? '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.8 15.1A9 9 0 1 1 8.9 3.2a7 7 0 0 0 11.9 11.9Z"></path></svg>'
  })
}

function bindThemeButtons() {
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', toggleTheme)
  })
  updateThemeButtons()
}


function updateOnlineBadge() {
  const el = document.querySelector('#onlineCount')
  if (el) el.textContent = String(onlineCount)
}

async function setupOnlinePresence() {
  onlineChannel = supabase.channel('nitra-space-online', {
    config: {
      presence: { key: sessionId }
    }
  })

  onlineChannel.on('presence', { event: 'sync' }, () => {
    const presence = onlineChannel.presenceState()
    onlineCount = Object.keys(presence).length
    updateOnlineBadge()
  })

  onlineChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      try {
        await onlineChannel.track({ session_id: sessionId, online_at: new Date().toISOString() })
      } catch (error) {
        console.warn('Online presence tracking failed:', error)
      }
    }
  })
}

function render() {
  const chatActive = state !== 'home'
  document.documentElement.classList.toggle('chat-active', chatActive)
  document.body.classList.toggle('chat-active', chatActive)
  if (state === 'home') renderHome()
  else renderChat()
}

function renderHome() {
  app.innerHTML = `
    <main class="home-shell">
      <header class="site-header">
        <strong class="site-name">Nitra Space Chat</strong>
        <div class="site-actions">
          <div class="online-badge" aria-live="polite">
            <span class="online-dot" aria-hidden="true"></span>
            <span><strong id="onlineCount">${onlineCount}</strong> online</span>
          </div>
          <button class="theme-toggle" type="button" data-theme-toggle></button>
        </div>
      </header>

      <section class="home-card">
        <h1>Porozprávaj sa<br class="desktop-break"> s niekým novým.</h1>
        <p class="home-lead">Anonymný textový chat. Bez účtu, bez histórie správ.</p>

        <button id="openTerms" class="start-btn" type="button">START CHAT</button>
      </section>

      <div id="termsModal" class="modal-backdrop" hidden>
        <section class="terms-sheet" role="dialog" aria-modal="true" aria-labelledby="termsTitle">
          <div class="sheet-handle" aria-hidden="true"></div>
          <header class="terms-header">
            <div>
              <span class="eyebrow">PRED VSTUPOM</span>
              <h2 id="termsTitle">Pravidlá Nitra Space Chat</h2>
            </div>
            <button id="closeTerms" class="icon-btn" type="button" aria-label="Zavrieť">×</button>
          </header>

          <div class="terms-scroll">
            <div class="terms-intro">
              <span class="shield-icon" aria-hidden="true">✓</span>
              <p>Chat je anonymný a spája ťa s náhodným človekom. Používaj ho slušne a nezdieľaj citlivé údaje.</p>
            </div>

            <section class="terms-section">
              <h3>Základné pravidlá</h3>
              <ol>
                <li>Musíš mať aspoň <strong>16 rokov</strong>.</li>
                <li>Zakázané sú vyhrážky, obťažovanie, nenávistný alebo násilný obsah a nabádanie k nezákonnej činnosti.</li>
                <li>Nezdieľaj heslá, platobné údaje, presnú adresu ani iné citlivé osobné údaje.</li>
                <li>Zakázaný je sexuálny obsah, najmä obsah zahŕňajúci osoby mladšie ako 18 rokov.</li>
                <li>Zakázané sú podvody, spam, vydávanie sa za inú osobu a úmyselné zneužívanie služby.</li>
                <li>Ak sa cítiš nepríjemne alebo ohrozene, chat okamžite ukonči.</li>
              </ol>
            </section>

            <section class="terms-section">
              <h3>Súkromie a správy</h3>
              <p>Obsah textových správ sa v aplikácii neukladá do databázy a po skončení chatu nie je dostupná história správ. Na prevádzku služby sa však môžu spracúvať nevyhnutné technické údaje poskytovateľmi infraštruktúry, napríklad Supabase alebo Vercel.</p>
            </section>

            <section class="terms-section">
              <h3>Zodpovednosť</h3>
              <p>Každý používateľ zodpovedá za obsah, ktorý odošle. Nitra Space môže pri porušovaní pravidiel obmedziť prístup k službe. Služba negarantuje identitu, vek ani správanie osoby na druhej strane.</p>
            </section>

            <p class="legal-note">Tieto pravidlá sú prevádzkové pravidlá služby, nie náhrada individuálneho právneho poradenstva.</p>
          </div>

          <footer class="terms-footer">
            <label class="consent-row" for="termsConsent">
              <input id="termsConsent" type="checkbox">
              <span>Mám aspoň 16 rokov a súhlasím s pravidlami používania a spracovaním údajov potrebným na prevádzku služby.</span>
            </label>
            <button id="acceptAndStart" class="start-btn" type="button" disabled>POKRAČOVAŤ DO CHATU</button>
          </footer>
        </section>
      </div>
    </main>`

  const modal = document.querySelector('#termsModal')
  const consent = document.querySelector('#termsConsent')
  const accept = document.querySelector('#acceptAndStart')
  bindThemeButtons()

  const openModal = () => {
    modal.hidden = false
    document.body.classList.add('modal-open')
    setTimeout(() => consent?.focus(), 0)
  }

  const closeModal = () => {
    modal.hidden = true
    document.body.classList.remove('modal-open')
  }

  document.querySelector('#openTerms').addEventListener('click', openModal)
  document.querySelector('#closeTerms').addEventListener('click', closeModal)
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal()
  })
  consent.addEventListener('change', () => {
    accept.disabled = !consent.checked
  })
  accept.addEventListener('click', async () => {
    if (!consent.checked) return
    closeModal()
    await startChat()
  })
}

function renderChat() {
  const statusText = state === 'searching'
    ? 'Čakám na človeka...'
    : state === 'connected'
      ? 'Pripojený'
      : 'Cudzí človek odišiel.'

  app.innerHTML = `
    <main class="chat-page">
      <header class="chat-header">
        <button id="brandHome" class="brand-home" type="button" aria-label="Späť na úvod">
          <strong>Nitra Space Chat</strong>
        </button>
        <div class="header-right">
          <span class="online-badge online-badge-header" aria-live="polite">
            <span class="online-dot" aria-hidden="true"></span>
            <span><strong id="onlineCount">${onlineCount}</strong> online</span>
          </span>
          <button class="theme-toggle" type="button" data-theme-toggle></button>
        </div>
      </header>

      <section class="chat-window" aria-label="Anonymný chat">
        <div class="status-row ${state}">
          <span class="status-dot" aria-hidden="true"></span>
          <span>${statusText}</span>
        </div>

        <div id="messages" class="transcript ${messages.length || partnerTyping ? '' : 'is-empty'}" aria-live="polite">
          ${transcriptTemplate()}
        </div>

        <div class="controls">
          <button id="next" class="next-btn" type="button">NEXT</button>

          <form id="composer" class="composer">
            <label class="sr-only" for="message">Správa</label>
            <textarea
              id="message"
              maxlength="1000"
              rows="1"
              autocomplete="off"
              placeholder="${state === 'connected' ? 'Napíš správu...' : 'Počkaj na pripojenie...'}"
              ${state === 'connected' ? '' : 'disabled'}
            ></textarea>
            <button class="send-btn" type="submit" ${state === 'connected' ? '' : 'disabled'}>POSLAŤ</button>
          </form>

          <button id="leave" class="leave-btn" type="button">LEAVE</button>
        </div>
      </section>
    </main>`

  document.querySelector('#leave').addEventListener('click', leaveChat)
  document.querySelector('#brandHome').addEventListener('click', leaveChat)
  document.querySelector('#next').addEventListener('click', nextChat)
  document.querySelector('#composer').addEventListener('submit', sendMessage)
  bindThemeButtons()

  const input = document.querySelector('#message')
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      document.querySelector('#composer').requestSubmit()
    }
  })

  input?.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
    handleTypingInput(input.value)
    scheduleScrollToBottom()
  })

  input?.addEventListener('focus', scheduleScrollToBottom)

  if (state === 'connected') setTimeout(() => input?.focus(), 0)
  scrollMessages()
}

function emptyTranscript() {
  if (state === 'searching') {
    return `
      <div class="system-message">
        <strong>Hľadám dostupného človeka...</strong>
        <span>Keď sa niekto pripojí, chat sa spustí automaticky.</span>
      </div>`
  }

  if (state === 'ended') {
    return `
      <div class="system-message ended-message">
        <strong>Cudzí človek odišiel.</strong>
        <span>Klikni NEXT a nájdeme ti ďalšieho.</span>
      </div>`
  }

  return `<div class="system-message"><span>Môžeš napísať prvú správu.</span></div>`
}

function messageTemplate(message) {
  return `
    <div class="chat-line ${message.mine ? 'mine' : 'theirs'}">
      <span class="message-author">${message.mine ? 'Ty' : 'Cudzí'}</span>
      <div class="message-bubble">${escapeHtml(message.text)}</div>
    </div>`
}

function typingTemplate() {
  if (!partnerTyping || state !== 'connected') return ''
  return `
    <div class="typing-indicator" role="status">
      <span>Cudzí píše…</span>
      <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>`
}

function transcriptTemplate() {
  const content = messages.length ? messages.map(messageTemplate).join('') : (partnerTyping ? '' : emptyTranscript())
  return `${content}${typingTemplate()}`
}

function clearTypingTimer() {
  if (!typingStopTimer) return
  clearTimeout(typingStopTimer)
  typingStopTimer = null
}

function clearPartnerTypingTimer() {
  if (!partnerTypingTimer) return
  clearTimeout(partnerTypingTimer)
  partnerTypingTimer = null
}

async function setLocalTyping(isTyping, force = false) {
  if (!isTyping) clearTypingTimer()
  if (!force && localTypingSent === isTyping) return
  localTypingSent = isTyping
  lastTypingBroadcastAt = isTyping ? Date.now() : 0
  if (state === 'connected' && channel) await broadcast('typing', { typing: isTyping })
}

function setPartnerTyping(isTyping) {
  clearPartnerTypingTimer()
  partnerTyping = state === 'connected' && isTyping

  if (partnerTyping) {
    partnerTypingTimer = setTimeout(() => {
      partnerTyping = false
      partnerTypingTimer = null
      refreshMessages()
    }, partnerTypingFallbackDelay)
  }

  refreshMessages()
}

function handleTypingInput(value) {
  if (state !== 'connected' || !channel) return

  if (!value.trim()) {
    clearTypingTimer()
    void setLocalTyping(false)
    return
  }

  const now = Date.now()
  if (!localTypingSent) {
    void setLocalTyping(true)
  } else if (now - lastTypingBroadcastAt >= typingHeartbeatDelay) {
    void setLocalTyping(true, true)
  }

  clearTypingTimer()
  typingStopTimer = setTimeout(() => {
    void setLocalTyping(false)
  }, typingIdleDelay)
}

function resetTypingState() {
  clearTypingTimer()
  clearPartnerTypingTimer()
  localTypingSent = false
  lastTypingBroadcastAt = 0
  partnerTyping = false
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]))
}

function setStatus(nextState) {
  state = nextState
  render()
}

async function startChat() {
  if (isStopping) return
  resetTypingState()
  state = 'searching'
  messages = []
  partnerPresent = false
  render()
  await findPartner()
}

async function findPartner() {
  try {
    const { data, error } = await supabase.rpc('find_chat_partner', {
      p_session_id: sessionId
    })
    if (error) throw error

    const match = Array.isArray(data) ? data[0] : data
    if (!match?.room_id) throw new Error('Supabase nevrátil room_id.')

    roomId = match.room_id
    await joinRoom(match.partner_session_id)
  } catch (error) {
    console.error(error)
    showFatal('Nepodarilo sa pripojiť k chatu.', error.message)
  }
}

async function joinRoom(partnerSessionId) {
  if (channel) await supabase.removeChannel(channel)

  partnerPresent = Boolean(partnerSessionId)
  channel = supabase.channel(`chat:${roomId}`, {
    config: {
      broadcast: { self: false, ack: true },
      presence: { key: sessionId }
    }
  })

  channel
    .on('broadcast', { event: 'message' }, ({ payload }) => {
      if (payload?.sender === sessionId) return
      if (payload?.room_id !== roomId) return
      clearPartnerTypingTimer()
      partnerTyping = false
      messages.push({ text: String(payload.text || ''), mine: false })
      refreshMessages()
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.sender === sessionId) return
      if (payload?.room_id !== roomId) return
      setPartnerTyping(payload?.typing === true)
    })
    .on('broadcast', { event: 'matched' }, ({ payload }) => {
      if (payload?.room_id !== roomId) return
      clearPartnerTypingTimer()
      partnerTyping = false
      partnerPresent = true
      setStatus('connected')
    })
    .on('broadcast', { event: 'left' }, ({ payload }) => {
      if (payload?.room_id !== roomId) return
      partnerPresent = false
      clearPartnerTypingTimer()
      partnerTyping = false
      if (!isStopping) setStatus('ended')
    })
    .on('presence', { event: 'sync' }, () => {
      const presence = channel.presenceState()
      const keys = Object.keys(presence)
      if (state === 'connected' && keys.length < 2 && partnerPresent && !isStopping) {
        partnerPresent = false
        clearPartnerTypingTimer()
        partnerTyping = false
        setStatus('ended')
      }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key !== sessionId && !isStopping && state === 'connected') {
        partnerPresent = false
        clearPartnerTypingTimer()
        partnerTyping = false
        setStatus('ended')
      }
    })

  await new Promise((resolve, reject) => {
    channel.subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ session_id: sessionId })
          if (partnerSessionId) {
            partnerPresent = true
            setStatus('connected')
            await broadcast('matched', {})
          }
          resolve()
        } catch (error) {
          reject(error)
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error(`Realtime status: ${status}`))
      }
    })
  })
}

async function broadcast(event, payload) {
  if (!channel) return
  const response = await channel.send({
    type: 'broadcast',
    event,
    payload: { ...payload, room_id: roomId, sender: sessionId }
  })
  if (response !== 'ok') console.warn('Broadcast response:', response)
}

async function sendMessage(event) {
  event.preventDefault()
  if (state !== 'connected' || !channel) return

  const input = document.querySelector('#message')
  const text = input.value.trim()
  if (!text) return

  messages.push({ text, mine: true })
  input.value = ''
  input.style.height = 'auto'
  await setLocalTyping(false)
  refreshMessages()
  await broadcast('message', { text })
  input.focus()
}

function refreshMessages() {
  const list = document.querySelector('#messages')
  if (!list) return
  list.classList.toggle('is-empty', !messages.length && !partnerTyping)
  list.innerHTML = transcriptTemplate()
  scrollMessages()
}

function scrollMessages() {
  const list = document.querySelector('#messages')
  if (list) list.scrollTop = list.scrollHeight
}

async function closeCurrentRoom() {
  if (!roomId) return

  try {
    await setLocalTyping(false)
    await broadcast('left', {})
    await supabase.rpc('close_chat_room', { p_room_id: roomId })
  } catch (error) {
    console.warn('Closing room failed:', error)
  } finally {
    if (channel) {
      await supabase.removeChannel(channel)
      channel = null
    }
    roomId = null
    resetTypingState()
  }
}

async function nextChat() {
  if (isStopping) return
  isStopping = true
  await closeCurrentRoom()
  isStopping = false
  state = 'searching'
  messages = []
  partnerPresent = false
  render()
  await findPartner()
}

async function leaveChat() {
  if (isStopping) return
  isStopping = true
  await closeCurrentRoom()
  isStopping = false
  if (returnPath) {
    window.location.assign(returnPath)
    return
  }
  state = 'home'
  messages = []
  partnerPresent = false
  render()
}

function showFatal(title, detail) {
  app.innerHTML = `
    <main class="fatal">
      <section class="fatal-card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail || 'Skontroluj Supabase nastavenie a skús to znova.')}</p>
        <button id="back" class="start-btn" type="button">SPÄŤ</button>
      </section>
    </main>`

  document.querySelector('#back').addEventListener('click', () => {
    state = 'home'
    render()
  })
}

window.addEventListener('beforeunload', () => {
  if (roomId) {
    channel?.send({
      type: 'broadcast',
      event: 'left',
      payload: { room_id: roomId, sender: sessionId }
    })
  }
})

applyTheme(getPreferredTheme())
updateVisualViewport()

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateVisualViewport, { passive: true })
  window.visualViewport.addEventListener('scroll', updateVisualViewport, { passive: true })
} else {
  window.addEventListener('resize', updateVisualViewport, { passive: true })
}

render()
setupOnlinePresence()

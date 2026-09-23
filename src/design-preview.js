import './design-preview.css'
import logo from './assets/nitra-logo.jpg?inline'
import { createClient } from '@supabase/supabase-js'
import './features/features.css'
import {mount as mountFeature,cleanup as cleanupFeature} from './features/runtime.js'

// Private messages are not part of this preview; keep stored conversations intact.
const withoutMessages = url => /^\/messages(?:\/|\?|#|$)/.test(url) ? '/' : url
if(withoutMessages(location.pathname)!==location.pathname)history.replaceState({},'', '/')
const featurePath = path => /^\/(polls|people|account|activity)(\/|$)/.test(path)
const resolveFeature = () => featurePath(location.pathname) ? location.pathname : null
let activeFeature = resolveFeature()
function goFeature(url){
  history.pushState({},'',withoutMessages(url))
  activeFeature=resolveFeature()
  if(!activeFeature)state.section=['board','meet','events','future'].includes(location.hash.slice(1))?location.hash.slice(1):'board'
  window.scrollTo({top:0,behavior:'instant'});render()
}

const root = document.querySelector('#designPreview')
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

const state = {
  section: ['board','meet','events','future'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'board',
  compose: false,
  intro: true,
  adminGate: false,
  adminOpen: false,
  adminTab: 'overview'
}

let adminTaps = 0
let adminTapTimer

let wall = [
  { name: 'Nina', time: 'pred 8 min', text: 'Kto ide dnes večer na Zobor? Výhľad bude asi top.', tag: 'vonku' },
  { name: 'Tomáš', time: 'pred 31 min', text: 'Hľadáme štvrtého na basket pri UKF o 19:00.', tag: 'šport' },
  { name: 'Laura', time: 'pred 1 h', text: 'V sobotu malé fotenie v centre. Kto sa pridá?', tag: 'kreatíva' }
]

let events = [
  { org: 'Student Events', title: 'YOUNIVERSE', date: '23 OKT', place: 'Agrokomplex', line: 'DJ set · live show · afterparty', tone: 'blue' },
  { org: 'Hidepark Nitra', title: 'NOC V PARKU', date: '06 SEP', place: 'Hidepark', line: 'Lokálni interpreti · street food', tone: 'acid' }
]

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
}

function safeExternalUrl(value = '') {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'práve teraz'
  if (minutes < 60) return `pred ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `pred ${hours} h` : `pred ${Math.floor(hours / 24)} d`
}

async function loadPublicContent() {
  if (!supabase) return
  const [wallResult, eventResult] = await Promise.all([
    supabase.from('nitra_wall_posts').select('id,name,body,created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('nitra_events').select('id,organizer,title,performer,event_date,place,link,image_data').order('event_date', { ascending: true })
  ])
  if (!wallResult.error) wall = wallResult.data.map(item => ({ id: item.id, name: item.name, text: item.body, time: relativeTime(item.created_at), tag: 'nitra' }))
  if (!eventResult.error) events = eventResult.data.map((item, index) => ({ id: item.id, org: item.organizer, title: item.title, date: new Date(item.event_date).toLocaleDateString('sk-SK', { day: '2-digit', month: 'short' }).toUpperCase().replace('.', ''), place: item.place, line: item.performer || 'Program bude oznámený', link: item.link || '', image: item.image_data || '', tone: index % 2 ? 'acid' : 'blue' }))
  render()
}

const analyticsSessionKey = 'nitra-space-analytics-session'
function analyticsSessionId() {
  let id = sessionStorage.getItem(analyticsSessionKey)
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(analyticsSessionKey, id) }
  return id
}
async function recordAnalytics(event, target = null) {
  if (!supabase) return
  const { error } = await supabase.rpc('record_nitra_analytics', { p_session_id: analyticsSessionId(), p_event: event, p_target: target })
  if (error) console.error('[analytics]', error.message)
}

function shell(content) {
  return `
    ${state.intro ? `<div class="aura-intro"><div class="aura-intro-stage"><img src="${logo}" alt="Nitra Space"><img class="aura-intro-fragment intro-fragment-left" src="${logo}" alt="" aria-hidden="true"><img class="aura-intro-fragment intro-fragment-right" src="${logo}" alt="" aria-hidden="true"></div><span>THE CITY IS YOURS</span></div>` : ''}
    <div class="chrome-atmosphere" aria-hidden="true">
      ${['sigil','thorn','wing','flourish','ring','arc'].map(shape=>`<i class="chrome-object chrome-${shape}"></i>`).join('')}
    </div>
    <div class="aura-app">
      <header class="aura-header">
        <button class="wordmark" data-admin-entry aria-label="Domov"><b>N</b><span>NITRA<br>SPACE</span></button>
        <nav class="home-desktop-nav" aria-label="Hlavná navigácia">
          <button data-section="board" class="active">Domov</button><button data-section="board">Novinky</button><button data-feature-url="/polls">Ankety</button><button data-section="meet">Chat</button><button data-feature-url="/people">Ľudia</button><button data-section="events">Eventy</button>
        </nav>
        <div class="header-status"><span data-real-online></span><a class="account-entry" href="/account" data-feature-link aria-label="Profil a nastavenia"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></a></div>
      </header>
      <main>${content}</main>
      <nav class="aura-nav">
        <button data-section="board" class="${!activeFeature && state.section === 'board' ? 'active' : ''}"><span>01</span><b>Nástenka</b></button>
        <button data-section="meet" class="${!activeFeature && state.section === 'meet' ? 'active' : ''}"><span>02</span><b>Chaty</b></button>
        <button data-section="events" class="${!activeFeature && state.section === 'events' ? 'active' : ''}"><span>03</span><b>Eventy</b></button>
        <button data-feature-url="/people" class="${activeFeature?.startsWith('/people') ? 'active' : ''}"><span>04</span><b>Matching</b></button>
      </nav>
      ${state.compose ? composeSheet() : ''}
      ${state.adminGate ? adminGate() : ''}
      ${state.adminOpen ? adminPanel() : ''}
    </div>`
}

function featureLinks() {
  return `<nav class="aura-feature-links" aria-label="Komunita">
    ${[
      ['/#meet','01','Chaty','Náhodné spojenie s niekým novým.','blue'],
      ['/polls','02','Ankety','Tvoj hlas mení mesto.','lime'],
      ['/people','03','Matching','Profily ľudí z Nitry.','violet'],
      ['/account','04','Účet','Tvoj priestor v Nitre.','coral']
    ].map(([url,number,label,description,tone])=>`<a class="feature-tile feature-tile--${tone}" href="${url}" data-feature-link><span class="feature-tile-number" aria-hidden="true">${number}</span><span class="feature-tile-arrow ui-arrow" aria-hidden="true"></span><span class="feature-tile-copy"><strong>${label}</strong><small>${description}</small></span></a>`).join('')}
  </nav>`
}

function quickLinks() {
  return `<section class="signal-row" aria-label="Rýchle odkazy">
    <a href="https://tellonym.me/nitraspace" target="_blank" rel="noreferrer"><span>?</span><div><b>Nájdi niekoho</b><small>Anonymné otázky cez Tellonym</small></div><em class="ui-arrow"></em></a>
    <button data-section="meet"><span>•••</span><div><b>Random chat</b><small>Stretni niekoho nového</small></div><em class="ui-arrow"></em></button>
    <button data-feature-url="/people"><span>＋</span><div><b>Matching</b><small>Spoznaj ľudí z Nitry</small></div><em class="ui-arrow"></em></button>
  </section>`
}

function meetView() {
  return `<section class="view meet-view">
    <div class="section-hero meet-hero"><span>/ CHAT</span><h1>Náhoda<br>môže<br><i>začať.</i></h1><p>Bez profilu.<br>Bez tlaku.<br>Len rozhovor.</p></div>
    <div class="meet-explainer reveal">
      <span class="meet-number">01 / RANDOM CONNECTION</span>
      <div><h2>Jeden klik.<br><i>Žiadne očakávania.</i></h2><p>Náhodne ťa spojíme s niekým novým. Bez profilu, bez histórie a bez zbytočného tlaku. Ak si nesadnete, jedným klikom pokračuješ ďalej.</p></div>
      <ul><li><b>01</b><span>Anonymný rozhovor</span></li><li><b>02</b><span>Správy sa neukladajú</span></li><li><b>03</b><span>Kedykoľvek môžeš dať NEXT</span></li></ul>
      <a href="/chat.html"><span>OTVORIŤ RANDOM CHAT</span><b class="ui-arrow" aria-hidden="true"></b></a>
    </div>
  </section>`
}

function boardView() {
  return `<section class="view board-view">
    <div class="hero-block">
      <div class="hero-index">NITRA / SLOVAKIA<br>48.30° N</div>
      <span class="hero-kicker">ONE CITY · ONE SPACE</span>
      <h1 class="spaced-home-title"><span>NITRA</span><b>SPACE</b></h1>
      <p class="hero-script">Nitra žije online.</p>
      <p class="hero-intro">Odkazy, ľudia a momenty z Nitry. Bez hluku. Priamo medzi nami.</p>
      <button class="hero-cta" data-section="board">OBJAV NITRA SPACE <i class="ui-arrow"></i></button>
      <p class="hero-side hero-side-left">REAL PEOPLE<br>REAL STORIES<br>REAL NITRA</p><p class="hero-side hero-side-right">PEOPLE<br>CULTURE<br>COMMUNITY<br>ALL IN ONE SPACE</p>
      <div class="hero-meta"><span><b data-online-number>—</b> ONLINE</span><span><b>${wall.length}</b> ODKAZY</span><span><b>—</b> HLASY DNES</span></div>
      <small class="hero-est">EST. 2024<br>NITRASPACE.XYZ</small><small class="hero-scroll">SCROLL<br>PRE VIAC</small>
      ${featureLinks()}
    </div>
    ${quickLinks()}
    <section class="feed-head"><div><span>LIVE BOARD</span><h2>Čo žije v Nitre</h2></div><button data-compose>＋</button></section>
    <div class="message-grid">${wall.map((item, index) => `
      <article class="message-card reveal" style="--delay:${index * 70}ms">
        <div class="message-top"><span>${String(index + 1).padStart(2, '0')}</span><time>${escapeHtml(item.time)}</time></div>
        <p>${escapeHtml(item.text)}</p>
        <footer><div class="avatar">${escapeHtml(item.name?.[0] || '?')}</div><strong>${escapeHtml(item.name)}</strong><small>#${escapeHtml(item.tag)}</small></footer>
      </article>`).join('')}</div>
  </section>`
}

function eventsView() {
  return `<section class="view events-view">
    <div class="section-hero"><span>/ EVENTY</span><h1>Kam<br><i>dnes?</i></h1><p>Nitra žije.</p></div>
    <div class="event-stack">${events.map((event, index) => {
      const link = safeExternalUrl(event.link)
      return `
      <article class="event-card ${event.tone} reveal" style="--delay:${index * 90}ms">
        ${link ? `<a class="event-poster" href="${link}" target="_blank" rel="noreferrer">` : '<div class="event-poster">'}<span>${escapeHtml(event.org)}</span><strong>${escapeHtml(event.title)}</strong><small>NITRA / ${escapeHtml(event.date)}</small><i>${String(index + 1).padStart(2, '0')}</i>${link ? '</a>' : '</div>'}
        <div class="event-detail"><div><span>${escapeHtml(event.date)}</span><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.place)} · ${escapeHtml(event.line)}</p></div>${link ? `<a href="${link}" target="_blank" rel="noreferrer"><i class="ui-arrow" aria-hidden="true"></i></a>` : '<span>·</span>'}</div>
      </article>`
    }).join('')}</div>
  </section>`
}

function futureView() {
  return `<section class="view future-view">
    <div class="section-hero"><span>NITRA SPACE / ZOZNAMKA</span><h1>Stretni niekoho<br><i>zo svojho mesta.</i></h1><p>Lokálny matching ľudí z Nitry. Jednoduché karty, vzdialenosť a vzájomný záujem.</p></div>
    <div class="future-stage reveal">
      <div class="phone-shell">
        <div class="phone-top"><b>N</b><span>12:48</span></div>
        <div class="notes-line"><i>N</i><i>L</i><i>S</i><i>＋</i></div>
        <div class="match-card"><div class="match-image"><span>N</span><small>2 KM OD TEBA</small></div><div><b>Nina, 21</b><p>Hudba · káva · mesto po zotmení</p></div><footer><button>×</button><button>♡</button></footer></div>
      </div>
      <div class="future-copy"><span>ZOZNAMKA / NITRA</span><h2>Potiahni.<br>Zhodnite sa.<br>Stretnite sa.</h2><ul><li>Profily ľudí z Nitry</li><li>Lokálny matching</li><li>Maximálne 3 fotografie</li><li>Chat až po vzájomnej zhode</li></ul></div>
    </div>
    <div class="manifesto reveal"><span>LOKÁLNY MATCHING</span><div><i></i></div><p>Nie nekonečné profily. Ľudia, ktorých môžeš naozaj stretnúť.</p></div>
  </section>`
}

function composeSheet() {
  return `<button class="sheet-backdrop" data-compose-close aria-label="Zavrieť"></button><form class="aura-sheet" data-wall-form><header><div><span>NOVÝ SIGNÁL</span><h2>Čo chceš<br>odkázať mestu?</h2></div><button type="button" data-compose-close>×</button></header><label>Meno<input name="name" maxlength="30" placeholder="Ako sa voláš?" required></label><label>Odkaz<textarea name="body" maxlength="180" placeholder="Napíš niečo, čo má zmysel." required></textarea></label><p class="sheet-error" data-wall-error></p><footer><small data-wall-count>0 / 180</small><button type="submit">ZVEREJNIŤ</button></footer></form>`
}

function adminGate() {
  return `<button class="admin-backdrop" data-admin-close aria-label="Zavrieť"></button>
    <section class="admin-gate" role="dialog" aria-label="Prihlásenie správcu">
      <span>PRIVATE ACCESS</span><h2>Admin<br>control room.</h2>
      <form data-admin-login><label>Prístupový kód<input type="password" name="password" autocomplete="off" placeholder="••••••••••••"></label><p data-admin-error></p><button>VSTÚPIŤ <b>→</b></button></form>
      <button class="admin-x" data-admin-close aria-label="Zavrieť">×</button>
    </section>`
}

function adminPanel() {
  const panels = {
    overview: `<div class="admin-overview"><article><span>DNES</span><strong>284</strong><small>návštevníkov</small></article><article><span>TERAZ</span><strong class="live-number">17</strong><small>ľudí online</small></article><article><span>INTERAKCIE</span><strong>436</strong><small>kliknutí</small></article><article><span>TOP SEKCIА</span><strong>42%</strong><small>Nástenka</small></article></div><div class="admin-chart"><header><div><span>7 DNÍ</span><h3>Návštevnosť</h3></div><b>+18.4%</b></header><div class="chart-bars">${[38,54,46,72,61,88,76].map((n,i)=>`<i style="--h:${n}%"><small>${['PO','UT','ST','ŠT','PI','SO','NE'][i]}</small></i>`).join('')}</div></div><div class="click-list"><h3>Na čo ľudia klikajú</h3><p><b>01</b><span>Random chat</span><strong>168</strong></p><p><b>02</b><span>Eventy</span><strong>121</strong></p><p><b>03</b><span>Tellonym</span><strong>84</strong></p></div>`,
    content: `<div class="admin-section-head"><div><span>CONTENT</span><h3>Obsah stránky</h3></div><button>＋ PRIDAŤ EVENT</button></div><div class="admin-content-list"><article><div class="mini-poster blue">Y</div><p><b>YOUNIVERSE</b><small>Student Events · 23 OKT</small></p><div><button>Upraviť</button><button>Vymazať</button></div></article><article><div class="mini-poster acid">N</div><p><b>NOC V PARKU</b><small>Hidepark · 06 SEP</small></p><div><button>Upraviť</button><button>Vymazať</button></div></article>${wall.map(item=>`<article><div class="mini-avatar">${item.name[0]}</div><p><b>${item.name}</b><small>${item.text}</small></p><div><button>Skryť</button><button>Vymazať</button></div></article>`).join('')}</div>`,
    polls: `<div class="admin-section-head"><div><span>POLLS</span><h3>Ankety</h3></div><button>＋ NOVÁ ANKETA</button></div><article class="active-poll"><span>PRÁVE PREBIEHA</span><h4>Čo chcete najbližšie na Nitra Space?</h4><div><p><b>Viac eventov</b><i><em style="width:62%"></em></i><strong>62%</strong></p><p><b>Nových ľudí</b><i><em style="width:38%"></em></i><strong>38%</strong></p></div><footer><small>184 hlasov</small><button>UKONČIŤ</button></footer></article><div class="poll-history"><h3>História ankiet</h3><p><span>Kam chodíš najčastejšie?</span><b>312 hlasov</b><button>×</button></p><p><span>Chceš nočný režim?</span><b>247 hlasov</b><button>×</button></p></div>`,
    users: `<div class="admin-section-head"><div><span>COMMUNITY</span><h3>Používatelia</h3></div><button>HĽADAŤ ÚČET</button></div><div class="admin-content-list user-list"><article><div class="mini-avatar">N</div><p><b>Nina Kováčová <i>✓</i></b><small>@nina · Nitra · aktívna dnes</small></p><div><button>Odobrať fajku</button><button class="danger">Zabanovať</button></div></article><article><div class="mini-avatar">T</div><p><b>Tomáš Mráz</b><small>@tomas · Nitra · aktívny pred 2 h</small></p><div><button>Pridať modrú fajku</button><button class="danger">Zabanovať</button></div></article><article class="banned"><div class="mini-avatar">M</div><p><b>Martin12</b><small>@martin12 · zabanovaný účet</small></p><div><button>Odblokovať</button><button>Zobraziť</button></div></article></div>`
  }
  return `<section class="admin-panel" role="dialog" aria-label="Admin panel"><header><button class="admin-brand" data-admin-close><b>N</b><span>CONTROL ROOM</span></button><div><span>ADMIN / ACTIVE</span><button data-admin-logout>ODHLÁSIŤ</button></div></header><nav>${[['overview','Prehľad'],['content','Obsah'],['polls','Ankety'],['users','Používatelia']].map(([id,label])=>`<button data-admin-tab="${id}" class="${state.adminTab===id?'active':''}">${label}</button>`).join('')}</nav><main>${panels[state.adminTab]}</main></section>`
}

function render() {
  cleanupFeature()
  document.documentElement.dataset.previewTheme = 'dark'
  const views = { board: boardView, meet: meetView, events: eventsView, future: futureView }
  root.innerHTML = shell(activeFeature?'<section class="view nitra-features"><div id="feature-content"><div class="feature-skeleton" aria-label="Načítavam"></div></div><p id="feature-notice" role="status"></p></section>':views[state.section]())
  if(activeFeature)mountFeature(supabase,activeFeature,goFeature)
  bind()
  requestAnimationFrame(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')))
}

function bind() {
  document.querySelector('[data-admin-entry]')?.addEventListener('click', () => {
    adminTaps += 1
    clearTimeout(adminTapTimer)
    adminTapTimer = setTimeout(() => { adminTaps = 0 }, 6000)
    if (adminTaps >= 5) { adminTaps = 0; window.location.assign('/social.html?admin=1#events') }
    else if (adminTaps === 1) { state.compose = false; goFeature('/') }
  })
  document.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault()
    activeFeature=null
    state.section = button.dataset.section
    history.pushState({},'',`/#${state.section}`)
    state.compose = false
    render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    recordAnalytics('click', `section_${state.section}`)
  }))
  document.querySelectorAll('[data-feature-url]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault()
    goFeature(button.dataset.featureUrl)
    recordAnalytics('click', 'matching')
  }))
  document.querySelector('[data-compose]')?.addEventListener('click', () => { state.compose = true; render() })
  document.querySelectorAll('[data-compose-close]').forEach(button => button.addEventListener('click', () => { state.compose = false; render() }))
  const wallForm = document.querySelector('[data-wall-form]')
  const wallBody = wallForm?.querySelector('textarea[name="body"]')
  wallBody?.addEventListener('input', () => { document.querySelector('[data-wall-count]').textContent = `${wallBody.value.length} / 180` })
  wallForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const body = String(form.get('body') || '').trim()
    if (!name || !body) return
    const submit = event.currentTarget.querySelector('button[type="submit"]')
    submit.disabled = true
    if (!supabase) { document.querySelector('[data-wall-error]').textContent = 'Pripojenie nie je dostupné.'; submit.disabled = false; return }
    const { data, error } = await supabase.from('nitra_wall_posts').insert({ name, body }).select('id,name,body,created_at').single()
    if (error) { document.querySelector('[data-wall-error]').textContent = 'Odkaz sa nepodarilo zverejniť.'; submit.disabled = false; return }
    wall.unshift({ name: data.name, text: data.body, time: 'práve teraz', tag: 'nitra', id: data.id })
    state.compose = false
    render()
  })
  document.querySelectorAll('[data-admin-close]').forEach(button => button.addEventListener('click', () => { state.adminGate = false; state.adminOpen = false; render() }))
  document.querySelector('[data-admin-login]')?.addEventListener('submit', event => {
    event.preventDefault()
    const password = new FormData(event.currentTarget).get('password')
    if (password !== 'nitraspace987') { document.querySelector('[data-admin-error]').textContent = 'Nesprávny prístupový kód.'; return }
    state.adminGate = false; state.adminOpen = true; render()
  })
  document.querySelector('[data-admin-logout]')?.addEventListener('click', () => { state.adminOpen = false; render() })
  document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => { state.adminTab = button.dataset.adminTab; render() }))
}

render()
root.addEventListener('click',event=>{const link=event.target.closest('a[data-feature-link],a[data-route]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.button!==0)return;event.preventDefault();goFeature(link.getAttribute('href'))})
window.addEventListener('popstate',()=>{if(withoutMessages(location.pathname)!==location.pathname)history.replaceState({},'', '/');activeFeature=resolveFeature();if(!activeFeature)state.section=['board','meet','events','future'].includes(location.hash.slice(1))?location.hash.slice(1):'board';render()})
loadPublicContent()
recordAnalytics('pageview')
document.addEventListener('click', event => {
  const target = event.target.closest('a,button')
  if (!target) return
  if (target.matches('a[href*="tellonym.me/nitraspace"]')) recordAnalytics('click', 'tellonym')
  else if (target.matches('a[href="/chat.html"]')) recordAnalytics('click', 'chat')
  else if (target.closest('.event-card')) recordAnalytics('click', 'event_link')
  else if (target.matches('[data-compose]')) recordAnalytics('click', 'wall_compose')
})
let headerFrame = 0
window.addEventListener('scroll', () => {
  if (headerFrame) return
  headerFrame = requestAnimationFrame(() => {
    document.querySelector('.aura-header')?.classList.toggle('is-compact', window.scrollY > 72)
    headerFrame = 0
  })
}, { passive: true })
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('page-backgrounded', document.hidden)
})
setTimeout(() => {
  state.intro = false
  document.querySelector('.aura-intro')?.classList.add('leave')
  setTimeout(render, 180)
}, 2700)

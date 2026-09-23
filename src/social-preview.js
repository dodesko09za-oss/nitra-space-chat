const profiles = [
  { id:'laura',name:'Laura',username:'laura',age:20,city:'Nitra',interests:'Hudba • Gym • Coffee',interestList:['Music','Gym','Coffee','Events'],initials:'L',color:'#efb4c8',photos:['#efb4c8','#d8b9a5','#b8cadf'],bio:'Hudba, gym a dobrá káva.',lookingFor:'Spoznávanie / Dating',followers:432,mutual:true },
  { id:'nina',name:'Nina',username:'nina',age:19,city:'Nitra',interests:'Fashion • Music • Events',interestList:['Fashion','Music','Events'],initials:'N',color:'#c6b6e8',photos:['#c6b6e8','#c5d5b7','#e3c4bb'],bio:'Koncerty, móda a nové miesta v meste.',lookingFor:'Dating / Priateľstvo',followers:518,private:true,mutual:true },
  { id:'sofia',name:'Sofia',username:'sofia',age:22,city:'Nitra',interests:'Travel • Coffee • Photography',interestList:['Travel','Coffee','Photography'],initials:'S',color:'#e1c3a3',photos:['#e1c3a3','#b8d2ce','#c8c3dc'],bio:'Hľadám nové známosti a niekoho na kávu.',lookingFor:'Spoznávanie',followers:367 },
  { id:'martin',name:'Martin',username:'martin',age:21,city:'Nitra',interests:'Gaming • Cars • Gym',interestList:['Gaming','Cars','Gym'],initials:'M',color:'#a8c7ed',photos:['#a8c7ed','#c4c9cf','#a9c4b1'],bio:'Autá, hry a spontánne výlety.',lookingFor:'Priateľstvo / Pokec',followers:286 },
  { id:'adam',name:'Adam',username:'adam',age:23,city:'Nitra',interests:'Music • Fitness • Travel',interestList:['Music','Fitness','Travel'],initials:'A',color:'#abd8c5',photos:['#abd8c5','#c9b8a7','#b7bfd7'],bio:'Hudba, pohyb a víkendové výlety.',lookingFor:'Dating / Priateľstvo',followers:241 }
]

const state = {
  loggedIn: true, entryScreen: 'landing', authMode: 'login', screen: 'home', history: [], theme: 'light',
  selectedProfile: null, profileTab: 'posts', chatTab: 'random', dmWith: null,
  datingAccepted: false, discoverTab: 'discover', discoverIndex: 0, discoverPhoto: 0,
  notes: { mine:'Pridaj poznámku',laura:'Kto ide dnes von? 👀',nina:'Koncert tento víkend?',sofia:'Káva v centre? ☕',martin:'Niekto na pokec?',adam:'Gym večer 💪' },
  datingLikes: new Set(), matches: new Set(['nina']),
  filters: { show:'Všetkých', age:'18 – 25', location:'Nitra', looking:'Všetko', interests:[] },
  following: new Set(), requested: new Set(), reveal: 'idle', modal: null,
  randomMessages: [
    { mine: false, text: 'Ahoj 👋' },
    { mine: true, text: 'Čau, odkiaľ si?' },
    { mine: false, text: 'Z Nitry.' }
  ],
  dmMessages: {
    laura: [{ mine: false, text: 'Ahoj 👋' }, { mine: true, text: 'Ahoj, rád ťa spoznávam.' }],
    nina: [{ mine: false, text: 'Čau' }, { mine: true, text: 'Ako sa máš?' }]
  },
  user: { name:'Dodo',username:'dodo',age:20,gender:'Muž',bio:'Nitra • Music • Events',city:'Nitra',interests:'Music, Events, Coffee',followers:128,following:96,connections:12 },
  datingProfile: { bio:'Rád spoznám niekoho nového v Nitre.',datingPreference:'Všetkých',lookingFor:'Dating, Friends, Chat',photos:[] }
}

const app = document.querySelector('#socialApp')

const icons = {
  home: '<path d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z"/>',
  discover: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  chat: '<path d="M4 5h16v11H8l-4 4Z"/>',
  messages: '<path d="M4 4h13v10H8l-4 4Z"/><path d="M10 17h6l4 3V9h-1"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21h-3.6v-.2A2 2 0 0 0 9 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.6 15a2 2 0 0 0-1.8-1.2H2v-3.6h.8A2 2 0 0 0 4.6 9a2 2 0 0 0-.4-2.2l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 9 4.6 2 2 0 0 0 10.2 3V2h3.6v1A2 2 0 0 0 15 4.6a2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.8v3.6h-.8A2 2 0 0 0 19.4 15Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
}

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`
}

function avatar(profile, size = '') {
  return `<span class="avatar ${size}" style="--avatar:${profile.color || '#b8c7dc'}">${profile.initials || profile.name[0]}</span>`
}

function navigate(screen, options = {}) {
  if (state.screen !== screen) state.history.push(state.screen)
  state.screen = screen
  Object.assign(state, options)
  render()
}

function back() {
  state.screen = state.history.pop() || 'home'
  state.modal = null
  render()
}

function authView() {
  const register = state.authMode === 'register'
  return `
    <main class="auth-page">
      <section class="auth-card">
        <p class="wordmark">Nitra Space</p>
        <div class="auth-copy">
          <span class="eyebrow">KOMUNITA V TVOJOM MESTE</span>
          <h1>Spoznaj ľudí<br>vo svojom okolí.</h1>
          <p>Nové spojenia, lokálne udalosti a anonymný chat na jednom mieste.</p>
        </div>
        <form id="authForm" class="auth-form">
          <h2>${register ? 'Vytvoriť účet' : 'Prihlásiť sa'}</h2>
          <label>Email<input type="email" placeholder="meno@email.sk" required></label>
          ${register ? '<label>Username<input type="text" placeholder="@username" required></label>' : ''}
          <label>Heslo<input type="password" placeholder="••••••••" required></label>
          <button class="primary-btn" type="submit">${register ? 'VYTVORIŤ ÚČET' : 'PRIHLÁSIŤ SA'}</button>
        </form>
        <button class="text-btn" data-action="auth-switch">${register ? 'Máš účet? Prihlás sa' : 'Nemáš účet? Vytvor si ho'}</button>
        <div class="divider"><span>alebo</span></div>
        <button class="secondary-btn" data-action="guest">Pokračovať bez účtu</button>
        <p class="prototype-note">Interaktívny lokálny prototyp • žiadne údaje sa neodosielajú</p>
      </section>
    </main>`
}

function landingView(){
  return `<main class="landing-page"><header class="landing-header"><strong>Nitra Space</strong><button class="outline-btn" data-action="enter-auth">PRIHLÁSIŤ SA</button></header><section class="landing-hero"><span class="eyebrow">NITRA • ĽUDIA • SPOJENIA</span><h1>Tvoje mesto.<br>Tvoj priestor.</h1><p>Objav ľudí v Nitre, začni anonymný rozhovor alebo zostaň v kontakte so svojou komunitou.</p><div class="landing-actions"><button class="primary-btn" data-action="enter-auth">VSTÚPIŤ DO NITRA SPACE</button><button class="text-btn" data-action="guest">Vyskúšať Random Chat bez účtu</button></div></section><section class="landing-features"><article><span>01</span><h2>Discover</h2><p>Lokálne profily, záujmy a nové matches.</p></article><article><span>02</span><h2>Random Chat</h2><p>Anonymný rozhovor bez zbytočného tlaku.</p></article><article><span>03</span><h2>Komunita</h2><p>Poznámky, správy a ľudia online.</p></article></section></main>`
}

function shell(content, title = 'Nitra Space') {
  return `
    <div class="app-shell">
      <aside class="desktop-sidebar">
        <strong class="sidebar-brand">Nitra Space</strong>
        ${navItems('desktop')}
        <button class="side-settings" data-nav="settings">${icon('settings')}<span>Settings</span></button>
      </aside>
      <main class="main-column">
        <header class="app-header">
          <strong>${title}</strong>
          <div class="header-actions"><span class="online"><i></i>124 online</span><button class="icon-button" data-action="theme" aria-label="Prepnúť tému">${state.theme === 'dark' ? '☀' : '☾'}</button></div>
        </header>
        <div class="screen-content">${content}</div>
      </main>
      <aside class="right-rail">
        <span class="eyebrow">ONLINE NOW</span>
        ${profiles.slice(0, 3).map(p => `<button class="mini-person" data-profile="${p.id}">${avatar(p)}<span><strong>${p.name}</strong><small>${p.city}</small></span><i></i></button>`).join('')}
        <div class="rail-card"><strong>Buď v bezpečí</strong><p>Nezdieľaj citlivé údaje s ľuďmi, ktorých ešte nepoznáš.</p><button class="text-btn" data-nav="safety">Safety & Privacy</button></div>
      </aside>
      <nav class="mobile-nav">${navItems('mobile')}</nav>
      ${modalView()}
    </div>`
}

function navItems(mode) {
  const items = [['home','HOME','home'],['discover','DISCOVER','discover'],['random-chat','RANDOM','chat'],['messages','MESSAGES','messages'],['profile','PROFILE','profile']]
  return items.map(([id,label,iconName]) => `<button class="nav-item ${state.screen === id || (id === 'profile' && state.screen === 'public-profile') ? 'active' : ''} ${id === 'random-chat' ? 'chat-nav' : ''}" data-nav="${id}">${icon(iconName)}<span>${mode === 'desktop' ? label[0] + label.slice(1).toLowerCase() : label}</span>${id === 'messages' ? '<b>2</b>' : ''}</button>`).join('')
}

function homeView() {
  return shell(`
    ${notesView()}
    <section class="welcome"><span class="eyebrow">DOBRÝ DEŇ</span><h1>Ahoj, ${state.user.name.toLowerCase()} 👋</h1><p>Ako chceš niekoho spoznať?</p></section>
    <div class="meet-grid">
      <section class="meet-card"><span class="meet-symbol">♥</span><div><span class="eyebrow">DISCOVER</span><h2>Prezri si ľudí v Nitre.</h2><p>Objav profily podľa veku, záujmov a toho, čo práve hľadajú.</p></div><button class="hero-button" data-nav="discover">OTVORIŤ DISCOVER <span>→</span></button></section>
      <section class="meet-card"><span class="meet-symbol">•••</span><div><span class="eyebrow">RANDOM CHAT</span><h2>Spoj sa anonymne.</h2><p>Náhodný rozhovor bez tlaku. Profil ukážeš iba po vzájomnej dohode.</p></div><button class="hero-button" data-nav="random-chat">START CHAT <span>→</span></button></section>
      <section class="meet-card tellonym-card"><span class="meet-symbol">?</span><div><span class="eyebrow">ANONÝMNE OTÁZKY</span><h2>Nájdi ľudí cez Tellonym.</h2><p>Pošli anonymnú otázku alebo objav ďalšie lokálne spojenia mimo aplikácie.</p></div><a class="hero-button" href="https://tellonym.me/nitraspace" target="_blank" rel="noopener noreferrer">OTVORIŤ TELLONYM <span>↗</span></a></section>
    </div>
    <div class="section-heading"><div><h2>Online teraz</h2><p>Ľudia aktívni v tvojom okolí</p></div><button class="text-btn" data-nav="discover">Zobraziť všetko</button></div>
    <div class="profile-row">${profiles.slice(0,3).map(profileCard).join('')}</div>
    <section class="metric-grid"><article><b>124</b><span>Online teraz</span></article><article><b>5</b><span>Nové profily</span></article><article><b>${state.matches.size}</b><span>Tvoje matches</span></article></section>
  `)
}

function notesView(){
  const noteProfiles=[{id:'mine',name:'Ty',initials:'D',color:'#171719'},...profiles.slice(0,5)]
  return `<section class="notes-strip" aria-label="Poznámky">${noteProfiles.map(p=>`<button class="note-item" data-note="${p.id}"><span class="note-bubble">${state.notes[p.id]}</span>${avatar(p)}<small>${p.name}</small></button>`).join('')}</section>`
}

function profileCard(p) {
  const status = state.following.has(p.id) ? 'FOLLOWING' : state.requested.has(p.id) ? 'REQUESTED' : p.private ? 'REQUEST FOLLOW' : 'FOLLOW'
  return `<article class="profile-card" data-profile="${p.id}"><button class="profile-hit" data-profile="${p.id}">${avatar(p,'large')}<span><strong>${p.name}, ${p.age}</strong><small>@${p.username} • ${p.city}</small></span></button><p>${p.interests}</p><button class="follow-btn ${status !== 'FOLLOW' && status !== 'REQUEST FOLLOW' ? 'active' : ''}" data-follow="${p.id}">${status}</button></article>`
}

function discoverView() {
  if (!state.datingAccepted) return shell(`
    <section class="age-gate"><span class="age-mark">18+</span><span class="eyebrow">DATING DISCOVER</span><h1>Najprv bezpečne.</h1><p>Dating je dostupný iba používateľom vo veku 18+.</p><label class="age-check"><input id="ageConfirm" type="checkbox"><span>Potvrdzujem, že mám aspoň 18 rokov.</span></label><button id="ageContinue" class="primary-btn" disabled>POKRAČOVAŤ</button></section>
  `, 'Discover')
  const p = profiles[state.discoverIndex % profiles.length]
  return shell(`
    <div class="discover-head"><div><span class="eyebrow">NITRA • 18+</span><h1>Discover</h1></div><button class="outline-btn" data-action="filters">FILTER</button></div>
    <div class="discover-tabs"><button class="${state.discoverTab==='discover'?'active':''}" data-discover-tab="discover">DISCOVER</button><button class="${state.discoverTab==='likes'?'active':''}" data-discover-tab="likes">LIKES <b>${state.datingLikes.size}</b></button><button class="${state.discoverTab==='matches'?'active':''}" data-discover-tab="matches">MATCHES <b>${state.matches.size}</b></button></div>
    ${state.discoverTab === 'discover' ? `<div class="online-strip"><span>Online teraz</span>${profiles.slice(0,3).map(x=>`<button data-profile="${x.id}">${avatar(x)}<i></i><small>${x.name}</small></button>`).join('')}</div>${datingCard(p)}` : state.discoverTab === 'likes' ? datingList('likes') : datingList('matches')}
  `, 'Discover')
}

function datingCard(p) {
  const photo = p.photos[state.discoverPhoto % p.photos.length]
  return `<section class="swipe-stage"><article id="swipeCard" class="dating-card">
    <div class="dating-photo" style="--photo:${photo}"><span class="photo-initial">${p.initials}</span><span id="swipeStamp" class="swipe-stamp"></span><button class="photo-zone previous" data-photo="prev" aria-label="Predošlá fotografia"></button><button class="photo-zone next" data-photo="next" aria-label="Ďalšia fotografia"></button><div class="photo-dots">${p.photos.map((_,i)=>`<button class="${i===state.discoverPhoto?'active':''}" data-photo-index="${i}"></button>`).join('')}</div><span class="photo-count">${state.discoverPhoto+1} / ${p.photos.length}</span></div>
    <div class="dating-info"><div><h2>${p.name}, ${p.age}</h2><span><i></i>${p.city}</span></div><p class="dating-interests">${p.interests}</p><p>${p.bio}</p><button class="text-btn" data-profile="${p.id}">VIEW PROFILE</button></div>
  </article><div class="swipe-controls"><button class="pass-control" data-swipe="pass" aria-label="Preskočiť">×</button><button class="view-control" data-profile="${p.id}">VIEW PROFILE</button><button class="like-control" data-swipe="like" aria-label="Zaujal ma">♥</button></div></section>`
}

function datingList(type) {
  const ids = type === 'likes' ? [...state.datingLikes] : [...state.matches]
  const title = type === 'likes' ? 'Ľudia, ktorých si označil/a' : 'Tvoje matches'
  return `<section class="dating-list"><div class="section-heading"><div><h2>${title}</h2><p>${ids.length ? 'Lokálny mock zoznam' : 'Zatiaľ je tu prázdno.'}</p></div></div>${ids.map(id=>{const p=profiles.find(x=>x.id===id);return `<article>${avatar(p,'medium')}<button data-profile="${id}"><strong>${p.name}, ${p.age}</strong><small><i></i>${type==='matches'?'Online':p.city}</small></button>${type==='matches'?`<button class="outline-btn" data-dm="${id}">MESSAGE</button>`:''}</article>`}).join('')}</section>`
}

function personRow(p) {
  const label = state.following.has(p.id) ? 'FOLLOWING' : state.requested.has(p.id) ? 'REQUESTED' : p.private ? 'REQUEST' : 'FOLLOW'
  return `<article class="person-row" data-search="${p.name} ${p.username} ${p.interests}"><button class="person-main" data-profile="${p.id}">${avatar(p,'medium')}<span><strong>${p.name}, ${p.age} ${p.private?'🔒':''}</strong><small>@${p.username} • ${p.city}</small><em>${p.interests}</em></span></button><button class="follow-btn ${label==='FOLLOW'||label==='REQUEST'?'':'active'}" data-follow="${p.id}">${label}</button></article>`
}

function profileView(profile = null) {
  const own = !profile
  const p = profile || { ...state.user, initials:'D', color:'#171719', age:'', id:'dodo' }
  const following = state.following.has(p.id), requested = state.requested.has(p.id)
  const followLabel = p.private ? (requested ? 'REQUESTED' : 'REQUEST FOLLOW') : (following ? 'FOLLOWING' : 'FOLLOW')
  return shell(`
    ${own ? '' : `<button class="back-button" data-action="back">${icon('back')} Späť</button>`}
    <section class="profile-hero">
      <div class="profile-top">${avatar(p,'xlarge')}<div class="profile-identity"><h1>${p.name}${p.age?', '+p.age:''}</h1><p>@${p.username}</p></div>${own ? '<button class="outline-btn" data-action="edit-profile">Edit profile</button>' : `<button class="follow-btn big ${following||requested?'active':''}" data-follow="${p.id}">${followLabel}</button><button class="more-button" data-action="profile-menu">${icon('more')}</button>`}</div>
      ${p.private && !own ? '<div class="private-banner"><strong>🔒 Private profile</strong><p>Pošli žiadosť a uvidíš viac.</p></div>' : `<p class="profile-bio">${p.bio}</p>`}
      <div class="stats"><button><b>${p.followers || 128}</b><span>Followers</span></button><button><b>${own ? p.following : 143}</b><span>Following</span></button><button data-nav="connections"><b>${own ? p.connections : 8}</b><span>Connections</span></button></div>
    </section>
    ${own ? `<section class="dating-profile-panel"><div class="dating-panel-head"><div><span class="eyebrow">ODDELENÉ OD PROFILU</span><h2>Tvoj zoznamovací profil</h2><p>V Discover sa zobrazujú iba tieto údaje a fotografie.</p></div><button class="outline-btn" data-action="edit-dating">UPRAVIŤ</button></div><div class="dating-own-photos">${[0,1,2].map(i=>state.datingProfile.photos[i]?`<div style="background-image:url('${state.datingProfile.photos[i]}')"></div>`:`<div class="empty"><span>${i+1}</span></div>`).join('')}</div><p class="dating-own-bio">${state.datingProfile.bio}</p><small>${state.datingProfile.photos.length} / 3 fotografie</small></section>` : `<div class="dating-gallery">${p.photos.map((photo,i)=>`<button style="--photo:${photo}" data-photo-index="${i}"><span>${p.initials}</span></button>`).join('')}</div><section class="about-card dating-about"><span class="eyebrow">O MNE</span><h2>${p.bio}</h2><p><strong>Hľadám:</strong> ${p.lookingFor}</p><div class="interest-chips">${p.interestList.map(x=>`<span>${x}</span>`).join('')}</div></section><div class="dating-profile-actions"><button class="pass-control" data-action="back">×</button><button class="outline-btn" data-action="report-profile">REPORT / BLOCK</button><button class="like-control" data-dating-like="${p.id}">♥</button></div>`}
    <div class="profile-tabs"><button class="${state.profileTab==='posts'?'active':''}" data-profile-tab="posts">Posts</button><button class="${state.profileTab==='about'?'active':''}" data-profile-tab="about">About</button></div>
    ${state.profileTab === 'posts' ? `<div class="post-grid">${Array.from({length:9},(_,i)=>`<div style="--tone:${(i%4)+1}"><span>NS / 0${i+1}</span></div>`).join('')}</div>` : `<div class="about-card"><h3>O profile</h3><p>${p.bio}</p><dl><div><dt>Mesto</dt><dd>${p.city}</dd></div><div><dt>Záujmy</dt><dd>${p.interests}</dd></div><div><dt>Hľadám</dt><dd>${p.lookingFor || state.user.lookingFor}</dd></div></dl></div>`}
  `, own ? 'Profile' : p.name)
}

function chatView() {
  return shell(`
    <div class="segment"><button class="${state.chatTab==='random'?'active':''}" data-chat-tab="random">RANDOM</button><button class="${state.chatTab==='messages'?'active':''}" data-chat-tab="messages">MESSAGES</button></div>
    ${state.chatTab === 'random' ? randomChatCard() : inboxView()}
  `, 'Chat')
}

function randomChatCard() {
  const revealed = state.reveal === 'revealed'
  return `<section class="mock-chat">
    <header class="mock-chat-head"><div><span class="connected-dot"></span><span>Connected</span><strong>${revealed ? 'Laura • @laura' : 'Random Chat'}</strong></div><button class="outline-btn compact" data-action="reveal">${revealed ? 'VIEW PROFILE' : 'Ukázať profil'}</button></header>
    ${state.reveal === 'waiting' ? '<div class="reveal-status">Čakáme, či chce profil odhaliť aj druhý človek…</div>' : ''}
    ${revealed ? '<div class="reveal-status success">Profily odhalené 🎉 <button data-profile="laura">VIEW PROFILE</button><button data-follow="laura">FOLLOW</button><button data-dating-like="laura">♥ ZAUJALA MA</button></div>' : ''}
    <div id="randomMessages" class="message-area">${state.randomMessages.map(messageBubble).join('')}<div class="typing-row"><i></i><i></i><i></i><span>Cudzí píše…</span></div></div>
    <div class="mock-controls"><button class="dark-btn" data-action="next-mock">NEXT</button><form id="randomForm" class="mock-composer"><input name="message" placeholder="Napíš správu…" autocomplete="off"><button>SEND</button></form><button class="quiet-btn" data-action="leave-mock">LEAVE</button></div>
  </section>`
}

function messageBubble(m) { return `<div class="bubble-line ${m.mine?'mine':'theirs'}"><small>${m.mine?'Ty':'Cudzí'}</small><p>${escapeHtml(m.text)}</p></div>` }

function inboxView() {
  const rows=[['laura','Tak potom zajtra 😄','2 min'],['nina','Ten koncert bol top','3 h']]
  return `<div class="inbox"><div class="section-heading"><div><h2>Správy</h2><p>Tvoje súkromné konverzácie</p></div></div>${rows.map(([id,text,time])=>{const p=profiles.find(x=>x.id===id);return `<button class="inbox-row" data-dm="${id}">${avatar(p,'medium')}<span><strong>${p.name}</strong><small>${text}</small></span><time>${time}</time></button>`}).join('')}</div>`
}

function messagesView(){ return shell(inboxView(),'Messages') }

function dmView() {
  const p=profiles.find(x=>x.id===state.dmWith) || profiles[0]
  const msgs=state.dmMessages[p.id] || [{mine:false,text:'Ahoj 👋'}]
  return shell(`<button class="back-button" data-action="back">${icon('back')} Správy</button><section class="mock-chat dm-chat"><header class="dm-head">${avatar(p)}<div><strong>${p.name}</strong><span><i></i> Online</span></div><button data-profile="${p.id}">${icon('profile')}</button></header><div id="dmMessages" class="message-area">${msgs.map(m=>`<div class="bubble-line ${m.mine?'mine':'theirs'}"><p>${escapeHtml(m.text)}</p></div>`).join('')}<div class="typing-row"><i></i><i></i><i></i><span>${p.name} píše…</span></div></div><form id="dmForm" class="dm-composer"><input name="message" placeholder="Napíš správu…" autocomplete="off"><button>SEND</button></form></section>`, p.name)
}

function notificationsView() {
  const notes=[['laura','Laura ťa začala sledovať.','2 min'],['martin','Martin označil tvoj profil ako connection.','20 min'],['nina','Nina chce odhaliť profil.','1 h'],[null,'Nitra Space: Vitaj v komunite.','1 d']]
  return shell(`<section class="page-title"><span class="eyebrow">AKTIVITY</span><h1>Notifications</h1><p>Novinky z tvojej komunity.</p></section><div class="notification-list">${notes.map(([id,text,time],i)=>{const p=profiles.find(x=>x.id===id);return `<article class="notification ${i<2?'unread':''}">${p?avatar(p):'<span class="app-avatar">NS</span>'}<div><p>${text}</p><time>${time}</time></div><i></i></article>`}).join('')}</div>`, 'Notifications')
}

function connectionsView() { return shell(`<button class="back-button" data-action="back">${icon('back')} Späť</button><section class="page-title"><span class="eyebrow">CONNECTIONS</span><h1>Ľudia, ktorých si spoznal</h1><p>Spojenia vytvorené cez Random Chat.</p></section><div class="people-list">${profiles.slice(0,3).map(personRow).join('')}</div>`, 'Connections') }

function settingsView(safety=false) {
  const items=safety?['Blocked accounts','Reported accounts','Private profile','Online status','Random chat safety','Delete account']:['Edit profile','Privacy','Notifications','Blocked users','Appearance','Safety','Terms','Privacy Policy']
  return shell(`<section class="page-title"><span class="eyebrow">${safety?'OCHRANA':'ÚČET'}</span><h1>${safety?'Safety & Privacy':'Settings'}</h1><p>${safety?'Nástroje pre bezpečnejšiu komunitu.':'Spravuj svoj profil a preferencie.'}</p></section><div class="settings-list">${items.map(x=>`<button data-setting="${x}"><span>${x}</span><b>›</b></button>`).join('')}</div><button class="logout-btn" data-action="logout">Log out</button>`, safety?'Safety & Privacy':'Settings')
}

function modalView() {
  if (!state.modal) return ''
  if (state.modal?.startsWith('note:')) { const id=state.modal.split(':')[1],p=id==='mine'?{name:'Dodo',initials:'D',color:'#171719'}:profiles.find(x=>x.id===id); return modal(p.name,state.notes[id],'<button class="dark-btn" data-action="modal-close">HOTOVO</button>') }
  if (state.modal === 'reveal') return modal('Ukázať svoj profil?', 'Tvoj profil sa zobrazí iba vtedy, ak o to požiada aj druhý používateľ.', '<button class="quiet-btn" data-action="modal-close">Zrušiť</button><button class="dark-btn" data-action="reveal-confirm">Požiadať</button>')
  if (state.modal === 'profile-menu') return modal('Možnosti profilu', 'Vyber akciu pre tento mock profil.', '<button class="danger-outline" data-action="report-profile">Report</button><button class="danger-btn" data-action="block">Block</button>')
  if (state.modal === 'report-reasons') return modal('Prečo profil nahlasuješ?', 'Vyber jeden dôvod. Hlásenie zostáva iba v tomto prototype.', '<div class="report-reasons"><button data-report-reason="Nevhodný obsah">Nevhodný obsah</button><button data-report-reason="Falošný profil">Falošný profil</button><button data-report-reason="Obťažovanie">Obťažovanie</button></div>')
  if (state.modal === 'reported') return modal('Ďakujeme za upozornenie', 'Profil bol v prototype označený na kontrolu.', '<button class="dark-btn" data-action="modal-close">HOTOVO</button>')
  if (state.modal === 'confirm-block') return modal('Zablokovať profil?', 'Používateľ by ťa už nemohol kontaktovať.', '<button class="quiet-btn" data-action="modal-close">Zrušiť</button><button class="danger-btn" data-action="modal-close">Zablokovať</button>')
  if (state.modal === 'filters') return `<div class="modal-backdrop bottom-sheet"><form id="filterForm" class="modal-card filter-form"><div class="modal-title"><div><span class="eyebrow">DISCOVER</span><h2>Filters</h2></div><button type="button" data-action="modal-close">×</button></div>${[['show','Zobraziť'],['age','Vek'],['location','Lokalita'],['looking','Hľadám']].map(([key,label])=>`<label>${label}<input name="${key}" value="${state.filters[key]}"></label>`).join('')}<label>Záujmy<input name="interests" value="${state.filters.interests.join(', ')}" placeholder="Music, Gym, Coffee"></label><button class="primary-btn">APPLY FILTERS</button></form></div>`
  if (state.modal === 'dating-edit') return `<div class="modal-backdrop"><form id="datingForm" class="modal-card dating-edit-modal"><div class="modal-title"><div><span class="eyebrow">ZOZNAMKA</span><h2>Dating profil</h2></div><button type="button" data-action="modal-close">×</button></div><p class="modal-help">Je oddelený od tvojho verejného profilu. Môže obsahovať najviac 3 fotografie.</p><div class="dating-photo-editor">${state.datingProfile.photos.map((src,i)=>`<div style="background-image:url('${src}')"><button type="button" data-remove-dating-photo="${i}" aria-label="Odstrániť fotografiu">×</button></div>`).join('')}${state.datingProfile.photos.length<3?`<label class="add-dating-photo"><input id="datingPhotos" type="file" accept="image/*" multiple><span>＋</span><small>PRIDAŤ</small></label>`:''}</div><small class="photo-limit">${state.datingProfile.photos.length} / 3 fotografie</small><label>Dating bio<textarea name="bio" maxlength="160">${state.datingProfile.bio}</textarea></label><label>Koho chceš vidieť<input name="datingPreference" value="${state.datingProfile.datingPreference}"></label><label>Hľadám<input name="lookingFor" value="${state.datingProfile.lookingFor}"></label><button class="primary-btn">ULOŽIŤ DATING PROFIL</button></form></div>`
  if (state.modal?.startsWith('match:')) { const p=profiles.find(x=>x.id===state.modal.split(':')[1]); return modal('It’s a match!', `Ty a ${p.name} ste sa navzájom označili.`, `<div class="match-visual">${avatar({name:'Dodo',initials:'D',color:'#171719'},'large')}${avatar(p,'large')}</div><button class="quiet-btn" data-action="match-continue">POKRAČOVAŤ</button><button class="dark-btn" data-dm="${p.id}">MESSAGE</button>`) }
  if (state.modal === 'edit') return `<div class="modal-backdrop"><form id="editForm" class="modal-card edit-modal"><div class="modal-title"><div><span class="eyebrow">PROFIL</span><h2>Edit profile</h2></div><button type="button" data-action="modal-close">×</button></div><div class="edit-avatar"><span class="avatar xlarge" style="--avatar:#171719">D</span><button type="button" class="text-btn">Zmeniť fotografiu</button></div>${[['name','Name'],['username','Username'],['age','Vek'],['bio','Bio'],['city','Mesto'],['gender','Pohlavie'],['datingPreference','Koho chceš vidieť'],['lookingFor','Hľadám'],['interests','Záujmy']].map(([key,label])=>`<label>${label}<input name="${key}" value="${state.user[key]}"></label>`).join('')}<label class="age-check"><input type="checkbox" name="datingMode" ${state.user.datingMode?'checked':''}><span>Zapnúť Dating mode</span></label><button class="primary-btn">SAVE CHANGES</button></form></div>`
  return ''
}

function modal(title,text,actions){return `<div class="modal-backdrop"><section class="modal-card"><div class="modal-title"><div><span class="eyebrow">NITRA SPACE</span><h2>${title}</h2></div><button data-action="modal-close">×</button></div><p>${text}</p><div class="modal-actions">${actions}</div></section></div>`}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

function render() {
  document.documentElement.dataset.theme=state.theme
  document.documentElement.style.colorScheme=state.theme
  document.querySelector('meta[name="theme-color"]').content=state.theme==='dark'?'#0a0a0b':'#f5f5f7'
  if(!state.loggedIn){app.innerHTML=state.entryScreen==='landing'?landingView():authView();bind();return}
  const selected=profiles.find(p=>p.id===state.selectedProfile)
  const views={home:homeView,discover:discoverView,messages:messagesView,chat:chatView,notifications:notificationsView,profile:()=>profileView(), 'public-profile':()=>profileView(selected), 'random-chat':()=>shell(randomChatCard(),'Random Chat'),dm:dmView,connections:connectionsView,settings:()=>settingsView(false),safety:()=>settingsView(true)}
  app.innerHTML=(views[state.screen]||homeView)()
  bind(); requestAnimationFrame(()=>document.querySelector('.message-area')?.scrollTo(0,99999))
}

function bind() {
  document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>{const n=el.dataset.nav;if(n==='chat')state.chatTab='random';navigate(n)})
  document.querySelectorAll('[data-profile]').forEach(el=>el.onclick=e=>{e.stopPropagation();state.selectedProfile=el.dataset.profile;navigate('public-profile')})
  document.querySelectorAll('[data-follow]').forEach(el=>el.onclick=e=>{e.stopPropagation();const id=el.dataset.follow,p=profiles.find(x=>x.id===id);if(p?.private){state.requested.has(id)?state.requested.delete(id):state.requested.add(id)}else{state.following.has(id)?state.following.delete(id):state.following.add(id)}render()})
  document.querySelectorAll('[data-chat-tab]').forEach(el=>el.onclick=()=>{state.chatTab=el.dataset.chatTab;render()})
  document.querySelectorAll('[data-profile-tab]').forEach(el=>el.onclick=()=>{state.profileTab=el.dataset.profileTab;render()})
  document.querySelectorAll('[data-dm]').forEach(el=>el.onclick=()=>navigate('dm',{dmWith:el.dataset.dm}))
  document.querySelectorAll('[data-discover-tab]').forEach(el=>el.onclick=()=>{state.discoverTab=el.dataset.discoverTab;render()})
  document.querySelectorAll('[data-photo-index]').forEach(el=>el.onclick=e=>{e.stopPropagation();state.discoverPhoto=Number(el.dataset.photoIndex);render()})
  document.querySelectorAll('[data-photo]').forEach(el=>el.onclick=()=>{const p=profiles[state.discoverIndex%profiles.length];state.discoverPhoto=(state.discoverPhoto+(el.dataset.photo==='next'?1:p.photos.length-1))%p.photos.length;render()})
  document.querySelectorAll('[data-swipe]').forEach(el=>el.onclick=()=>decideDiscover(el.dataset.swipe))
  document.querySelectorAll('[data-dating-like]').forEach(el=>el.onclick=e=>{e.stopPropagation();likeProfile(el.dataset.datingLike)})
  document.querySelectorAll('[data-note]').forEach(el=>el.onclick=()=>{state.modal=`note:${el.dataset.note}`;render()})
  document.querySelectorAll('[data-remove-dating-photo]').forEach(el=>el.onclick=()=>{state.datingProfile.photos.splice(Number(el.dataset.removeDatingPhoto),1);render()})
  document.querySelectorAll('[data-report-reason]').forEach(el=>el.onclick=()=>{state.modal='reported';render()})
  document.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>action(el.dataset.action))
  document.querySelector('#authForm')?.addEventListener('submit',e=>{e.preventDefault();state.loggedIn=true;render()})
  document.querySelector('#randomForm')?.addEventListener('submit',e=>{e.preventDefault();const input=e.currentTarget.message;if(!input.value.trim())return;state.randomMessages.push({mine:true,text:input.value.trim()});input.value='';render();setTimeout(()=>{state.randomMessages.push({mine:false,text:'To znie dobre 🙂'});render()},900)})
  document.querySelector('#dmForm')?.addEventListener('submit',e=>{e.preventDefault();const input=e.currentTarget.message;if(!input.value.trim())return;(state.dmMessages[state.dmWith]??=[]).push({mine:true,text:input.value.trim()});input.value='';render()})
  document.querySelector('#editForm')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;new FormData(form).forEach((v,k)=>state.user[k]=v);state.user.datingMode=form.datingMode.checked;state.modal=null;render()})
  document.querySelector('#filterForm')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.currentTarget);['show','age','location','looking'].forEach(k=>state.filters[k]=data.get(k));state.filters.interests=String(data.get('interests')).split(',').map(x=>x.trim()).filter(Boolean);state.modal=null;render()})
  document.querySelector('#datingForm')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.currentTarget);['bio','datingPreference','lookingFor'].forEach(k=>state.datingProfile[k]=data.get(k));state.modal=null;render()})
  document.querySelector('#datingPhotos')?.addEventListener('change',async e=>{const files=[...e.target.files].slice(0,3-state.datingProfile.photos.length);const images=await Promise.all(files.map(file=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file)})));state.datingProfile.photos.push(...images);render()})
  const age=document.querySelector('#ageConfirm'), ageButton=document.querySelector('#ageContinue');if(age&&ageButton){age.onchange=()=>ageButton.disabled=!age.checked;ageButton.onclick=()=>{state.datingAccepted=true;render()}}
  bindSwipe()
  document.querySelector('#peopleSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('[data-search]').forEach(x=>x.hidden=!x.dataset.search.toLowerCase().includes(q))})
}

function action(name){
  if(name==='auth-switch')state.authMode=state.authMode==='login'?'register':'login'
  if(name==='enter-auth')state.entryScreen='auth'
  if(name==='guest'){state.loggedIn=true;state.screen='random-chat'}
  if(name==='theme')state.theme=state.theme==='light'?'dark':'light'
  if(name==='back')return back()
  if(name==='edit-profile')state.modal='edit'
  if(name==='edit-dating')state.modal='dating-edit'
  if(name==='profile-menu')state.modal='profile-menu'
  if(name==='filters')state.modal='filters'
  if(name==='report-profile')state.modal='report-reasons'
  if(name==='match-continue')state.modal=null
  if(name==='reveal')state.modal='reveal'
  if(name==='modal-close')state.modal=null
  if(name==='report')state.modal='confirm-report'
  if(name==='block')state.modal='confirm-block'
  if(name==='reveal-confirm'){state.modal=null;state.reveal='waiting';render();setTimeout(()=>{state.reveal='revealed';render()},1500);return}
  if(name==='next-mock'){state.randomMessages=[{mine:false,text:'Ahoj, ako sa máš?'}];state.reveal='idle'}
  if(name==='leave-mock')return navigate('home')
  if(name==='logout'){state.loggedIn=false;state.entryScreen='landing';state.screen='home';state.history=[]}
  render()
}

function likeProfile(id){
  state.datingLikes.add(id)
  const p=profiles.find(x=>x.id===id)
  if(p?.mutual){state.matches.add(id);state.modal=`match:${id}`}
  render()
}

function decideDiscover(choice){
  const p=profiles[state.discoverIndex%profiles.length]
  if(choice==='like') state.datingLikes.add(p.id)
  const card=document.querySelector('#swipeCard')
  if(card){card.classList.add(choice==='like'?'swipe-right':'swipe-left');const stamp=card.querySelector('#swipeStamp');stamp.textContent=choice==='like'?'LIKE':'PASS';stamp.className=`swipe-stamp show ${choice}`}
  setTimeout(()=>{if(choice==='like'&&p.mutual){state.matches.add(p.id);state.modal=`match:${p.id}`}state.discoverIndex=(state.discoverIndex+1)%profiles.length;state.discoverPhoto=0;render()},260)
}

function bindSwipe(){
  const card=document.querySelector('#swipeCard');if(!card)return
  let start=0,delta=0,dragging=false
  card.onpointerdown=e=>{start=e.clientX;dragging=true;card.setPointerCapture(e.pointerId)}
  card.onpointermove=e=>{if(!dragging)return;delta=e.clientX-start;card.style.transform=`translateX(${delta}px) rotate(${delta/22}deg)`;const stamp=card.querySelector('#swipeStamp');if(Math.abs(delta)>35){stamp.textContent=delta>0?'LIKE':'PASS';stamp.className=`swipe-stamp show ${delta>0?'like':'pass'}`}}
  card.onpointerup=()=>{dragging=false;if(Math.abs(delta)>80)return decideDiscover(delta>0?'like':'pass');card.style.transform='';card.querySelector('#swipeStamp').className='swipe-stamp';delta=0}
}

render()

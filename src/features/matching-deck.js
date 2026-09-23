import {db,state,content,notice,navigate,onCleanup} from './runtime.js'
import {html,httpsUrl} from './shared.js'
export async function renderMatching(){
 if(!state.user){content('<section class="ed-hero"><i class="ed-chrome" aria-hidden="true"></i><p class="eyebrow">/ MATCHING</p><h1>SPOZNAJ<br>ĽUDÍ Z NITRY.</h1><p>Skutoční ľudia. Žiadne masky.</p></section><section class="panel"><h2>TVOJ PROFIL. TVOJE TEMPO.</h2><p>Prihlás sa, pridaj fotky a vyber svoje záujmy. Lajky sú súkromné; rozhovor sa otvorí až pri vzájomnom záujme.</p><a href="/account">Prihlásiť sa / vytvoriť účet →</a></section>');return}
 const generation=state.generation
 const setup=await db.from('matching_profiles').select('matching_enabled,intro').eq('user_id',state.user.id).maybeSingle()
 if(setup.error)throw setup.error
 if(!setup.data?.matching_enabled||!setup.data?.intro){const social=await import('./social.js');return social.matchingOnboarding()}
 let rows=[],filter='',online=false,photo=0,busy=false,drag=null
 const paint=()=>{
  if(generation!==state.generation)return
  const visible=rows.filter(p=>(!online||p.online)&&(!filter||p.interests.some(t=>t.name.toLocaleLowerCase().includes(filter)))),p=visible[0]
  content(`<section class="ed-hero"><i class="ed-chrome" aria-hidden="true"></i><p class="eyebrow">/ MATCHING</p><h1>SPOZNAJ<br>ĽUDÍ Z NITRY.</h1><p>Skutoční ľudia. Žiadne masky.</p></section><div class="ed-actions"><button data-online aria-pressed="${online}">Online</button><a href="/account">Môj profil ↗</a><a href="/messages">Rozhovory ↗</a></div><label>Záujem<input data-interest value="${html(filter)}" placeholder="Hudba, šport…"></label><div class="ed-deck">${p?`<article class="ed-match-card" aria-label="Profil ${html(p.display_name)}">${p.urls.length?`<img src="${html(p.urls[photo%p.urls.length])}" alt="${html(p.display_name)} — fotografia ${photo+1}" draggable="false">`:'<i class="ed-chrome" aria-hidden="true"></i>'}${p.urls.length>1?`<button class="ed-photo-next" data-photo aria-label="Ďalšia fotografia">${photo%p.urls.length+1} / ${p.urls.length} →</button>`:''}<div class="ed-match-caption"><small>${p.online?'● ONLINE':'NITRA'}${p.is_verified?' · OVERENÝ PROFIL':''}</small><h2>${html(p.display_name)}, ${html(p.age)}</h2><p>${html(p.intro)}</p><div class="tags">${p.interests.map(i=>`<span>${html(i.name)}</span>`).join('')}</div></div></article><div class="ed-match-controls"><button data-decision="pass" aria-label="Preskočiť ${html(p.display_name)}">× PASS</button><a href="/people/${html(p.username)}" class="ed-back">Profil ↗</a><button data-decision="like" aria-label="Páči sa mi ${html(p.display_name)}">♡ LIKE</button></div><div class="ed-actions"><button data-block>Blokovať</button><button data-report>Nahlásiť</button></div>`:'<section class="empty"><h2>NA DNES TICHŠIE.</h2><p>Žiadny ďalší profil v tomto výbere. Skús zmeniť filter alebo sa vráť neskôr.</p><button data-reload>Obnoviť výber</button></section>'}<p class="ed-match-status" role="status"></p><p class="muted">Potiahni doľava pre PASS alebo doprava pre LIKE. Jednostranný záujem sa nikomu nezobrazuje.</p><div class="ed-matches" data-matches></div></div>`)
  document.querySelector('[data-online]').onclick=()=>{online=!online;paint()}
  document.querySelector('[data-interest]').onchange=e=>{filter=e.target.value.trim().toLocaleLowerCase();paint()}
  document.querySelector('[data-photo]')?.addEventListener('click',()=>{photo++;paint()})
  document.querySelector('[data-reload]')?.addEventListener('click',load)
  const decision=async like=>{
   if(busy||!p)return;busy=true
   document.querySelectorAll('[data-decision]').forEach(b=>b.disabled=true)
   try{const r=await db.rpc('matching_decide',{p_target:p.id,p_like:like});if(r.error)throw r.error;rows=rows.filter(x=>x.id!==p.id);photo=0;paint();if(r.data==='match'){const el=document.querySelector('.ed-match-status');el.innerHTML='<strong>JE TO MATCH.</strong> Máte vzájomný záujem. <button data-open-match>Otvoriť rozhovor →</button>';el.querySelector('button').onclick=async()=>{const dm=await db.rpc('get_or_create_dm',{p_other_user_id:p.id});if(dm.error)notice(dm.error.message);else navigate('/messages/'+dm.data)}}else notice(like?'Tvoj súkromný záujem je uložený.':'Profil preskočený.')}
   catch(e){notice(e.message);document.querySelectorAll('[data-decision]').forEach(b=>b.disabled=false)}finally{busy=false}
  }
  document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>decision(b.dataset.decision==='like'))
  const card=document.querySelector('.ed-match-card')
  card?.addEventListener('pointerdown',e=>{if(e.target.closest('button')||busy)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};card.setPointerCapture(e.pointerId)})
  card?.addEventListener('pointermove',e=>{if(!drag)return;const x=e.clientX-drag.x,y=e.clientY-drag.y;if(Math.abs(y)>Math.abs(x)&&Math.abs(y)>25){drag=null;card.style.transform='';return}card.style.transform=`translateX(${Math.max(-90,Math.min(90,x))}px) rotate(${x/35}deg)`})
  const end=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag=null;card.style.transform='';if(Math.abs(dx)>80&&Math.abs(dx)>Math.abs(dy)*1.5)decision(dx>0)}
  card?.addEventListener('pointerup',end);card?.addEventListener('pointercancel',()=>{drag=null;card.style.transform=''})
  document.querySelector('[data-block]')?.addEventListener('click',async()=>{if(!confirm('Zablokovať tento profil?'))return;const r=await db.from('blocks').insert({blocker_id:state.user.id,blocked_id:p.id});if(r.error)notice(r.error.message);else{rows=rows.filter(x=>x.id!==p.id);paint()}})
  document.querySelector('[data-report]')?.addEventListener('click',async()=>{const reason=prompt('Prečo chceš profil nahlásiť?');if(!reason?.trim())return;const r=await db.from('reports').insert({reporter_id:state.user.id,reported_user_id:p.id,reason:reason.trim().slice(0,1000)});notice(r.error?r.error.message:'Nahlásenie bolo odoslané moderátorovi.')})
  matches()
 }
 async function matches(){const r=await db.rpc('matching_updates',{p_limit:20});const host=document.querySelector('[data-matches]');if(r.error||generation!==state.generation||!host)return;host.innerHTML=(r.data?.items||[]).map(m=>`<a href="/people/${html(m.actor_username)}">Vzájomný match · ${html(m.actor_name)} ↗</a>`).join('')}
 async function load(){const r=await db.rpc('matching_feed',{p_limit:20});if(r.error){notice(r.error.message);return}rows=await Promise.all((r.data||[]).map(async p=>{const signed=p.photos?.length?await db.storage.from('matching-photos').createSignedUrls(p.photos,600):{data:[]};return {...p,urls:(signed.data||[]).map(x=>httpsUrl(x.signedUrl)).filter(Boolean),interests:p.interests||[]}}));paint()}
 await load();onCleanup(()=>{drag=null;rows=[]})
}

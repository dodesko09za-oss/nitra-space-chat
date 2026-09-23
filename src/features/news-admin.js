import { db, state, content, notice, requireUser } from './runtime.js'
import { html, field, slugify, dateLabel, articleCard } from './shared.js'
let tab='draft'
const categories=['Mesto','Doprava','Kultúra','Šport','Komunita','Bezpečnosť']
const draftLanguage=/n[aá]vrh (?:čaká|vznikol)|pred publikovan[ií]m|pred vydan[ií]m|čo treba pred vydan[ií]m|dodatočn[eé] redakčn[eé] overenie/i
function publishProblem(article){
  if(article.manual_review_required)return 'Najprv článok otvor cez UPRAVIŤ, prepíš ho vlastnými slovami a potvrď dokončenú redakčnú kontrolu.'
  if((article.summary||'').trim().length<80)return 'Doplň vlastné zhrnutie s dĺžkou aspoň 80 znakov.'
  if((article.content||'').trim().length<250)return 'Vlastný text článku musí mať aspoň 250 znakov.'
  if(draftLanguage.test(`${article.summary||''} ${article.content||''}`))return 'Text stále obsahuje pracovné pokyny alebo automatickú šablónu. Prepíš ich na hotový článok.'
  if(article.cover_image_url&&article.image_rights==='source_unverified')return 'Fotografia nemá potvrdené práva. Dolož povolenie alebo použi grafiku Nitra Space.'
  return ''
}
export async function renderNewsAdmin() {
  if(!await requireUser())return
  const permission=await db.rpc('is_admin')
  if(permission.error||permission.data!==true){content('<section class="empty"><h1>Prístup iba pre redakciu.</h1></section>');return}
  state.admin=true
  const {data,error}=await db.from('nitra_news').select('*').eq('status',tab).order('created_at',{ascending:false}).limit(50)
  if(error)throw error
  const topicsResult=await db.from('nitra_news_topics').select('id,label,query,scope,enabled').order('created_at',{ascending:true})
  if(topicsResult.error)throw topicsResult.error
  const topics=topicsResult.data||[]
  const topicBank=`<section class="news-topic-bank"><div class="news-topic-heading"><div><span>EDITORIAL WATCHLIST</span><h2>Témy, ktoré sleduješ.</h2><p>Uložené výrazy hľadajú čerstvé články globálne alebo v SK/CZ médiách.</p></div><button data-discover-topics ${topics.length?'':'disabled'}>✦ PREHĽADAŤ VŠETKY</button></div><div class="news-topic-list">${topics.map(topic=>`<div class="news-topic"><button data-topic-search="${topic.id}"><strong>${html(topic.label)}</strong><small>${html(topic.query)} · ${topic.scope==='sk_cz'?'SK/CZ':topic.scope==='nitra'?'NITRA':'SVET'}</small></button><button data-topic-delete="${topic.id}" aria-label="Vymazať tému ${html(topic.label)}">×</button></div>`).join('')||'<p class="muted">Zatiaľ nemáš uloženú žiadnu tému.</p>'}</div><form class="news-topic-form" data-topic-form><input name="label" maxlength="60" required placeholder="Názov, napr. Rap svet"><input name="query" maxlength="120" required placeholder="Slová, mená alebo téma"><select name="scope"><option value="global">SVET</option><option value="sk_cz">SK/CZ</option><option value="nitra">NITRA</option></select><button type="submit">＋ ULOŽIŤ TÉMU</button></form></section>`
  content(`<section class="page-heading"><span>NITRA SPACE / REDAKCIA</span><h1>Návrhy článkov.</h1><p>Nič sa nezverejní samo. Skontroluj zdroj a text, potom článok publikuj alebo zahoď.</p></section><div class="news-admin-tools"><div class="news-search-box"><label for="newsSearch">MENO ALEBO TÉMA</label><div><input id="newsSearch" data-news-query maxlength="80" placeholder="napr. Jaguar, Zobor, hokej…"><button class="news-discover-button" data-discover>✦ NÁJSŤ AKTUÁLNE</button></div></div><button data-discover-latest>NAJNOVŠIE Z NITRY</button><button data-new>＋ PRIDAŤ RUČNE</button><small>Hľadá správy z posledných 72 hodín, spája rovnakú tému z viacerých médií a vytvára iba redakčný návrh. Publikovanie ostáva na tebe.</small><div class="news-search-status" data-search-status role="status" aria-live="polite"></div></div><div class="tabs">${[['draft','NÁVRHY'],['published','PUBLIKOVANÉ'],['rejected','ZAHODENÉ']].map(([id,label])=>`<button data-tab="${id}" aria-pressed="${tab===id}">${label}</button>`).join('')}</div><div class="admin-list news-admin-list">${data.map(a=>`<article class="admin-row news-proposal"><div class="news-proposal-preview">${articleCard({...a,slug:'preview'})}</div><div class="news-proposal-copy"><small>${html(a.source_name)} · ${html(dateLabel(a.created_at))}</small><h2>${html(a.headline)}</h2><p>${html(a.summary)}</p>${a.ai_generated?'<strong>AI draft — over fakty a zdroj</strong>':''}<div class="actions"><button data-edit="${a.id}">UPRAVIŤ</button>${a.status!=='published'?`<button data-publish="${a.id}">PUBLIKOVAŤ</button>`:''}<button data-reject="${a.id}">ZAHODIŤ</button><button data-delete="${a.id}">VYMAZAŤ NAVŽDY</button></div></div></article>`).join('')||'<section class="empty suggestion-empty"><span>00 / ČAKÁME NA ZDROJ</span><h2>Zatiaľ žiadne návrhy.</h2><p>Zadaj meno alebo tému a nájdi aktuálne články, prípadne načítaj najnovšie z Nitry.</p></section>'}</div><p class="muted">Zobrazujeme najviac 50 článkov. Automatický import môže vytvoriť iba návrh — publikovanie ostáva vždy na tebe.</p>`)
  document.querySelector('.page-heading').insertAdjacentHTML('afterend',topicBank)
  document.querySelector('[data-new]').onclick=()=>edit({})
  const discover=async(button,query='',queries=[])=>{
    const original=button.textContent;const status=document.querySelector('[data-search-status]');const message=queries.length?`Hľadám články pre ${queries.length} uložené témy…`:query?`Hľadám nové články o „${query}“…`:'Hľadám najnovšie články priamo o Nitre…';button.disabled=true;button.textContent='HĽADÁM…';status.textContent=message;status.dataset.state='loading';notice(message)
    try{
      const refreshed=await db.auth.refreshSession();const session=refreshed.data.session
      if(refreshed.error||!session)throw new Error('Prihlásenie vypršalo. Otvor Účet, prihlás sa znova a potom zopakuj hľadanie.')
      const response=await fetch('/api/news-discover',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({query,queries})})
      const report=await response.json().catch(()=>({}));if(!response.ok)throw new Error(report.error||'Hľadanie sa nepodarilo.')
      tab='draft';notice(`Hotovo: ${report.drafts} nových návrhov, ${report.duplicates} už existovalo.`);await renderNewsAdmin()
    }catch(error){notice(error.message);status.textContent=error.message;status.dataset.state='error';button.disabled=false;button.textContent=original}
  }
  document.querySelector('[data-discover]').onclick=e=>{const query=document.querySelector('[data-news-query]').value.trim();if(query.length<2){notice('Zadaj aspoň 2 znaky.');return}discover(e.currentTarget,query)}
  document.querySelector('[data-news-query]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();document.querySelector('[data-discover]').click()}}
  document.querySelector('[data-discover-latest]').onclick=e=>discover(e.currentTarget)
  document.querySelector('[data-discover-topics]').onclick=e=>discover(e.currentTarget,'',topics.filter(topic=>topic.enabled).map(topic=>topic.query))
  document.querySelectorAll('[data-topic-search]').forEach(button=>button.onclick=()=>discover(button,topics.find(topic=>topic.id===button.dataset.topicSearch)?.query||''))
  document.querySelectorAll('[data-topic-delete]').forEach(button=>button.onclick=async()=>{
    const topic=topics.find(item=>item.id===button.dataset.topicDelete);if(!topic||!confirm(`Vymazať tému „${topic.label}“?`))return
    button.disabled=true;const result=await db.from('nitra_news_topics').delete().eq('id',topic.id)
    if(result.error){notice(result.error.message);button.disabled=false;return}await renderNewsAdmin()
  })
  document.querySelector('[data-topic-form]').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('[type=submit]');submit.disabled=true
    const values=Object.fromEntries(new FormData(form));values.label=values.label.trim();values.query=values.query.trim()
    const result=await db.from('nitra_news_topics').insert(values)
    if(result.error){notice(result.error.code==='23505'?'Táto téma už je uložená.':result.error.message);submit.disabled=false;return}
    notice(`Téma „${values.label}“ je uložená.`);await renderNewsAdmin()
  }
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderNewsAdmin().catch(()=>notice('Načítanie zlyhalo.'))})
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(data.find(a=>a.id===b.dataset.edit)))
  for(const action of ['publish','reject','delete'])document.querySelectorAll(`[data-${action}]`).forEach(b=>b.onclick=async()=>{
    const article=data.find(item=>item.id===b.dataset[action])
    const problem=action==='publish'?publishProblem(article||{}):''
    if(problem){notice(problem);return}
    if(!confirm(action==='publish'?'Overil si fakty a práva k fotografii, ak ju článok používa? Publikovať vlastné spracovanie Nitra Space?':action==='delete'?'Natrvalo vymazať tento článok?':'Presunúť článok medzi zamietnuté?'))return
    b.disabled=true;const id=b.dataset[action]
    const result=action==='delete'?await db.from('nitra_news').delete().eq('id',id):await db.from('nitra_news').update({status:action==='publish'?'published':'rejected'}).eq('id',id)
    if(result.error){notice(result.error.message);b.disabled=false;return}await renderNewsAdmin()
  })
}
function edit(article) {
  let imageUrl=article.cover_image_url||null
  content(`<div class="two-cols"><form class="panel" data-editor><h1>${article.id?'Upraviť':'Nový'} článok</h1><div class="news-authorship-note"><b>TEXT: REDAKCIA NITRA SPACE</b><span>Vlastné redakčné spracovanie verejne dostupných a overených faktov. Odkaz na pôvodné zdroje zostáva uvedený kvôli transparentnosti.</span></div>${field('headline','Vlastný nadpis Nitra Space',article.headline)}${field('slug','Verejný slug',article.slug)}${field('visual_headline','Kratší nadpis karty',article.visual_headline)}<label>Vlastné zhrnutie<textarea name="summary" minlength="80" maxlength="600" required>${html(article.summary)}</textarea></label><label>Text článku Nitra Space<textarea name="content" minlength="250" maxlength="40000" rows="12" required>${html(article.content)}</textarea></label>${field('source_name','Zdroj faktov',article.source_name)}${field('source_url','Odkaz na pôvodný zdroj (HTTPS)',article.source_url,'url')}<label>Kategória<select name="category">${categories.map(c=>`<option ${c===article.category?'selected':''}>${c}</option>`).join('')}</select></label><label><input type="checkbox" name="breaking" ${article.breaking?'checked':''}> BREAKING</label><label>FOTOGRAFIA — samostatné autorské práva (max. 5 MB)<input data-image type="file" accept="image/jpeg,image/png,image/webp"></label><label>Práva iba k fotografii<select name="image_rights">${[['fallback','Grafika Nitra Space / bez cudzej fotky'],['owned','Moja vlastná fotografia'],['licensed','Mám licenciu alebo povolenie'],['official','Oficiálny press materiál']].map(([value,label])=>`<option value="${value}" ${value===(article.image_rights||'fallback')?'selected':''}>${label}</option>`).join('')}</select></label>${field('image_credit','Autor alebo povolenie k fotografii',article.image_credit)}<button type="button" data-remove-image>Použiť grafiku Nitra Space bez cudzej fotografie</button><label class="news-editorial-check"><input type="checkbox" name="editorial_reviewed" ${article.manual_review_required===false?'checked':''} required><span><b>Článok je hotový a overený</b>Potvrdzujem, že nadpis, zhrnutie a text sú vlastné spracovanie Nitra Space, neobsahujú pracovné pokyny a fakty som porovnal so zdrojmi.</span></label><div class="actions"><button type="submit">Uložiť ako DRAFT</button><button type="button" data-back>Späť</button></div><p class="muted">Kontrola licencie sa týka iba fotografie. Bez potvrdenej redakčnej kontroly článok nie je možné publikovať.</p></form><aside><h2>Náhľad karty</h2><div data-card-preview>${articleCard({...article,headline:article.headline||'Tvoj nadpis. Tvoje mesto.',slug:'preview',category:article.category||'Mesto'})}</div><button data-regenerate>REGENERATE CARD</button></aside></div>`)
  const form=document.querySelector('[data-editor]')
  form.editorial_reviewed.required=false
  if(article.image_rights==='source_unverified'){const option=new Option('Fotografia zo zdroja — práva ešte nie sú potvrdené','source_unverified',true,true);form.image_rights.add(option)}
  form.headline.required=true;form.headline.maxLength=180;form.source_name.required=true;form.source_url.required=true
  form.headline.oninput=()=>{if(!article.id)form.slug.value=slugify(form.headline.value)}
  document.querySelector('[data-back]').onclick=()=>renderNewsAdmin().catch(error=>notice(error.message))
  document.querySelector('[data-remove-image]').onclick=()=>{imageUrl=null;form.image_rights.value='fallback';notice('Fotografia bude odstránená po uložení.')}
  document.querySelector('[data-regenerate]').onclick=()=>{document.querySelector('[data-card-preview]').innerHTML=articleCard({headline:form.visual_headline.value||form.headline.value,cover_image_url:imageUrl,slug:'preview',category:form.category.value});notice('Náhľad obnovený. Serverová karta sa obnoví po uložení.')}
  form.querySelector('[data-image]').onchange=async e=>{
    const file=e.target.files[0];if(!file)return
    if(file.size>5242880||!['image/jpeg','image/png','image/webp'].includes(file.type)){notice('Použi JPG, PNG alebo WebP do 5 MB.');return}
    const submit=form.querySelector('[type=submit]');submit.disabled=true
    try {
      const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('Fotografia má príliš veľké rozlíšenie.')}
      const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob)throw new Error('Fotografiu nemožno spracovať.')
      const name=`${state.user.id}/${crypto.randomUUID()}.jpg`;const result=await db.storage.from('news-images').upload(name,blob,{contentType:'image/jpeg',upsert:false});if(result.error)throw result.error
      imageUrl=db.storage.from('news-images').getPublicUrl(name).data.publicUrl;form.image_rights.value='owned';notice('Fotografia nahraná. Doplň autora a potvrď práva.')
    }catch(error){notice(error.message)}finally{submit.disabled=false}
  }
  form.onsubmit=async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true
    const values=Object.fromEntries(new FormData(form));delete values.editorial_reviewed;values.slug=slugify(values.slug||values.headline);values.breaking=form.breaking.checked;values.cover_image_url=imageUrl;values.status='draft';values.manual_review_required=!form.editorial_reviewed.checked;values.card_version=(article.card_version||0)+1
    if(form.editorial_reviewed.checked){const problem=publishProblem({...article,...values});if(problem){notice(problem);button.disabled=false;return}}
    const result=article.id?await db.from('nitra_news').update(values).eq('id',article.id):await db.from('nitra_news').insert(values)
    if(result.error){notice(result.error.message);button.disabled=false}else{tab='draft';renderNewsAdmin()}
  }
}

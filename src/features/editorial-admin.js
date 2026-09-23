import {db,state,content,notice,navigate,onCleanup} from './runtime.js'
import {html,field,slugify,dateLabel,httpsUrl} from './shared.js'
import {renderTypographicCover,coverTemplates} from './news-cover.js'
import {newsCard,articleBody,usableNewsImage} from './editorial-news.js'
import {hasPlaceholder,publicationIssue} from './editorial-workflow.js'
const statuses={draft:'Návrhy',review:'Kontrola',scheduled:'Naplánované',published:'Publikované',failed:'Chyby',archived:'Archív'}
const sections={articles:'Témy a návrhy'}
let tab='work',page=0,categories=[],configPage=0
const split=v=>String(v||'').split(',').map(s=>s.trim()).filter(Boolean)
const select=(name,label,options,value)=>{const choices=name==='status'&&!options.some(([v])=>v==='rejected')?[...options,['rejected','Zamietnuté']]:options;return `<label>${label}<select name="${name}">${choices.map(([v,l])=>`<option value="${html(v)}" ${v===value?'selected':''}>${html(l)}</option>`).join('')}</select></label>`}
const check=(name,label,value)=>`<label><input type="checkbox" name="${name}" ${value?'checked':''}>${label}</label>`
const textArea=(name,label,value='',rows=4)=>`<label>${label}<textarea name="${name}" rows="${rows}">${html(value)}</textarea></label>`
function chrome(section,body){return `<nav class="ed-admin-nav">${Object.entries(sections).map(([k,v])=>`<a href="/admin/news?view=${k}" ${section===k?'aria-current="page"':''}>${v}</a>`).join('')}<a href="/polls">Ankety</a></nav>${body}`}
async function result(query){const r=await query;if(r.error)throw r.error;return r.data}
function bind(selector,fn){document.querySelectorAll(selector).forEach(el=>el.onclick=async()=>{el.disabled=true;try{await fn(el)}catch(e){notice(e.message)}finally{if(el.isConnected)el.disabled=false}})}
async function callApi(path,body){const {data}=await db.auth.getSession();if(!data.session)throw Error('Prihlásenie vypršalo.');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path==='/api/news-generate'?70000:30000);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(body),signal:controller.signal});const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(json.error||'Server nedokončil požiadavku.');return json}catch(error){if(error?.name==='AbortError')throw Error('Lokálna AI pracuje príliš pomaly. Draft zostal zachovaný; skús menší článok alebo spusti generovanie znova.');throw error}finally{clearTimeout(timer)}}
export async function renderAdmin(path){
 if(!state.user){content('<section class="empty"><h1>Redakcia.</h1><p>Prihlás sa svojím administrátorským účtom.</p><a href="/account">Prihlásiť sa →</a></section>');return}
 const allowed=await db.rpc('is_admin');if(allowed.error||allowed.data!==true){content('<section class="empty"><h1>Prístup zamietnutý.</h1><p>Tvoj účet nemá redakčné oprávnenie.</p></section>');return}
 categories=await result(db.from('nitra_news_categories').select('*').order('sort_order'))
 const articleId=new URLSearchParams(location.search).get('article');if(articleId)return editor(await result(db.from('nitra_news').select('*').eq('id',articleId).single()))
 const view=new URLSearchParams(location.search).get('view')||'articles'
 if(view==='articles')return articles()
 if(['sources','topics','categories'].includes(view))return configuration(view)
 if(view==='media')return media()
 if(view==='logs')return logs()
 return overview()
}
async function overview(){
 const counts=await Promise.all(Object.keys(statuses).map(async status=>{const r=await db.from('nitra_news').select('id',{count:'exact',head:true}).eq('status',status);if(r.error)throw r.error;return [status,r.count]}))
 const config=await result(db.from('nitra_news_automation').select('*').single())
 const sourceCheck=await db.from('nitra_news_sources').select('id',{count:'exact',head:true}).eq('enabled',true).eq('approved',true);if(sourceCheck.error)throw sourceCheck.error
 const runnableSources=sourceCheck.count||0
 const runtime=await callApi('/api/news-generate',{action:'status'}).catch(()=>({ai_configured:false,free_generation:true,cron_configured:false}))
 const runs=await result(db.from('nitra_news_ingestion_runs').select('*').order('started_at',{ascending:false}).limit(8))
 content(chrome('overview',`<h1>SPRÁVA<br>ČLÁNKOV.</h1><p>Nájdi články, vyber dobré návrhy a publikuj ich.</p>${runnableSources?`<p class="ed-discovery-ready"><strong>${runnableSources}</strong> zdroj je pripravený.</p>`:`<section class="ed-setup-warning" role="alert"><strong>Najprv pridaj zdroj článkov.</strong><p>Bez zdroja systém nemá kde hľadať.</p><a href="/admin/news?view=sources">Pridať zdroj →</a></section>`}<div class="ed-actions"><button class="primary" data-run>${runnableSources?'Nájsť články do Návrhov':'Pridať zdroj článkov'}</button><button data-new>+ Vlastný článok</button></div><p class="ed-run-status" role="status" data-run-status>${runnableSources?'Klikni a nájdené články sa uložia do Návrhov.':'Po pridaní zdroja sa sem vráť.'}</p><div class="ed-metrics">${counts.map(([s,n])=>`<div><strong>${n}</strong><span>${statuses[s]}</span></div>`).join('')}</div><details class="ed-advanced"><summary>Pokročilé nastavenia</summary><div class="ed-actions"><button data-pause>${config.paused?'Zapnúť automatizáciu':'Pozastaviť automatizáciu'}</button><button data-auto>Automatické vydanie: ${config.auto_publish?'ON':'OFF'}</button></div><p class="muted">AI: ${runtime.ai_configured?'NASTAVENÁ':'NENASTAVENÁ'} · Automatizácia: ${config.paused?'POZASTAVENÁ':'POVOLENÁ'} · Plánovač: ${runtime.cron_configured?'NASTAVENÝ':'NENASTAVENÝ'}</p></details><h2 style="margin-top:32px">POSLEDNÉ HĽADANIA</h2>${logRows(runs)}`))
 const runStatus=document.querySelector('[data-run-status]');if(runStatus&&runnableSources)runStatus.textContent='Klikni a nájdené články sa automaticky doplnia a uložia do Návrhov.'
 const runtimeStatus=document.querySelector('.ed-advanced .muted');if(runtimeStatus)runtimeStatus.textContent=`Generovanie: ${runtime.ai_configured?'AI':'BEZPLATNÉ ŠABLÓNY'} · Automatizácia: ${config.paused?'POZASTAVENÁ':'POVOLENÁ'} · Plánovač: ${runtime.cron_configured?'NASTAVENÝ':'NENASTAVENÝ'}`
 bind('[data-new]',()=>editor({}));bind('[data-pause]',async()=>{await result(db.from('nitra_news_automation').update({paused:!config.paused,updated_at:new Date().toISOString()}).eq('id',true));overview()})
 bind('[data-auto]',async()=>{if(!config.auto_publish&&!confirm('Povoliť automatické vydanie? Vyžaduje aj oficiálny povolený zdroj, povolenú tému a úspešnú faktickú kontrolu.'))return;await result(db.from('nitra_news_automation').update({auto_publish:!config.auto_publish}).eq('id',true));return overview()})
 bind('[data-run]',async button=>{if(!runnableSources){navigate('/admin/news?view=sources');return}const status=document.querySelector('[data-run-status]');button.textContent='Hľadám…';if(status)status.textContent='Hľadám najnovšie články…';try{const r=await callApi('/api/editorial-discover',{manual:true}),drafts=r.drafts||0,duplicates=r.duplicates||0;const message=drafts?`Pridané do Návrhov: ${drafts} nových článkov.`:`Nič nové. ${duplicates} článkov už v Návrhoch máš.`;notice(message);tab='work';page=0;await articles()}catch(error){if(status)status.textContent='Hľadanie zlyhalo: '+error.message;throw error}finally{if(button.isConnected)button.textContent='Nájsť články do Návrhov'}})
}
function logRows(rows){return rows.map(r=>`<div class="ed-log"><time>${html(dateLabel(r.started_at))}</time> · ${html(r.status)}<p>${r.checked} skontrolovaných / ${r.drafts} návrhov / ${r.duplicates} duplicít</p>${r.error?`<p>${html(r.error)}</p>`:''}${(r.report?.item_errors||[]).map(e=>`<p><a href="/admin/news?article=${e.article_id}">Chyba článku</a>: ${html(e.error)}</p>`).join('')}</div>`).join('')||'<p class="muted">Zatiaľ žiadne behy automatizácie.</p>'}
async function logs(){const rows=await result(db.from('nitra_news_ingestion_runs').select('*').order('started_at',{ascending:false}).limit(100)),generations=await result(db.from('nitra_news_generations').select('id,article_id,status,action,model,usage,error,created_at').order('created_at',{ascending:false}).limit(50));content(chrome('logs','<h1>AKTIVITA.</h1><button data-recover>Obnoviť spracovania prerušené pred viac ako 15 minútami</button>'+logRows(rows)+'<h2>AI GENEROVANIA</h2>'+generations.map(g=>`<div class="ed-log"><a href="/admin/news?article=${g.article_id}">${html(g.action)} · ${html(g.status)}</a><p>${html(g.model)} · ${html(dateLabel(g.created_at))}</p><p>${html(g.error||'')}</p><details><summary>Spotreba tokenov</summary><pre>${html(JSON.stringify(g.usage,null,2))}</pre></details></div>`).join('')));bind('[data-recover]',async()=>{const r=await callApi('/api/news-generate',{action:'recover'});notice(`Obnovených spracovaní: ${r.recovered}. Nič sa automaticky nepublikovalo.`);return logs()})}
async function articles(){
 const [rows,sources]=await Promise.all([
  result(db.from('nitra_news').select('*').in('status',['draft','review']).order('created_at',{ascending:false}).limit(200)),
  result(db.from('nitra_news_sources').select('*').eq('enabled',true).eq('approved',true).order('name'))
 ])
 const folders=[...sources.map(source=>[String(source.id),source.name]),['other','Ostatné']]
 const sourceById=new Map(sources.map(source=>[String(source.id),source]))
 const nitraSource=sources.find(source=>/nitra/i.test(source.name||''))
 const articleFolder=article=>{if(sourceById.has(String(article.source_id||'')))return String(article.source_id);if(nitraSource&&/nitrak\.sk|nitriak/i.test(article.source_name||''))return String(nitraSource.id);return 'other'}
 const cards=folder=>rows.filter(article=>articleFolder(article)===folder).map(article=>`<article class="ed-admin-row ed-admin-card"><img src="${html(usableNewsImage(article)||'/chrome-sculpture.png')}" alt="${html(article.cover_image_alt||'Obálka článku')}" loading="lazy"><div><small>${html(article.source_name||'Nitra Space')}</small><h2>${html(article.headline)}</h2><button class="primary" data-edit="${article.id}">Otvoriť návrh</button></div></article>`).join('')||'<p class="empty">V tomto priečinku zatiaľ nie sú návrhy.</p>'
 content(chrome('articles',`<h1>TÉMY.</h1><p class="ed-intro">Každý Google Alerts feed je jeden priečinok. Otvor ho a stlač Generovať články.</p><button class="primary" data-add-topic>+ Pridať tému</button><button data-complete-all>Spracovať všetky návrhy</button><form data-topic-form hidden>${field('name','Názov témy')}${field('endpoint','Google Alerts feed link','','url')}<label><input type="checkbox" name="confirmed" required>Feed používam na vyhľadanie zdrojov a pri článku uvediem pôvodný zdroj.</label><div class="ed-actions"><button type="submit">Uložiť tému</button><button type="button" data-cancel-topic>Zrušiť</button></div></form><h2>MOJE TÉMY</h2><div class="ed-folder-grid">${folders.map(([key,label])=>{const count=rows.filter(article=>articleFolder(article)===key).length;return `<button type="button" class="ed-folder-card" data-simple-folder="${key}"><strong>${html(label)}</strong><span>${count} návrhov</span><em>Otvoriť →</em></button>`}).join('')}</div>${folders.map(([key,label])=>`<section data-simple-panel="${key}" hidden><div class="ed-actions">${key!=='other'?`<button class="primary" data-generate-folder="${key}">Generovať články: ${html(label)}</button>`:''}</div><p role="status" data-folder-status="${key}"></p>${cards(key)}</section>`).join('')}`))
 const topicForm=document.querySelector('[data-topic-form]')
 bind('[data-add-topic]',()=>{topicForm.hidden=false;topicForm.elements.name.focus()})
 bind('[data-cancel-topic]',()=>{topicForm.hidden=true})
 topicForm.onsubmit=async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(topicForm));const endpoint=String(values.endpoint||'').trim();if(!/^https:\/\/www\.google\.com\/alerts\/feeds\//i.test(endpoint))throw Error('Vlož celý Google Alerts feed link.');await result(db.from('nitra_news_sources').insert({name:String(values.name||'').trim(),endpoint,website_url:'https://www.google.com/alerts',adapter:'rss',enabled:true,approved:true,priority:0,frequency_minutes:60,trust_level:'standard',license_notes:'Google Alerts feed sa používa iba na vyhľadanie pôvodných zdrojov.'}));notice('Téma bola pridaná.');return articles()}
 bind('[data-simple-folder]',button=>{const folder=button.dataset.simpleFolder;document.querySelectorAll('[data-simple-panel]').forEach(panel=>panel.hidden=panel.dataset.simplePanel!==folder);document.querySelectorAll('[data-simple-folder]').forEach(card=>card.setAttribute('aria-pressed',card===button));document.querySelector(`[data-simple-panel="${folder}"]`)?.scrollIntoView({behavior:'smooth',block:'start'})})
 bind('[data-complete-all]',async button=>{if(!rows.length){notice('V Návrhoch zatiaľ nič nie je.');return}if(!confirm(`Spracovať všetkých ${rows.length} návrhov? Vytvorí sa vlastný text a doplní sa fotka do každého draftu.`))return;let done=0,failed=0;for(const article of rows){button.textContent=`Spracúvam ${done+failed+1}/${rows.length}…`;try{const generated=await callApi('/api/news-generate',{article_id:article.id,action:'write'});if(!generated?.cover_image_url)await callApi('/api/news-generate',{article_id:article.id,action:'image'});done++}catch{failed++}}notice(`Spracované návrhy: ${done}${failed?` · nepodarilo sa: ${failed}`:''}. Nič sa automaticky nepublikovalo.`);return articles()})
 bind('[data-generate-folder]',async button=>{const folder=button.dataset.generateFolder,source=sourceById.get(folder),status=document.querySelector(`[data-folder-status="${folder}"]`);if(!source)return;const local=/nitra/i.test(source.name||'');status.textContent=local?'Načítavam najnovšie správy priamo z Nitriak.sk…':'Hľadám najnovšie články…';const response=local?await callApi('/api/news-discover',{source_id:source.id}):await callApi('/api/editorial-discover',{source_id:source.id,manual:true});notice(response.drafts?`Pridané nové návrhy: ${response.drafts}.`:`Nič nové. ${response.duplicates||0} článkov už máš.`);return articles()})
 bind('[data-edit]',button=>editor(rows.find(article=>article.id===button.dataset.edit)))
}

async function legacyArticles(){
 let query=db.from('nitra_news').select('*')
 query=tab==='work'?query.in('status',['draft','review']):query.eq('status',tab)
 const rows=await result(query.order('created_at',{ascending:false}).order('id').range(page*30,page*30+29))
 const tabLabels={work:'Pracovné návrhy',...statuses}
 const folderOf=a=>{const t=String(`${a.headline||''} ${a.source_name||''} ${a.category||''}`).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return /rap|rapper|hip[\s-]?hop|kanye|carti|travis|music|hudba/.test(t)?'rap':/nitra|nitre|nitru|nitry|agrokomplex|ukf|nitriansky/.test(t)?'nitra':/slovak|slovakia|czech|cesk|slovensko|sk[\s/_-]?cz/.test(t)?'skcz':'other'}
 const folderTabs='<div class="ed-tabs" data-article-folders><button data-article-folder="all" aria-pressed="true">Všetky</button><button data-article-folder="nitra">Nitra</button><button data-article-folder="rap">Rap / hudba</button><button data-article-folder="skcz">Slovensko / Česko</button><button data-article-folder="other">Ostatné</button></div>'
 content(chrome('articles',`<h1>REDAKCIA.</h1><p class="ed-intro">Tu vidíš všetky nájdené aj prepísané články. Otvor kartu, skontroluj text a fotku, potom ju publikuj.</p><div class="ed-actions"><button class="primary" data-new>+ Nový článok</button><button data-complete-selected>Doplniť vybrané</button><button data-bulk>Archivovať vybrané</button></div><div class="ed-tabs">${Object.entries(tabLabels).map(([s,l])=>`<button data-status="${s}" aria-pressed="${tab===s}">${l}</button>`).join('')}</div>${folderTabs}<label class="ed-search">Hľadať v návrhoch<input data-article-search type="search" placeholder="Názov, zdroj alebo kategória…"></label><p class="ed-list-help">${rows.length} zobrazených · Vyber návrhy a jedným klikom doplň text aj obrázok zo zdroja.</p>${rows.map(a=>{const folder=folderOf(a),cover=usableNewsImage(a),image=Boolean(cover),imageVerified=image&&['owned','licensed','official'].includes(a.image_rights),textReady=String(a.summary||'').trim().length>=80&&String(a.content||'').trim().length>=300&&!/redakčný podklad|pred vydaním|pred publikovaním|návrh z portálu/i.test(String(a.summary||'')+' '+String(a.content||'')),changed=Boolean(a.ai_generated||a.cover_image_url||a.updated_at!==a.created_at),english=/\b(the|and|what|who|how|new|news|rapper|artist|album|music|favorite|means|underground|trial|acquitted|announces|announce|release|released|says|this|that|calls|calling|hosting|full|circle|moment|found|not|guilty|timely|arbitrary|arrests|for|with|from|your|is|are|on|in|of|to|a|an)\b/i.test(String(a.headline||''));return `<article class="ed-admin-row ed-admin-card" data-admin-card data-article-folder="${folder}" data-search="${html(`${a.headline} ${a.source_name} ${a.category}`.toLowerCase())}"><img src="${html(cover||'/chrome-sculpture.png')}" alt="${html(a.cover_image_alt||'Automatická strieborná chrome obálka Nitra Space')}" loading="lazy"><div><div class="ed-admin-topline"><label><input type="checkbox" data-select="${a.id}">${html(a.category||'Mesto')} / ${html(a.source_name||'Neznámy zdroj')}</label><span class="ed-state-pill ${a.status}">${html(statuses[a.status]||a.status)}</span></div><h2>${html(a.headline)}</h2><small>Objavené ${html(dateLabel(a.created_at))}${a.source_published_at?' · Zdroj '+html(dateLabel(a.source_published_at)):''}${a.scheduled_at?' · Plán '+html(dateLabel(a.scheduled_at)):''}</small><div class="ed-card-checks"><span class="${textReady?'is-ok':'is-missing'}">${textReady?'✓ Text hotový':'! Doplniť text'}</span><span class="${image&&!imageVerified?'is-missing':'is-ok'}">${image?(imageVerified?'✓ Fotka pripravená':'! Over práva fotky'):'✓ Chrome obálka'}</span>${changed?'<span class="is-changed">● Zmenené</span>':''}</div><div class="ed-actions"><button class="primary" data-edit="${a.id}">Otvoriť a upraviť</button>${!textReady||!image?`<button data-complete="${a.id}">Doplniť text + obrázok</button>`:''}${english?`<button data-translate="${a.id}">Preložiť do slovenčiny</button>`:''}<button data-copy="${a.id}">Duplikovať</button><button data-archive="${a.id}">Archivovať</button><button data-delete="${a.id}">Vymazať</button></div></div></article>`}).join('')||'<p class="empty">V tomto stave zatiaľ nie sú články.</p>'}<div class="ed-actions"><button data-prev ${page?'':'disabled'}>Predchádzajúce</button><button data-next ${rows.length===30?'':'disabled'}>Ďalšie</button></div>`))
 document.querySelectorAll('[data-admin-card]').forEach(card=>{const heading=card.querySelector('h2')?.textContent||'';if(/[áäčďéíľňóôŕšťúýž]/i.test(heading))card.querySelector('[data-translate]')?.remove()})
 bind('[data-new]',()=>editor({}));bind('[data-status]',b=>{tab=b.dataset.status;page=0;return articles()});bind('[data-prev]',()=>{page--;return articles()});bind('[data-next]',()=>{page++;return articles()})
 const search=document.querySelector('[data-article-search]');if(search)search.oninput=()=>{const needle=search.value.trim().toLowerCase();document.querySelectorAll('[data-admin-card]').forEach(card=>{card.hidden=Boolean(needle&&!card.dataset.search.includes(needle))})}
 bind('[data-article-folder]',button=>{const folder=button.dataset.articleFolder;document.querySelectorAll('[data-article-folder]').forEach(b=>b.setAttribute('aria-pressed',b===button));document.querySelectorAll('[data-admin-card]').forEach(card=>{card.hidden=folder!=='all'&&card.dataset.articleFolder!==folder})})
 bind('[data-edit]',b=>editor(rows.find(a=>a.id===b.dataset.edit)))
  bind('[data-translate]',async b=>{
   if(!confirm('Preložiť tento anglický návrh do slovenčiny? Existujúci text sa nahradí. Bez poplatku.'))return
   notice('Prekladám titulok, perex aj text…')
   await callApi('/api/news-generate',{article_id:b.dataset.translate,action:'translate'})
   notice('Preklad dokončený. Návrh je uložený v pracovných návrhoch.')
   return articles()
  })
  async function completeOne(article,progress=''){
   if(!article)return
   const textReady=String(article.summary||'').trim().length>=80&&String(article.content||'').trim().length>=300&&!/redakčný podklad|pred vydaním|pred publikovaním|návrh z portálu/i.test(String(article.summary||'')+' '+String(article.content||''))
   let generated=null,textError=null,imageError=null
   if(!textReady){notice(progress||'Dopĺňam vlastný text z uložených podkladov…');try{generated=await callApi('/api/news-generate',{article_id:article.id,action:'write'})}catch(error){textError=error}}
   if(!usableNewsImage(article)&&!generated?.cover_image_url){try{await callApi('/api/news-generate',{article_id:article.id,action:'image'})}catch(error){imageError=error;await result(db.from('nitra_news').update({cover_image_alt:'Automatická strieborná chrome obálka Nitra Space',cover_chrome:true,image_rights:'fallback'}).eq('id',article.id))}}
   if(textError)throw textError
   return {imageFallback:Boolean(imageError)}
  }
  bind('[data-complete]',async b=>{
   const article=rows.find(a=>a.id===b.dataset.complete);if(!article)return
   if(!confirm('Doplniť text z uložených zdrojových podkladov a nájsť obrázok priamo na zdroji?'))return
   const done=await completeOne(article,'Dopĺňam text a hľadám obrázok…');notice(done?.imageFallback?'Text je hotový. Zdroj nemal použiteľnú fotku, preto zostala chrome obálka.':'Hotovo. Návrh má text aj obrázok zo zdroja; pred publikovaním over práva.');return articles()
  })
  bind('[data-complete-selected]',async b=>{
   const selected=[...document.querySelectorAll('[data-select]:checked')].map(input=>rows.find(a=>a.id===input.dataset.select)).filter(Boolean)
   if(!selected.length){notice('Najprv zaškrtni návrhy, ktoré chceš doplniť.');return}
   if(!confirm(`Doplniť text a nájsť obrázky zo zdrojov pri ${selected.length} vybraných návrhoch?`))return
   let completed=0,failed=0
   for(let i=0;i<selected.length;i++){b.textContent=`Dopĺňam ${i+1}/${selected.length}…`;try{await completeOne(selected[i],`Dopĺňam ${i+1}/${selected.length}…`);completed++}catch{failed++}}
   notice(`Doplnené návrhy: ${completed}${failed?` · bez zdrojových podkladov: ${failed}`:''}. Skontroluj fakty aj práva k načítaným obrázkom.`);return articles()
  })
  bind('[data-copy]',async b=>{
  const original=rows.find(a=>a.id===b.dataset.copy);if(!original)return
  const suffix=Date.now().toString(36),a={...original};
  delete a.id;delete a.fingerprint;delete a.published_at;delete a.created_at;delete a.updated_at;
  a.headline=`${String(original.headline||'Článok')} (kópia)`.slice(0,180);
  a.cover_headline=String(original.cover_headline||original.headline||'').slice(0,180);
  a.slug=`${slugify(a.headline).slice(0,145)}-kopia-${suffix}`.slice(0,180);
  // source_url is intentionally unique in the database; keep the original
  // source while making this independent draft addressable and publishable.
  const sourceUrl=String(original.source_url||'https://www.nitraspace.xyz');
  a.source_url=`${sourceUrl}${sourceUrl.includes('?')?'&':'?'}nitra-copy=${suffix}`;
  a.status='draft';a.manual_review_required=true;a.ai_generated=false;a.published_at=null;
  delete a.generation_error;
  const inserted=await result(db.from('nitra_news').insert(a).select('id'));
  if(!inserted.length)throw Error('Kópiu sa nepodarilo uložiť.');
  notice('Kópia uložená v Návrhoch.');tab='draft';page=0;return articles()
 })
 bind('[data-archive]',async b=>{await result(db.from('nitra_news').update({status:'archived'}).eq('id',b.dataset.archive));return articles()})
 bind('[data-delete]',async b=>{if(!confirm('Natrvalo vymazať článok? Jeho redakčná história zostane uchovaná.'))return;await result(db.from('nitra_news').delete().eq('id',b.dataset.delete));return articles()})
 bind('[data-bulk]',async()=>{const ids=[...document.querySelectorAll('[data-select]:checked')].map(b=>b.dataset.select);if(!ids.length||!confirm(`Archivovať ${ids.length} článkov?`))return;await result(db.from('nitra_news').update({status:'archived'}).in('id',ids));return articles()})
}
async function upload(file,credit,rights){
 if(!file||file.size>5242880||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Použi JPG, PNG alebo WebP do 5 MB.')
 if(!credit.trim())throw Error('Najprv doplň autora fotografie a práva.')
 const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('Fotografia je príliš veľká.')}
 const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));if(!blob)throw Error('Spracovanie fotografie zlyhalo.')
 const path=`${state.user.id}/${crypto.randomUUID()}.jpg`;await result(db.storage.from('news-images').upload(path,blob,{contentType:'image/jpeg',upsert:false}))
 const url=db.storage.from('news-images').getPublicUrl(path).data.publicUrl
 await result(db.from('nitra_news_media').insert({url,storage_path:path,credit,rights:rights==='fallback'?'owned':rights}));return url
}
async function editor(article){
  let image=usableNewsImage(article)||null,id=article.id,busy=false,dirty=false,previewMode='card',pendingSave=Promise.resolve(),operating=false
 const needsEditorialContent=!String(article.summary||'').trim()||!String(article.content||'').trim()
 const contentWarning=needsEditorialContent?`<section class="ed-setup-warning" role="alert"><strong>Tento starší návrh ešte nie je hotový.</strong><p>Chýba vlastný text alebo perex${article.cover_image_url?'':' — ako bezpečný vizuál sa používa automatická chrome obálka'}. Ak má návrh uložené zdrojové podklady, klikni vedľa náhľadu na „Doplniť text a obálku“. Nové nájdené články sa už spracujú automaticky.</p></section>`:''
 const generationRows=id?await result(db.from('nitra_news_generations').select('*').eq('article_id',id).order('created_at',{ascending:false}).limit(10)):[]
 const mediaRows=await result(db.from('nitra_news_media').select('*').order('created_at',{ascending:false}).limit(40))
 content(chrome('articles',`<div class="ed-editor-grid"><form data-editor><h2>${id?'UPRAVIŤ ČLÁNOK':'NOVÝ ČLÁNOK'}</h2>${contentWarning}${field('headline','Nadpis',article.headline)}${field('slug','Slug',article.slug)}${field('subheadline','Podnadpis',article.subheadline)}${textArea('summary','Perex',article.summary)}${textArea('content','Text článku — vlastné faktické spracovanie',article.content,14)}${select('category_id','Kategória',categories.map(c=>[c.id,c.name]),article.category_id||categories.find(c=>c.name===article.category)?.id)}${field('tags','Tagy, oddelené čiarkou',(article.tags||[]).join(', '))}${field('source_name','Zdroj faktov',article.source_name||'Redakcia Nitra Space')}${field('source_url','Pôvodný zdroj (HTTPS)',article.source_url||'https://www.nitraspace.xyz','url')}${field('source_published_at','Čas vydania zdroja',localTime(article.source_published_at),'datetime-local')}<h3>TYPOGRAFICKÁ OBÁLKA</h3>${select('cover_template','Šablóna',[['auto','Automaticky'],...coverTemplates.map(t=>[t,t])],article.cover_template||'auto')}${textArea('cover_headline','Nadpis obálky — riadky môžeš zalomiť ručne',article.cover_headline||article.headline)}${check('cover_chrome','Strieborný chrome prvok',article.cover_chrome!==false)}${field('cover_number','Číslo článku',article.cover_number||1,'number')}<button type="button" data-regenerate>Iné rozloženie</button>${field('cover_image_alt','Popis fotografie',article.cover_image_alt)}${field('image_credit','Autor / povolenie',article.image_credit)}${select('image_rights','Práva k fotografii',[['fallback','Bez cudzej fotografie'],['source_unverified','Fotografia zo zdroja — over práva'],['owned','Vlastná fotografia'],['licensed','Licencia / povolenie'],['official','Povolený press materiál']],article.image_rights||'fallback')}<label>Nahrať fotografiu (max. 5 MB)<input type="file" data-upload accept="image/jpeg,image/png,image/webp"></label>${select('media','Vybrať z médií',[['','Vyber fotografiu'],...mediaRows.map(m=>[m.id,m.credit+' · '+m.created_at.slice(0,10)])],'')}<button type="button" data-fallback>Použiť typografickú obálku</button>${select('layout','Rozloženie',[['standard','Štandard'],['featured','Featured'],['compact','Kompaktné'],['breaking','Breaking']],article.layout||'standard')}${check('featured','Hlavný článok',article.featured)}${check('breaking','Breaking',article.breaking)}${check('sensitive','Citlivá téma — povinná kontrola',article.sensitive)}<details><summary>SEO a zdieľanie</summary>${field('seo_title','SEO titulok',article.seo_title)}${field('seo_description','SEO popis',article.seo_description)}${field('social_title','Social titulok',article.social_title)}${field('social_description','Social popis',article.social_description)}</details>${select('status','Stav',Object.entries(statuses),article.status||'draft')}${field('published_at','Dátum vydania',localTime(article.published_at),'datetime-local')}${field('scheduled_at','Naplánovať na (tvoj miestny čas)',localTime(article.scheduled_at),'datetime-local')}${check('reviewed','Overil/a som fakty, vlastný text a práva k fotografiám.',article.manual_review_required===false)}<p class="ed-editor-status" role="status" data-save-state>Neuložené zmeny sa automaticky ukladajú iba pri existujúcom DRAFTe.</p><div class="ed-actions"><button type="submit">Uložiť</button><button type="button" data-state="draft">Uložiť draft / stiahnuť z webu</button><button type="button" data-state="published">Publikovať teraz</button><button type="button" data-state="scheduled">Naplánovať</button><button type="button" data-state="rejected">Zamietnuť</button><button type="button" data-state="archived">Archivovať</button><button type="button" data-back>Späť</button></div></form><aside><div class="ed-tabs"><button data-preview="card">Karta</button><button data-preview="article">Článok</button><button data-preview="social">Social</button></div><div data-preview-host></div>${id?`<div class="ed-actions"><button data-export="feed">Export 1080 × 1350</button><button data-export="story">Export 1080 × 1920</button><button data-export="og">OG 1200 × 630</button></div>`:''}<div class="ed-actions">${[['write','Vytvoriť článok'],['rewrite','Prepísať'],['shorten','Skrátiť'],['new_headline','Nový nadpis'],['new_perex','Nový perex'],['reprocess','Znovu spracovať podklady']].map(([action,label])=>`<button data-ai="${action}" title="Vyžaduje nastavenú AI v Pokročilých nastaveniach">${label}</button>`).join('')}</div><p>${html(article.generation_error||'')}</p><h3>HISTÓRIA AI</h3>${generationRows.map(g=>`<details><summary>${html(g.action)} · ${html(g.status)} · ${html(dateLabel(g.created_at))}</summary><p>${html(g.error||'')}</p><pre class="ed-generation-data">${html(JSON.stringify({facts:g.fact_sheet,output:g.output,usage:g.usage},null,2))}</pre></details>`).join('')||'<p>Zatiaľ bez generovania.</p>'}<h3>FAKTY ZO ZDROJOV</h3><p class="muted">${html(JSON.stringify(article.source_facts||[]))}</p>${id?'<button data-history>História zmien</button><div data-history-host></div>':''}</aside></div>`))
  const generationButtons=[...document.querySelectorAll('[data-ai]')];generationButtons.slice(1).forEach(button=>button.remove());if(generationButtons[0]){generationButtons[0].textContent='Doplniť text a obálku';generationButtons[0].title='Bezplatne doplní vlastný článok zo zdrojových podkladov a použije chrome obálku.';if(id){const translate=document.createElement('button');translate.type='button';translate.dataset.ai='translate';translate.textContent='Preložiť do slovenčiny';translate.title='Bezplatne preloží anglický návrh do slovenčiny.';generationButtons[0].parentElement.append(translate);const imageButton=document.createElement('button');imageButton.type='button';imageButton.dataset.ai='image';imageButton.textContent='Nájsť obrázok';imageButton.title='Nájde náhľadový obrázok zo zdrojovej stránky a uloží ho do draftu.';generationButtons[0].parentElement.append(imageButton)}}
 const form=document.querySelector('[data-editor]'),saved=document.querySelector('[data-save-state]')
 document.querySelector('[data-regenerate]').onclick=()=>{form.cover_template.value=coverTemplates[(coverTemplates.indexOf(form.cover_template.value)+1)%coverTemplates.length];dirty=true;preview()}
 form.headline.required=true;form.headline.maxLength=180;form.cover_headline.maxLength=180;form.summary.maxLength=600;form.content.maxLength=40000
 function values(){const v=Object.fromEntries(new FormData(form));delete v.media;delete v.reviewed;v.slug=slugify(v.slug||v.headline);v.category=categories.find(c=>c.id===v.category_id)?.name||'Mesto';v.category_id=v.category_id||null;v.cover_image_url=image;v.tags=split(v.tags).slice(0,12);v.cover_number=Math.max(1,Math.min(9999,Number(v.cover_number)||1));for(const k of ['breaking','featured','sensitive','cover_chrome'])v[k]=form[k].checked;v.manual_review_required=!form.reviewed.checked;v.image_rights=image?v.image_rights:'fallback';v.published_at=v.published_at?new Date(v.published_at).toISOString():null;v.scheduled_at=v.scheduled_at?new Date(v.scheduled_at).toISOString():null;v.source_published_at=v.source_published_at?new Date(v.source_published_at).toISOString():null;return v}
 async function exclusive(task){
  if(operating)return
  operating=true;form.inert=true
  const buttons=[...document.querySelectorAll('[data-ai],[data-state],[data-export],[data-back]')]
  buttons.forEach(button=>button.disabled=true)
  try{return await task()}catch(error){saved.textContent=error.message;saved.setAttribute('role','alert');notice(error.message)}
  finally{operating=false;form.inert=false;buttons.forEach(button=>button.disabled=false)}
 }
 async function generate(action){
  await pendingSave
  if(!id||dirty){notice('Ukladám…');if(!await save())throw Error(saved.textContent)}
  const label=action==='image'?'Hľadám fotografiu…':action==='translate'?'Prekladám text…':'Spracúvam text…',started=Date.now()
  const progress=()=>{const message=`${label} ${Math.floor((Date.now()-started)/1000)} s`;saved.textContent=message;notice(message)}
  progress();const timer=setInterval(progress,1000)
  try{
   const outcome=await callApi('/api/news-generate',{article_id:id,action})
   const fresh=await result(db.from('nitra_news').select('*').eq('id',id).single().abortSignal(AbortSignal.timeout(20000)))
   clearInterval(timer);await editor(fresh)
   notice(action==='image'?(outcome.fallback?(outcome.reason||'Vhodná fotografia sa nenašla. Použitá je chrome obálka.'):'Fotografia uložená. Rovnaký obrázok je vo všetkých troch formátoch.'):'Vlastný text je uložený ako draft. Skontroluj ho a potom publikuj.')
  }finally{clearInterval(timer)}
 }
 function preview(){const a={...article,...values()};try{document.querySelector('[data-preview-host]').innerHTML=previewMode==='social'?['feed','story','og'].map(format=>`<figure><figcaption>${{feed:'Príspevok · 1080 × 1350',story:'Story · 1080 × 1920',og:'Odkaz · 1200 × 630'}[format]}</figcaption><div class="ed-cover-preview">${renderTypographicCover({...a,headline:a.headline||'NOVÝ ČLÁNOK'},format)}</div></figure>`).join(''):previewMode==='article'?articleBody(a):newsCard({...a,headline:a.headline||'TVOJ NOVÝ ČLÁNOK.',layout:a.layout})}catch(error){document.querySelector('[data-preview-host]').innerHTML=`<p role="alert">${html(error.message)}</p>`}}
 form.addEventListener('input',()=>{dirty=true;preview()});form.headline.addEventListener('input',()=>{if(!id)form.slug.value=slugify(form.headline.value)})
 function save(auto=false){
  if(auto&&(operating||busy||!id||article.status!=='draft'||form.status.value!=='draft'||!dirty))return Promise.resolve(false)
  pendingSave=pendingSave.then(async()=>{
   const payload=values(),snapshot=JSON.stringify(payload)
   busy=true;saved.textContent='Ukladám…'
   try{
    let q=id?db.from('nitra_news').update(payload).eq('id',id):db.from('nitra_news').insert(payload)
    // Save the current form snapshot by row ID; do not queue stale snapshots.
    const rows=await result(q.select('id,updated_at,status').abortSignal(AbortSignal.timeout(20000)))
    if(!rows.length)throw Error('Databáza nevrátila uložený článok. Článok už neexistuje alebo účet nemá oprávnenie na jeho úpravu.')
    id=rows[0].id;article.status=rows[0].status
    dirty=JSON.stringify(values())!==snapshot;saved.setAttribute('role','status');saved.textContent='Uložené '+new Date().toLocaleTimeString('sk-SK')
    return rows[0].status===payload.status
   }catch(e){saved.setAttribute('role','alert');saved.textContent='Neuložené: '+e.message;notice(e.message);return false}
   finally{busy=false}
  })
  return pendingSave
 }
 form.onsubmit=e=>{e.preventDefault();exclusive(()=>changeState(form.status.value))}
 async function changeState(target){
  await pendingSave
  const v={...values(),status:target}
  if(['published','scheduled'].includes(target)){
   if(hasPlaceholder(v)){form.status.value='draft';dirty=true;await generate('write');return}
   const issue=publicationIssue(v)
   if(issue){saved.textContent=issue;saved.setAttribute('role','alert');notice(issue);saved.scrollIntoView({block:'center'});return}
  }
  if(target==='published'&&!confirm('Publikovať tento článok pre návštevníkov?'))return
  const previousStatus=form.status.value
  form.status.value=target
  if(target==='published')form.published_at.value=localTime(new Date().toISOString())
  dirty=true
  const success=await save()
  if(!success){form.status.value=previousStatus;return}
  if(target==='published'){
   saved.textContent='Článok je publikovaný. '
   const link=document.createElement('a');link.href='/news/'+form.slug.value;link.textContent='Otvoriť článok →';saved.append(link)
   notice('Publikované. Otváram článok v NEWS.');navigate(link.getAttribute('href'))
  }
 }
 bind('[data-state]',b=>exclusive(()=>changeState(b.dataset.state)))
 bind('[data-back]',()=>{if(!dirty||confirm('Odísť s neuloženými zmenami?'))return articles()});bind('[data-preview]',b=>{previewMode=b.dataset.preview;preview()})
 form.querySelector('[data-upload]').onchange=async e=>{try{image=await upload(e.target.files[0],form.image_credit.value,form.image_rights.value);if(form.image_rights.value==='fallback')form.image_rights.value='owned';previewMode='card';dirty=true;preview();notice('Fotografia nahraná. Ulož článok.')}catch(e){saved.textContent=e.message;saved.setAttribute('role','alert');notice(e.message)}}
 form.media.onchange=()=>{const m=mediaRows.find(m=>m.id===form.media.value);if(!m)return;image=m.url;form.image_credit.value=m.credit;form.image_rights.value=m.rights;form.cover_image_alt.value=m.alt;previewMode='card';dirty=true;preview()}
 bind('[data-export]',async b=>{if(dirty)throw Error('Pred exportom ulož zmeny.');const {data}=await db.auth.getSession();if(!data.session)throw Error('Prihlásenie vypršalo. Prihlás sa znova.');const response=await fetch(`/api/news-card?id=${id}&format=${b.dataset.export}`,{headers:{Authorization:`Bearer ${data.session.access_token}`}});if(!response.ok){const failure=await response.json().catch(()=>({}));throw Error(failure.error||`Export zlyhal (${response.status}).`)}const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=`nitra-space-${id}-${b.dataset.export}.png`;link.rel='noopener';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notice('PNG export je pripravený v stiahnutých súboroch.')})
 bind('[data-ai]',b=>exclusive(()=>generate(b.dataset.ai)))
 bind('[data-fallback]',()=>{image=null;form.image_rights.value='fallback';form.image_credit.value='Nitra Space';form.cover_image_alt.value='Strieborná chrome obálka Nitra Space';form.cover_chrome.checked=true;dirty=true;preview();notice('Zvolená je chrome obálka. Ulož článok.')})
 bind('[data-history]',async()=>{const rows=await result(db.from('nitra_news_revisions').select('*').eq('article_id',id).order('created_at',{ascending:false}).limit(30));document.querySelector('[data-history-host]').innerHTML=rows.map(r=>`<p>${html(dateLabel(r.created_at))} · ${html(r.operation)} <button data-restore="${r.id}">Obnoviť ako draft</button></p>`).join('');bind('[data-restore]',async b=>{if(!confirm('Obnoviť staršiu verziu ako nepublikovaný draft?'))return;const old=rows.find(r=>String(r.id)===b.dataset.restore).snapshot;const allowed=Object.keys(values());const restore=Object.fromEntries(allowed.filter(k=>k in old).map(k=>[k,old[k]]));restore.status='draft';restore.manual_review_required=true;await result(db.from('nitra_news').update(restore).eq('id',id));return editor(await result(db.from('nitra_news').select('*').eq('id',id).single()))})})
 const timer=setInterval(()=>{if(form.isConnected&&!document.hidden)save(true)},20000);onCleanup(()=>clearInterval(timer));preview()
}
function localTime(s){if(!s)return '';const d=new Date(s);if(Number.isNaN(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
async function media(){const rows=await result(db.from('nitra_news_media').select('*').order('created_at',{ascending:false}).limit(60));content(chrome('media','<h1>MÉDIÁ.</h1><p>Fotografie nahraj cez editor článku. Ukladajú sa sem aj s právami.</p><div class="ed-media-grid">'+rows.map(m=>`<div><img src="${html(httpsUrl(m.url))}" alt="${html(m.alt)}" loading="lazy"><p>${html(m.credit)}<br>${html(m.rights)}</p></div>`).join('')+'</div>'))}
function sourceFolder(row){
 const text=String(`${row.name||''} ${row.endpoint||''} ${row.website_url||''}`).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 if(/\b(rap|rapper|hip[\s-]?hop|kanye|carti|travis|music|hudba)\b/.test(text)) return 'rap'
 if(/\b(nitra|nitre|nitru|nitry|agrokomplex|ukf|nitriansky)\b/.test(text)) return 'nitra'
 if(/\b(slovak|slovakia|czech|cesk|slovensko|sk[\s/_-]?cz)\b/.test(text)) return 'skcz'
 return 'other'
}

async function configuration(type){
 const table={sources:'nitra_news_sources',topics:'nitra_news_topics',categories:'nitra_news_categories'}[type],rows=await result(db.from(table).select('*').order('id').range(configPage*50,configPage*50+49)),feedRows=type==='topics'?await result(db.from('nitra_news_sources').select('id,name,endpoint,enabled,approved').order('name')):[]
 const help=type==='sources'?'<p class="ed-intro">Každý zdroj je samostatný feed. Spusti ho zvlášť a jeho výsledky sa označia názvom zdroja.</p>':type==='topics'?'<p class="ed-intro">Každá téma má vlastné slová a môže byť napojená na konkrétny feed. Rap, Nitra aj ďalšie hľadaj oddelene.</p>':''
 const scopeFilters=type==='topics'?'<div class="ed-tabs" data-scope-filters><button data-scope="all" aria-pressed="true">Všetky témy</button><button data-scope="nitra">Nitra</button><button data-scope="sk_cz">Slovensko / Česko</button><button data-scope="global">Svet / Rap</button></div>':''
 const folderFilters=type==='sources'?'<div class="ed-tabs" data-folder-filters><button data-folder="all" aria-pressed="true">Všetky feedy</button><button data-folder="nitra">Nitra</button><button data-folder="rap">Rap / hudba</button><button data-folder="skcz">Slovensko / Česko</button><button data-folder="other">Ostatné</button></div>':''
 content(chrome(type,`<h1>${sections[type]}.</h1>${help}${scopeFilters}${folderFilters}${type==='sources'&&!rows.length?'<section class="ed-setup-warning" role="status"><strong>Zatiaľ tu nie je žiadny zdroj.</strong><p>Klikni na „+ Pridať“, vlož HTTPS adresu povoleného RSS/Atom/JSON feedu, zaškrtni povolenie aj „Zapnuté“ a ulož.</p></section>':''}<button data-config-new>+ Pridať</button><div class="ed-actions"><button data-config-prev ${configPage?'':'disabled'}>Predchádzajúce</button><button data-config-next ${rows.length===50?'':'disabled'}>Ďalšie</button></div><div data-config-editor></div>${rows.map(r=>{const folder=type==='sources'?sourceFolder(r):'other',folderLabel={nitra:'NITRA',rap:'RAP / HUDBA',skcz:'SK / CZ',other:'OSTATNÉ'}[folder],scopeValue=type==='topics'?(r.scope||'nitra'):'all',scope=type==='topics'&&r.source_filters?.length?` · Iba feedy: ${r.source_filters.map(id=>feedRows.find(s=>s.id===id)?.name||id).join(', ')}`:'';return `<div class="ed-admin-row" data-topic-scope="${scopeValue}" data-source-folder="${folder}"><div>${r.enabled?'ON':'OFF'}</div><div><h2>${html(r.name||r.label)}${type==='sources'?` <small class="ed-folder-label">${folderLabel}</small>`:''}</h2><p>${html((r.endpoint||r.query||r.slug)+scope)}</p><div class="ed-actions"><button data-config-edit="${r.id}">Upraviť</button><button data-config-delete="${r.id}">Vymazať</button>${type==='sources'?`<button data-source-run="${r.id}">Hľadať tento feed</button>`:type==='topics'?`<button data-topic-run="${r.id}">Hľadať túto tému</button>`:''}</div></div></div>`}).join('')}`))
 if(type==='sources'){
  const folderNames={nitra:'Nitra',rap:'Rap / hudba',skcz:'Slovensko / Česko',other:'Ostatné'},grid=document.createElement('div');grid.className='ed-folder-grid';grid.innerHTML=Object.entries(folderNames).map(([key,label])=>`<button type="button" class="ed-folder-card" data-folder-open="${key}"><strong>${label}</strong><span>${rows.filter(r=>sourceFolder(r)===key).length} feedov</span><em>Otvoriť a generovať →</em></button>`).join('');const anchor=document.querySelector('[data-folder-filters]');anchor?.after(grid)
  bind('[data-folder-open]',button=>{const folder=button.dataset.folderOpen;document.querySelectorAll('[data-source-folder]').forEach(row=>row.hidden=row.dataset.sourceFolder!==folder);document.querySelectorAll('[data-folder-open]').forEach(b=>b.setAttribute('aria-pressed',b===button));document.querySelector('[data-folder-filters]')?.scrollIntoView({block:'nearest'})})
 }
 bind('[data-scope]',button=>{const scope=button.dataset.scope;document.querySelectorAll('[data-scope]').forEach(b=>b.setAttribute('aria-pressed',b===button));document.querySelectorAll('[data-topic-scope]').forEach(row=>{row.hidden=scope!=='all'&&row.dataset.topicScope!==scope})})
 bind('[data-folder]',button=>{const folder=button.dataset.folder;document.querySelectorAll('[data-folder]').forEach(b=>b.setAttribute('aria-pressed',b===button));document.querySelectorAll('[data-source-folder]').forEach(row=>{row.hidden=folder!=='all'&&row.dataset.sourceFolder!==folder})})
 bind('[data-config-prev]',()=>{configPage--;return configuration(type)});bind('[data-config-next]',()=>{configPage++;return configuration(type)})
 const edit=(r={})=>{
  const common=type==='categories'?field('name','Názov',r.name)+field('slug','Slug',r.slug)+field('sort_order','Poradie',r.sort_order||0,'number'):
   type==='sources'?field('name','Názov',r.name)+field('endpoint','Adresa povoleného feedu (HTTPS)',r.endpoint,'url')+field('website_url','Web zdroja (HTTPS)',r.website_url,'url')+field('priority','Priorita',r.priority||0,'number')+select('adapter','Typ',[['rss','RSS'],['atom','Atom'],['json','JSON API']],r.adapter||'rss')+check('approved','Mám povolenie používať tento zdroj / feed',r.approved)+textArea('license_notes','Podmienky použitia / poznámka',r.license_notes)+select('trust_level','Dôveryhodnosť',[['standard','Štandardný'],['official','Oficiálny']],r.trust_level||'standard')+field('frequency_minutes','Interval (minúty)',r.frequency_minutes||60,'number'):
   field('label','Téma',r.label)+select('scope','Rozsah témy',[['nitra','Iba Nitra'],['sk_cz','Slovensko / Česko'],['global','Celý svet']],r.scope||'nitra')+field('query','Hľadané výrazy, oddelené čiarkou',r.query)+field('required_keywords','Povinné slová (všetky)',(r.required_keywords||[]).join(', '))+field('excluded_keywords','Vylúčené slová',(r.excluded_keywords||[]).join(', '))+`<fieldset class="ed-source-filters"><legend>Hľadať iba v týchto feedoch</legend><p class="muted">Nič nevyberieš = téma sa hľadá vo všetkých zapnutých feedoch.</p>${feedRows.map(s=>`<label><input type="checkbox" name="source_filter" value="${html(s.id)}" ${(r.source_filters||[]).includes(s.id)?'checked':''}>${html(s.name||s.endpoint)}${s.enabled&&s.approved?'':' <small>(vypnutý alebo bez schválenia)</small>'}</label>`).join('')||'<p class="muted">Zatiaľ nemáš pridaný žiadny feed.</p>'}</fieldset>`+field('priority','Priorita',r.priority||0,'number')
  document.querySelector('[data-config-editor]').innerHTML=`<form class="panel" data-config-form>${common}${type!=='categories'?select('category_id','Kategória',[['','Bez predvolenej kategórie'],...categories.map(c=>[c.id,c.name])],r.category_id||'')+select('mode','Režim',[['discover','Iba objaviť'],['draft','Vytvoriť draft'],['notify','Draft + aktivita pre admina'],['safe_publish','Bezpečné automatické vydanie (vyžaduje serverové schválenie)']],r.mode||'draft'):''}${check('enabled','Zapnuté',r.enabled)}<button>Uložiť</button></form>`
  document.querySelector('[data-config-form]').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,v=Object.fromEntries(new FormData(f));v.enabled=f.enabled.checked;if(type==='sources'){v.website_url=v.website_url||null;v.priority=Number(v.priority);v.approved=f.approved.checked;v.frequency_minutes=Number(v.frequency_minutes)}if(type==='topics'){v.scope=f.scope.value||'nitra';for(const k of ['required_keywords','excluded_keywords'])v[k]=split(v[k]);v.source_filters=[...f.querySelectorAll('input[name="source_filter"]:checked')].map(input=>input.value);v.priority=Number(v.priority)}if(type==='categories')v.sort_order=Number(v.sort_order);else v.category_id=v.category_id||null;try{await result(r.id?db.from(table).update(v).eq('id',r.id):db.from(table).insert(v));configuration(type)}catch(e){notice(e.message)}}
 }
 bind('[data-config-new]',()=>edit());bind('[data-config-edit]',b=>edit(rows.find(r=>r.id===b.dataset.configEdit)));bind('[data-config-delete]',async b=>{if(!confirm('Vymazať nastavenie? Existujúce články zostanú zachované.'))return;await result(db.from(table).delete().eq('id',b.dataset.configDelete));configuration(type)})
 bind('[data-source-run]',async b=>{notice('Hľadám iba tento feed…');const r=await callApi('/api/editorial-discover',{source_id:b.dataset.sourceRun,manual:true});notice(`Feed dokončený: ${r.drafts||0} návrhov, ${r.failed||0} chýb, ${r.duplicates||0} duplicít.`);tab='work';page=0;return articles()})
 bind('[data-topic-run]',async b=>{notice('Hľadám iba túto tému…');const r=await callApi('/api/editorial-discover',{topic_id:b.dataset.topicRun,manual:true});notice(`Téma dokončená: ${r.drafts||0} návrhov, ${r.failed||0} chýb, ${r.duplicates||0} duplicít.`);tab='work';page=0;return articles()})
}

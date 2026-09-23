import {db,state,content,notice,onCleanup} from './runtime.js'
import {html,httpsUrl,dateLabel,articleCard} from './shared.js'
let articles=[],more=true,cachedAt=0,feedScroll=0,heroIndex=0,heroTimer=0
export function rememberNewsScroll(){feedScroll=window.scrollY}
export function invalidateNews(){cachedAt=0}
function leadCard(a,index=0){
  const cover=httpsUrl(a.cover_image_url)
  return `<a class="news-lead" href="/news/${html(a.slug)}" data-route><div class="news-lead-art">${cover?`<img src="${html(cover)}" alt="" width="800" height="1000" fetchpriority="${index===0?'high':'low'}">`:'<span class="news-art-word" aria-hidden="true">N<span>SPACE.</span></span><span class="news-art-orbit" aria-hidden="true"></span>'}<span class="news-lead-edition">${a.localPreview?'DIZAJNOVÁ UKÁŽKA':'NITRA / V CENTRE DIANIA'}</span><span class="news-lead-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span></div><div class="news-lead-copy"><span class="news-lead-kicker">${a.localPreview?'UKÁŽKOVÝ ČLÁNOK · MIMO NITRY':a.breaking?'PRÁVE TERAZ':html(a.category)}</span><h2>${html(a.headline)}</h2><p>${html(a.summary)}</p><div class="news-lead-bottom"><span>${html(dateLabel(a.published_at))}</span><strong>Čítať článok <i aria-hidden="true">↗</i></strong></div></div></a>`
}
function cityNewsCard(a,index){
  const cover=httpsUrl(a.cover_image_url),number=String(index+2).padStart(2,'0')
  return `<a class="city-news-card" href="/news/${html(a.slug)}" data-route><div class="city-news-visual">${cover?`<img src="${html(cover)}" alt="" loading="lazy">`:'<span class="city-news-letter" aria-hidden="true">N</span><span class="city-news-orbit" aria-hidden="true"></span>'}<span class="city-news-number">${number}</span></div><div class="city-news-copy"><div class="city-news-meta"><span>${html(a.category)}</span><time>${html(dateLabel(a.published_at))}</time></div><h3>${html(a.visual_headline||a.headline)}</h3><p>${html(a.summary)}</p><div class="city-news-action"><span>OTVORIŤ ČLÁNOK</span><i aria-hidden="true">↗</i></div></div></a>`
}
function heroCarousel(items){
  if(!items.length)return '<section class="news-home-empty"><span>01 / PRIPRAVUJEME</span><h2>Dobré správy<br>začínajú tu.</h2><p>Schválené novinky z Nitry sa zobrazia priamo na tejto stránke.</p></section>'
  return `<section class="news-hero-shell" aria-label="Hlavné články"><div class="news-hero-carousel" data-news-carousel>${items.map((article,index)=>`<div class="news-hero-slide">${leadCard(article,index)}</div>`).join('')}</div>${items.length>1?`<div class="news-hero-controls"><span class="news-hero-count"><b data-news-hero-current>01</b> / ${String(items.length).padStart(2,'0')}</span><span class="news-hero-swipe">POTIAHNI PRE ĎALŠIE <i aria-hidden="true">→</i></span><div class="news-hero-buttons"><button type="button" data-news-hero-prev aria-label="Predchádzajúci článok">←</button><button type="button" data-news-hero-next aria-label="Ďalší článok">→</button></div></div>`:''}</section>`
}
function bindHeroCarousel(){
  const carousel=document.querySelector('[data-news-carousel]')
  if(!carousel)return
  const slides=[...carousel.children],current=document.querySelector('[data-news-hero-current]')
  const go=index=>{heroIndex=Math.max(0,Math.min(slides.length-1,index));carousel.scrollTo({left:heroIndex*carousel.clientWidth,behavior:'smooth'})}
  const next=()=>go((heroIndex+1)%slides.length)
  const stop=()=>{clearInterval(heroTimer);heroTimer=0}
  const start=()=>{stop();if(slides.length>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches)heroTimer=setInterval(next,4800)}
  const restart=()=>{stop();start()}
  let frame=0
  carousel.addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{heroIndex=Math.round(carousel.scrollLeft/Math.max(1,carousel.clientWidth));if(current)current.textContent=String(heroIndex+1).padStart(2,'0')})},{passive:true})
  carousel.addEventListener('pointerenter',stop)
  carousel.addEventListener('pointerleave',start)
  carousel.addEventListener('focusin',stop)
  carousel.addEventListener('focusout',start)
  carousel.addEventListener('touchstart',stop,{passive:true})
  carousel.addEventListener('touchend',start,{passive:true})
  document.querySelector('[data-news-hero-prev]')?.addEventListener('click',()=>{go(heroIndex===0?slides.length-1:heroIndex-1);restart()})
  document.querySelector('[data-news-hero-next]')?.addEventListener('click',()=>{next();restart()})
  requestAnimationFrame(()=>{heroIndex=Math.min(heroIndex,slides.length-1);carousel.scrollLeft=heroIndex*carousel.clientWidth;if(current)current.textContent=String(heroIndex+1).padStart(2,'0')})
  start()
  onCleanup(stop)
}
export async function renderNews(path){
  const generation=state.generation
  const samples=import.meta.env.DEV?(await import('./news-preview-data.js')).previewArticles:[]
  if(generation!==state.generation)return
  if(path==='/news'){
    const paint=()=>{
      const items=[...articles,...samples],lead=items[0],rest=items.slice(1)
      document.title='Nitra Space — tvoje mesto, tvoj prehľad'
      content(`<section class="news-home-heading"><div><span class="news-home-eyebrow">LOKÁLNE. PODSTATNÉ. TVOJE.</span><h1>Nitra, <i>práve teraz.</i></h1></div><p>Čo sa deje za tvojím rohom.<br>Celé mesto na jednom mieste.</p></section>${heroCarousel(items)}${lead?.localPreview?'<p class="news-sample-note">Lokálny dizajnový náhľad s predtým vybraným článkom. Ostrý obsah bude iba o Nitre.</p>':''}<div class="news-feed-heading"><div><span class="news-feed-eyebrow">MESTSKÝ VÝBER</span><h2>${rest.length?'Ďalej v meste':'Medzitým v Nitre'}<span> / ${rest.length?String(rest.length).padStart(2,'0'):'SPACE'}</span></h2><p>Ďalšie témy, ľudia a udalosti, ktoré sa oplatí zachytiť.</p></div>${state.admin?'<a href="/admin/news" data-feature-link>Redakcia ↗</a>':'<span>VŠETKO PODSTATNÉ Z NITRY</span>'}</div>${rest.length?`<div class="news-feed-shell"><div class="news-feed">${rest.map((article,index)=>`<div class="news-feed-item">${cityNewsCard(article,index)}</div>`).join('')}</div><div class="news-feed-hint"><span>POSÚVAJ DOĽAVA</span><i aria-hidden="true">→</i></div></div>`:'<div class="news-city-links"><a href="/#events" data-feature-link><span>02 / KAM VYRAZIŤ</span><strong>Mesto žije.<br>Buď pri tom.</strong><small>Pozrieť eventy <b aria-hidden="true">↗</b></small></a><a href="/polls" data-feature-link><span>03 / HLAS MESTA</span><strong>Čo má Nitra<br>na jazyku?</strong><small>Pozrieť ankety <b aria-hidden="true">↗</b></small></a></div>'}${more?'<button data-news-more>Ďalšie správy</button>':''}`)
      bindHeroCarousel()
      document.querySelector('[data-news-more]')?.addEventListener('click',e=>{e.currentTarget.disabled=true;load(false).catch(error=>notice(error.message))})
    }
    const load=async(reset)=>{
      let query=db.from('nitra_news').select('id,slug,headline,summary,cover_image_url,category,breaking,published_at').eq('status','published').order('published_at',{ascending:false}).order('id',{ascending:false}).limit(12)
      const last=reset?null:articles.at(-1);if(last)query=query.or(`published_at.lt.${last.published_at},and(published_at.eq.${last.published_at},id.lt.${last.id})`)
      const {data,error}=await query;if(error)throw error;if(generation!==state.generation)return
      articles=reset?data:[...articles,...data];more=data.length===12;cachedAt=Date.now();paint()
    }
    if(cachedAt&&Date.now()-cachedAt<60000)paint();else await load(true)
    if(generation===state.generation)requestAnimationFrame(()=>window.scrollTo({top:feedScroll,behavior:'instant'}))
    return
  }
  const slug=decodeURIComponent(path.slice(6))
  const sample=samples.find(article=>article.slug===slug)
  const {data:a,error}=sample?{data:sample,error:null}:await db.from('nitra_news').select('*').eq('slug',slug).eq('status','published').maybeSingle()
  if(error)throw error;if(generation!==state.generation)return
  if(!a){content('<section class="panel"><h1>Článok nie je dostupný.</h1><a href="/news" data-feature-link>Späť na NEWS</a></section>');return}
  document.title=`${a.headline} — Nitra Space`
  content(`<article class="news-article"><a href="/news" data-feature-link>← Späť na NEWS</a><div class="article-cover-card">${articleCard(a)}</div><small>${html(a.image_credit)}</small><p class="eyebrow">${html(a.category)} · ${html(dateLabel(a.published_at))}</p><h1>${html(a.headline)}</h1><p class="article-summary">${html(a.summary)}</p><div class="article-text">${a.content.split(/\n\s*\n/).map(p=>`<p>${html(p)}</p>`).join('')}</div><footer>Zdroj: <a href="${html(httpsUrl(a.source_url))}" target="_blank" rel="noopener noreferrer">${html(a.source_name)} ↗</a><button data-news-share>Zdieľať článok</button></footer><section data-article-poll></section></article>`)
  document.querySelector('.article-cover-card a')?.removeAttribute('href')
  document.querySelector('[data-news-share]').onclick=async()=>{try{if(navigator.share)await navigator.share({title:a.headline,url:location.href});else{await navigator.clipboard.writeText(location.href);notice('Odkaz skopírovaný.')}}catch{}}
  if(!a.localPreview){const {renderInlinePolls}=await import('./polls.js');if(generation===state.generation)await renderInlinePolls(a.id,document.querySelector('[data-article-poll]'))}
}

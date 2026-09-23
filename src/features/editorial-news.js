import {db,state,content,notice,onCleanup} from './runtime.js'
import {html,httpsUrl,dateLabel} from './shared.js'
import {approvedCoverImage,renderTypographicCover} from './news-cover.js'
import {renderInlinePolls} from './polls.js'
import './news-reference.css'

export const newsHero=()=>`<section class="ed-hero"><i class="ed-chrome" aria-hidden="true"></i><p class="eyebrow">NITRA SPACE / NEWS</p><h1>ČO SA DEJE<br>V NITRE.</h1><p>Bez omáčky. To podstatné.</p></section>`
export const usableNewsImage=a=>approvedCoverImage(a)
export function newsCard(a,i=0){
 const cover=usableNewsImage(a),layout=a.breaking?'breaking':a.featured?'featured':a.layout||'standard'
 if(!cover)return `<article class="ed-story ed-type-story ${layout}"><a href="/news/${html(a.slug)}"><div class="ed-type-art">${renderTypographicCover({...a,cover_number:a.cover_number||i+1})}</div><div class="ed-story-copy"><h2>${html(a.headline)}</h2><p>${html(a.summary)}</p><span class="ed-open" aria-label="Čítať článok">↗</span></div></a></article>`
 return `<article class="ed-story ${layout}"><a href="/news/${html(a.slug)}"><div class="ed-story-art">${cover?`<img src="${html(cover)}" alt="${html(a.cover_image_alt||'')}" loading="lazy" decoding="async" width="800" height="1000">`:'<i class="ed-chrome" aria-hidden="true"></i>'}</div><div class="ed-story-meta"><span>${a.breaking?'<b class="breaking-label">BREAKING</b>':html(a.category)} / ${html(dateLabel(a.published_at||a.source_published_at))}</span><span>${String(i+1).padStart(2,'0')}</span></div><div class="ed-story-copy"><h2>${html(a.headline)}</h2><p>${html(a.summary)}</p><span class="ed-open" aria-label="Čítať článok">↗</span></div></a></article>`
}
export function articleBody(a){
 const image=usableNewsImage(a)
 return `<article class="ed-article"><a href="/news" class="ed-back">← NEWS</a><p class="eyebrow">${html(a.category)} / ${html(dateLabel(a.published_at))}</p><h1>${html(a.headline)}</h1>${a.subheadline?`<h2>${html(a.subheadline)}</h2>`:''}${!image?`<div class="ed-cover-preview">${renderTypographicCover(a)}</div>`:''}${image?`<figure><img src="${html(image)}" alt="${html(a.cover_image_alt)}" width="1200" height="900"><figcaption>${html(a.image_credit)}</figcaption></figure>`:''}<p class="ed-perex">${html(a.summary)}</p><div class="ed-reading">${String(a.content||'').split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${html(p).replace(/\n/g,'<br>')}</p>`).join('')}</div>${(a.additional_images||[]).filter(p=>httpsUrl(p.url)).map(p=>`<figure><img src="${html(httpsUrl(p.url))}" alt="${html(p.alt)}" loading="lazy"><figcaption>${html(p.credit)}</figcaption></figure>`).join('')}<aside class="ed-sources"><span class="eyebrow">ZDROJE FAKTOV</span><a href="${html(httpsUrl(a.source_url))}" target="_blank" rel="noopener noreferrer">${html(a.source_name)} ↗</a>${(a.related_sources||[]).filter(s=>httpsUrl(s.url)).map(s=>`<a href="${html(httpsUrl(s.url))}" target="_blank" rel="noopener noreferrer">${html(s.name||s.url)} ↗</a>`).join('')}</aside><button data-share>Zdielať článok ↗</button><div id="article-pulse"></div><section id="related-stories"></section></article>`
}
export async function renderNews(path){
 const generation=state.generation,slug=path.split('/')[2]
 if(slug){
  const {data:a,error}=await db.from('nitra_news').select('*').eq('slug',decodeURIComponent(slug)).eq('status','published').eq('manual_review_required',false).lte('published_at',new Date().toISOString()).maybeSingle()
  if(error)throw error;if(generation!==state.generation)return
  if(!a){content('<section class="empty"><h1>Článok nie je dostupný.</h1><a href="/news">Späť na NEWS</a></section>');return}
  const previous=document.title;document.title=(a.seo_title||a.headline)+' — Nitra Space';onCleanup(()=>{document.title=previous})
  content(articleBody(a))
  document.querySelector('[data-share]').onclick=async()=>{try{if(navigator.share)await navigator.share({title:a.headline,url:location.href});else{await navigator.clipboard.writeText(location.href);notice('Odkaz skopírovaný.')}}catch(e){if(e.name!=='AbortError')notice('Odkaz môžeš skopírovať z adresného riadka.')}}
  renderInlinePolls(a.id,document.querySelector('#article-pulse'))
  const related=await db.from('nitra_news').select('*').eq('status','published').eq('manual_review_required',false).eq('category',a.category).neq('id',a.id).lte('published_at',new Date().toISOString()).order('published_at',{ascending:false}).limit(3)
  const relatedHost=document.querySelector('#related-stories');
  if(generation===state.generation&&relatedHost&&related.data?.length)relatedHost.innerHTML='<h2>ĎALŠIE SPRÁVY</h2><div class="ed-feed">'+related.data.map(newsCard).join('')+'</div>'
  return
 }
 const categories=await db.from('nitra_news_categories').select('id,name').eq('enabled',true).order('sort_order')
 if(categories.error)throw categories.error;if(generation!==state.generation)return
 let selected='',rows=[],loading=false,more=true,request=0
 content(`${newsHero()}${state.admin?'<a class="ed-admin-entry" href="/admin">Otvoriť redakciu ↗</a>':''}<div class="ed-filters">${[{id:'',name:'Všetko'},...categories.data].map(c=>`<button data-category="${html(c.name==='Všetko'?'':c.name)}" aria-pressed="${!c.id}">${html(c.name)}</button>`).join('')}</div><div class="ed-feed" id="news-feed" aria-live="polite"></div><button class="ed-more" data-more>Načítať ďalšie</button>`)
 const load=async(reset=false)=>{
  if(loading&&!reset)return;loading=true;const ticket=++request;if(reset)rows=[]
  const button=document.querySelector('[data-more]'),feed=document.querySelector('#news-feed');
  if(!button||!feed||generation!==state.generation)return
  button.disabled=true;button.textContent='Načítavam…'
  let q=db.from('nitra_news').select('*').eq('status','published').eq('manual_review_required',false).lte('published_at',new Date().toISOString()).order('published_at',{ascending:false}).order('id',{ascending:false}).limit(12)
  if(selected)q=q.eq('category',selected)
  const last=rows.at(-1);if(last)q=q.or(`published_at.lt.${last.published_at},and(published_at.eq.${last.published_at},id.lt.${last.id})`)
  const result=await q;if(generation!==state.generation||ticket!==request)return
  loading=false;button.disabled=false
  if(result.error){notice(result.error.message);button.textContent='Skúsiť znova';return}
  more=result.data.length===12;rows.push(...result.data)
  if(!feed.isConnected||generation!==state.generation)return
  feed.innerHTML=rows.map(newsCard).join('')||'<section class="empty"><h2>ZATIAĽ TICHŠIE.</h2><p>V tejto kategórii zatiaľ nie sú zverejnené články.</p></section>'
  button.hidden=!more;button.textContent='Načítať ďalšie'
 }
 document.querySelector('[data-more]').onclick=()=>load()
 document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{selected=button.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));load(true)})
 await load()
}

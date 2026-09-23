import {createHash} from 'node:crypto'
import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import {slugify} from '../src/features/shared.js'
import {publicAddress} from './news-ingestion.js'

const ORIGIN='https://www.nitrak.sk'
const CITY=/\b(nitra|nitre|nitru|nitry|nitrou|nitran\w*|zobor\w*|chrenov\w*|klokočin\w*|dražov\w*|ukf|agrokomplex\w*)\b/i
const OTHER_CITY=/\b(komárn\w*|levic\w*|nové zámky|šaľ\w*|topoľčan\w*|zlaté moravce)\b/i

function decode(value){return value.replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim()}
function xmlValue(item,tag){const match=item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return decode(String(match?.[1]||'').replace(/^<!\[CDATA\[|\]\]>$/g,''))}
function metaValue(source,name){const escaped=escapeRegex(name);const patterns=[new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,'i'),new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,'i')];return patterns.map(pattern=>source.match(pattern)?.[1]).find(Boolean)||''}
export function articleExcerpt(source){
 const start=source.match(/<div\b[^>]*\bclass=["'][^"']*\bfull-article\b[^"']*["'][^>]*>/i)
 let body=''
 if(start){
  const tail=source.slice(start.index+start[0].length);let depth=1
  for(const tag of tail.matchAll(/<div\b[^>]*>|<\/div\s*>/gi)){depth+=/^<\//.test(tag[0])?-1:1;if(!depth){body=tail.slice(0,tag.index);break}}
 }else body=source.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||''
 return [...body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>decode(match[1])).filter(text=>text.length>40).slice(0,12).join('\n\n').slice(0,6000)
}
function safeAddress(address){if(isIP(address)===4)return publicAddress(address);if(isIP(address)!==6)return false;const value=address.toLowerCase();return value!=='::'&&value!=='::1'&&!value.startsWith('fc')&&!value.startsWith('fd')&&!value.startsWith('fe8')&&!value.startsWith('fe9')&&!value.startsWith('fea')&&!value.startsWith('feb')&&!value.startsWith('::ffff:')}

export function unwrapSourceUrl(value){
  const url=new URL(value)
  if(['google.com','www.google.com'].includes(url.hostname)&&url.pathname==='/url'){
    for(const [key,target] of url.searchParams){
      if(!/(^|;)url$|(^|;)q$/i.test(key))continue
      try{const destination=new URL(target);if(destination.protocol==='https:'&&!destination.username&&!destination.password)return destination.href}catch{}
    }
  }
  return url.href
}

export function normalizeSearchQuery(value){return String(value||'').normalize('NFC').replace(/[\u0000-\u001f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,80)}

export function parseNitrakLinks(source){
  const found=[];const seen=new Set();const anchor=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for(const match of source.matchAll(anchor)){
    let url;try{url=new URL(match[1],ORIGIN)}catch{continue}
    if(!['nitrak.sk','www.nitrak.sk'].includes(url.hostname)||!/^\/clanky\/\d+\//.test(url.pathname))continue
    url.hash='';url.search='';const title=decode(match[2]);if(title.length<20||title.length>180||!CITY.test(title)||OTHER_CITY.test(title)||seen.has(url.href))continue
    seen.add(url.href);found.push({title,url:url.href})
  }
  return found.slice(0,12)
}

export async function discoverNitrak(){
  const response=await fetch(`${ORIGIN}/lokality/nitra`,{redirect:'follow',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'NitraSpace-News-Drafts/1.0'}})
  const finalUrl=new URL(response.url);if(!response.ok||!['nitrak.sk','www.nitrak.sk'].includes(finalUrl.hostname))throw new Error('Zdroj Nitrak.sk momentálne neodpovedá.')
  const length=Number(response.headers.get('content-length')||0);if(length>1500000)throw new Error('Odpoveď zdroja je príliš veľká.')
  const source=await response.text();if(source.length>1500000)throw new Error('Odpoveď zdroja je príliš veľká.')
  return parseNitrakLinks(source)
}

function searchText(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
const SEARCH_ALIASES={rap:['rap','rapper','raper','hip-hop','hip hop','hiphop'],'sk/cz rap':['slovenský rap','český rap','sk rap','cz rap'],hokej:['hokej','hk nitra','extraliga'],futbal:['futbal','fc nitra','futbalista'],koncert:['koncert','festival','hudba','vystúpenie']}
function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
export function searchExpression(value){const query=normalizeSearchQuery(value).replace(/["()]/g,' '),terms=SEARCH_ALIASES[searchText(query)]||[query];return `(${terms.map(term=>`"${term}"`).join(' OR ')})`}

export function parseGoogleNewsRss(source,now=Date.now(),query='',maxAgeDays=400,{localOnly=false}={}){
  const found=[];const seen=new Set()
  for(const match of source.matchAll(/<item>([\s\S]*?)<\/item>/gi)){
    const sourceName=xmlValue(match[1],'source').slice(0,100);const suffix=sourceName?new RegExp(`\\s+-\\s+${escapeRegex(sourceName)}$`,'i'):null
    const title=xmlValue(match[1],'title').replace(suffix||/$^/,'').trim();const link=xmlValue(match[1],'link');const published=Date.parse(xmlValue(match[1],'pubDate'))
    let url;try{url=new URL(link)}catch{continue}
    const local=CITY.test(title)&&!OTHER_CITY.test(title)
    if(!sourceName||url.protocol!=='https:'||title.length<12||title.length>180||(localOnly&&!local)||!Number.isFinite(published)||now-published>maxAgeDays*86400000||published-now>86400000||seen.has(url.href))continue
    seen.add(url.href);found.push({title,url:url.href,source_name:sourceName,published_at:new Date(published).toISOString(),query})
  }
  return found.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,12)
}

const COMMON_WORDS=new Set(['a','aj','ale','ako','do','na','sa','si','so','v','vo','z','zo','je','sú','pre','pri','od','po','o','k','ku','the','of','to','in','for','and'])
function storyTokens(value){return new Set(searchText(value).replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(word=>word.length>2&&!COMMON_WORDS.has(word)))}
function storySimilarity(left,right){const a=storyTokens(left),b=storyTokens(right);if(!a.size||!b.size)return 0;let shared=0;for(const token of a)if(b.has(token))shared++;return shared/Math.min(a.size,b.size)}
export function verifyStories(items){
  const groups=[]
  for(const item of [...items].sort((a,b)=>Date.parse(b.published_at||0)-Date.parse(a.published_at||0))){
    let group=groups.find(candidate=>storySimilarity(candidate[0].title,item.title)>=.5)
    if(!group){group=[];groups.push(group)}
    group.push(item)
  }
  return groups.map(group=>{
    const primary=group[0],sources=[]
    for(const item of group)if(item.source_name&&!sources.some(source=>searchText(source.name)===searchText(item.source_name)))sources.push({name:item.source_name,url:item.url})
  return {...primary,verification_sources:sources,verified:sources.length>=2}
  })
}

export async function discoverNitrakByQuery(value){
  const query=normalizeSearchQuery(value);if(query.length<2)throw new Error('Zadaj aspoň 2 znaky.')
  const fetchFeed=async(search,maxAgeDays)=>{
    const url=new URL('https://news.google.com/rss/search');url.searchParams.set('q',search);url.searchParams.set('hl','sk');url.searchParams.set('gl','SK');url.searchParams.set('ceid','SK:sk')
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/rss+xml,application/xml,text/xml'}})
    if(!response.ok)throw new Error('Vyhľadávanie aktuálnych článkov momentálne neodpovedá.')
    const length=Number(response.headers.get('content-length')||0);if(length>1000000)throw new Error('Odpoveď vyhľadávania je príliš veľká.')
    const source=await response.text();if(source.length>1000000)throw new Error('Odpoveď vyhľadávania je príliš veľká.')
    return parseGoogleNewsRss(source,Date.now(),query,maxAgeDays)
  }
  const expression=searchExpression(query)
  return fetchFeed(`${expression} when:3d`,3)
}

async function safeHtml(urlValue,redirects=0){
  if(redirects>3)throw new Error('Príliš veľa presmerovaní.')
  const url=new URL(unwrapSourceUrl(urlValue));if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Neplatný zdroj obrázka.')
  const addresses=await lookup(url.hostname,{all:true});if(!addresses.length||addresses.some(({address})=>!safeAddress(address)))throw new Error('Súkromná adresa bola odmietnutá.')
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(4500),headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'NitraSpace-News-Drafts/1.0'}})
  if(response.status>=300&&response.status<400&&response.headers.get('location'))return safeHtml(new URL(response.headers.get('location'),url).href,redirects+1)
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw new Error('Zdroj neposkytol HTML.')
  const length=Number(response.headers.get('content-length')||0);if(length>1000000)throw new Error('Zdroj je príliš veľký.')
  const source=await response.text();if(source.length>1000000)throw new Error('Zdroj je príliš veľký.')
  return {source,url:response.url||url.href}
}

export async function discoverLicensedImage(item,{excludeUrls=[]}={}){
  const rawQuery=normalizeSearchQuery(item.title||item.headline||item.query||'Nitra Slovensko').replace(/\s+[|–—-]\s+[^|–—-]+$/,'').slice(0,100)
  if(rawQuery.length<2)return null
  const ignored=new Set(excludeUrls.map(value=>String(value||'').split('?')[0]))
  const words=rawQuery.replace(/[^\p{L}\p{N}\s-]/gu,' ').split(/\s+/).filter(word=>word.length>2&&!COMMON_WORDS.has(searchText(word))).slice(0,8)
  const meaningful=words.join(' '),firstPair=words.slice(0,2).join(' '),lastPair=words.slice(-2).join(' '),nitraWord=words.find(word=>/nitr/i.test(searchText(word))),subject=words.find(word=>!/^nov(ý|a|e|y)?$/i.test(word)&&!/nitr/i.test(searchText(word)))
  const topicQuery=/\b(hokej|hk nitra|extraliga)\b/i.test(rawQuery)?'HK Nitra ice hockey':/\b(skate|skatepark|bmx)\b/i.test(rawQuery)?'skatepark Slovakia':/\b(futbal|fc nitra)\b/i.test(rawQuery)?'FC Nitra football':firstPair
  const queries=[topicQuery,rawQuery,meaningful,firstPair,nitraWord&&subject?`${subject} ${nitraWord}`:'',lastPair].filter((value,index,list)=>value.length>1&&list.indexOf(value)===index)
  for(const query of queries){
    const url=new URL('https://commons.wikimedia.org/w/api.php')
    const params={action:'query',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'10',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'1200',format:'json'}
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value)
    const response=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','User-Agent':'NitraSpace-News-Drafts/1.0'}})
    if(!response.ok)continue
    const length=Number(response.headers.get('content-length')||0);if(length>800000)continue
    const payload=await response.json(),pages=Object.values(payload?.query?.pages||{})
    const page=pages.find(candidate=>{const candidateUrl=candidate?.imageinfo?.[0]?.thumburl||candidate?.imageinfo?.[0]?.url||'',title=String(candidate?.title||'');return /^https:\/\//.test(candidateUrl)&&!ignored.has(candidateUrl.split('?')[0])&&!/\.pdf\b|\.svg\b/i.test(title)})
    if(!page)continue
    const info=page.imageinfo[0],meta=info.extmetadata||{},creator=decode(meta.Artist?.value||meta.Credit?.value||'Autor uvedený na Wikimedia Commons').slice(0,160),license=decode(meta.LicenseShortName?.value||meta.UsageTerms?.value||'licencia Wikimedia Commons').slice(0,80),landing=info.descriptionurl||'https://commons.wikimedia.org/'
    return {cover_image_url:info.thumburl||info.url,image_rights:'licensed',image_credit:`${creator} · ${license} · Wikimedia Commons · ${landing}`}
  }
  return null
}

export async function discoverArticleImage(item){
  try{
    const page=await safeHtml(item.url);item={...item,source_excerpt:articleExcerpt(page.source)};const raw=metaValue(page.source,'og:image:secure_url')||metaValue(page.source,'og:image')||metaValue(page.source,'twitter:image');const sourceDescription=decode(metaValue(page.source,'og:description')||metaValue(page.source,'description')).slice(0,500)
    if(raw){const image=new URL(raw,page.url);if(image.protocol==='https:'&&!image.username&&!image.password)return {...item,source_description:sourceDescription,cover_image_url:image.href,image_rights:'source_unverified',image_credit:`Automaticky načítané zo zdroja ${item.source_name||new URL(page.url).hostname}. Pred publikovaním over práva na použitie.`}}
    return {...item,source_description:sourceDescription}
  }catch{return item}
}

export async function enrichArticleImages(items,limit=8){
  const result=[...items];let cursor=0
  const worker=async()=>{while(cursor<Math.min(limit,result.length)){const index=cursor++;result[index]=await discoverArticleImage(result[index])}}
  await Promise.all(Array.from({length:Math.min(4,result.length,limit)},worker));return result
}

export function toDraft(item,query=''){
  const fingerprint=createHash('sha256').update(item.url).digest('hex')
  const context=query?` Nájdené podľa výrazu „${query}“.`:''
  const sourceName=item.source_name||'Nitrak.sk'
  const sources=Array.isArray(item.verification_sources)&&item.verification_sources.length?item.verification_sources:[{name:sourceName,url:item.url}]
  const sourceNames=sources.map(source=>source.name).join(', ')
  const verification=item.verified?`Informáciu nezávisle zachytili najmenej ${sources.length} zdroje: ${sourceNames}.`:`Informáciu zatiaľ priniesol jeden dohľadateľný zdroj: ${sourceName}. Pred publikovaním potrebuje druhé potvrdenie.`
  const summary=`Aktuálna téma: ${item.title}. ${item.verified?'Správu zachytilo viac médií.':'Návrh čaká na dodatočné redakčné overenie.'}`.slice(0,600)
  const content=[`Nitra Space zachytila aktuálnu správu k téme „${item.title}“. Návrh vznikol z verejne dostupných faktov a metadát zdrojov, nie kopírovaním ich článkov.`,verification,`Čo treba pred vydaním: otvoriť uvedené zdroje, porovnať mená, dátumy, miesto a čísla a doplniť vlastný redakčný kontext. Ak sa zdroje rozchádzajú, návrh nezverejňuj.`,`Zdroje použité na kontrolu: ${sourceNames}.`].join('\n\n')
  return {headline:item.title,visual_headline:item.title,summary,content,category:'Mesto',slug:`${slugify(item.title)}-${fingerprint.slice(0,8)}`,fingerprint,source_name:sourceName,source_url:item.url,status:'draft',manual_review_required:true,ai_generated:false,breaking:false,source_facts:[{source:sourceName,url:item.url,headline:item.title,excerpt:item.source_description||''}],cover_image_url:item.cover_image_url||null,image_rights:item.cover_image_url?(item.image_rights||'source_unverified'):'fallback',image_credit:item.cover_image_url?item.image_credit:''}
}

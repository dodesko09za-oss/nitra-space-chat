import {createClient} from '@supabase/supabase-js'
import {sensitive} from './news-ingestion.js'
import {selectArticlePhoto} from './news-photo.js'
import {createLocalOllamaWriter} from './local-ollama.js'
import {textIssue} from '../src/features/editorial-workflow.js'
import {discoverArticleImage} from './nitrak-discovery.js'
async function checked(q){const r=await q;if(r.error)throw r.error;return r.data}
async function usedCoverUrls(db,articleId){const rows=await checked(db.from('nitra_news').select('cover_image_url').neq('id',articleId).not('cover_image_url','is',null).limit(500));return rows.map(row=>row.cover_image_url).filter(Boolean)}
const translationCache=new Map()
const ENGLISH_MARKERS=/\b(the|and|what|who|how|new|news|rapper|artist|album|music|favorite|means|underground|trial|acquitted|announces|announce|release|released|says|this|that|calls|calling|hosting|full|circle|moment|found|not|guilty|timely|arbitrary|arrests|for|with|from|your|is|are|on|in|of|to|a|an)\b/i
export function looksEnglish(value){const text=String(value||'').trim();if(!text)return false;const words=text.toLowerCase().match(/[a-z]+/g)||[],hits=words.filter(word=>ENGLISH_MARKERS.test(word)).length,hasSlovak=/[áäčďéíľňóôŕšťúýž]/i.test(text);return hits>=2||(!hasSlovak&&hits>=1)}
function translationChunks(value,max=480){const words=String(value||'').replace(/\s+/g,' ').trim().split(' '),chunks=[];let current='';for(const word of words){if(current&&current.length+word.length+1>max){chunks.push(current);current=''}current=current?`${current} ${word}`:word}if(current)chunks.push(current);return chunks}
async function translateChunk(chunk){
 let lastError
 for(let attempt=0;attempt<2;attempt++){
  try{
   const url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',chunk);url.searchParams.set('langpair','en|sk')
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(4500),headers:{Accept:'application/json','User-Agent':'NitraSpaceEditorial/1.0'}});if(!response.ok)throw Error(`Prekladová služba odpovedala HTTP ${response.status}`)
   const data=await response.json();if(data?.responseStatus&&Number(data.responseStatus)!==200)throw Error('Prekladová služba je dočasne nedostupná.');const translated=String(data?.responseData?.translatedText||'').trim();if(!translated||/^MYMEMORY WARNING/i.test(translated))throw Error('Prekladová služba vrátila prázdny výsledok.');return translated
  }catch(error){lastError=error;if(attempt===0)await new Promise(resolve=>setTimeout(resolve,200))}
 }
 throw lastError
}
export async function translateToSlovak(value){
 const original=String(value||'').trim();if(!looksEnglish(original))return original
 if(translationCache.has(original))return translationCache.get(original)
 try{
  const requestText=original.replace(/[“”\"]/g,'').replace(/\s*&\s*/g,' and '),chunks=translationChunks(requestText),translated=await Promise.all(chunks.map(async chunk=>{try{return await translateChunk(chunk)}catch{return chunk}}))
  const result=translated.join(' ').trim();translationCache.set(original,result);return result
 }catch{return original}
}
async function freeEditorialDraft(article,sources,action='write'){
 const source=sources[0]||{},rawHeadline=String(article.headline||source.text?.split('\n')[0]||'Novinka').replace(/\s+-\s+[^-]{2,35}$/,'').trim().slice(0,180)
 const evidence=String(source.text||'').split('\n').slice(1).join(' ').replace(/\s+/g,' ').trim().slice(0,900)
 const sourceName=String(source.name||article.source_name||'pôvodný zdroj').trim()
 if(action==='translate'){
  const [translatedHeadline,translatedSummary,translatedContent]=await Promise.all([translateToSlovak(article.headline),translateToSlovak(article.summary),translateToSlovak(article.content)]),headline=(translatedHeadline||article.headline||'').slice(0,180),summary=(translatedSummary||article.summary||'').slice(0,600),content=(translatedContent||article.content||'').slice(0,12000)
  return {id:null,verified:false,sensitive:false,free:true,sheet:{location:'',event:headline,status:'redakčný návrh',date:'',facts:[],quotes:[],unknown:['Vyžaduje manuálnu kontrolu prekladu.'],sensitive:false},copy:{headline,summary,content,category:article.category||'Mesto',tags:article.tags||[],cover_headline:headline||article.cover_headline||article.headline,used_fact_ids:[]}}
 }
 const [translatedHeadline,translatedEvidence]=await Promise.all([translateToSlovak(rawHeadline),translateToSlovak(evidence)]),headline=(translatedHeadline||rawHeadline).slice(0,180),evidenceSk=translatedEvidence||evidence
 const notes=(evidenceSk||evidence)||'Zdroj neposkytol textový výťah. Podrobnosti sú dostupné na pôvodnom odkaze.'
 const summary=`${headline}. Aktuálne zhrnutie pre čitateľov Nitra Space vychádza z verejne dostupných informácií od zdroja ${sourceName}.`.slice(0,600)
 const content=[
  `Téma ${headline} prináša novú informáciu, ktorú zachytil redakčný monitor Nitra Space.`,
  `Podľa zdroja ${sourceName} sa príbeh týka tejto udalosti alebo témy: ${notes}`,
  `V tomto článku uvádzame stručné vlastné zhrnutie a zachovávame odkaz na pôvodné podklady. Neuvádzame nič, čo vo verejnom výťahu nebolo potvrdené; mená, čísla a časové údaje preto zostávajú viazané na zdroj.`,
  `Čitateľ v Nitre a okolí tak dostáva rýchly kontext k aktuálnej téme. Pri ďalšom vývoji môže redakcia tento návrh doplniť o nové overené informácie a aktualizovať ho.`,
  `Zdroj faktov: ${sourceName}.`
 ].join('\n\n').slice(0,12000)
 return {id:null,verified:false,sensitive:false,free:true,sheet:{location:'',event:headline,status:'redakčný návrh',date:'',facts:[],quotes:[],unknown:['Vyžaduje manuálnu kontrolu zdroja a prekladu.'],sensitive:false},copy:{headline,summary,content,category:article.category||'Mesto',tags:article.tags||[],cover_headline:headline,used_fact_ids:[]}}
}
export async function generateArticle(db,{articleId,actorId,writer=null,action='write'}){
 if(!writer&&action!=='translate')throw Error('Lokálna AI nie je dostupná. Otvor redakciu na tomto počítači a spusti Ollama. Pôvodný návrh zostal zachovaný.')
 const article=await checked(db.from('nitra_news').select('*').eq('id',articleId).single())
 if(['published','scheduled','archived','rejected'].includes(article.status))throw Error('Najprv vytvor nepublikovaný draft. AI nemení vydané ani naplánované články.')
 const claimed=await checked(db.from('nitra_news').update({status:'processing',generation_error:null}).eq('id',articleId).eq('updated_at',article.updated_at).neq('status','processing').select('updated_at'))
 if(!claimed.length)throw Error('Článok sa práve spracúva alebo bol upravený. Obnov editor.')
 const stamp=claimed[0].updated_at
 try{
  const links=await checked(db.from('nitra_news_article_sources').select('item:nitra_news_source_items(id,title,excerpt,canonical_url,source:nitra_news_sources(name))').eq('article_id',articleId))
  const evidence=links.length?links.map(({item})=>({source:item.source?.name,url:item.canonical_url,headline:item.title,excerpt:item.excerpt})):Array.isArray(article.source_facts)&&article.source_facts.length?article.source_facts:(article.source_url?[{source:article.source_name||'Pôvodný zdroj',url:article.source_url,headline:article.headline,excerpt:article.summary||''}]:[])
  if(article.source_url&&evidence.every(item=>String(item.excerpt||'').length<250)){
   const page=await discoverArticleImage({url:article.source_url,source_name:article.source_name})
   if(page.source_excerpt)evidence.unshift({source:article.source_name,url:article.source_url,headline:article.headline,excerpt:page.source_excerpt})
  }
  const sources=evidence.map((s,i)=>({id:String(i+1),name:s.source||article.source_name,url:s.url||article.source_url,text:[s.headline,s.excerpt].filter(Boolean).join('\n')}))
  if(!sources.length)throw Error('Článok nemá uložené zdrojové podklady. Najprv použi discovery povoleného feedu.')
  const generated=writer?await writer({articleId,actorId,sources,action,current:{headline:article.headline,summary:article.summary,content:article.content,tags:article.tags,cover_headline:article.cover_headline}}):await freeEditorialDraft(article,sources,action)
  const generatedIssue=textIssue(generated.copy)
  if(generatedIssue)throw Error('AI nedokončila použiteľný článok: '+generatedIssue+' Pôvodný text zostal zachovaný.')
  const modes=article.topic_id?await checked(db.from('nitra_news_topics').select('mode').eq('id',article.topic_id).maybeSingle()):null
  const sourceMode=article.source_id?await checked(db.from('nitra_news_sources').select('mode').eq('id',article.source_id).maybeSingle()):null
  const {copy,sheet}=generated,isSensitive=generated.sensitive||sensitive({title:copy.headline,summary:copy.summary,content:copy.content})
  const payload={headline:copy.headline,summary:copy.summary,content:copy.content,tags:copy.tags,cover_headline:copy.cover_headline,cover_image_url:null,cover_image_alt:'Automatická strieborná chrome obálka Nitra Space',cover_chrome:true,image_rights:'fallback',image_credit:'',fact_sheet:{location:sheet.location,event:sheet.event,status:sheet.status,date:sheet.date,unknown:sheet.unknown},ai_generated:!generated.free,sensitive:isSensitive,status:generated.free?'draft':!generated.verified||isSensitive||sheet.unknown.length||modes?.mode==='notify'||sourceMode?.mode==='notify'?'review':'draft',manual_review_required:true,generation_error:null}
  payload.ai_generated=!!writer
  if(!article.category_id){const category=await checked(db.from('nitra_news_categories').select('id,name').eq('name',copy.category).eq('enabled',true).maybeSingle());if(category){payload.category_id=category.id;payload.category=category.name}}
  // Keep a real source image, but replace legacy generic/Wikimedia covers when
  // the editor asks AI to complete the article. Those covers are only visual
  // placeholders and should never prevent finding the article's own image.
  if(article.cover_image_url&&!/Wikimedia Commons/i.test(String(article.image_credit||''))){payload.cover_image_url=article.cover_image_url;payload.cover_image_alt=article.cover_image_alt;payload.image_rights=article.image_rights;payload.image_credit=article.image_credit}
  else{const photo=await selectArticlePhoto(article,{excludeUrls:await usedCoverUrls(db,articleId)});Object.assign(payload,{cover_image_url:photo.cover_image_url,cover_image_alt:photo.cover_image_alt,image_rights:photo.image_rights,image_credit:photo.image_credit})}
  const saved=await checked(db.from('nitra_news').update(payload).eq('id',articleId).eq('updated_at',stamp).select('id'))
  if(!saved.length)throw Error('Článok bol počas generovania zmenený. Výsledok sa neuložil, aby neprepísal novšie úpravy.')
  return {article_id:articleId,generation_id:generated.id,status:payload.status,verified:generated.verified,free:generated.free===true,cover_image_url:payload.cover_image_url}
 }catch(error){await db.from('nitra_news').update({status:'draft',generation_error:String(error.message).slice(0,600)}).eq('id',articleId).eq('updated_at',stamp);throw error}
}
export async function enrichArticleCover(db,{articleId,selectPhoto=selectArticlePhoto}){
 const article=await checked(db.from('nitra_news').select('id,updated_at,status,headline,source_name,source_url,cover_image_url,cover_image_alt,image_rights,image_credit').eq('id',articleId).single())
 if(!['draft','review','failed'].includes(article.status))throw Error('Obrázok možno doplniť iba do návrhu, ktorý sa práve nespracúva.')
 const photo=await selectPhoto(article,{excludeUrls:await usedCoverUrls(db,articleId)})
 if(!photo.cover_image_url){
  if(article.cover_image_url)return {article_id:articleId,cover_image_url:article.cover_image_url,fallback:true,reason:'Nová relevantná fotografia sa nenašla. Pôvodná fotografia zostala zachovaná.'}
  const fallback=await checked(db.from('nitra_news').update({cover_image_url:null,cover_image_alt:'Strieborná chrome obálka Nitra Space',image_credit:'Nitra Space',image_rights:'fallback',cover_chrome:true}).eq('id',articleId).eq('updated_at',article.updated_at).select('id'))
  if(!fallback.length)throw Error('Článok bol počas hľadania upravený. Obálka sa neprepísala.')
  return {article_id:articleId,cover_image_url:null,fallback:true,reason:photo.photo_reason||'Relevantná fotografia sa nenašla. Uložená je chrome obálka.'}
 }
 const payload={cover_image_url:photo.cover_image_url,cover_image_alt:photo.cover_image_alt,image_rights:photo.image_rights,image_credit:photo.image_credit,cover_chrome:false,generation_error:null}
 const saved=await checked(db.from('nitra_news').update(payload).eq('id',articleId).eq('updated_at',article.updated_at).select('id,cover_image_url'))
 if(!saved.length)throw Error('Obrázok sa nepodarilo uložiť.')
 return {article_id:articleId,cover_image_url:saved[0].cover_image_url,existing:false}
}
export function serverClients(env){
 const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_ANON_KEY,secret=env.SUPABASE_SERVICE_ROLE_KEY
 const service=url&&secret?createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}):null
 return {url,key,service}
}
export async function handleGeneration({authorization,body,env}){
 const {url,key,service}=serverClients(env)
 if(!url||!key)return {status:503,body:{error:'Chýba serverové Supabase pripojenie.'}}
 if(!/^Bearer \S+$/.test(authorization||''))return {status:401,body:{error:'Prihlás sa do redakcie.'}}
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}})
 const user=await db.auth.getUser(authorization.slice(7)),admin=await db.rpc('is_admin')
 const access=await db.from('nitra_news_automation').select('id').maybeSingle()
 if(user.error||!user.data.user||admin.error||admin.data!==true||access.error||!access.data)return {status:403,body:{error:'Prístup iba pre administrátora.'}}
 const workDb=service||db
 const localWriter=createLocalOllamaWriter(env)
 if(body?.action==='status')return {status:200,body:{ai_configured:!!localWriter,free_generation:true,cron_configured:!!env.CRON_SECRET}}
 if(body?.action==='recover'){if(!service)return {status:503,body:{error:'Chýba serverový kľúč Supabase.'}};const recovered=await service.rpc('news_recover_processing');return recovered.error?{status:422,body:{error:'Obnova zlyhala.'}}:{status:200,body:{recovered:recovered.data}}}
 if(!['write','rewrite','shorten','new_headline','new_perex','reprocess','translate','image'].includes(body?.action||'write'))return {status:400,body:{error:'Neplatná akcia.'}}
 if(!/^[0-9a-f-]{36}$/i.test(body?.article_id||''))return {status:400,body:{error:'Neplatný článok.'}}
 try{return {status:200,body:body.action==='image'?await enrichArticleCover(workDb,{articleId:body.article_id}):await generateArticle(workDb,{articleId:body.article_id,actorId:user.data.user.id,writer:localWriter,action:body.action||'write'})}}catch(error){return {status:422,body:{error:error.message}}}
}

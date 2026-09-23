import {XMLParser,XMLValidator} from 'fast-xml-parser'
import {lookup} from 'node:dns/promises'
import https from 'node:https'
import {createHash} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {publicAddress,relevant,sensitive} from './news-ingestion.js'
import {generateArticle,serverClients} from './news-generation.js'
import {createLocalOllamaWriter} from './local-ollama.js'
import {slugify} from '../src/features/shared.js'
const array=x=>x==null?[]:Array.isArray(x)?x:[x]
const text=x=>String(typeof x==='object'?x?.['#text']||'':x||'').replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi,(entity,code)=>{const named={lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"};if(named[code.toLowerCase()])return named[code.toLowerCase()];const point=code[1]?.toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return Number.isFinite(point)?String.fromCodePoint(point):entity}).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
export function canonical(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';u.hash='';for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid)/.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.href}catch{return ''}}
export function parseFeed(raw,type,now=Date.now()){
 let items
 if(type==='json'){const data=JSON.parse(raw);if(!Array.isArray(data.items))throw Error('JSON feed musí obsahovať pole items.');items=data.items}
 else{
  if(/<!DOCTYPE|<!ENTITY/i.test(raw)||XMLValidator.validate(raw)!==true)throw Error('Zdroj obsahuje neplatné alebo nepovolené XML.')
  const doc=new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false}).parse(raw)
  if(!doc.rss?.channel&&!doc.feed)throw Error('Zdroj nie je RSS ani Atom feed.')
  items=array(doc.rss?.channel?.item||doc.feed?.entry).map(i=>({title:text(i.title),summary:text(i.description||i.summary||i.content||i['content:encoded']),url:typeof i.link==='string'?i.link:array(i.link).find(l=>!l['@_rel']||l['@_rel']==='alternate')?.['@_href'],external_id:text(i.guid||i.id),published_at:i.pubDate||i.published||i.updated}))
 }
 return items.slice(0,100).map(i=>({external_id:text(i.external_id||i.id).slice(0,500)||null,title:text(i.title).slice(0,180),summary:text(i.summary||i.content_text||i.content_html).slice(0,6000),url:canonical(i.url||i.external_url),published_at:i.published_at||i.date_published})).filter(i=>i.title.length>=5&&i.url&&Number.isFinite(Date.parse(i.published_at))&&Date.parse(i.published_at)<=now+300000&&Date.parse(i.published_at)>=now-72*3600000).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,30)
}
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function topicMatches(item,topic,sourceId){const body=norm(item.title+' '+item.summary),includes=String(topic.query||'').split(',').map(s=>norm(s.trim())).filter(Boolean);return (!topic.source_filters?.length||topic.source_filters.includes(sourceId))&&(!includes.length||includes.some(k=>body.includes(k)))&&(topic.required_keywords||[]).every(k=>body.includes(norm(k)))&&!(topic.excluded_keywords||[]).some(k=>body.includes(norm(k)))}
export function sameStory(a,b){const au=canonical(a.url||a.source_url),bu=canonical(b.url||b.source_url);if(au&&au===bu)return true;if(a.published_at&&b.source_published_at&&Math.abs(Date.parse(a.published_at)-Date.parse(b.source_published_at))>72*3600000)return false;const words=s=>new Set(norm(s).split(/\W+/).filter(w=>w.length>3));const x=words(a.title||a.headline),y=words(b.title||b.headline);if(x.size<4||y.size<4)return norm(a.title||a.headline)===norm(b.title||b.headline);const intersection=[...x].filter(w=>y.has(w)).length;return intersection/new Set([...x,...y]).size>=.68}
export async function fetchFeed(source){
 if(!source.approved||!source.enabled)throw Error('Zdroj musí byť povolený a schválený administrátorom.')
 const u=new URL(source.endpoint);if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password)throw Error('Nepovolená adresa zdroja.')
 const addresses=await lookup(u.hostname,{all:true}),ipv4=addresses.filter(a=>a.family===4);if(!ipv4.length||ipv4.some(a=>!publicAddress(a.address)))throw Error('Súkromná alebo nepodporovaná adresa zdroja.')
 // Pin the validated IP to the TLS request. No DNS-rebinding or redirects.
 return new Promise((resolve,reject)=>{const req=https.get(u,{lookup:(_host,options,cb)=>options.all?cb(null,[ipv4[0]]):cb(null,ipv4[0].address,ipv4[0].family),headers:{Accept:'application/rss+xml, application/atom+xml, application/json, text/xml','User-Agent':'NitraSpaceEditorial/1.0'}},res=>{if(res.statusCode!==200){res.resume();reject(Error('Zdroj odpovedal HTTP '+res.statusCode));return}let size=0,chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>1048576){req.destroy(Error('Feed prekročil 1 MB.'));return}chunks.push(chunk)});res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));res.on('error',reject)});req.setTimeout(10000,()=>req.destroy(Error('Zdroj neodpovedá.')));req.on('error',reject)})
}
async function checked(q){const r=await q;if(r.error)throw r.error;return r.data}
async function activeTopics(db){const rows=[];for(let start=0;;start+=500){const page=await checked(db.from('nitra_news_topics').select('*').eq('enabled',true).order('priority',{ascending:false}).order('id').range(start,start+499));rows.push(...page);if(page.length<500)return rows}}
/** @param {import('@supabase/supabase-js').SupabaseClient} db @param {{sourceId?:string,topicId?:string,generate?:Function,actorId?:string,manual?:boolean}} options */
export async function discoverSources(db,{sourceId,topicId,generate,actorId,manual=false}={}){
 const config=await checked(db.from('nitra_news_automation').select('*').single());if(config.paused&&!sourceId&&!topicId&&!manual)throw Error('Automatizácia je pozastavená. Povoľ ju alebo spusti konkrétny zdroj alebo tému.')
 let q=db.from('nitra_news_sources').select('*').eq('enabled',true).eq('approved',true).order('last_checked_at',{ascending:true,nullsFirst:true}).order('priority',{ascending:false}).limit(6);if(sourceId)q=q.eq('id',sourceId)
 const sources=await checked(q),allTopics=await activeTopics(db),selectedTopic=topicId?allTopics.find(t=>t.id===topicId):null
 if(topicId&&!selectedTopic)throw Error('Vybraná téma už neexistuje alebo je vypnutá.')
 const topics=selectedTopic?[selectedTopic]:allTopics
 const sourceFilter=selectedTopic?.source_filters||[]
 const scopedSources=sourceFilter.length?sources.filter(s=>sourceFilter.includes(s.id)):sources
 const existing=await checked(db.from('nitra_news').select('id,headline,source_url,related_sources,status,source_published_at').gte('created_at',new Date(Date.now()-7*86400000).toISOString()).limit(1000))
 const deadline=Date.now()+170000;let aiRemaining=generate?Math.min(Math.max(1,config.max_ai_per_run||2),10):180
 const report={drafts:0,failed:0,duplicates:0,sources:sources.length,aiConfigured:!!generate}
 if(!sourceId){
  const linked=await checked(db.from('nitra_news_source_items').select('article_id').not('article_id','is',null).order('published_at',{ascending:false}).limit(200)),linkedIds=[...new Set(linked.map(r=>r.article_id).filter(Boolean))]
  const pending=linkedIds.length?await checked(db.from('nitra_news').select('id,source_id,topic_id').in('id',linkedIds).eq('status','draft').eq('ai_generated',false).or('content.is.null,content.eq.').not('source_id','is',null).not('topic_id','is',null).order('created_at',{ascending:false}).limit(50)):[]
  for(const item of pending){if(aiRemaining<=0||Date.now()>deadline)break;const source=sources.find(s=>s.id===item.source_id),topic=topics.find(t=>t.id===item.topic_id);if(!source||!topic||(!manual&&(source.mode==='discover'||topic.mode==='discover')))continue;aiRemaining--;try{const output=await generateArticle(db,{articleId:item.id,actorId,writer:generate});if(config.auto_publish&&source.mode==='safe_publish'&&topic.mode==='safe_publish'&&output.verified)await checked(db.rpc('news_publish_generated',{p_article:item.id,p_generation:output.generation_id}));report.drafts++}catch{report.failed++}}
 }
 for(const source of scopedSources){
  const time=new Date().toISOString()
  if(source.last_checked_at&&!manual&&Date.now()-Date.parse(source.last_checked_at)<(sourceId?60000:Math.max(1,source.frequency_minutes||60)*60000))continue
  let claim=db.from('nitra_news_sources').update({last_checked_at:time}).eq('id',source.id);claim=source.last_checked_at?claim.eq('last_checked_at',source.last_checked_at):claim.is('last_checked_at',null)
  if(!(await checked(claim.select('id'))).length)continue
  const run=(await checked(db.from('nitra_news_ingestion_runs').insert({source_id:source.id}).select('id')))[0];let drafts=0,duplicates=0,count=0;const itemErrors=[]
  try{
   const items=parseFeed(await fetchFeed(source),source.adapter);count=items.length
   for(const item of items){
    const topic=topics.find(t=>topicMatches(item,t,source.id));if(!topic||!relevant(item,topic))continue
    const known=await checked(db.from('nitra_news_source_items').select('article_id').eq('source_id',source.id).eq(item.external_id?'source_article_id':'canonical_url',item.external_id||item.url).limit(1));if(known.length){duplicates++;continue}
    const duplicate=existing.find(a=>sameStory(item,a));if(duplicate){duplicates++;const itemRows=await checked(db.from('nitra_news_source_items').upsert({source_id:source.id,source_article_id:item.external_id,canonical_url:item.url,title:item.title,excerpt:item.summary,published_at:new Date(item.published_at).toISOString(),article_id:duplicate.id},{onConflict:'source_id,canonical_url'}).select('id'));if(itemRows[0])await checked(db.from('nitra_news_article_sources').upsert({article_id:duplicate.id,item_id:itemRows[0].id}));const links=duplicate.related_sources||[];if(duplicate.status!=='published'&&duplicate.source_url!==item.url&&!links.some(s=>s.url===item.url)){links.push({name:source.name,url:item.url});await checked(db.from('nitra_news').update({related_sources:links.slice(0,12)}).eq('id',duplicate.id))}continue}
    const hash=createHash('sha256').update(item.url).digest('hex'),isSensitive=sensitive({...item,content:item.summary})
    const row={headline:String(item.title).slice(0,180),summary:String('').slice(0,600),content:String('').slice(0,12000),slug:slugify(item.title).slice(0,145)+'-'+hash.slice(0,12),fingerprint:hash,source_name:source.name,source_url:item.url,source_id:source.id,topic_id:topic?.id||null,source_published_at:new Date(item.published_at).toISOString(),category_id:topic?.category_id||source.category_id||null,category:'Mesto',status:'draft',manual_review_required:true,sensitive:isSensitive,ai_generated:false,source_facts:[{source:source.name,url:item.url,headline:item.title,excerpt:String(item.summary||'').slice(0,600)}],cover_image_url:null,image_rights:'fallback'}
    // Unverified source copy is stored in the private draft's evidence, never as a published article.
    if(row.category_id){const c=await checked(db.from('nitra_news_categories').select('name').eq('id',row.category_id).maybeSingle());if(c)row.category=c.name}
    const inserted=await db.from('nitra_news').insert(row).select('id');if(inserted.error?.code==='23505'){duplicates++;continue}if(inserted.error)throw inserted.error;const articleId=inserted.data[0].id;existing.push({...row,id:articleId});drafts++
    const stored=await checked(db.from('nitra_news_source_items').upsert({source_id:source.id,source_article_id:item.external_id,canonical_url:item.url,title:item.title,excerpt:item.summary,published_at:new Date(item.published_at).toISOString(),article_id:articleId},{onConflict:'source_id,canonical_url'}).select('id'))
    if(stored[0])await checked(db.from('nitra_news_article_sources').upsert({article_id:articleId,item_id:stored[0].id}))
    if(aiRemaining>0&&Date.now()<deadline&&(manual||(source.mode!=='discover'&&topic?.mode!=='discover'))){
     aiRemaining--;try{const output=await generateArticle(db,{articleId,actorId,writer:generate});if(config.auto_publish&&source.mode==='safe_publish'&&topic?.mode==='safe_publish'&&output.verified)await checked(db.rpc('news_publish_generated',{p_article:articleId,p_generation:output.generation_id}))}catch(error){report.failed++;itemErrors.push({article_id:articleId,error:String(error.message).slice(0,600)});await db.from('nitra_news').update({generation_error:String(error.message).slice(0,600)}).eq('id',articleId)}
    }
   }
   await checked(db.from('nitra_news_ingestion_runs').update({status:'completed',finished_at:new Date().toISOString(),checked:count,drafts,duplicates,report:{ai_configured:!!generate,free_generation:!generate,auto_publish_enabled:config.auto_publish,item_errors:itemErrors}}).eq('id',run.id))
   await checked(db.from('nitra_news_sources').update({last_success_at:time,last_error:null,discovered_count:source.discovered_count+drafts}).eq('id',source.id))
   report.drafts+=drafts;report.duplicates+=duplicates
  }catch(e){report.failed++;const error=String(e.message||'Import zlyhal').slice(0,600);await checked(db.from('nitra_news_ingestion_runs').update({status:'failed',finished_at:new Date().toISOString(),checked:count,drafts,duplicates,error}).eq('id',run.id));await checked(db.from('nitra_news_sources').update({last_error:error}).eq('id',source.id))}
 }
 return report
}
export async function handleEditorialDiscovery({authorization,url,key,sourceId,topicId,generate,env,manual=false}){
 if(!url||!key)return {status:503,body:{error:'Server nemá nastavené Supabase pripojenie.'}}
 if(!/^Bearer \S+$/.test(authorization||''))return {status:401,body:{error:'Prihlás sa do redakcie.'}}
 if(sourceId&&!/^[a-f0-9-]{36}$/i.test(sourceId))return {status:400,body:{error:'Neplatný zdroj.'}}
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}})
 const user=await db.auth.getUser(authorization.slice(7));if(user.error||!user.data.user)return {status:401,body:{error:'Prihlásenie vypršalo.'}}
 const admin=await db.rpc('is_admin'),access=await db.from('nitra_news_automation').select('id').maybeSingle();if(admin.error||admin.data!==true||access.error||!access.data)return {status:403,body:{error:'Prístup iba pre administrátora.'}}
 try{
  const clients=serverClients(env||{}),workDb=clients.service||db
  // Production uses the deterministic, zero-cost draft builder by default.
  // Tests may still inject a writer explicitly, but no paid provider is required.
  return {status:200,body:await discoverSources(workDb,{sourceId,topicId,manual,generate:generate||createLocalOllamaWriter(env),actorId:user.data.user.id})}
 }catch(e){return {status:422,body:{error:e.message||'Discovery zlyhalo.'}}}
}

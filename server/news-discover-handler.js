import {createClient} from '@supabase/supabase-js'
import {discoverNitrak,discoverNitrakByQuery,enrichArticleImages,normalizeSearchQuery,toDraft,verifyStories} from './nitrak-discovery.js'
import {generateArticle,serverClients} from './news-generation.js'
import {createLocalOllamaWriter} from './local-ollama.js'
const headlineKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

export async function handleNewsDiscover({authorization,url,key,query:rawQuery='',queries:rawQueries=[],sourceId='',env={}}){
  console.info('[news-discover] request received',{hasAuthorization:!!authorization,queryLength:String(rawQuery||'').length})
  if(!url||!key)return {status:503,body:{error:'Serverová konfigurácia chýba.'}}
  const token=String(authorization||'').replace(/^Bearer\s+/i,'')
  if(!token)return {status:401,body:{error:'Najprv sa prihlás.'}}
  const db=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}})
  const {data:{user},error:authError}=await db.auth.getUser(token)
  if(authError||!user){
    console.warn('[news-discover] auth rejected',{status:authError?.status,code:authError?.code,message:authError?.message})
    if(authError?.status===0||/fetch failed/i.test(authError?.message||''))return {status:503,body:{error:'Lokálny server sa nevie pripojiť k Supabase. Reštartuj dev server a skús znova.'}}
    return {status:401,body:{error:'Prihlásenie vypršalo. Prihlás sa znova cez Účet.'}}
  }
  const permission=await db.rpc('is_admin')
  if(permission.error||permission.data!==true)return {status:403,body:{error:'Prístup iba pre redakciu.'}}
  try{
    const query=normalizeSearchQuery(rawQuery)
    const queries=[...new Set((Array.isArray(rawQueries)?rawQueries:[]).map(normalizeSearchQuery).filter(value=>value.length>=2))].slice(0,12)
    if(query&&!queries.includes(query))queries.unshift(query)
    const discovered=queries.length?await Promise.all(queries.map(discoverNitrakByQuery)):[await discoverNitrak()]
    const interleaved=[];for(let index=0;index<12;index++)for(const group of discovered)if(group[index])interleaved.push(group[index])
    const grouped=verifyStories(interleaved)
    const unique=[];const urls=new Set();const headlines=new Set()
    for(const item of grouped){const headline=headlineKey(item.title);if(urls.has(item.url)||headlines.has(headline))continue;urls.add(item.url);headlines.add(headline);unique.push(item);if(unique.length>=32)break}
    const existing=await db.from('nitra_news').select('source_url,headline').order('created_at',{ascending:false}).limit(500)
    if(existing.error)throw existing.error
    const existingUrls=new Set((existing.data||[]).map(item=>item.source_url));const existingHeadlines=new Set((existing.data||[]).map(item=>headlineKey(item.headline)))
    const fresh=unique.filter(item=>!existingUrls.has(item.url)&&!existingHeadlines.has(headlineKey(item.title)))
    const items=await enrichArticleImages(fresh)
    const report={drafts:0,failed:0,duplicates:unique.length-fresh.length,scanned:interleaved.length,verified:fresh.filter(item=>item.verified).length,query,searched:queries}
    const writer=createLocalOllamaWriter(env),workDb=serverClients(env).service||db
    console.info('[news-discover] source completed',{mode:queries.length?'search':'latest',items:items.length,topics:queries.length})
    for(const item of items){
      const draft={...toDraft(item,item.query||query),source_id:/^[a-f0-9-]{36}$/i.test(sourceId)?sourceId:null}
      const inserted=await db.from('nitra_news').insert(draft).select('id')
      const {error}=inserted
      if(error?.code==='23505'){report.duplicates++;continue}
      if(error)throw error
      report.drafts++
      try{await generateArticle(workDb,{articleId:inserted.data[0].id,actorId:user.id,writer})}catch(error){report.failed++;await db.from('nitra_news').update({generation_error:String(error.message||'Generovanie zlyhalo.').slice(0,600)}).eq('id',inserted.data[0].id)}
    }
    console.info('[news-discover] drafts completed',report);return {status:200,body:report}
  }catch(error){console.error('[news-discover] failed',{message:error?.message});return {status:502,body:{error:error?.message||'Hľadanie noviniek sa nepodarilo.'}}}
}

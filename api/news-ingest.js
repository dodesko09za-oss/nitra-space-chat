import {createClient} from '@supabase/supabase-js'
import {ingestSource} from '../server/news-ingestion.js'
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST')return res.status(405).end()
  const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_ANON_KEY
  if(!url||!key)return res.status(503).json({error:'Server configuration missing'})
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'')
  const db=createClient(url,key,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}})
  const {data:{user},error:authError}=await db.auth.getUser(token)
  if(authError||!user)return res.status(401).end()
  const permission=await db.rpc('is_admin');if(permission.data!==true)return res.status(403).end()
  const sourceId=req.body?.source_id
  if(typeof sourceId!=='string'||!/^[0-9a-f-]{36}$/i.test(sourceId))return res.status(400).end()
  const {data:source,error}=await db.from('nitra_news_sources').select('*').eq('id',sourceId).eq('approved',true).maybeSingle()
  if(error||!source)return res.status(404).end()
  try{return res.status(200).json(await ingestSource(db,source))}catch{return res.status(502).json({error:'Import sa nepodaril. Over schválený zdroj a jeho adapter.'})}
}

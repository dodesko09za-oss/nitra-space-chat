import {createClient} from '@supabase/supabase-js'
import {renderCoverPng} from '../server/news-card.js'
export default async function handler(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store')
 if(req.method!=='GET')return res.status(405).end()
 const id=String(req.query.id||''),format=['story','og'].includes(req.query.format)?req.query.format:'feed'
 if(!/^[a-f0-9-]{36}$/i.test(id))return res.status(400).end()
 const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_ANON_KEY
 if(!url||!key)return res.status(503).end()
 const authorization=req.headers.authorization||'',db=createClient(url,key,{auth:{persistSession:false},global:{headers:authorization?{Authorization:authorization}:{}}})
 const {data:article,error}=await db.from('nitra_news').select('*').eq('id',id).maybeSingle()
 if(error||!article)return res.status(404).end()
 try{const {png}=await renderCoverPng(article,format);res.setHeader('Content-Type','image/png');res.setHeader('Content-Disposition','inline; filename="nitra-space-'+format+'.png"');return res.status(200).send(Buffer.from(png))}catch{return res.status(422).json({error:'Obálku nemožno vykresliť. Skráť nadpis alebo zruš ručné zalomenia.'})}
}

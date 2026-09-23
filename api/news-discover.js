import {handleNewsDiscover} from '../server/news-discover-handler.js'

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store')
  if(req.method!=='POST')return res.status(405).end()
  const result=await handleNewsDiscover({authorization:req.headers.authorization,url:process.env.VITE_SUPABASE_URL,key:process.env.VITE_SUPABASE_ANON_KEY,query:req.body?.query,queries:req.body?.queries,sourceId:req.body?.source_id,env:process.env})
  return res.status(result.status).json(result.body)
}

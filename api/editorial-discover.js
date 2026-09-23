import {handleEditorialDiscovery} from '../server/editorial-discovery.js'
export const config={maxDuration:300}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='POST')return res.status(405).end()
 if(JSON.stringify(req.body||{}).length>2048)return res.status(413).end()
 const result=await handleEditorialDiscovery({authorization:req.headers.authorization,url:process.env.VITE_SUPABASE_URL,key:process.env.VITE_SUPABASE_ANON_KEY,env:process.env,sourceId:req.body?.source_id,topicId:req.body?.topic_id,manual:req.body?.manual===true})
 return res.status(result.status).json(result.body)
}

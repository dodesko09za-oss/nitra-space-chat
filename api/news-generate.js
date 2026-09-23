import {handleGeneration} from '../server/news-generation.js'
export const config={maxDuration:300}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='POST')return res.status(405).end()
 if(JSON.stringify(req.body||{}).length>2048)return res.status(413).end()
 const result=await handleGeneration({authorization:req.headers.authorization,body:req.body,env:process.env})
 return res.status(result.status).json(result.body)
}

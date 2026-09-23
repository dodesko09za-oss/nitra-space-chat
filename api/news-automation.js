import {timingSafeEqual} from 'node:crypto'
import {serverClients} from '../server/news-generation.js'
import {discoverSources} from '../server/editorial-discovery.js'
export const config={maxDuration:300}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 const secret=process.env.CRON_SECRET,actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+(secret||''))
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).end()
 if(req.method!=='GET')return res.status(405).end()
 const {service}=serverClients(process.env)
 if(!service)return res.status(503).json({error:'Serverové pripojenie nie je nastavené.'})
 const config=await service.from('nitra_news_automation').select('paused').single()
 if(config.error)return res.status(503).json({error:'Nastavenia automatizácie nie sú dostupné.'})
 if(config.data.paused)return res.status(200).json({paused:true})
 await service.rpc('news_recover_processing')
 try{return res.status(200).json(await discoverSources(service))}catch{return res.status(500).json({error:'Beh zlyhal. Skontroluj redakčné logy.'})}
}

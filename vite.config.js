import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { handleNewsDiscover } from './server/news-discover-handler.js'
import {renderCoverPng} from './server/news-card.js'
import {createClient} from '@supabase/supabase-js'
import {handleGeneration} from './server/news-generation.js'
import { handleEditorialDiscovery } from './server/editorial-discovery.js'
import dropMp4 from './api/drop-mp4.js'

const root = fileURLToPath(new URL('.', import.meta.url))

export default ({mode}) => {
  const env=loadEnv(mode,root,'')
  // The free writer is only reachable from the editor's local Vite server.
  // Production never receives this default, so a Vercel Function cannot try
  // to contact a private computer.
  const editorialEnv=mode==='development'?{...env,LOCAL_OLLAMA_MODEL:env.LOCAL_OLLAMA_MODEL||'qwen3:4b'}:env
  return {
  plugins: [{name:'existing-site-routes',configureServer(server){
    // Local preview uses the same FFmpeg handler as production so MP4 export
    // does not fail merely because the app is running through Vite.
    process.env.VITE_SUPABASE_URL ||= env.VITE_SUPABASE_URL
    process.env.VITE_SUPABASE_ANON_KEY ||= env.VITE_SUPABASE_ANON_KEY
    server.middlewares.use('/api/drop-mp4',(req,res)=>{
      // Vercel decorates ServerResponse with these helpers; Vite does not.
      res.status=code=>{res.statusCode=code;return res}
      res.json=payload=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload))}
      res.send=payload=>res.end(payload)
      return dropMp4(req,res)
    })
    server.middlewares.use('/api/news-card',async(req,res)=>{
        try{if(req.method!=='GET'){res.statusCode=405;return res.end()}const params=new URL(req.url,'http://localhost').searchParams,id=params.get('id');if(!/^[a-f0-9-]{36}$/i.test(id||'')){res.statusCode=400;return res.end()}const db=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{headers:req.headers.authorization?{Authorization:req.headers.authorization}:{}}});const result=await db.from('nitra_news').select('*').eq('id',id).maybeSingle();if(result.error||!result.data){res.statusCode=404;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:result.error?.message||'Článok sa pre export nenašiel.'}))}const {png}=await renderCoverPng(result.data,params.get('format'));res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition','attachment; filename="nitra-space-'+(params.get('format')||'feed')+'.png"');res.end(png)}catch(error){res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message||'Export zlyhal.'}))}
    })
    server.middlewares.use('/api/news-generate',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      if(req.method!=='POST'){res.statusCode=405;return res.end('{}')}
      try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048){res.statusCode=413;return res.end('{}')}}const result=await handleGeneration({authorization:req.headers.authorization,body:JSON.parse(raw||'{}'),env:editorialEnv});res.statusCode=result.status;res.end(JSON.stringify(result.body))}catch{res.statusCode=400;res.end(JSON.stringify({error:'Neplatná požiadavka.'}))}
    })
    server.middlewares.use('/api/editorial-discover',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      if(req.method!=='POST'){res.statusCode=405;return res.end('{}')}
      try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2048){res.statusCode=413;return res.end('{}')}chunks.push(chunk)}
        const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')
        const result=await handleEditorialDiscovery({authorization:req.headers.authorization,url:env.VITE_SUPABASE_URL,key:env.VITE_SUPABASE_ANON_KEY,env:editorialEnv,sourceId:body.source_id,topicId:body.topic_id,manual:body.manual===true})
        res.statusCode=result.status;res.end(JSON.stringify(result.body))
      }catch{res.statusCode=400;res.end(JSON.stringify({error:'Neplatná požiadavka.'}))}
    })
    server.middlewares.use('/api/news-discover',async(req,res,next)=>{
      if(req.method!=='POST')return next()
      let size=0;const chunks=[]
      for await(const chunk of req){size+=chunk.length;if(size>2048){res.statusCode=413;return res.end()}chunks.push(chunk)}
      let body={};try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{res.statusCode=400;return res.end()}
      const result=await handleNewsDiscover({authorization:req.headers.authorization,url:env.VITE_SUPABASE_URL,key:env.VITE_SUPABASE_ANON_KEY,query:body.query,queries:body.queries,sourceId:body.source_id,env:editorialEnv})
      res.statusCode=result.status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(result.body))
    })
    server.middlewares.use((req,_res,next)=>{if(/^\/(news|polls|people|messages|account|activity|admin)(\/|\?|$)/.test(req.url))req.url='/index.html';next()})
  }}],
  optimizeDeps: {
    exclude: ['@supabase/supabase-js']
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        chat: resolve(root, 'chat.html'),
        social: resolve(root, 'social.html')
        ,designPreview: resolve(root, 'design-preview.html'),chromePreview: resolve(root, 'chrome-preview.html')
      }
    }
  }
  }
}

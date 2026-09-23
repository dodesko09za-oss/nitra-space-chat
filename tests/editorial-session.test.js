import test from 'node:test'
import assert from 'node:assert/strict'
import {initialise,cleanup,state} from '../src/features/runtime.js'
import {renderTypographicCover} from '../src/features/news-cover.js'
import {hasPlaceholder,publicationIssue} from '../src/features/editorial-workflow.js'
import {enrichArticleCover,generateArticle} from '../server/news-generation.js'
import {articleExcerpt} from '../server/nitrak-discovery.js'

test('auth refresh releases its lock before checking admin and survives route cleanup',async()=>{
 const oldWindow=globalThis.window
 globalThis.window={dispatchEvent(){}}
 let callback,locked=false,calls=0
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'admin'}}}}),onAuthStateChange(fn){callback=fn;return {data:{subscription:{unsubscribe(){callback=null}}}}}},rpc:async()=>{assert.equal(locked,false,'database request inside auth lock');calls++;return {data:true}}}
 try{
  await initialise(client,()=>{})
  cleanup()
  assert.equal(typeof callback,'function')
  locked=true
  const returned=callback('TOKEN_REFRESHED',{user:{id:'admin'}})
  assert.equal(returned,undefined)
  locked=false
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(calls,2)
  assert.equal(state.admin,true)
 }finally{globalThis.window=oldWindow}
})

test('the same photograph fills each social format',()=>{
 const article={headline:'Koncert v Nitre',status:'draft',cover_image_url:'https://example.com/concert.jpg',image_rights:'owned',image_credit:'Nitra Space'}
 for(const format of ['feed','story','og']){
  const svg=renderTypographicCover(article,format)
  assert.ok(svg.includes(article.cover_image_url))
  assert.match(svg,/preserveAspectRatio="xMidYMid slice"/)
 }
})

const ready={headline:'Novinka',summary:'Vlastný overený perex. '.repeat(5),content:'Vlastná správa s overenými informáciami a súvislosťami. '.repeat(8),source_url:'https://example.com/news',source_name:'Zdroj',manual_review_required:false,status:'published',cover_image_url:null}
test('publishing requires complete reviewed text and usable image rights',()=>{
 assert.equal(publicationIssue(ready),'')
 assert.ok(publicationIssue({...ready,manual_review_required:true}))
 assert.ok(publicationIssue({...ready,content:''}))
 assert.ok(publicationIssue({...ready,source_url:'https://'}))
 assert.ok(publicationIssue({...ready,cover_image_url:'https://example.com/photo.jpg',image_rights:'source_unverified'}))
 assert.equal(publicationIssue({...ready,cover_image_url:'https://example.com/photo.jpg',image_rights:'licensed',image_credit:'Autor, CC BY 4.0'}),'')
 assert.ok(hasPlaceholder({...ready,content:'Návrh čaká na overenie. Pred publikovaním doplň fakty.'}))
})

function photoDb(article){
 const writes=[]
 return {writes,from(){let patch
  const query={select(){return query},eq(){return query},neq(){return query},not(){return query},single(){return Promise.resolve({data:article})},limit(){return Promise.resolve({data:[]})},update(value){patch=value;writes.push(value);return query},then(resolve){resolve({data:[{id:article.id,...patch}]})}}
  return query
 }}
}
test('photo completion persists all metadata and saves chrome when search is empty',async()=>{
 const db=photoDb({id:'draft',status:'draft',updated_at:'revision',cover_image_url:null})
 const photo={cover_image_url:'https://example.com/concert.jpg',cover_image_alt:'Koncert',image_credit:'Autor',image_rights:'licensed'}
 const result=await enrichArticleCover(db,{articleId:'draft',selectPhoto:async()=>photo})
 assert.equal(result.cover_image_url,photo.cover_image_url)
 for(const key of Object.keys(photo))assert.equal(db.writes[0][key],photo[key])
 const emptyDb=photoDb({id:'draft',status:'draft',updated_at:'revision',cover_image_url:null})
 const fallback=await enrichArticleCover(emptyDb,{articleId:'draft',selectPhoto:async()=>({cover_image_url:null})})
 assert.equal(fallback.fallback,true)
 assert.equal(emptyDb.writes[0].cover_chrome,true)
 assert.equal(emptyDb.writes[0].image_rights,'fallback')
})
test('an unsuccessful new image search preserves an existing image',async()=>{
 const db=photoDb({id:'draft',status:'draft',updated_at:'revision',cover_image_url:'https://example.com/original.jpg'})
 const result=await enrichArticleCover(db,{articleId:'draft',selectPhoto:async()=>({cover_image_url:null})})
 assert.equal(db.writes.length,0)
 assert.equal(result.fallback,true)
 assert.match(result.reason,/zostala zachovaná/)
})
test('missing AI cannot manufacture a finished placeholder article',async()=>{
 await assert.rejects(()=>generateArticle(null,{articleId:'draft',actorId:'admin'}),/Lokálna AI nie je dostupná/)
})
test('source evidence comes from article paragraphs, not navigation or related stories',()=>{
 const paragraph='Mesto pripravilo verejné podujatie s ukážkami práce hasičov a polície.'
 const html=`<nav><p>Unrelated navigation text</p></nav><div class="full-article"><div><p>${paragraph}</p></div></div><p>Related article outside the source body should never become evidence.</p>`
 assert.equal(articleExcerpt(html),paragraph)
 assert.equal(articleExcerpt('<p>A page without an identifiable article body.</p>'),'')
})

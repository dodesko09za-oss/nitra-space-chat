import test from 'node:test'
import assert from 'node:assert/strict'
import {parseFeed,canonical,sameStory,topicMatches} from '../server/editorial-discovery.js'
import {createAIWriter,validateFacts,validateArticle} from '../server/news-ai.js'
import {renderCoverPng} from '../server/news-card.js'
import {coverTemplates,fitCoverHeadline} from '../src/features/news-cover.js'
const now=Date.parse('2026-09-10T12:00:00Z')
test('Google Alerts Atom content is retained as source evidence',()=>{
 const raw='<feed><entry><title type="html">Novinky v Nitre</title><link href="https://example.org/nitra"/><published>2026-09-10T10:00:00Z</published><content type="html">Mesto &lt;b&gt;Nitra&lt;/b&gt; pripravuje festival.</content></entry></feed>'
 const items=parseFeed(raw,'atom',now)
 assert.equal(items.length,1)
 assert.equal(items[0].summary,'Mesto Nitra pripravuje festival.')
})
test('feed ingestion rejects old, future, malformed and unsafe items',()=>{
 const raw=JSON.stringify({items:[{id:'one',title:'Nový park v Nitre',summary:'Mesto Nitra pripravuje park.',url:'https://example.org/a?utm_source=x',date_published:'2026-09-10T10:00:00Z'},{title:'Starý park v Nitre',url:'https://example.org/old',published_at:'2025-01-01'},{title:'Budúci park v Nitre',url:'https://example.org/future',published_at:'2030-01-01'},{title:'Unsafe Nitra',url:'http://localhost/a',published_at:'2026-09-10'}]})
 const items=parseFeed(raw,'json',now);assert.equal(items.length,1);assert.equal(items[0].external_id,'one');assert.equal(items[0].url,'https://example.org/a')
 assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>','rss',now));assert.throws(()=>parseFeed('<rss>','rss',now))
 assert.equal(canonical('javascript:alert(1)'),'');assert.equal(sameStory({title:'Jedna vec'},{title:'Iná vec'}),false)
})
test('topic filters and canonical deduplication',()=>{
 const item={title:'Koncert UKF v Nitre',summary:'Študenti pripravujú koncert.'}
 assert.equal(topicMatches(item,{query:'UKF,festival',required_keywords:['Nitra'],excluded_keywords:[]},'s'),false)
 assert.equal(topicMatches(item,{query:'UKF',required_keywords:['Nitre'],excluded_keywords:['nehoda'],source_filters:['s']},'s'),true)
 assert.equal(topicMatches(item,{query:'UKF',source_filters:['other']},'s'),false)
 assert.equal(sameStory({url:'https://example.org/a?utm_medium=x'},{source_url:'https://example.org/a'}),true)
})
const sources=[{id:'1',text:'Mesto Nitra pripravuje nový park. Projekt je v príprave. Termín otvorenia neurčilo.'}]
const sheet={facts:[{id:'f1',claim:'Nitra pripravuje park.',source_id:'1',evidence:'Mesto Nitra pripravuje nový park.'}],unknown:[],quotes:[],sensitive:false}
test('fact validation rejects invented evidence and quotes',()=>{
 assert.equal(validateFacts(sheet,sources),sheet)
 assert.throws(()=>validateFacts({...sheet,facts:[{...sheet.facts[0],evidence:'Otvorenie v roku 2027.'}]},sources))
 assert.throws(()=>validateFacts({...sheet,quotes:[{source_id:'1',text:'Povedal primátor',speaker:'Primátor'}]},sources))
})
test('writer is unavailable without credentials, no network call',async()=>{
 let called=false;const writer=createAIWriter({fetchImpl:()=>{called=true}})
 await assert.rejects(writer({articleId:'id',sources}),/AI nie je nastavená/);assert.equal(called,false)
})
test('article validator rejects invented numbers and copied paragraphs',()=>{
 const copy={headline:'Park v Nitre je v príprave',summary:'Pripravovaný park zatiaľ nemá oznámený termín otvorenia.',content:'Nitra chystá park. Zámer zatiaľ zostáva v príprave a mesto neuviedlo, kedy by sa mal nový priestor otvoriť. Ďalší postup zatiaľ nepoznáme.',tags:['Nitra'],used_fact_ids:['f1']}
 assert.equal(validateArticle(copy,sheet,sources),copy)
 assert.throws(()=>validateArticle({...copy,content:copy.content+' Otvorí sa v roku 2029.'},sheet,sources))
 assert.throws(()=>validateArticle({...copy,used_fact_ids:['invented']},sheet,sources))
})
test('all cover layouts render real PNGs with requested dimensions',async()=>{
 for(const template of coverTemplates){for(const [format,w,h] of [['feed',1080,1350],['story',1080,1920],['og',1200,630]]){
  const {png,svg}=await renderCoverPng({headline:'ČO SA MENÍ V CENTRE NITRY?',cover_headline:'ČO SA MENÍ\nV CENTRE NITRY?',cover_template:template,category:'Ľudia'},format)
  assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);assert.ok(png.length>5000);assert.ok(svg.includes('<image'));assert.ok(svg.includes('data:image/png;base64,'));assert.ok(svg.includes('<path'))
 }}
 assert.throws(()=>fitCoverHeadline('A\n'.repeat(80)))
})
test('AI stages persist results and audit before returning verified copy',async()=>{
 const writes=[],source=[{id:'1',text:'Mesto Nitra pripravuje nový park. Projekt je v príprave. Termín otvorenia neurčilo.'}]
 const facts={...sheet,location:'Nitra',event:'Príprava parku',status:'Príprava',date:''}
 const copy={headline:'Nitra pripravuje park',cover_headline:'NITRA\nPRIPRAVUJE PARK',summary:'Pripravovaný park zatiaľ nemá termín otvorenia. Mestský projekt zostáva vo fáze prípravy.',content:'V Nitre vzniká zámer parku. Podľa mesta sa projekt ešte len pripravuje. Kedy by mohli obyvatelia začať priestor využívať, radnica zatiaľ neuviedla. Z oznámenia preto nevyplýva konkrétny dátum otvorenia.',category:'Mesto',tags:['Nitra'],used_fact_ids:['f1']}
 const service={from(){let value=null;const q={select(){return q},eq(){return q},order(){return q},limit(){return q},insert(v){value=v;return q},update(v){value=v;return q},then(resolve){if(value)writes.push(value);return Promise.resolve(resolve({data:[],error:null}))}};return q}}
 let calls=0;const replies=[facts,copy,{supported:true,sensitive:false,issues:[]}]
 const writer=createAIWriter({service,apiKey:'test-only-not-a-real-key',model:'mock-model',fetchImpl:async()=>{assert.ok(writes.some(w=>w.status===undefined&&w.input_hash));const response=replies[calls++];return {ok:true,status:200,json:async()=>({id:'mock-'+calls,status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{content:[{type:'output_text',text:JSON.stringify(response)}]}]})}}})
 const result=await writer({articleId:'test-article',sources:source});assert.equal(calls,3);assert.equal(result.verified,true);assert.equal(result.sensitive,false);assert.ok(writes.some(w=>w.status==='complete'));assert.equal(writes.filter(w=>w.responses).at(-1).responses.length,3)
})

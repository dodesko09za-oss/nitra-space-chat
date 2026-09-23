import test from 'node:test'
import assert from 'node:assert/strict'
import {crc32} from 'node:zlib'
import {Resvg} from '@resvg/resvg-js'
import {approvedCoverImage,coverImageAttribution,renderTypographicCover} from '../src/features/news-cover.js'
import {CoverImageError,fetchCoverImage,renderCoverPng} from '../server/news-card.js'

const photo=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#ec4329"/><rect y="400" width="1200" height="400" fill="#286be0"/></svg>',{font:{loadSystemFonts:false}}).render().asPng()
const photoUrl='https://upload.wikimedia.org/wikipedia/commons/a/ab/Editorial_fixture.png'
const article={headline:'NOVÁ FOTOGRAFIA Z NITRY',category:'Mesto',cover_template:'left',cover_image_url:photoUrl,image_rights:'licensed',image_credit:'Žofia Nová · CC BY 4.0 · Wikimedia Commons · https://commons.wikimedia.org/wiki/File:Editorial_fixture.png',image_license:'CC BY 4.0',image_license_url:'https://creativecommons.org/licenses/by/4.0/'}
function network(response=()=>new Response(photo,{headers:{'content-type':'image/png'}}),addresses=[{address:'1.1.1.1',family:4}]){
 const calls=[]
 return {calls,lookupImpl:async()=>addresses,fetchImpl:async(url,options)=>{calls.push(url.href);assert.equal(options.redirect,'manual');return response(url,options)}}
}
function pngMetadata(png){
 let description
 for(let offset=8;offset+12<=png.length;){
  const size=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+size)
  assert.equal(crc32(png.subarray(offset+4,offset+8+size)),png.readUInt32BE(offset+8+size),type+' CRC must remain valid')
  if(type==='iTXt'&&data.subarray(0,16).equals(Buffer.from('Description\0\0\0\0\0')))description=JSON.parse(data.subarray(16).toString('utf8'))
  offset+=size+12
 }
 return description
}
function pngPixel(png,x,y){
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20)
 const rendered=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}"/></svg>`,{font:{loadSystemFonts:false}}).render()
 return [...rendered.pixels.subarray((y*width+x)*4,(y*width+x)*4+4)]
}

test('feed, story and OG preview/embed/rasterize the same approved article photo with complete attribution',async()=>{
 const imageOptions=network(),hrefs=[]
 for(const [format,width,height] of [['feed',1080,1350],['story',1080,1920],['og',1200,630]]){
  const preview=renderTypographicCover(article,format)
  assert.match(preview,/<image data-cover-photo="true" href="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/a\/ab\/Editorial_fixture\.png"/)
  assert.match(preview,/FOTO: Žofia Nová/)
  const {png,svg,imageStatus}=await renderCoverPng(article,format,imageOptions)
  assert.equal(imageStatus,'photo')
  assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height)
  const href=svg.match(/<image data-cover-photo="true" href="([^"]+)"/)?.[1]
  assert.equal(href,'data:image/png;base64,'+photo.toString('base64'))
  hrefs.push(href)
  assert.doesNotMatch(svg,/href="https:/,'rasterization must not depend on an unresolved remote image')
  assert.deepEqual(pngMetadata(png),coverImageAttribution(article))
  const [red,green,blue,alpha]=pngPixel(png,10,10)
  assert.ok(red>130&&red>green*2&&red>blue*3,format+' exported pixels must contain the red photograph, not a blank or chrome background')
  assert.equal(alpha,255)
 }
 assert.equal(new Set(hrefs).size,1)
 assert.deepEqual(imageOptions.calls,[photoUrl,photoUrl,photoUrl])
})

test('missing or unapproved photo keeps chrome fallback and performs no external image request',async()=>{
 const imageOptions=network(()=>{throw Error('Must not download an unapproved photo')})
 for(const patch of [{image_rights:'source_unverified'},{image_rights:'fallback'},{image_credit:''},{cover_image_url:null}]){
  const input={...article,...patch,cover_chrome:false}
  assert.equal(approvedCoverImage(input),'')
  const {svg,png,imageStatus}=await renderCoverPng(input,'feed',imageOptions)
  assert.equal(imageStatus,'fallback');assert.doesNotMatch(svg,/data-cover-photo/)
  if(input.cover_image_url)assert.match(svg,/href="data:image\/png;base64,/)
  assert.equal(pngMetadata(png),undefined)
 }
 assert.deepEqual(imageOptions.calls,[])
 assert.equal(approvedCoverImage(article),photoUrl,'Wikimedia attribution must not cause a blanket photo exclusion')
})

test('approved-photo exports fail explicitly for private DNS, redirects, bad MIME, oversized and corrupt images',async()=>{
 const privateDns=network(undefined,[{address:'127.0.0.1',family:4}])
 await assert.rejects(renderCoverPng(article,'feed',privateDns),CoverImageError)
 assert.deepEqual(privateDns.calls,[])
 const redirected=network(url=>url.hostname==='upload.wikimedia.org'?new Response(null,{status:302,headers:{location:'https://private.example/photo.png'}}):new Response(photo,{headers:{'content-type':'image/png'}}))
 redirected.lookupImpl=async host=>[{address:host==='private.example'?'169.254.169.254':'1.1.1.1',family:4}]
 await assert.rejects(renderCoverPng(article,'story',redirected),CoverImageError)
 assert.equal(redirected.calls.length,1,'do not request the private redirect target')
 for(const response of [
  ()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),
  ()=>new Response(photo,{headers:{'content-type':'image/png','content-length':String(6*1024*1024)}}),
  ()=>new Response(Buffer.alloc(5*1024*1024+1),{headers:{'content-type':'image/png'}}),
  ()=>new Response('<html>not a PNG</html>',{headers:{'content-type':'image/png'}}),
  ()=>new Response(photo.subarray(0,33),{headers:{'content-type':'image/png'}}),
  ()=>new Response(null,{status:404}),
  ()=>{throw Error('Connection reset')},
 ])await assert.rejects(renderCoverPng(article,'og',network(response)),CoverImageError)
})

test('public redirects preserve the same photo and unsafe URL schemes are never requested',async()=>{
 const redirected=network(url=>url.pathname.endsWith('start')?new Response(null,{status:302,headers:{location:'/final.png'}}):new Response(photo,{headers:{'content-type':'image/png'}}))
 assert.equal(await fetchCoverImage('https://images.example/start',redirected),'data:image/png;base64,'+photo.toString('base64'))
 assert.deepEqual(redirected.calls,['https://images.example/start','https://images.example/final.png'])
 for(const url of ['http://images.example/a.png','file:///secret.png','https://user:password@images.example/a.png','https://images.example:8080/a.png']){
  const imageOptions=network()
  await assert.rejects(fetchCoverImage(url,imageOptions),CoverImageError)
  assert.deepEqual(imageOptions.calls,[])
 }
})

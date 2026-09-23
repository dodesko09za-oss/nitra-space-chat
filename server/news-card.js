import {approvedCoverImage,coverImageAttribution,fitCoverHeadline,renderTypographicCover} from '../src/features/news-cover.js'
import opentype from 'opentype.js'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {lookup} from 'node:dns/promises'
import {isIP} from 'node:net'
import https from 'node:https'
import {Resvg} from '@resvg/resvg-js'

export class CoverImageError extends Error {}
const MAX_IMAGE_BYTES=5*1024*1024,IMAGE_DEADLINE_MS=7000
function publicImageAddress(address){
 // Pin IPv4 and fail closed for IPv6-only sources, including mapped/tunnel addresses.
 if(isIP(address)!==4)return false
 const [a,b,c]=address.split('.').map(Number)
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113))
}
function photoUrl(value){
 let url
 try{url=new URL(value)}catch{throw new CoverImageError('Fotografia nemá platnú HTTPS adresu.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>8192)throw new CoverImageError('Adresa fotografie nie je povolená.')
 const host=url.hostname.replace(/^\[|\]$/g,'')
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||isIP(host)&&!publicImageAddress(host))throw new CoverImageError('Súkromná adresa fotografie nie je povolená.')
 return url
}
async function beforeDeadline(work,deadline){
 let timer
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CoverImageError('Fotografia neodpovedá. Skús export zopakovať.')),Math.max(1,deadline-Date.now()))})])}finally{clearTimeout(timer)}
}
/** @param {URL} url @param {import('node:dns').LookupAddress} address @param {number} deadline @param {typeof https.get} requestImpl */
function requestImage(url,address,deadline,requestImpl){
 return new Promise((resolve,reject)=>{
  const req=requestImpl(url,{
   agent:false,family:4,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),
   // Keep the original TLS hostname but never perform a second DNS lookup after validation.
   lookup:(_host,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family),
   headers:{Accept:'image/png,image/jpeg,image/webp','User-Agent':'NitraSpace-News-Covers/1.0','Accept-Encoding':'identity'},
  },res=>{
   const status=res.statusCode||0
   if([301,302,303,307,308].includes(status)&&res.headers.location){res.destroy();resolve({location:res.headers.location});return}
   const mime=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase()
   if(status!==200||!['image/png','image/jpeg','image/webp'].includes(mime)){res.destroy();reject(new CoverImageError('Fotografiu nemožno stiahnuť ako PNG, JPEG alebo WebP.'));return}
   if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'||Number(res.headers['content-length'])>MAX_IMAGE_BYTES){res.destroy();reject(new CoverImageError('Fotografia prekročila limit 5 MB alebo používa nepovolené kódovanie.'));return}
   let size=0;const chunks=[]
   res.on('data',chunk=>{size+=chunk.length;if(size>MAX_IMAGE_BYTES){req.destroy(new CoverImageError('Fotografia prekročila limit 5 MB.'));return}chunks.push(chunk)})
   res.on('end',()=>resolve({mime,bytes:Buffer.concat(chunks)}))
   res.on('error',reject)
   res.on('aborted',()=>reject(new CoverImageError('Sťahovanie fotografie bolo prerušené.')))
  })
  req.on('error',reject)
 })
}
function imageDimensions(bytes,mime){
 if(mime==='image/png'&&bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)]
 if(mime==='image/jpeg'&&bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  for(let offset=2;offset+4<=bytes.length;){
   if(bytes[offset++]!==255)break
   while(bytes[offset]===255)offset++
   const marker=bytes[offset++];if(marker===217||marker===218)break
   if(marker===1||marker>=208&&marker<=215)continue
   if(offset+2>bytes.length)break
   const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)break
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=7)return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)]
   offset+=size
  }
 }
 if(mime==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  const kind=bytes.toString('ascii',12,16)
  if(kind==='VP8X')return [1+bytes.readUIntLE(24,3),1+bytes.readUIntLE(27,3)]
  if(kind==='VP8 '&&bytes.subarray(23,26).equals(Buffer.from([157,1,42])))return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383]
  if(kind==='VP8L'&&bytes[20]===47){const bits=bytes.readUInt32LE(21);return [(bits&16383)+1,((bits>>>14)&16383)+1]}
 }
 throw new CoverImageError('Obsah fotografie nezodpovedá podporovanému obrázku.')
}
/** Download once using a validated, pinned public address. Dependencies are injectable for offline security/export tests. */
export async function fetchCoverImage(value,{lookupImpl=lookup,requestImpl=https.get}={}){
 const deadline=Date.now()+IMAGE_DEADLINE_MS
 try{
  let url=photoUrl(value)
  for(let redirects=0;redirects<=3;redirects++){
   const addresses=await beforeDeadline(lookupImpl(url.hostname,{all:true,family:4}),deadline)
   if(!addresses.length||addresses.some(a=>!publicImageAddress(a.address)))throw new CoverImageError('Súkromná alebo nepodporovaná adresa fotografie.')
   const response=await requestImage(url,addresses[0],deadline,requestImpl)
   if(response.location){if(redirects===3)throw new CoverImageError('Fotografia má príliš veľa presmerovaní.');url=photoUrl(new URL(response.location,url).href);continue}
   const {bytes,mime}=response,[width,height]=imageDimensions(bytes,mime)
   if(!width||!height||width>16000||height>16000||width*height>40000000)throw new CoverImageError('Rozmery fotografie sú príliš veľké alebo neplatné.')
   const href='data:'+mime+';base64,'+bytes.toString('base64')
   // resvg may silently discard a corrupt/unsupported image. Reject before exporting a card without its photo.
   const probe=new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="'+href+'" width="2" height="2"/></svg>',{font:{loadSystemFonts:false}})
   if(!probe.innerBBox())throw new CoverImageError('Fotografiu nemožno dekódovať. Nahraj ju ako PNG alebo JPEG.')
   return href
  }
 }catch(error){if(error instanceof CoverImageError)throw error;throw new CoverImageError('Fotografiu sa nepodarilo načítať. Skús export zopakovať alebo nahraj PNG/JPEG.')}
}
function addPngAttribution(png,attribution){
 // Uncompressed UTF-8 iTXt retains complete author/license/source metadata in the downloaded PNG.
 const data=Buffer.concat([Buffer.from('Description\0\0\0\0\0'),Buffer.from(JSON.stringify(attribution),'utf8')]),type=Buffer.from('iTXt'),chunk=Buffer.alloc(data.length+12)
 chunk.writeUInt32BE(data.length,0);type.copy(chunk,4);data.copy(chunk,8)
 let crc=0xffffffff
 for(const byte of Buffer.concat([type,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 chunk.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8)
 return Buffer.concat([png.subarray(0,png.length-12),chunk,png.subarray(png.length-12)])
}
export function fitHeadline(text,width=936,maxLines=6){let display=String(text).slice(0,180);while(display.length){try{return fitCoverHeadline(display,{width,maxLines,height:maxLines*92*1.2,maxSize:92,minSize:48,measure:(s,size)=>s.length*size*.68})}catch{display=display.slice(0,-2).trimEnd()+'…';if(display.length<2)break}}throw Error('Nadpis sa nezmestí.')}
export function renderNewsCard(article,format='feed'){return renderTypographicCover(article,format)}
let fontPromise,chromePromise
export async function renderCoverPng(article,format='feed',imageOptions={}){
 if(!fontPromise)fontPromise=Promise.all(['latin','latin-ext'].map(subset=>readFile(createRequire(import.meta.url).resolve('@fontsource/anton/files/anton-'+subset+'-400-normal.woff')).then(bytes=>opentype.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))))).then(fonts=>({
  getAdvanceWidth(text,size){return [...text].reduce((sum,c)=>{const f=fonts.find(f=>f.charToGlyphIndex(c))||fonts[0];return sum+f.getAdvanceWidth(c,size)},0)},
  getPath(text,x,y,size){const path=new opentype.Path();for(const c of text){const f=fonts.find(f=>f.charToGlyphIndex(c))||fonts[0];path.extend(f.getPath(c,x,y,size));x+=f.getAdvanceWidth(c,size)}return path}
 }))
 if(!chromePromise)chromePromise=readFile(new URL('../public/chrome-sculpture.png',import.meta.url)).then(bytes=>'data:image/png;base64,'+bytes.toString('base64'))
 const photoUrl=approvedCoverImage(article)
 const [font,chrome,photo]=await Promise.all([fontPromise,chromePromise,photoUrl?fetchCoverImage(photoUrl,imageOptions):Promise.resolve('')])
 const svg=renderTypographicCover(article,format,font,chrome,photo),png=new Resvg(svg,{font:{loadSystemFonts:false}}).render().asPng()
 return {svg,png:photo?addPngAttribution(png,coverImageAttribution(article)):png,imageStatus:photo?'photo':'fallback'}
}

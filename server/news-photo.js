import {lookup} from 'node:dns/promises'
import {request} from 'node:https'
import {isIP} from 'node:net'
import {Resvg} from '@resvg/resvg-js'
import {publicAddress} from './news-ingestion.js'
import {discoverArticleImage} from './nitrak-discovery.js'

const API='https://commons.wikimedia.org/w/api.php'
const MAX_IMAGE_BYTES=5*1024*1024
const MAX_JSON_BYTES=800000
const PHOTO_MIMES=new Set(['image/jpeg','image/png','image/webp'])
const STOP=new Set('a aj ako ale bez bol bola bude co do dnes for from in is je jeho jej k kde ked kto na nad nie novy nova nove o of od po pod podla pre pri sa si so su ten the this to uz v vo z za zo and with mesto mesta nitre nitra nitry nitru slovensko slovakia novinky spravy new news announces announced vydava vydal pripravuje chysta prichadza hovori rapper raper koncert festival policia zmeny uzavierka zacina konci'.split(' '))
const TOPICS=[
  ['hokej|hockey|extralig|hk nitra','ice hockey'],
  ['futbal|football|fc nitra','football'],
  ['skate|bmx','skatepark'],
  ['mhd|autobus|trolejbus|bus|tram','bus'],
  ['park|zahrad|garden','park'],
  ['nemocnic|hospital','hospital'],
  ['skol|univerzit|university|school','university'],
]

function plain(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&nbsp;/gi,' ').replace(/&#(\d+);/g,(_,n)=>{const point=Number(n);return point>0&&point<=0x10ffff?String.fromCodePoint(point):' '}).replace(/\s+/g,' ').trim()}
function normalized(value){return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]/g,' ').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()}
function words(value){return [...new Set(normalized(value).split(' ').filter(word=>word.length>=3&&!STOP.has(word)))]}
function includesPhrase(text,phrase){return (` ${text} `).includes(` ${normalized(phrase)} `)}
function safeUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.href.length<8192?url:null}catch{return null}}
function publicIPv4(address){return isIP(address)===4&&publicAddress(address)&&!/^192\.0\.(0|2)\.|^198\.51\.100\.|^203\.0\.113\.|^192\.88\.99\./.test(address)}

// Resolve once and pin the HTTPS socket to that public IPv4 address. A DNS
// preflight followed by ordinary fetch would allow a second, unsafe resolution.
function pinnedRequest(url,address,{headers,signal}){
  return new Promise((resolve,reject)=>{
    const req=request(url,{agent:false,family:4,headers,signal,lookup:(_hostname,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)},response=>{
      resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,url:url.href,headers:{get:name=>{const value=response.headers[name.toLowerCase()];return Array.isArray(value)?value.join(','):value||null}},body:response})
    })
    req.on('error',reject);req.end()
  })
}

async function beforeAbort(work,signal){
  signal.throwIfAborted()
  let abort
  try{return await Promise.race([work,new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true})})])}finally{signal.removeEventListener('abort',abort)}
}

/** @param {any} requestOptions */
async function checkedResponse(value,requestOptions={},redirects=0){
  const {fetchImpl,lookupImpl=lookup,kind='image',signal:requestedSignal}=requestOptions
  const url=safeUrl(value)
  if(!url||redirects>3)throw new Error('Neplatná alebo presmerovaná adresa fotografie.')
  if(url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||isIP(url.hostname)&&!publicIPv4(url.hostname))throw new Error('Súkromná adresa fotografie bola odmietnutá.')
  if(kind==='commons'&&url.hostname!=='commons.wikimedia.org')throw new Error('Neplatný zdroj licencie.')
  const signal=requestedSignal||AbortSignal.timeout(6500)
  const addresses=await beforeAbort(lookupImpl(url.hostname,{all:true,family:4}),signal)
  if(!addresses.length||addresses.some(({address})=>!publicIPv4(address)))throw new Error('Súkromná adresa fotografie bola odmietnutá.')
  const options={redirect:'manual',signal,headers:{Accept:kind==='commons'?'application/json':'image/jpeg,image/png,image/webp','Accept-Encoding':'identity','User-Agent':'NitraSpace-News-Photo/1.0 (editorial photo attribution)'}}
  const response=await beforeAbort(fetchImpl?fetchImpl(url,options):pinnedRequest(url,addresses[0].address,options),signal)
  if(response.status>=300&&response.status<400){
    const location=response.headers.get('location');await discard(response)
    if(!location)throw new Error('Neplatné presmerovanie fotografie.')
    return checkedResponse(new URL(location,url).href,{fetchImpl,lookupImpl,kind,signal:options.signal},redirects+1)
  }
  if(!response.ok){await discard(response);throw new Error('Fotografia alebo jej licencia nie je dostupná.')}
  return response
}

async function discard(response){try{if(response.body?.cancel)await response.body.cancel();else response.body?.destroy?.()}catch{}}
async function boundedBytes(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await discard(response);throw new Error('Odpoveď fotografie je príliš veľká.')}
  const chunks=[];let size=0
  if(!response.body)throw new Error('Prázdna odpoveď fotografie.')
  for await(const chunk of response.body){size+=chunk.length;if(size>limit){await discard(response);throw new Error('Odpoveď fotografie je príliš veľká.')}chunks.push(Buffer.from(chunk))}
  return Buffer.concat(chunks)
}
async function commonsQuery(params,options){
  const url=new URL(API)
  for(const [key,value] of Object.entries({action:'query',prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1600',format:'json',...params}))url.searchParams.set(key,String(value))
  const response=await checkedResponse(url.href,{...options,kind:'commons'})
  if(!String(response.headers.get('content-type')||'').includes('application/json')){await discard(response);throw new Error('Neplatná odpoveď licencie.')}
  const data=JSON.parse((await boundedBytes(response,MAX_JSON_BYTES)).toString('utf8'))
  return Object.values(data?.query?.pages||{})
}

function imageDimensions(bytes,mime){
  if(mime==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)]
  if(mime==='image/jpeg'&&bytes.length>4&&bytes[0]===255&&bytes[1]===216){
    let offset=2
    while(offset+4<bytes.length){
      if(bytes[offset]!==255)return null
      const marker=bytes[offset+1];if(marker===217||marker===218)return null
      const length=bytes.readUInt16BE(offset+2);if(length<2||offset+length+2>bytes.length)return null
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return [bytes.readUInt16BE(offset+7),bytes.readUInt16BE(offset+5)]
      offset+=length+2
    }
  }
  if(mime==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
    const type=bytes.toString('ascii',12,16)
    if(type==='VP8X')return [bytes.readUIntLE(24,3)+1,bytes.readUIntLE(27,3)+1]
    if(type==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383]
    if(type==='VP8L'&&bytes[20]===47){const bits=bytes.readUInt32LE(21);return [(bits&16383)+1,((bits>>>14)&16383)+1]}
  }
  return null
}

export async function fetchPhotoBytes(url,options={}){
  const signal=options.signal||AbortSignal.timeout(6500)
  const response=await checkedResponse(url,{...options,signal})
  const mime=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()
  if(!PHOTO_MIMES.has(mime)){await discard(response);throw new Error('Zdroj neposkytol podporovanú fotografiu.')}
  const encoding=response.headers.get('content-encoding')
  if(encoding&&encoding!=='identity'){await discard(response);throw new Error('Fotografia používa nepodporované kódovanie.')}
  const buffer=await beforeAbort(boundedBytes(response,MAX_IMAGE_BYTES),signal),dimensions=imageDimensions(buffer,mime)
  const minimum=options.minimumDimensions===false?1:400
  if(!dimensions||Math.min(...dimensions)<minimum||(options.minimumDimensions!==false&&Math.max(...dimensions)<800)||Math.max(...dimensions)>16000||dimensions[0]*dimensions[1]>40000000)throw new Error('Fotografia je poškodená alebo má nevhodné rozmery.')
  return {mime,width:dimensions[0],height:dimensions[1],buffer}
}

export async function verifyPhotoUrl(url,options={}){
  const {buffer,...metadata}=await fetchPhotoBytes(url,options)
  const embedded=`data:${metadata.mime};base64,${buffer.toString('base64')}`
  const probe=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="${embedded}" width="2" height="2"/></svg>`,{font:{loadSystemFonts:false}})
  if(!probe.innerBBox())throw new Error('Fotografiu nemožno dekódovať.')
  return {...metadata,bytes:buffer.length}
}

// Cropped social cards can satisfy CC BY, CC0 and public-domain terms. Do not
// auto-select NC, ND, GFDL or ShareAlike works without implementing their terms.
export function allowedPhotoLicense(metadata={}){
  const name=plain(metadata.LicenseShortName?.value||metadata.UsageTerms?.value)
  const url=safeUrl(String(metadata.LicenseUrl?.value||'').replace(/^http:\/\//,'https://'))
  if(!url||!['creativecommons.org','www.creativecommons.org'].includes(url.hostname))return null
  const by=url.pathname.match(/^\/licenses\/by\/(1\.0|2\.0|2\.5|3\.0|4\.0)\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?$/)
  const cc0=/^\/publicdomain\/zero\/1\.0\/$/.test(url.pathname),pd=/^\/publicdomain\/mark\/1\.0\/$/.test(url.pathname)
  if(by&&!new RegExp(`^CC BY ${by[1].replace('.','\\.')}(?: [A-Z-]+)?$`,'i').test(name))return null
  if(cc0&&!/^CC0(?: 1\.0)?$/i.test(name))return null
  if(pd&&!/^Public domain$/i.test(name))return null
  if(!by&&!cc0&&!pd)return null
  if(plain(metadata.Restrictions?.value))return null
  return {name,url:url.href,requiresAttribution:!!by}
}

function subject(article){
  const title=plain(article.headline||article.title||article.query),text=normalized(title)
  const entities=[]
  if(/\b(?:kanye\w*|kanye west)\b/.test(text))entities.push('Kanye West')
  if(/\b(?:playboi carti|carti\w*)\b/.test(text))entities.push('Playboi Carti')
  if(title!==title.toUpperCase()){
    for(const match of title.matchAll(/\b[\p{Lu}][\p{L}\d]*(?:\s+[\p{Lu}][\p{L}\d]*){0,3}/gu)){
      const name=match[0].split(/\s+/).filter(word=>!STOP.has(normalized(word))&&!TOPICS.some(([pattern])=>new RegExp(`^(?:${pattern})`,'i').test(normalized(word)))).join(' ')
      if(name&&normalized(name).length>=4&&!entities.some(entity=>includesPhrase(normalized(entity),name)))entities.push(name)
    }
  }
  const topic=TOPICS.find(([pattern])=>new RegExp(`\\b(?:${pattern})`,'i').test(text))
  const local=/\bnitr(?:a|e|u|y|ou)\b/.test(text)
  const tokens=words(title)
  return {title,text,entities:entities.slice(0,3),topic,local,tokens}
}

export function photoRelevance(article,page){
  const item=subject(article),info=page?.imageinfo?.[0],meta=info?.extmetadata||{}
  // Categories often mention a city or many artists only indirectly; they are
  // not evidence of the subject actually depicted in this photograph.
  const caption=normalized(`${String(page?.title||'').replace(/^File:/,'')} ${plain(meta.ObjectName?.value)} ${plain(meta.ImageDescription?.value)}`)
  if(!caption||/\b(?:logo|poster|album cover|screenshot|map|coat of arms|signature)\b/.test(caption))return 0
  const entityMatches=item.entities.filter(entity=>includesPhrase(caption,entity))
  if(item.entities.length)return entityMatches.length?10+entityMatches.length:0
  if(item.topic){
    const matches=new RegExp(`\\b(?:${item.topic[0]}|${item.topic[1]})`,'i').test(caption)
    if(!matches||(item.local&&!/\bnitr(?:a|e|y|u)\b/.test(caption)))return 0
    return 6
  }
  const matches=item.tokens.filter(token=>includesPhrase(caption,token))
  if(matches.length<2||(item.local&&!/\bnitr(?:a|e|y|u)\b/.test(caption)))return 0
  return matches.length
}

function photoKey(value){
  const url=safeUrl(value);if(!url)return ''
  if(url.hostname==='upload.wikimedia.org'){
    const pieces=url.pathname.split('/'),thumb=pieces.indexOf('thumb')
    if(thumb>=0&&pieces[thumb+3])return `commons:${decodeURIComponent(pieces[thumb+3])}`
    return `commons:${decodeURIComponent(pieces.at(-1))}`
  }
  return `${url.origin}${url.pathname}`
}

function licensedCandidate(article,page,{excludeUrls=[]}={}){
  const info=page?.imageinfo?.[0],meta=info?.extmetadata||{},license=allowedPhotoLicense(meta)
  const image=safeUrl(info?.thumburl||info?.url),landing=safeUrl(info?.descriptionurl)
  if(!license||!image||image.hostname!=='upload.wikimedia.org'||!image.pathname.startsWith('/wikipedia/commons/')||!landing||landing.hostname!=='commons.wikimedia.org'||!/^\/wiki\/File:/.test(landing.pathname)||!PHOTO_MIMES.has(info?.mime)||/\.(?:svg|pdf|gif|tif|tiff|webm|ogg)$/i.test(page.title||''))return null
  const width=Number(info.thumbwidth||info.width),height=Number(info.thumbheight||info.height)
  if(Math.min(width,height)<400||Math.max(width,height)<800||!width||!height)return null
  const excluded=new Set(excludeUrls.map(photoKey));if(excluded.has(photoKey(image.href)))return null
  const relevance=photoRelevance(article,page);if(!relevance)return null
  const creator=plain(meta.Artist?.value),title=plain(meta.ObjectName?.value||String(page.title||'').replace(/^File:/,''))
  if(license.requiresAttribution&&!creator)return null
  // Keep complete source + license links; social exports also carry this credit.
  const credit=`${creator||'Autor neuvedený'} · ${title} · ${license.name} (${license.url}) · Wikimedia Commons: ${landing.href} · Orez a grafická úprava: Nitra Space.`
  if(credit.length>1800)return null
  return {cover_image_url:image.href,image_rights:'licensed',image_credit:credit,cover_image_alt:`Ilustračná fotografia: ${title}`.slice(0,500),relevance}
}

export async function discoverLicensedPhoto(article,options={}){
  const item=subject(article)
  const queries=[...item.entities.map(name=>`"${name}"`),item.tokens.slice(0,8).join(' '),item.local&&item.topic?`Nitra ${item.topic[1]}`:''].filter((query,index,all)=>query.length>2&&all.indexOf(query)===index).slice(0,4)
  for(const query of queries){
    try{
      const pages=await commonsQuery({generator:'search',gsrsearch:`${query} filetype:bitmap`,gsrnamespace:6,gsrlimit:12},options)
      const candidates=pages.map(page=>licensedCandidate(article,page,options)).filter(Boolean).sort((a,b)=>b.relevance-a.relevance)
      for(const candidate of candidates.slice(0,3)){
        try{await verifyPhotoUrl(candidate.cover_image_url,options);const {relevance,...photo}=candidate;return photo}catch{}
      }
    }catch{}
  }
  return null
}

function existingCommonsFile(article){
  const url=safeUrl(article.cover_image_url)
  if(url?.hostname==='upload.wikimedia.org')return photoKey(url.href).replace(/^commons:/,'')
  const match=String(article.image_credit||'').match(/https:\/\/commons\.wikimedia\.org\/wiki\/File:[^\s)]+/)
  return match?decodeURIComponent(new URL(match[0]).pathname.slice('/wiki/File:'.length)):''
}

export async function selectArticlePhoto(article,{excludeUrls=[],...options}={}){
  const missing={cover_image_url:null,image_rights:'fallback',image_credit:'',cover_image_alt:'Bez fotografie: nenašla sa dostupná fotografia s overenou licenciou a súvisom s témou.',photo_status:'missing',photo_reason:'Nenašla sa relevantná dostupná fotografia s overenou licenciou.'}
  const existing=safeUrl(article.cover_image_url),credit=plain(article.image_credit)
  if(existing&&credit&&['owned','official','licensed'].includes(article.image_rights)){
    try{
      const commonsFile=existingCommonsFile(article)
      if(commonsFile){
        const pages=await commonsQuery({titles:`File:${commonsFile}`},options)
        const candidate=pages.map(page=>licensedCandidate(article,page)).find(photo=>photo&&photoKey(photo.cover_image_url)===photoKey(existing.href))
        if(candidate){await verifyPhotoUrl(existing.href,options);const {relevance,...photo}=candidate;return {...photo,cover_image_url:existing.href,photo_status:'reused',photo_reason:null}}
      }else{
        // owned/official represent an editor's explicit rights assertion. A
        // licensed external image additionally needs a supported license link.
        const licenseLink=credit.match(/https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/by\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:zero|mark)\/1\.0)\//)
        if(article.image_rights!=='licensed'||licenseLink){
          await verifyPhotoUrl(existing.href,options)
          return {cover_image_url:existing.href,image_rights:article.image_rights,image_credit:article.image_credit,cover_image_alt:article.cover_image_alt||'Redakčne zvolená fotografia k článku',photo_status:'reused',photo_reason:null}
        }
      }
    }catch{}
  }
  // A draft may still show the source article's own lead image. It is clearly
  // marked unverified and publication validation will require an editor to
  // confirm permission/credit (or replace it with an owned/licensed image).
  try{
    const source=await discoverArticleImage({url:article.source_url,source_name:article.source_name,headline:article.headline})
    // A source's own lead image remains relevant even when another draft of
    // the same story uses it. Deduplication applies to generic search results.
    if(source?.cover_image_url)return {cover_image_url:source.cover_image_url,image_rights:'source_unverified',image_credit:source.image_credit||`Fotografia zo zdroja ${article.source_name||'pôvodný zdroj'}. Pred publikovaním over práva.`,cover_image_alt:source.cover_image_alt||`Náhľadová fotografia k téme ${article.headline}`,photo_status:'source',photo_reason:'Fotografia je zo zdroja a čaká na potvrdenie práv.'}
  }catch{}
  const photo=await discoverLicensedPhoto(article,{...options,excludeUrls})
  if(photo)return {...photo,photo_status:'selected',photo_reason:null}
  return missing
}

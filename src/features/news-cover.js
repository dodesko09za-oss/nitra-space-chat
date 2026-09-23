import {html} from './shared.js'
// Article and social formats use the same approved photograph; the host is not a rights decision.
export function approvedCoverImage(article){
 const rights=String(article.image_rights||'')
 // Source images are allowed in draft previews/exports with an explicit
 // unverified label, but never rendered on a scheduled or published story.
 const draftSource=rights==='source_unverified'&&!['published','scheduled'].includes(String(article.status||''))
 if(!['owned','licensed','official'].includes(rights)&&!draftSource||!String(article.image_credit||'').trim())return ''
 try{const url=new URL(article.cover_image_url);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port?url.href:''}catch{return ''}
}
export function coverImageAttribution(article){return {url:approvedCoverImage(article),credit:String(article.image_credit||''),rights:String(article.image_rights||''),license:String(article.image_license||''),license_url:String(article.image_license_url||'')}}
export const coverTemplates=['left','center','bottom','number','asymmetric']
export function chooseTemplate(a){if(coverTemplates.includes(a.cover_template))return a.cover_template;const s=String(a.cover_headline||a.visual_headline||a.headline||'');return s.length>95?'left':coverTemplates[[...s].reduce((n,c)=>n+c.charCodeAt(0),Number(a.card_version)||0)%5]}
export function fitCoverHeadline(title,{width=936,height=720,maxSize=160,minSize=40,maxLines=Infinity,measure=(s,size)=>s.length*size*.57}={}){
 const paragraphs=String(title||'NITRA SPACE').trim().slice(0,180).toLocaleUpperCase('sk').split(/\n+/)
 for(let size=maxSize;size>=minSize;size-=2){
  const lines=[]
  for(const p of paragraphs){let line='';const words=p.trim().split(/\s+/).flatMap(w=>{const parts=[];let part='';for(const c of w){if(part&&measure(part+c,size)>width){parts.push(part);part=''}part+=c}if(part)parts.push(part);return parts})
   for(const w of words){const next=line?line+' '+w:w;if(line&&measure(next,size)>width){lines.push(line);line=w}else line=next}if(line)lines.push(line)
  }
  if(lines.length<=maxLines&&lines.length*size*1.2<=height){
   if(paragraphs.length===1&&lines.length>1&&lines.at(-1).split(' ').length===1){const before=lines.at(-2).split(' ');if(before.length>2){const word=before.pop(),merged=word+' '+lines.at(-1);if(measure(merged,size)<=width){lines[lines.length-2]=before.join(' ');lines[lines.length-1]=merged}}}
   return {size,lines,lineHeight:size*1.2}
  }
 }
 throw Error('Nadpis je príliš dlhý pre túto obálku. Skráť ho alebo zruš ručné zalomenia.')
}
export function renderTypographicCover(a,format='feed',font=null,chromeHref='/chrome-sculpture.png',embeddedPhoto=null){
 const width=format==='og'?1200:1080,height=format==='og'?630:format==='story'?1920:1350,m=72,template=chooseTemplate(a),og=format==='og',story=format==='story'
 const title=a.cover_headline||a.visual_headline||a.headline||'NITRA SPACE',top=og?180:story?450:310,bottom=og?115:story?330:250,regionHeight=height-top-bottom,regionWidth=width-m*2-(template==='asymmetric'&&!og?100:0)
 const fit=fitCoverHeadline(title,{width:regionWidth,height:regionHeight,maxSize:og?116:174,minSize:og?32:42,measure:font?(s,size)=>font.getAdvanceWidth(s,size):undefined}),block=fit.lines.length*fit.lineHeight
 const start=template==='bottom'?height-bottom-block+fit.size:template==='center'?top+(regionHeight-block)/2+fit.size:top+fit.size
 const text=(value,x,y,size,{fill='#fff',anchor='start',opacity=1}={})=>{
  const v=String(value),w=font?font.getAdvanceWidth(v,size):0,offset=anchor==='middle'?w/2:anchor==='end'?w:0
  return font?'<path d="'+font.getPath(v,x-offset,y,size).toPathData(2)+'" fill="'+fill+'" opacity="'+opacity+'"/>':'<text x="'+x+'" y="'+y+'" fill="'+fill+'" opacity="'+opacity+'" text-anchor="'+anchor+'" font-family="Anton,Impact,sans-serif" font-size="'+size+'">'+html(v)+'</text>'
 }
 const center=template==='center',x=center?width/2:m+(template==='asymmetric'?50:0)
 const photo=approvedCoverImage(a)?embeddedPhoto??approvedCoverImage(a):'',attribution=coverImageAttribution(a)
 const chrome=!photo&&(a.cover_chrome!==false||Boolean(a.cover_image_url))?'<image href="'+html(chromeHref)+'" x="'+(og?width-470:width-660)+'" y="'+(og?-110:story?80:-80)+'" width="'+(og?560:story?930:820)+'" height="'+(og?560:story?930:820)+'" preserveAspectRatio="xMidYMid meet" opacity=".78"/>':''
 const background=photo?'<image data-cover-photo="true" href="'+html(photo)+'" x="0" y="0" width="'+width+'" height="'+height+'" preserveAspectRatio="xMidYMid slice"/><rect width="'+width+'" height="'+height+'" fill="url(#photo-shade)"/>':chrome
 // A short visible credit survives social platforms stripping PNG metadata. The full attribution remains in both SVG and PNG.
 const fullCredit=[attribution.credit,attribution.license].filter(Boolean).join(' · ').replace(/\s+/g,' ').trim(),credit=fullCredit.length>150?fullCredit.slice(0,147)+'…':fullCredit
 const creditSize=Math.min(og?18:22,(width-2*m)/(font?font.getAdvanceWidth('FOTO: '+credit,1):('FOTO: '+credit).length*.57))
 const footer=photo?text('FOTO: '+credit,m,height-(story?130:og?16:82),creditSize,{fill:'#dedede'}):''
 return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+html(a.headline||title)+'">'+(photo?'<metadata>'+html(JSON.stringify(attribution))+'</metadata>':'')+'<defs><linearGradient id="metal"><stop stop-color="#343434"/><stop offset=".3" stop-color="#fff"/><stop offset=".52" stop-color="#555"/><stop offset=".7" stop-color="#fff"/><stop offset="1" stop-color="#777"/></linearGradient><linearGradient id="photo-shade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".3"/><stop offset=".3" stop-color="#000" stop-opacity=".42"/><stop offset=".78" stop-color="#000" stop-opacity=".88"/><stop offset="1" stop-color="#000" stop-opacity=".96"/></linearGradient></defs><rect width="'+width+'" height="'+height+'" fill="#030303"/>'+background+text('NITRA SPACE / NEWS',m,og?66:story?200:110,og?25:30)+text(String(a.cover_number||1).padStart(2,'0')+' / '+String(a.category||'NITRA').toLocaleUpperCase('sk'),m,og?122:story?302:210,og?25:30,{fill:'#168dff'})+(template==='number'&&!og?text(String(a.cover_number||1).padStart(2,'0'),width-m,height-bottom+20,440,{anchor:'end',opacity:.09}):'')+fit.lines.map((line,i)=>text(line,x,start+i*fit.lineHeight,fit.size,{anchor:center?'middle':'start'})).join('')+'<path d="M'+m+' '+(height-bottom+44)+'H'+(width-m)+'" stroke="#505050"/>'+text('NITRASPACE.XYZ',m,height-(story?180:42),og?23:28)+text(String(a.cover_number||1).padStart(2,'0'),width-m,height-(story?180:42),og?23:28,{anchor:'end'})+footer+'</svg>'
}

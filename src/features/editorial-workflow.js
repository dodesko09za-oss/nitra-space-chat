export function hasPlaceholder(article){
 const text=[article.summary,article.content].filter(Boolean).join(' ').toLowerCase()
 return /redakčný podklad|pred vydaním|toto je redakčný návrh|pred publikovaním|návrh z portálu|návrh (čaká|vznikol)|dodatočné redakčné overenie/.test(text)
}
export function textIssue(article){
 if(hasPlaceholder(article))return 'Návrh ešte obsahuje pracovné pokyny. Najprv treba doplniť vlastný text.'
 if(String(article.summary||'').trim().length<80||String(article.content||'').trim().length<300)return 'Perex potrebuje aspoň 80 a článok 300 znakov.'
 return ''
}
export function publicationIssue(article){
 const issue=textIssue(article);if(issue)return issue
 if(article.manual_review_required)return 'Potvrď kontrolu faktov, textu a fotografie.'
 try{const url=new URL(article.source_url);if(url.protocol!=='https:'||url.username||url.password)throw Error()}catch{return 'Doplň platný HTTPS odkaz na zdroj.'}
 if(!String(article.source_name||'').trim())return 'Doplň názov zdroja.'
 if(article.cover_image_url&&(!['owned','licensed','official'].includes(article.image_rights)||!String(article.image_credit||'').trim()))return 'Potvrď práva a kredit fotografie alebo zvoľ typografickú chrome obálku.'
 if(article.status==='scheduled'&&(!article.scheduled_at||!Number.isFinite(Date.parse(article.scheduled_at))))return 'Zadaj dátum a čas publikovania.'
 return ''
}

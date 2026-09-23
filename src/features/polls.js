import {db,state,content,notice,requireUser,onCleanup} from './runtime.js'
import {html,field} from './shared.js'
let submitting=false
export async function renderPolls(){
  const news=new URLSearchParams(location.search).get('news')
  const generation=state.generation
  const load=async()=>{
    const {data,error}=await db.rpc('nitra_community_polls',{p_news:news||null});if(error)throw error
    if(generation!==state.generation)return
    content(`<section class="page-heading"><span>TVOJ HLAS V MESTE</span><h1>Čo si myslíš?</h1><p>Výsledky sa zobrazia po tvojom hlase.</p></section>${state.admin?'<button data-poll-admin>Spravovať ankety</button>':''}<div class="poll-stack">${data.map(p=>`<article class="panel"><span class="eyebrow">${html(p.kind)}</span><h2>${html(p.question)}</h2><div class="poll-options ${p.kind==='rating'?'rating':''}">${p.options.map(o=>{const percent=p.total_votes?Math.round(o.votes/p.total_votes*100):0;return `<button data-vote="${html(p.id)}" data-option="${html(o.id)}" ${p.selected_option?'disabled':''}><span>${html(o.label)}</span>${p.selected_option?`<strong>${percent}% · ${o.votes}</strong><i style="--percent:${percent}%"></i>`:''}</button>`}).join('')}</div>${p.selected_option?`<p class="muted">${p.total_votes} hlasujúcich · Tvoj hlas bol započítaný.</p>`:''}</article>`).join('')||'<section class="empty"><h2>Žiadna aktívna anketa.</h2></section>'}</div>`)
    document.querySelector('[data-poll-admin]')?.addEventListener('click',admin)
    document.querySelectorAll('[data-vote]').forEach(button=>button.onclick=async()=>{
      if(submitting||!await requireUser())return;submitting=true;button.disabled=true
      try{const {error}=await db.rpc('nitra_community_vote',{p_poll:button.dataset.vote,p_option:button.dataset.option});if(error)throw error;await load()}
      catch(error){notice(error.message);button.disabled=false}finally{submitting=false}
    })
  }
  await load()
  const timer=setInterval(()=>{if(!document.hidden&&!submitting&&state.generation===generation&&!document.querySelector('[data-poll-editor]'))load().catch(()=>{})},8000)
  onCleanup(()=>clearInterval(timer))
}
async function admin(){
  const permission=await db.rpc('is_admin');if(permission.data!==true)return
  const {data,error}=await db.from('nitra_polls').select('*').eq('account_voting',true).order('created_at',{ascending:false}).limit(50);if(error){notice(error.message);return}
  content(`<section class="page-heading"><h1>Správa ankiet</h1></section><form class="panel" data-poll-editor>${field('question','Otázka')}<label>Typ<select name="kind"><option value="normal">NORMAL</option><option value="versus">A vs B</option><option value="rating">RATING 1–10</option><option value="daily">DAILY</option></select></label><label>Možnosti (2–4, každá na nový riadok; rating sa vytvorí automaticky)<textarea name="options"></textarea></label>${field('news_id','ID súvisiaceho NEWS článku (voliteľné)')}<button>Vytvoriť a spustiť</button></form><div class="admin-list">${data.map(p=>`<article class="admin-row"><h2>${html(p.question)}</h2><small>${p.active?'AKTÍVNA':'UKONČENÁ'} · ${html(p.kind)}</small><div class="actions"><button data-toggle="${html(p.id)}">${p.active?'Ukončiť':'Spustiť'}</button><button data-question="${html(p.id)}">Upraviť otázku</button><button data-remove="${html(p.id)}">Vymazať</button></div></article>`).join('')}</div>`)
  const form=document.querySelector('form');form.question.required=true;form.question.maxLength=180
  form.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(form));const labels=v.kind==='rating'?Array.from({length:10},(_,i)=>String(i+1)):v.options.split('\n').map(s=>s.trim()).filter(Boolean);if(v.kind!=='rating'&&(labels.length<2||labels.length>4||v.kind==='versus'&&labels.length!==2)){notice('Zadaj správny počet možností.');return}const button=form.querySelector('button');button.disabled=true;const {error}=await db.from('nitra_polls').insert({id:crypto.randomUUID(),question:v.question.trim(),account_voting:true,kind:v.kind,options:labels.map((label,i)=>({id:String(i+1),label})),news_id:v.news_id||null,active:true,closes_at:v.kind==='daily'?new Date(Date.now()+86400000).toISOString():null});if(error){notice(error.message);button.disabled=false}else admin()}
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{const p=data.find(p=>p.id===b.dataset.toggle);const r=await db.from('nitra_polls').update({active:!p.active,closes_at:!p.active&&p.kind==='daily'?new Date(Date.now()+86400000).toISOString():p.closes_at}).eq('id',p.id);if(r.error)notice(r.error.message);else admin()})
  document.querySelectorAll('[data-question]').forEach(b=>b.onclick=async()=>{const p=data.find(p=>p.id===b.dataset.question);const question=prompt('Upraviť otázku (možnosti s hlasmi zostávajú nemenné)',p.question);if(!question)return;const r=await db.from('nitra_polls').update({question}).eq('id',p.id);if(r.error)notice(r.error.message);else admin()})
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=async()=>{if(!confirm('Vymazať anketu aj jej hlasy?'))return;const r=await db.from('nitra_polls').delete().eq('id',b.dataset.remove);if(r.error)notice(r.error.message);else admin()})
}

export async function renderInlinePolls(news,host){
 const generation=state.generation;const load=async()=>{const {data,error}=await db.rpc('nitra_community_polls',{p_news:news});if(error||generation!==state.generation||!host.isConnected)return;host.innerHTML=data.map(p=>'<article class="panel"><h2>'+html(p.question)+'</h2><div class="poll-options">'+p.options.map(o=>'<button data-inline-vote="'+html(p.id)+'" data-option="'+html(o.id)+'" '+(p.selected_option?'disabled':'')+'><span>'+html(o.label)+'</span>'+(p.selected_option?'<strong>'+Math.round(p.total_votes?o.votes/p.total_votes*100:0)+'% · '+o.votes+'</strong>':'')+'</button>').join('')+'</div></article>').join('');host.querySelectorAll('[data-inline-vote]').forEach(b=>b.onclick=async()=>{if(!await requireUser())return;b.disabled=true;const r=await db.rpc('nitra_community_vote',{p_poll:b.dataset.inlineVote,p_option:b.dataset.option});if(r.error){notice(r.error.message);b.disabled=false}else load()})};await load();const timer=setInterval(()=>{if(!document.hidden)load()},8000);onCleanup(()=>clearInterval(timer))
}

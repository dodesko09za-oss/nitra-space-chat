export function html(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
export function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
}
export function slugify(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,160).replace(/-$/,'')
}
export function dateLabel(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sk-SK',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
}
export const field = (name,label,value='',type='text') => `<label>${html(label)}<input name="${name}" type="${type}" value="${html(value)}"></label>`
export function articleCard(article) {
  const cover = httpsUrl(article.cover_image_url)
  return `<a class="news-card" href="/news/${html(article.slug)}" data-route>
    ${cover ? `<img src="${html(cover)}" alt="" loading="lazy" decoding="async" width="800" height="1000">` : '<div class="news-fallback" aria-hidden="true">N</div>'}
    <div class="news-card-top"><span>NITRA SPACE</span>${article.localPreview ? '<b>LOKÁLNY NÁHĽAD</b>' : article.breaking ? '<b>BREAKING</b>' : ''}</div>
    <div class="news-card-copy"><span>${html(article.category)} · ${html(dateLabel(article.published_at))}</span><h2>${html(article.headline)}</h2><p>${html(article.summary)}</p><span>Čítať článok ↗</span></div>
  </a>`
}

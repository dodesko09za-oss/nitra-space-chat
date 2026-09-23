const names=['window','document','location','navigator','confirm','alert','crypto','FormData','createImageBitmap','URL','URLSearchParams','fetch','AbortSignal','setTimeout','clearTimeout','setInterval','clearInterval','console','Buffer','process']
export default [{
 files:['server/editorial-discovery.js','server/news-ai.js','server/news-generation.js','server/news-card.js','api/editorial-discover.js','api/news-generate.js','api/news-card.js','api/news-automation.js','src/features/editorial-admin.js','src/features/editorial-news.js','src/features/news-cover.js','tests/news-automation.test.js','vite.config.js'],
 languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:Object.fromEntries(names.map(n=>[n,'readonly']))},
 rules:{'no-undef':'error','no-dupe-args':'error','no-dupe-keys':'error','no-unreachable':'error','no-unsafe-finally':'error','valid-typeof':'error','constructor-super':'error','no-this-before-super':'error'}
}]

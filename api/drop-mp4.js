import { createClient } from '@supabase/supabase-js'
import { once } from 'node:events'
import { renderDropVideo } from '../server/drop-video.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, no-transform')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použi POST.' })
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') {
    return res.status(415).json({ error: 'Obnov stránku a spusti nový export videa.' })
  }
  const authorization = String(req.headers.authorization || '')
  const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key || !authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Vyžaduje sa prihlásenie administrátora.' })
  const controller = new AbortController()
  const disconnected = () => { if (!res.writableFinished) controller.abort() }
  res.on('close', disconnected)
  const send = async event => {
    controller.signal.throwIfAborted()
    if (!res.write(JSON.stringify(event) + '\n')) await once(res, 'drain', { signal: controller.signal })
  }
  try {
    const db = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } })
    const { data: user } = await db.auth.getUser()
    const { data: admin } = await db.rpc('is_admin')
    if (!user.user || admin !== true) return res.status(403).json({ error: 'MP4 export je dostupný len pre admina.' })
    let payload = req.body
    if (payload === undefined) {
      let size = 0
      const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16_384) return res.status(413).json({ error: 'Odkaz je príliš dlhý.' })
        chunks.push(chunk)
      }
      payload = Buffer.concat(chunks).toString('utf8')
    }
    if (Buffer.isBuffer(payload)) payload = payload.toString('utf8')
    if (typeof payload === 'string') payload = JSON.parse(payload)
    const { drop, format } = payload || {}
    if (!['story', 'feed', 'square'].includes(format) || typeof drop?.body !== 'string' || !drop.body.trim() || drop.body.length > 1200 || (drop.reply != null && (typeof drop.reply !== 'string' || drop.reply.length > 1200))) {
      return res.status(400).json({ error: 'Neplatný odkaz alebo formát videa.' })
    }
    // Stream progress and encoded chunks; never buffer a full video response.
    // An explicit done event prevents downloads of truncated MP4 files.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.flushHeaders?.()
    await send({ type: 'progress', percent: 0 })
    const result = await renderDropVideo({
      drop: { body: drop.body, reply: drop.reply || '', style: drop.style }, format,
      signal: controller.signal,
      onProgress: percent => send({ type: 'progress', percent }),
      onChunk: chunk => send({ type: 'chunk', data: chunk.toString('base64') }),
    })
    await send({ type: 'done', ...result })
    res.end()
    console.log('[drop-mp4] render completed', result)
  } catch (error) {
    if (controller.signal.aborted) return
    console.error('[drop-mp4] render failed', String(error?.message || error))
    const message = error instanceof SyntaxError ? 'Neplatná požiadavka.' : 'Video sa nepodarilo dokončiť. Skús export znova.'
    if (!res.headersSent) return res.status(422).json({ error: message })
    if (!res.destroyed) { await send({ type: 'error', error: message }).catch(() => {}); res.end() }
  } finally {
    res.off('close', disconnected)
  }
}

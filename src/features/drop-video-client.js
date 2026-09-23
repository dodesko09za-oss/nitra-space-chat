export async function readVideoStream(response, onProgress = () => {}) {
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw Error(detail.error || `Export videa zlyhal (${response.status}).`)
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw Error('Neplatná odpoveď exportu. Obnov stránku a skús znova.')
  const reader = response.body.getReader(), decoder = new TextDecoder(), parts = []
  let pending = '', done = false, bytes = 0
  const event = line => {
    if (!line.trim()) return
    const item = JSON.parse(line)
    if (item.type === 'error') throw Error(item.error)
    if (item.type === 'progress') onProgress(item.percent)
    if (item.type === 'chunk') {
      const binary = atob(item.data), chunk = Uint8Array.from(binary, char => char.charCodeAt(0))
      bytes += chunk.byteLength
      if (bytes > 100 * 1024 * 1024) throw Error('Export prekročil maximálnu veľkosť.')
      parts.push(chunk)
    }
    if (item.type === 'done') {
      if (item.frames !== 900 || item.fps !== 60 || item.width !== 1080 || ![1080, 1350, 1920].includes(item.height)) throw Error('Video nemá požadovanú kvalitu.')
      done = true
    }
  }
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      pending += decoder.decode(chunk.value, { stream: true })
      let newline
      while ((newline = pending.indexOf('\n')) !== -1) {
        event(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
    }
    pending += decoder.decode()
    if (pending.trim()) event(pending)
    if (!done || !bytes) throw Error('Prenos videa sa prerušil. Skús export znova.')
    return new Blob(parts, { type: 'video/mp4' })
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}

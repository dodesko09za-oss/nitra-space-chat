import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import { resolve } from 'node:path'
import { exportLayout, wrapText, renderDropFrame } from '../src/features/drop-renderer.js'

export const DROP_FPS = 60
export const DROP_FRAMES = DROP_FPS * 15
let chromePromise
let fontsReady = false

export async function prepareDropRenderer(drop, format) {
  if (!['story', 'feed', 'square'].includes(format)) throw Error('Neplatný formát videa.')
  if (!fontsReady) {
    const loaded = GlobalFonts.registerFromPath(resolve('public/fonts/Arimo.ttf'), 'Arimo')
    if (!loaded) throw Error('Nepodarilo sa načítať písmo exportu.')
    fontsReady = true
  }
  if (!chromePromise) chromePromise = (async () => {
    const image = await loadImage(resolve('public/chrome-sculpture.png'))
    const chrome = createCanvas(image.width, image.height), ctx = chrome.getContext('2d')
    ctx.filter = 'grayscale(1) brightness(1.85) contrast(1.25)'
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, chrome.width, chrome.height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const light = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])
      pixels.data[i + 3] = Math.round(pixels.data[i + 3] * Math.max(0, Math.min(1, (light - 18) / 46)))
    }
    ctx.putImageData(pixels, 0, 0)
    return chrome
  })().catch(error => { chromePromise = undefined; throw error })
  const chrome = await chromePromise, layout = exportLayout(format)
  const canvas = createCanvas(layout.width, layout.height), ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const prepared = { ...drop, __wrapped: wrapText(ctx, drop.body + (drop.reply ? `\n\n${drop.reply}` : ''), layout.bodyWidth, layout.body, layout.maxBody) }
  return { canvas, layout, render: seconds => renderDropFrame(ctx, chrome, prepared, layout, seconds) }
}

// Render every timeline sample exactly once. Encoding speed never changes time
// or drops a frame. Only one raw frame is held while FFmpeg consumes the pipe.
export async function renderDropVideo({ drop, format, onChunk, onProgress = () => {}, signal }) {
  const { canvas, layout, render } = await prepareDropRenderer(drop, format)
  signal?.throwIfAborted()
  const encoder = spawn(ffmpeg.path, [
    '-hide_banner', '-loglevel', 'error', '-threads', '2',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${layout.width}x${layout.height}`,
    '-framerate', String(DROP_FPS), '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '19',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '4.2',
    '-g', String(DROP_FPS), '-keyint_min', String(DROP_FPS), '-sc_threshold', '0',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = '', inputError
  encoder.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000) })
  encoder.stdin.on('error', error => { inputError = error })
  const finished = new Promise((resolveDone, reject) => {
    encoder.on('error', reject)
    encoder.on('close', code => code === 0 ? resolveDone() : reject(Error(stderr || `Video enkóder skončil chybou ${code}.`)))
  })
  // Attach a handler immediately; a failure may happen while a frame is drawn.
  finished.catch(() => {})
  const abort = () => encoder.kill('SIGKILL')
  signal?.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(abort, 260_000)
  const output = (async () => {
    for await (const chunk of encoder.stdout) await onChunk(chunk)
  })()
  output.catch(abort)
  try {
    for (let frame = 0; frame < DROP_FRAMES; frame++) {
      signal?.throwIfAborted()
      if (inputError) throw inputError
      if (encoder.exitCode !== null || encoder.signalCode) throw Error(stderr || 'Vytváranie videa sa prerušilo.')
      render(frame / DROP_FPS)
      if (!encoder.stdin.write(canvas.data())) await once(encoder.stdin, 'drain', { signal })
      if (frame % 15 === 0) {
        await onProgress(Math.floor(frame / DROP_FRAMES * 99))
        await yieldTurn()
      }
    }
    encoder.stdin.end()
    await Promise.all([finished, output])
    await onProgress(100)
    return { width: layout.width, height: layout.height, frames: DROP_FRAMES, fps: DROP_FPS, duration: 15 }
  } finally {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', abort)
    if (encoder.exitCode === null) abort()
    await Promise.allSettled([finished, output])
  }
}

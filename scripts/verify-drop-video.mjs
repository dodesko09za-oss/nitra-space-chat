import { mkdir, writeFile, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { renderDropVideo, prepareDropRenderer } from '../server/drop-video.js'

const format = process.argv[2] || 'story'
const directory = resolve('outputs/drop-verification')
await mkdir(directory, { recursive: true })
const path = resolve(directory, `${format}.mp4`)
const file = await open(path, 'w')
const started = performance.now()
const drop = { body: 'Hľadám dievča, ktoré som stretol v sobotu pri divadle v Nitre. Usmiala si sa a ja som nestihol povedať ahoj. Ozvi sa, ak sa v tomto odkaze nájdeš.', reply: '', style: 'chrome' }
const still = await prepareDropRenderer(drop, format)
still.render(7.5)
await writeFile(resolve(directory, `${format}.png`), await still.canvas.encode('png'))
if (process.argv.includes('--still')) { await file.close(); process.exit(0) }
let last = -1
try {
  const result = await renderDropVideo({ drop, format,
    onChunk: async chunk => { await file.write(chunk) },
    onProgress: value => { const step = Math.floor(value / 10); if (step !== last) { last = step; console.log(`render ${value}%`) } },
  })
  console.log(JSON.stringify({ ...result, renderSeconds: (performance.now() - started) / 1000, path }))
} finally { await file.close() }
const decoded = spawnSync(ffmpeg.path, ['-hide_banner', '-i', path, '-an', '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 90_000, windowsHide: true })
if (decoded.status !== 0) throw Error(decoded.stderr)
const frames = decoded.stdout.split('\n').filter(line => /^0,/.test(line))
const hashes = frames.map(line => line.split(',').at(-1).trim())
if (frames.length !== 900) throw Error(`Wrong decoded frame count: ${frames.length}`)
const middle = hashes.slice(240, 720)
const unique = new Set(middle).size
if (unique < middle.length * .98) throw Error(`Frozen frames: only ${unique}/${middle.length} unique`)
if (!decoded.stderr.includes('yuv420p')) throw Error('Not mobile-compatible yuv420p')
console.log(JSON.stringify({ decodedFrames: frames.length, uniqueMiddleFrames: unique, checkedMiddleFrames: middle.length, metadata: decoded.stderr }))
const renderer = await prepareDropRenderer(drop, format)
renderer.render(7.5)
await writeFile(resolve(directory, `${format}.png`), await renderer.canvas.encode('png'))

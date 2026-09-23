import test from 'node:test'
import assert from 'node:assert/strict'
import { readVideoStream } from '../src/features/drop-video-client.js'
import { exportLayout } from '../src/features/drop-renderer.js'

const done = { type: 'done', frames: 900, fps: 60, width: 1080, height: 1920 }
function response(events, stride = 11) {
  const data = new TextEncoder().encode(events.map(x => JSON.stringify(x)).join('\n') + '\n')
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < data.length; i += stride) controller.enqueue(data.slice(i, i + stride))
    controller.close()
  } }), { headers: { 'content-type': 'application/x-ndjson' } })
}

test('video download reconstructs binary chunks across arbitrary network boundaries', async () => {
  const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 255, 128, 0])
  const progress = []
  const blob = await readVideoStream(response([
    { type: 'progress', percent: 20 },
    { type: 'chunk', data: bytes.subarray(0, 6).toString('base64') },
    { type: 'progress', percent: 100 },
    { type: 'chunk', data: bytes.subarray(6).toString('base64') }, done,
  ]), value => progress.push(value))
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes)
  assert.equal(blob.type, 'video/mp4')
  assert.deepEqual(progress, [20, 100])
})
test('interrupted video never downloads an incomplete MP4', async () => {
  await assert.rejects(readVideoStream(response([{ type: 'chunk', data: 'AA==' }])), /prerušil/)
})
test('encoder failures reach the UI rather than silently becoming static video', async () => {
  await assert.rejects(readVideoStream(response([{ type: 'error', error: 'Enkóder zlyhal.' }])), /Enkóder zlyhal/)
})
test('low-resolution and missing-frame exports are rejected', async () => {
  for (const bad of [{ ...done, width: 540 }, { ...done, frames: 240 }, { ...done, fps: 30 }]) {
    await assert.rejects(readVideoStream(response([{ type: 'chunk', data: 'AA==' }, bad])), /kvalitu/)
  }
})
test('auth failures remain errors rather than downloadable files', async () => {
  await assert.rejects(readVideoStream(new Response(JSON.stringify({ error: 'Len pre admina.' }), { status: 403 })), /admina/)
})
test('all three formats retain their full export resolution', () => {
  for (const [format, height] of [['story', 1920], ['feed', 1350], ['square', 1080]]) {
    const layout = exportLayout(format)
    assert.equal(layout.width, 1080)
    assert.equal(layout.height, height)
  }
})

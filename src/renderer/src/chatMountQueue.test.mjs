import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatMountQueue } from './chatMountQueue.ts'

const setup = () => {
  const frames = new Set()
  const enqueue = createChatMountQueue((run) => {
    frames.add(run)
    return () => frames.delete(run)
  })
  const paint = () => {
    assert.equal(frames.size, 1)
    const run = [...frames][0]
    frames.delete(run)
    run()
  }
  return { frames, enqueue, paint }
}

test('history mounts newest first, one committed turn per paint opportunity', () => {
  const { frames, enqueue, paint } = setup()
  const mounted = []
  let complete
  for (let index = 0; index < 10; index++) {
    enqueue((done) => {
      mounted.push(index)
      complete = done
    }, index)
  }
  paint()
  assert.deepEqual(mounted, [9])
  assert.equal(frames.size, 0, 'wait for the current React commit before scheduling more work')
  complete()
  complete()
  assert.equal(frames.size, 1, 'completion is idempotent')
  paint()
  assert.deepEqual(mounted, [9, 8])
})

test('switching chats cancels queued and active mounts without blocking the next chat', () => {
  const { frames, enqueue, paint } = setup()
  let oldComplete
  const cancelOld = enqueue((done) => {
    oldComplete = done
  }, 10)
  const cancelQueued = enqueue(() => assert.fail('old queued turn must not mount'), 1)
  paint()
  cancelOld()
  cancelQueued()
  assert.equal(frames.size, 0)
  let mounted = false
  enqueue((done) => {
    mounted = true
    done()
  }, 0)
  oldComplete()
  paint()
  assert.equal(mounted, true)
  assert.equal(frames.size, 0)
})

test('cancelling the final queued mount cancels the pending frame', () => {
  const { frames, enqueue } = setup()
  const cancel = enqueue(() => assert.fail('cancelled turn'), 0)
  cancel()
  cancel()
  assert.equal(frames.size, 0)
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadRolloutHistory } from './CodexRolloutHistory.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const record = (payload, type = 'event_msg') => JSON.stringify({ type, payload })

test('loads retained turns across a normal resume rollout chain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-rollout-chain-'))
  const previousDirectory = join(directory, 'sessions', '2026', '08', '30')
  const currentDirectory = join(directory, 'sessions', '2026', '08', '31')
  const previousSegmentId = '01a0548b-d405-7fe0-9c62-5a7ce0925e1c'
  const currentSegmentId = '01a05897-bf57-7f53-a7a5-70c4cd982f85'
  const previousPath = join(
    previousDirectory,
    `rollout-2026-08-30T23-20-45-root_${previousSegmentId}.jsonl`
  )
  const currentPath = join(
    currentDirectory,
    `rollout-2026-08-31T18-12-15-root_${currentSegmentId}.jsonl`
  )

  try {
    await mkdir(previousDirectory, { recursive: true })
    await mkdir(currentDirectory, { recursive: true })

    const retainedRecords = [
      record({ id: 'root' }, 'session_meta'),
      record({ type: 'task_started', turn_id: 'retained-turn' }),
      record({
        type: 'user_message',
        turn_id: 'retained-turn',
        id: 'retained-user',
        message: 'Keep this'
      }),
      record({
        type: 'agent_message',
        turn_id: 'retained-turn',
        id: 'retained-answer',
        phase: 'final_answer',
        message: 'Kept'
      })
    ]
    const retainedPrefix = `${retainedRecords.join('\n')}\n`
    const discardedTail = [
      record({ type: 'task_started', turn_id: 'discarded-turn' }),
      record({
        type: 'user_message',
        turn_id: 'discarded-turn',
        id: 'discarded-user',
        message: 'Do not resurrect this'
      })
    ]
    await writeFile(previousPath, `${retainedPrefix}${discardedTail.join('\n')}\n`)

    await writeFile(
      currentPath,
      [
        record(
          {
            id: 'root',
            history_base: {
              thread_id: previousSegmentId,
              end_ordinal_exclusive: retainedRecords.length,
              end_byte_offset: Buffer.byteLength(retainedPrefix)
            }
          },
          'session_meta'
        ),
        record({ type: 'task_started', turn_id: 'current-turn' }),
        record(
          {
            type: 'message',
            role: 'user',
            id: 'current-user',
            content: [{ type: 'input_text', text: 'Normal send' }]
          },
          'response_item'
        ),
        record(
          {
            type: 'message',
            role: 'assistant',
            id: 'current-answer',
            content: [{ type: 'output_text', text: 'Still here' }]
          },
          'response_item'
        )
      ].join('\n') + '\n'
    )

    const turns = await loadRolloutHistory(currentPath)

    assert.deepEqual(
      turns.map((turn) => turn.id),
      ['retained-turn', 'current-turn']
    )
    assert.deepEqual(
      turns[1].items.map((item) => item.type),
      ['userMessage', 'agentMessage']
    )
    assert.equal(
      turns.some((turn) => turn.id === 'discarded-turn'),
      false
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

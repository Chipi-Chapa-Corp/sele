import assert from 'node:assert/strict'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadRolloutContextUsage,
  loadRolloutCwd,
  loadRolloutHistory
} from './CodexRolloutHistory.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const record = (payload, type = 'event_msg') => JSON.stringify({ type, payload })

test('streams rollout history, indexes tool outputs, and invalidates appended snapshots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-rollout-'))
  const path = join(directory, 'rollout.jsonl')

  try {
    await writeFile(
      path,
      [
        record({ type: 'session_meta', cwd: '/workspace' }),
        record({ type: 'task_started', turn_id: 'turn-1' }),
        record({ type: 'user_message', turn_id: 'turn-1', id: 'user-1', message: 'Run it' }),
        record({
          type: 'function_call',
          turn_id: 'turn-1',
          id: 'tool-1',
          call_id: 'call-1',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}'
        }),
        record({
          type: 'function_call_output',
          turn_id: 'turn-1',
          call_id: 'call-1',
          output: 'done'
        }),
        record({
          type: 'agent_message',
          turn_id: 'turn-1',
          id: 'answer-1',
          phase: 'final_answer',
          message: 'Finished'
        })
      ].join('\n') + '\n'
    )

    const turns = await loadRolloutHistory(path)
    assert.equal(turns.length, 1)
    assert.equal(turns[0].id, 'turn-1')
    assert.equal(
      turns[0].items.find((item) => item.id.startsWith('tool-1'))?.customToolOutput,
      'done'
    )
    assert.equal(await loadRolloutCwd(path), '/workspace')
    assert.equal(await loadRolloutContextUsage(path), null)

    await appendFile(
      path,
      record({
        type: 'token_count',
        info: {
          total_token_usage: {
            total_tokens: 100,
            input_tokens: 70,
            cached_input_tokens: 10,
            output_tokens: 20,
            reasoning_output_tokens: 0
          },
          last_token_usage: {
            total_tokens: 30,
            input_tokens: 20,
            cached_input_tokens: 5,
            output_tokens: 5,
            reasoning_output_tokens: 0
          },
          model_context_window: 200
        }
      }) + '\n'
    )

    const usage = await loadRolloutContextUsage(path)
    assert.equal(usage?.usedTokens, 20)
    assert.equal(usage?.maxTokens, 200)
    assert.equal(usage?.total.totalTokens, 100)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { renderCopilotChatItems } from './CopilotItemRenderers.ts'
import {
  createCopilotSubagentTranscriptItems,
  renderCopilotSubagentWindow
} from './CopilotSubagents.ts'

const summary = { id: 'child', title: 'Agent', description: 'Inspect the app', status: 'completed' }
const user = (id) => ({ id, agentId: 'child', type: 'user.message', data: { content: id } })
const answer = (id) => ({
  id,
  agentId: 'child',
  type: 'assistant.message',
  data: { content: id, messageId: id }
})

test('subagent turn windows match full history without copying instructions onto old pages', () => {
  for (const events of [
    [],
    [answer('orphan')],
    [answer('orphan'), user('follow-up'), answer('answer')],
    Array.from({ length: 25 }, (_, index) => [user(`u${index}`), answer(`a${index}`)]).flat()
  ]) {
    const full = createCopilotSubagentTranscriptItems(
      summary,
      renderCopilotChatItems(events, { agentId: 'child', active: false, stopped: false })
    )
    const count = getProviderChatTurnCount(full)
    for (const requested of [null, 0, 1, 10, 50]) {
      const start = requested === null ? Math.max(0, count - 10) : Math.min(requested, count)
      const page = renderCopilotSubagentWindow(summary, events, {
        startIndex: requested,
        limit: 10
      })
      assert.equal(page.turnCount, count)
      assert.equal(page.itemsStartTurnIndex, start)
      assert.deepEqual(page.items, sliceProviderChatTurns(full, start, start + 10))
    }
  }
})

test('subagent paging converts only the selected assistant payloads', () => {
  let payloadVisits = 0
  const events = Array.from({ length: 2_000 }, (_, index) => [
    user(`u${index}`),
    {
      ...answer(`a${index}`),
      data: {
        messageId: `a${index}`,
        get content() {
          payloadVisits++
          return 'Answer'
        }
      }
    }
  ]).flat()
  events.push({
    ...answer('unrelated'),
    agentId: 'other',
    data: {
      get content() {
        return assert.fail('unrelated agent payload must not be converted')
      }
    }
  })
  for (const startIndex of [null, 20]) {
    payloadVisits = 0
    const page = renderCopilotSubagentWindow(summary, events, { startIndex, limit: 10 })
    assert.equal(page.turnCount, 2_000)
    assert.equal(getProviderChatTurnCount(page.items), 10)
    assert.ok(payloadVisits <= 100, `${payloadVisits} assistant payload reads`)
  }
})

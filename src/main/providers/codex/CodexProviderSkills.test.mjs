import assert from 'node:assert/strict'
import { test } from 'node:test'
import { writeCodexSkillEnabled } from './CodexSkillConfig.ts'

const path = '/tmp/sele-codex-provider-skills/review-agent/SKILL.md'

test('uses Codex skill config with only a path selector when disabling a skill', async () => {
  const requests = []
  const client = {
    async request(method, params) {
      requests.push([method, params])
      return { effectiveEnabled: false }
    }
  }

  await writeCodexSkillEnabled(client, path, false)

  assert.deepEqual(requests, [['skills/config/write', { enabled: false, path }]])
})

test('rejects a Codex skill update when the effective state does not change', async () => {
  const client = {
    async request() {
      return { effectiveEnabled: true }
    }
  }

  await assert.rejects(
    writeCodexSkillEnabled(client, path, false),
    /Codex did not disable the skill/
  )
})

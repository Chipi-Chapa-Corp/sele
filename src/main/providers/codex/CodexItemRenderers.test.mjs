import { getToolDisplayLabel } from '../../../renderer/src/toolDisplayLabel.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel } from '../../../renderer/src/chatConversationModel.ts'
import {
  getWorkingStepDefaultOpen,
  getWorkingStepProgressPolicy
} from '../../../renderer/src/workingStepDisclosure.ts'
import { CodexTranscriptProjection, getChatItems } from './CodexItemRenderers.ts'
import { updateIndexedTranscriptRecord } from '../transcriptProjection/recordChanges.ts'

const imageSizingMetadata =
  '[Image: original 2380x292, displayed at 2000x245. Multiply coordinates by 1.19 to map to original image.]'

test('Codex app reads, searches, and lists render without raw payloads in every call format', () => {
  const cases = [
    ['github.fetch_file', 'Read file from GitHub', 'read'],
    ['github.fetch_pull_request', 'Read pull request from GitHub', 'read'],
    ['github.search_code', 'Searched GitHub', 'search'],
    ['github.list_repositories', 'Listed repositories in GitHub', 'search'],
    ['gdrive.fetch', 'Read file from Google Drive', 'read'],
    ['google_drive.search', 'Searched Google Drive', 'search'],
    ['slack.fetch', 'Read message from Slack', 'read'],
    ['gmail.get_thread', 'Read thread from Gmail', 'read'],
    ['notion.fetch_page', 'Read page from Notion', 'read'],
    ['linear.get_issue', 'Read issue from Linear', 'read'],
    ['dropbox.fetch_file', 'Read file from Dropbox', 'read'],
    ['box.search', 'Searched Box', 'search'],
    ['sharepoint.list_files', 'Listed files in SharePoint', 'search'],
    ['outlook_email.fetch', 'Read email from Outlook Email', 'read'],
    ['outlook_calendar.list_events', 'Listed events in Outlook Calendar', 'search'],
    ['google_calendar.get_event', 'Read event from Google Calendar', 'read'],
    ['teams.get_message', 'Read message from Teams', 'read']
  ]
  for (const [name, label, activity] of cases) {
    const [app, operation] = name.split('.')
    const flattened = `mcp__codex_apps__${app}_${operation}`
    for (const status of ['inProgress', 'completed']) {
      for (const call of [
        { type: 'mcpToolCall', server: 'codex_apps', tool: name },
        { type: 'dynamicToolCall', namespace: 'codex_apps', tool: name },
        { type: 'mcpToolCall', server: app, tool: operation },
        { type: 'customToolCall', customToolName: `codex_apps/${name}` },
        { type: 'customToolCall', customToolName: `mcp__${app}__${operation}` },
        { type: 'customToolCall', customToolName: flattened },
        { type: 'commandExecution', command: `await tools.${flattened}({})` }
      ]) {
        const turn = {
          id: 'apps',
          status,
          items: [
            {
              id: 'call',
              status,
              arguments: { path: 'private-input' },
              customToolInput: '{}',
              result: { structuredContent: 'private-output' },
              aggregatedOutput: 'private-output',
              customToolOutput: 'private-output',
              ...call
            }
          ]
        }
        const items = getChatItems([turn])
        assert.deepEqual(items, getChatItems([turn], null, {}, new CodexTranscriptProjection()))
        const tool = items.find((item) => item.type === 'working')?.items[0]
        assert.equal(tool?.label, label, JSON.stringify(call))
        assert.equal(tool.activity, activity)
        assert.equal(tool.status, status === 'inProgress' ? 'running' : 'finished')
        for (const key of ['command', 'stdout', 'rawInput', 'rawOutput'])
          assert.equal(tool[key], null)
        assert.equal(JSON.stringify(items).includes('private-'), false)
        assert.equal(getToolDisplayLabel(label, activity, false), label)
        if (activity === 'read') {
          assert.equal(
            getToolDisplayLabel(label, activity, true),
            label.replace(/^Read/, 'Reading')
          )
        }
      }
    }
  }
})

test('app file reads group with local reads and unknown app tools remain inspectable', () => {
  const items = getChatItems([
    {
      id: 'apps',
      status: 'completed',
      items: [
        { id: 'local', type: 'commandExecution', command: 'cat themes.ts', status: 'completed' },
        {
          id: 'github',
          type: 'mcpToolCall',
          server: 'codex_apps',
          tool: 'github.fetch_file',
          arguments: { path: 'src/styles/popup/base.css' },
          status: 'completed'
        },
        {
          id: 'unknown-operation',
          type: 'mcpToolCall',
          server: 'codex_apps',
          tool: 'github.frobnicate_widget',
          arguments: { inspect: true },
          result: 'inspect result',
          status: 'completed'
        },
        {
          id: 'unknown-app',
          type: 'mcpToolCall',
          server: 'codex_apps',
          tool: 'custom.frobnicate_widget',
          arguments: { path: 'custom' },
          result: 'custom result',
          status: 'completed'
        },
        {
          id: 'unknown-server',
          type: 'mcpToolCall',
          server: 'custom',
          tool: 'github.fetch_file',
          arguments: { path: 'custom' },
          result: 'custom result',
          status: 'completed'
        }
      ]
    }
  ])
  const group = items.find((item) => item.type === 'working').items[0]
  assert.equal(group.type, 'toolGroup')
  assert.equal(group.tools[0].activity, 'read')
  assert.equal(group.tools[1].activity, 'read')
  assert.equal(group.tools[1].label, 'Read file from GitHub')
  for (const tool of group.tools.slice(2)) {
    assert.equal(tool.activity, 'other')
    assert.ok(tool.rawInput)
    assert.ok(tool.rawOutput)
  }
})

test('app action families cover GitHub writes and enabled Pets and plugin tools', () => {
  const cases = [
    ['github.create_issue', 'Created issue in GitHub', 'Creating issue in GitHub'],
    ['github.update_issue', 'Updated issue in GitHub', 'Updating issue in GitHub'],
    ['github.add_issue_comment', 'Added issue comment in GitHub', 'Adding issue comment in GitHub'],
    [
      'github.create_pull_request',
      'Created pull request in GitHub',
      'Creating pull request in GitHub'
    ],
    [
      'github.merge_pull_request',
      'Merged pull request in GitHub',
      'Merging pull request in GitHub'
    ],
    ['github.create_or_update_file', 'Saved file in GitHub', 'Saving file in GitHub'],
    ['github.delete_file', 'Deleted file from GitHub', 'Deleting file from GitHub'],
    ['github.push_files', 'Pushed files to GitHub', 'Pushing files to GitHub'],
    ['github.fork_repository', 'Forked repository in GitHub', 'Forking repository in GitHub'],
    ['github.download_file', 'Downloaded file from GitHub', 'Downloading file from GitHub'],
    ['slack.send_message', 'Sent message via Slack', 'Sending message via Slack'],
    ['gmail.reply_email', 'Replied to email in Gmail', 'Replying to email in Gmail'],
    ['gdrive.upload_file', 'Uploaded file to Google Drive', 'Uploading file to Google Drive'],
    ['notion.archive_page', 'Archived page in Notion', 'Archiving page in Notion'],
    ['linear.assign_issue', 'Assigned issue in Linear', 'Assigning issue in Linear'],
    ['pets.adopt', 'Adopted pet in ChatGPT Pets', 'Adopting pet in ChatGPT Pets'],
    ['pets.create_pet', 'Created pet in ChatGPT Pets', 'Creating pet in ChatGPT Pets'],
    ['pets.update_pet', 'Updated pet in ChatGPT Pets', 'Updating pet in ChatGPT Pets'],
    ['pets.delete_pet', 'Deleted pet from ChatGPT Pets', 'Deleting pet from ChatGPT Pets'],
    ['pets.select_pet', 'Selected pet in ChatGPT Pets', 'Selecting pet in ChatGPT Pets'],
    ['pets.share_pet', 'Shared pet in ChatGPT Pets', 'Sharing pet in ChatGPT Pets'],
    ['pets.unshare_pet', 'Unshared pet in ChatGPT Pets', 'Unsharing pet in ChatGPT Pets'],
    [
      'pets.prepare_pet_upload',
      'Prepared pet upload in ChatGPT Pets',
      'Preparing pet upload in ChatGPT Pets'
    ],
    [
      'pets.validate_pet_spritesheet',
      'Validated pet sprite sheet in ChatGPT Pets',
      'Validating pet sprite sheet in ChatGPT Pets'
    ],
    [
      'plugin_management.suggest_plugins',
      'Suggested plugins in Plugin Management',
      'Suggesting plugins in Plugin Management'
    ],
    [
      'plugin_management.uninstall_app',
      'Uninstalled app from Plugin Management',
      'Uninstalling app from Plugin Management'
    ],
    [
      'plugin_management.update_app_permissions',
      'Updated app permissions in Plugin Management',
      'Updating app permissions in Plugin Management'
    ]
  ]
  for (const [name, label, active] of cases) {
    const flattened = `mcp__codex_apps__${name.replace('.', '_')}`
    for (const status of ['inProgress', 'completed']) {
      for (const call of [
        { type: 'mcpToolCall', server: 'codex_apps', tool: name },
        { type: 'dynamicToolCall', namespace: 'codex_apps', tool: name },
        { type: 'customToolCall', customToolName: flattened },
        { type: 'commandExecution', command: `await tools.${flattened}({})` }
      ]) {
        const items = getChatItems([
          {
            id: 'apps',
            status,
            items: [
              {
                id: 'call',
                status,
                arguments: { private: 'private-input' },
                customToolInput: '{}',
                result: { private: 'private-output' },
                customToolOutput: 'private-output',
                aggregatedOutput: 'private-output',
                ...call
              }
            ]
          }
        ])
        const tool = items.find((item) => item.type === 'working').items[0]
        assert.equal(tool.label, label)
        assert.equal(
          tool.activity,
          'other',
          'remote mutations must not be grouped as local file edits'
        )
        assert.equal(tool.icon, 'app')
        assert.equal(tool.compact, true)
        assert.equal(
          getToolDisplayLabel(tool.label, tool.activity, status === 'inProgress'),
          status === 'inProgress' ? active : label
        )
        assert.equal(JSON.stringify(items).includes('private-'), false)
      }
    }
  }
})

test('new apps and new resources get readable labels without reinterpreting unrelated MCP servers', () => {
  for (const [name, label, activity] of [
    ['new_app.fetch_widget', 'Read widget from New App', 'read'],
    ['new_app.list_widgets', 'Listed widgets in New App', 'search'],
    ['new_app.create_widget', 'Created widget in New App', 'other'],
    ['github.fetch_pr_patch', 'Read pull request patch from GitHub', 'read'],
    ['github.get_or_create_branch', 'Opened branch in GitHub', 'other'],
    ['pets.get_pet_download_link', 'Read pet download link from ChatGPT Pets', 'read'],
    ['pets.list_pets', 'Listed pets in ChatGPT Pets', 'search'],
    [
      'plugin_management.get_app_permissions',
      'Read app permissions from Plugin Management',
      'read'
    ],
    [
      'plugin_management.get_plugin_dependencies',
      'Read plugin dependencies from Plugin Management',
      'read'
    ],
    ['plugin_management.search_plugins', 'Searched Plugin Management', 'search']
  ]) {
    for (const call of [
      { type: 'mcpToolCall', server: 'codex_apps', tool: name },
      { type: 'customToolCall', customToolName: `mcp__codex_apps__${name.replace('.', '_')}` },
      { type: 'customToolCall', customToolName: `mcp__codex_apps__${name.replace('.', '__')}` }
    ]) {
      const tool = getChatItems([
        {
          id: 'turn',
          status: 'completed',
          items: [{ id: 'call', arguments: {}, result: 'private-output', ...call }]
        }
      ]).find((item) => item.type === 'working').items[0]
      assert.equal(tool.label, label)
      assert.equal(tool.activity, activity)
      assert.equal(tool.rawOutput, null)
    }
  }
})

test('web and developer documentation tools render concrete compact actions', () => {
  const cases = [
    [
      'codex_apps',
      'search_service.web_run',
      { search_query: [{ q: 'example' }] },
      'Searched the web',
      'browser'
    ],
    [
      'codex_apps',
      'search_service.web_run',
      { open: [{ ref_id: 'https://example.com' }] },
      'Read webpages',
      'browser'
    ],
    [
      'codex_apps',
      'search_service.web_run',
      { weather: [{ location: 'London' }] },
      'Checked weather',
      'browser'
    ],
    ['web', 'run', { image_query: [{ q: 'example' }] }, 'Searched web images', 'browser'],
    ['openaiDeveloperDocs', 'search_openai_docs', {}, 'Searched OpenAI docs', 'openai-docs'],
    ['openaiDeveloperDocs', 'fetch_openai_doc', {}, 'Read OpenAI docs', 'openai-docs'],
    ['openaiDeveloperDocs', 'list_openai_docs', {}, 'Listed OpenAI docs', 'openai-docs'],
    ['openaiDeveloperDocs', 'get_openapi_spec', {}, 'Read OpenAI API specification', 'openai-docs'],
    ['openaiDeveloperDocs', 'list_api_endpoints', {}, 'Listed OpenAI API endpoints', 'openai-docs']
  ]
  for (const [server, name, args, label, icon] of cases) {
    const flattened = `mcp__${server}__${name.replace('.', '_')}`
    for (const call of [
      { type: 'mcpToolCall', server, tool: name },
      { type: 'customToolCall', customToolName: flattened, customToolInput: JSON.stringify(args) },
      { type: 'commandExecution', command: `await tools.${flattened}(${JSON.stringify(args)})` }
    ]) {
      const tool = getChatItems([
        {
          id: 'turn',
          status: 'completed',
          items: [
            {
              id: 'call',
              arguments: args,
              result: 'private-output',
              ...call
            }
          ]
        }
      ]).find((item) => item.type === 'working').items[0]
      assert.equal(tool.label, label)
      assert.equal(tool.icon, icon)
      assert.equal(tool.compact, true)
      assert.equal(tool.rawInput, null)
      assert.equal(tool.rawOutput, null)
    }
  }
})

test('structured async questions render only as a question tool in live and completed history', () => {
  for (const status of ['inProgress', 'completed']) {
    for (const phase of [null, 'commentary', 'final_answer']) {
      const turn = {
        id: 'turn',
        status,
        items: [
          {
            id: 'question',
            type: 'agentMessage',
            phase,
            status: 'completed',
            text: 'Which saved integration?\n- Integration #1\n- Integration #3',
            questions: [
              { title: 'Which saved integration?', options: ['Integration #1', 'Integration #3'] }
            ]
          }
        ]
      }
      const items = getChatItems([turn])
      assert.deepEqual(items, getChatItems([turn], null, {}, new CodexTranscriptProjection()))
      const tool = items.find((item) => item.type === 'working')?.items[0]
      assert.equal(tool?.type, 'tool')
      assert.equal(tool.icon, 'question')
      assert.equal(tool.label, 'Asked a question')
      for (const key of ['command', 'stdout', 'rawInput', 'rawOutput'])
        assert.equal(tool[key], null)
      assert.equal(JSON.stringify(items).includes('Which saved integration?'), false)
      assert.equal(
        items.some((item) => item.type === 'message' && item.role === 'assistant'),
        false
      )
      assert.equal(turn.items[0].questions[0].title, 'Which saved integration?')
    }
  }
})

test('late question metadata replaces provisional text without hiding an earlier final answer', () => {
  for (const status of ['inProgress', 'completed']) {
    const projection = new CodexTranscriptProjection()
    let turn = {
      id: 'turn',
      status,
      items: [
        { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Real answer' },
        {
          type: 'agentMessage',
          id: 'question',
          phase: 'final_answer',
          text: 'Private question',
          questions: null
        }
      ]
    }
    getChatItems([turn], null, {}, projection)
    turn = {
      ...turn,
      items: updateIndexedTranscriptRecord(turn.items, 'question', (item) => ({
        ...item,
        questions: [{ title: 'Private question', options: null }]
      }))
    }
    const items = getChatItems([turn], null, {}, projection)
    assert.deepEqual(items, getChatItems([turn]))
    assert.equal(JSON.stringify(items).includes('Private question'), false)
    assert.equal(JSON.stringify(items).includes('Real answer'), true)
    assert.equal(JSON.stringify(items).includes('Asked a question'), true)
  }
})

test('blocking and async question tool calls hide payloads and keep lifecycle labels', () => {
  for (const name of ['request_user_input', 'request_user_input_async']) {
    for (const type of ['customToolCall', 'dynamicToolCall', 'mcpToolCall', 'nested']) {
      for (const status of ['running', 'completed']) {
        const payload = '{"questions":[{"title":"Private question"}]}'
        const call = {
          id: 'question',
          status,
          type,
          customToolName: type === 'customToolCall' ? name : undefined,
          tool: type === 'dynamicToolCall' || type === 'mcpToolCall' ? name : undefined,
          customToolInput: payload,
          arguments: JSON.parse(payload),
          customToolOutput: 'Private answer',
          result: 'Private answer',
          ...(type === 'nested'
            ? { type: 'commandExecution', command: `tools.${name}(${payload})` }
            : {})
        }
        const items = getChatItems([
          { id: 'turn', status: status === 'running' ? 'inProgress' : 'completed', items: [call] }
        ])
        const tool = items.find((item) => item.type === 'working')?.items[0]
        assert.equal(tool?.icon, 'question')
        assert.equal(tool.label, status === 'running' ? 'Asking question' : 'Asked a question')
        assert.equal(JSON.stringify(items).includes('Private'), false)
      }
    }
  }
})

test('image sizing metadata keeps one working segment in full and incremental history', () => {
  for (const status of ['inProgress', 'completed']) {
    const projection = new CodexTranscriptProjection()
    let turn = {
      id: 'image-turn',
      status,
      items: [
        { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Inspect it' }] },
        { type: 'agentMessage', id: 'before', text: 'Before screenshot', phase: 'commentary' }
      ]
    }
    getChatItems([turn], null, {}, projection)
    for (const item of [
      {
        type: 'userMessage',
        id: 'metadata',
        content: [{ type: 'text', text: imageSizingMetadata }]
      },
      { type: 'agentMessage', id: 'after', text: 'After screenshot', phase: 'commentary' }
    ]) {
      turn = { ...turn, items: [...turn.items, item] }
      const items = getChatItems([turn], null, {}, projection)
      assert.deepEqual(items, getChatItems([turn]))
      assert.equal(items.filter((entry) => entry.type === 'message').length, 1)
      const working = items.filter((entry) => entry.type === 'working')
      assert.equal(working.length, 1)
      assert.equal(working[0].status, status === 'inProgress' ? 'working' : 'worked')
      assert.equal(working[0].items.length, item.id === 'after' ? 2 : 1)
    }
  }
})

test('preserves user text discussing image metadata and messages with actual attachments', () => {
  for (const content of [
    [{ type: 'text', text: `What does this mean? ${imageSizingMetadata}` }],
    [
      { type: 'text', text: imageSizingMetadata },
      { type: 'localImage', path: '/tmp/screenshot.png' }
    ]
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [{ type: 'userMessage', id: 'message', content }]
      }
    ])
    assert.equal(items[0]?.role, 'user')
    assert.equal(items[0]?.content, content[0].text)
  }
})

test('tool output preserves non-JSON text without warning and unwraps JSON envelopes', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const mixedOutput = '{\n  "value": true\n}\nCommand completed'
  for (const [output, expected] of [
    [mixedOutput, mixedOutput],
    ['[info] Command completed', '[info] Command completed'],
    ['{"incomplete":', '{"incomplete":'],
    ['{"value":true}\n{"value":false}', '{"value":true}\n{"value":false}'],
    ['{"value":true}', '{"value":true}'],
    [JSON.stringify({ output: mixedOutput }), mixedOutput],
    [
      JSON.stringify({ result: { content: [{ text: JSON.stringify({ stdout: 'done' }) }] } }),
      'done'
    ]
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [
          {
            id: 'tool',
            type: 'customToolCall',
            customToolName: 'apply_patch',
            customToolOutput: output,
            status: 'completed'
          }
        ]
      }
    ])
    assert.equal(items.find((item) => item.type === 'working')?.items[0]?.stdout, expected)
  }
  assert.equal(warn.mock.callCount(), 0)
})

test('renders read images with nonstandard filename extensions as previews', () => {
  const path = '/tmp/makehuman/hair/long01.thumb'
  const items = getChatItems([
    {
      id: 'turn',
      status: 'completed',
      items: [{ type: 'imageView', id: 'image', path, status: 'completed' }]
    }
  ])
  const tool = items.find((item) => item.type === 'working')?.items[0]

  assert.equal(tool?.label, 'Read image')
  assert.deepEqual(tool?.images, [{ path, name: 'long01.thumb' }])
  assert.equal(tool?.rawOutput, null)
})

test('group headings describe image viewing instead of generic tool use', async () => {
  const { getToolSequenceDisplayLabel } = await import('../../../renderer/src/toolDisplayLabel.ts')
  const items = getChatItems([
    {
      id: 'image-group',
      status: 'completed',
      items: [
        { type: 'commandExecution', id: 'read', command: 'cat base.css', status: 'completed' },
        { type: 'imageView', id: 'image-1', path: '/tmp/one.png', status: 'completed' },
        {
          type: 'customToolCall',
          id: 'image-2',
          customToolName: 'view_image',
          customToolInput: JSON.stringify({ path: '/tmp/two.png' }),
          status: 'completed'
        }
      ]
    }
  ])
  const group = items.find((item) => item.type === 'working')?.items[0]
  assert.equal(group.type, 'toolGroup')
  assert.deepEqual(group.toolActivities, ['read', 'image-view'])
  assert.equal(group.dominantActivity, 'image-view')
  assert.equal(getToolSequenceDisplayLabel(group.toolActivities, false), 'Read files, read images')
  assert.equal(
    getToolSequenceDisplayLabel(group.toolActivities, true),
    'Reading files, Reading images'
  )
  assert.equal(
    getToolSequenceDisplayLabel(['image-view', 'other'], false),
    'Read images, used tools'
  )
})

// Test fixtures intentionally omit production-only Codex fields.
const renderFailedWorkingStep = (codexErrorInfo) => {
  const items = getChatItems([
    {
      id: `turn-${codexErrorInfo}`,
      status: 'failed',
      error: {
        message: 'Provider request failed',
        additionalDetails: null,
        codexErrorInfo
      },
      items: [
        {
          type: 'userMessage',
          id: 'user-message',
          content: [{ type: 'text', text: 'Try this' }]
        }
      ]
    }
  ])

  return items.find((item) => item.type === 'working')
}

test('marks Codex usage and rate-limit failures as resettable rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('usageLimitExceeded')?.failureReason, 'rateLimit')
  assert.equal(renderFailedWorkingStep('rateLimitExceeded')?.failureReason, 'rateLimit')
})

test('keeps Codex failure details on the failed step', () => {
  const failedStep = renderFailedWorkingStep('serverOverloaded')
  assert.equal(failedStep?.failureMessage, 'Provider request failed')
  assert.deepEqual(failedStep.items, [])
  assert.equal(failedStep.itemCount, 0)
  const step = getChatItems([{ id: 'failed', status: 'failed', items: [] }]).find(
    (item) => item.type === 'working'
  )
  assert.equal(step?.status, 'failed')
  assert.equal(step?.failureMessage, undefined)
})

test('renders one timeline anchor when Codex repeats a subagent completion event', () => {
  const items = getChatItems([
    {
      id: 'parent-turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Delegate' }] },
        {
          type: 'subAgentActivity',
          id: 'completed-one',
          kind: 'completed',
          agentThreadId: 'child-thread'
        },
        {
          type: 'subAgentActivity',
          id: 'completed-two',
          kind: 'completed',
          agentThreadId: 'child-thread'
        }
      ]
    }
  ])
  const anchors = items.filter((item) => item.type === 'timelineAnchor')

  assert.deepEqual(anchors, [
    { type: 'timelineAnchor', id: 'parent-turn:subagent-completed:child-thread' }
  ])
})

test('incremental projection does not reinsert a repeated subagent completion anchor', async () => {
  const { CodexTranscriptProjection } = await import('./CodexItemRenderers.ts')
  const projection = new CodexTranscriptProjection()
  const turn = {
    id: 'parent-turn',
    status: 'inProgress',
    items: [
      { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Delegate' }] },
      {
        type: 'subAgentActivity',
        id: 'completed-one',
        kind: 'completed',
        agentThreadId: 'child-thread'
      },
      { type: 'reasoning', id: 'working', summary: ['Continuing'] }
    ]
  }

  getChatItems([turn], null, {}, projection)
  turn.items.push({
    type: 'subAgentActivity',
    id: 'completed-two',
    kind: 'completed',
    agentThreadId: 'child-thread'
  })
  const items = getChatItems([turn], null, {}, projection)

  assert.equal(items.filter((item) => item.type === 'timelineAnchor').length, 1)
})

test('keeps the failed turn user message available for retry after a limit reset', () => {
  const userMessage = {
    type: 'message',
    id: 'user-message',
    editTargetId: 'turn-id',
    role: 'user',
    content: 'Try this'
  }
  const rateLimitedStep = {
    type: 'working',
    id: 'working-step',
    status: 'failed',
    failureReason: 'rateLimit',
    items: []
  }
  const model = buildChatConversationModel([userMessage, rateLimitedStep])

  assert.equal(model.stoppedTurnRetryMessages.get(rateLimitedStep.id), userMessage)
})

test('does not mark unrelated Codex failures as rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('serverOverloaded')?.failureReason, undefined)
})

test('does not render an orphan stopped marker for an interrupted turn with no items', () => {
  assert.deepEqual(
    getChatItems([
      {
        id: 'orphan-interrupted-turn',
        status: 'interrupted',
        items: []
      }
    ]),
    []
  )
})

test('renders a stopped marker after the submitted user message', () => {
  const items = getChatItems([
    {
      id: 'interrupted-turn',
      status: 'interrupted',
      items: [
        {
          type: 'userMessage',
          id: 'submitted-message',
          content: [{ type: 'text', text: 'Keep this message' }]
        }
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => (item.type === 'message' ? `${item.role}:${item.content}` : item.status)),
    ['user:Keep this message', 'stopped']
  )
})

test('marks an inline follow-up as a steering message', () => {
  const items = getChatItems([
    {
      id: 'steered-turn',
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          id: 'initial-message',
          content: [{ type: 'text', text: 'Start here' }]
        },
        {
          type: 'userMessage',
          id: 'steering-message',
          content: [{ type: 'text', text: 'Change direction' }]
        }
      ]
    }
  ])
  const steeringMessage = items.find(
    (item) => item.type === 'message' && item.content === 'Change direction'
  )

  assert.equal(steeringMessage?.kind, 'steering')
  assert.equal(steeringMessage?.label, 'Steered with')
  assert.equal(steeringMessage?.editTargetId, 'steered-turn:steering-message')
})

test('progress finished by steering uses steered collapse settings across displayed turns', () => {
  for (const status of ['inProgress', 'completed']) {
    const items = getChatItems([
      {
        id: 'steered-turn',
        status,
        items: [
          { type: 'userMessage', id: 'initial', content: [{ type: 'text', text: 'Start' }] },
          { type: 'agentMessage', id: 'before-steer', phase: 'commentary', text: 'Working' },
          {
            type: 'userMessage',
            id: 'steer',
            content: [{ type: 'text', text: 'Change direction' }]
          },
          { type: 'agentMessage', id: 'after-steer', phase: 'commentary', text: 'Continuing' }
        ]
      }
    ])
    const model = buildChatConversationModel(items)
    assert.equal(model.turns.length, 2)
    const step = model.turns[0].items.find((item) => item.type === 'working')
    assert.equal(step.status, 'worked')
    const policy = getWorkingStepProgressPolicy(step, model.turns[0].items, model.turns[1].items[0])
    assert.equal(policy, 'stoppedSteeredFailed')
    assert.equal(
      getWorkingStepDefaultOpen(
        step.status,
        policy,
        {
          expandProgressOnStart: true,
          collapseProgressOnFinish: true,
          collapseProgressOnNextTurn: true,
          collapseStoppedSteeredFailedProgressOnFinish: false,
          collapseStoppedSteeredFailedProgressOnNextTurn: false
        },
        model.workingStepIdsWithNextWorkingStep.has(step.id)
      ),
      true
    )
  }
})

test('promotes the final response as soon as it starts streaming', () => {
  const createTurn = (status) => ({
    id: 'answer-turn',
    status,
    items: [
      {
        type: 'userMessage',
        id: 'question',
        content: [{ type: 'text', text: 'Answer this' }]
      },
      {
        type: 'agentMessage',
        id: 'reasoning',
        phase: 'commentary',
        text: 'Checking the details'
      },
      {
        type: 'agentMessage',
        id: 'answer',
        text: 'Here is the answer.',
        phase: 'final_answer'
      }
    ]
  })

  for (const status of ['inProgress', 'completed']) {
    const items = getChatItems([createTurn(status)])
    const working = items.find((item) => item.type === 'working')
    const finalMessage = items.find((item) => item.type === 'message' && item.role === 'assistant')

    assert.equal(working?.status, 'worked')
    assert.equal(finalMessage?.id, 'answer-turn:answer')
    assert.equal(finalMessage?.content, 'Here is the answer.')
    assert.ok(working.items.every((item) => item.id !== finalMessage.id))
  }
})

test('renders CUA browser actions with readable compact labels without protocol payloads', () => {
  const cases = [
    ['cua.getBrowser({ url: "https://www.wikipedia.org" })', 'Opened browser'],
    [
      'cua.createBrowserTab(browser.browserId, "https://www.wikipedia.org", { visible: true }); await tab.markDeliverable()',
      'Opened a new tab'
    ],
    ['tab.goto("https://www.wikipedia.org")', 'Navigated to webpage'],
    ['tab.click(12); await tab.getAXState()', 'Clicked on webpage'],
    ['tab.getScreenshot()', 'Took browser screenshot'],
    ['tab.typeText("example")', 'Typed on webpage'],
    ['tab.scroll(1, "down")', 'Scrolled webpage'],
    ['tab.markHandoff()', 'Handed over browser'],
    ['nodeRepl.write("tab.close()"); /* tab.goto() */ await tab.getAXState()', 'Read webpage']
  ]
  for (const [code, label] of cases) {
    for (const type of ['mcpToolCall', 'dynamicToolCall', 'customToolCall']) {
      const args = { code, title: 'User supplied title' }
      const items = getChatItems([
        {
          id: 'browser-turn',
          status: 'inProgress',
          items: [
            {
              id: 'browser-call',
              type,
              status: 'inProgress',
              server: type === 'mcpToolCall' ? 'cua_repl' : undefined,
              namespace: type === 'dynamicToolCall' ? 'mcp__cua_repl' : undefined,
              tool: type === 'customToolCall' ? undefined : 'js',
              customToolName: type === 'customToolCall' ? 'mcp__cua_repl__js' : undefined,
              customToolInput: type === 'customToolCall' ? JSON.stringify(args) : undefined,
              arguments: args
            }
          ]
        }
      ])
      const tool = items.find((item) => item.type === 'working')?.items[0]
      assert.equal(tool?.label, label)
      assert.equal(tool?.icon, 'browser')
      assert.equal(tool?.compact, true)
      assert.equal(tool?.rawInput, null)
      assert.equal(tool?.rawOutput, null)
    }
  }
})

test('stores canonical browser labels independently of provider status', () => {
  for (const [status, error, label] of [
    ['completed', null, 'Opened a new tab'],
    ['failed', 'Browser unavailable', 'Opened a new tab'],
    ['completed', 'Browser unavailable', 'Opened a new tab']
  ]) {
    const items = getChatItems([
      {
        id: 'turn',
        status: 'completed',
        items: [
          {
            id: 'call',
            type: 'mcpToolCall',
            server: 'cua_repl',
            tool: 'js',
            status,
            error,
            arguments: { code: 'await cua.createBrowserTab("iab")' }
          }
        ]
      }
    ])
    assert.equal(items.find((item) => item.type === 'working')?.items[0]?.label, label)
  }
})

test('browser labels use the same active-to-finished display flow as other tools', () => {
  for (const [finished, active, activity] of [
    ['Opened a new tab', 'Opening a new tab', 'other'],
    ['Opened browser', 'Opening browser', 'other'],
    ['Navigated to webpage', 'Navigating to webpage', 'other'],
    ['Took browser screenshot', 'Taking browser screenshot', 'other'],
    ['Read webpage', 'Reading webpage', 'other'],
    ['Read file', 'Reading file', 'read'],
    ['Create network.gd', 'Creating network.gd', 'create'],
    ['Created network.gd', 'Creating network.gd', 'create'],
    ['Edit network.gd', 'Changing network.gd', 'edit'],
    ['Delete network.gd', 'Deleting network.gd', 'delete'],
    ['Search scripts', 'Searching scripts', 'search'],
    ['Ran a command', 'Running a command', 'command'],
    ['Applied patch', 'Applying patch', 'edit']
  ]) {
    assert.equal(getToolDisplayLabel(finished, activity, true), active)
    assert.equal(getToolDisplayLabel(finished, activity, false), finished)
  }
})

test('bounded live rendering retains compact actions between tool sequences', () => {
  const command = (id) => ({
    id,
    type: 'commandExecution',
    command: 'rg needle src',
    status: 'completed',
    aggregatedOutput: 'match'
  })
  const turn = {
    id: 'bounded-tools',
    status: 'inProgress',
    items: [
      command('search-1'),
      command('search-2'),
      {
        id: 'browser',
        type: 'mcpToolCall',
        server: 'cua_repl',
        tool: 'js',
        arguments: { code: 'tab.click(12)' },
        status: 'inProgress'
      },
      command('search-3')
    ]
  }
  const flatten = (items) =>
    items.flatMap((item) => (item.type === 'toolGroup' ? item.tools : [item]))
  const full = getChatItems([turn]).find((item) => item.type === 'working')
  const bounded = getChatItems([turn], null, {
    workingItemTailTurnId: turn.id,
    workingItemTailLimit: 50
  }).find((item) => item.type === 'working')
  assert.deepEqual(flatten(bounded.items), flatten(full.items))
  assert.deepEqual(
    bounded.items.map((item) => item.type),
    ['toolGroup', 'tool', 'tool']
  )
  assert.equal(bounded.items[1].icon, 'browser')
  assert.equal(bounded.itemCount, 3)
})

test('mixed tool headings name both reading and searching while active', async () => {
  const { getToolSequenceDisplayLabel } = await import('../../../renderer/src/toolDisplayLabel.ts')
  assert.equal(
    getToolSequenceDisplayLabel(['read', 'search', 'read'], true),
    'Reading files, Searching'
  )
  assert.equal(getToolSequenceDisplayLabel(['read', 'search'], false), 'Read files, searched')
})

test('skill usage retains its activity in grouped headings and paged summaries', async () => {
  const { getToolSequenceDisplayLabel } = await import('../../../renderer/src/toolDisplayLabel.ts')
  for (const type of ['commandExecution', 'customToolCall']) {
    const command = 'cat /skills/visualize/SKILL.md'
    const turn = {
      id: 'skill-turn',
      status: 'completed',
      items: [
        {
          id: 'skill',
          type,
          command: type === 'commandExecution' ? command : undefined,
          customToolName: type === 'customToolCall' ? 'exec_command' : undefined,
          customToolInput: JSON.stringify({ cmd: command }),
          status: 'completed'
        },
        { id: 'mkdir', type: 'commandExecution', command: 'mkdir output', status: 'completed' }
      ]
    }
    const working = getChatItems([turn]).find((item) => item.type === 'working')
    const group = working.items[0]
    assert.equal(group.type, 'toolGroup')
    assert.equal(group.tools[0].label, 'Used visualize skill')
    assert.equal(group.tools[0].icon, 'skill')
    assert.equal(group.tools[0].activity, 'skill')
    assert.deepEqual(group.toolActivities, ['skill', 'command'])
    assert.equal(group.dominantActivity, 'skill')
    assert.equal(
      getToolSequenceDisplayLabel(group.toolActivities, false),
      'Used skills, ran commands'
    )
    assert.equal(
      getToolSequenceDisplayLabel(group.toolActivities, true),
      'Using skills, Running commands'
    )
  }
  assert.equal(getToolSequenceDisplayLabel(['skill', 'read'], false), 'Used skills, read files')
})

test('MCP Apps retain their original call ID and resource association in tool projections', () => {
  const items = getChatItems([
    {
      id: 'turn',
      status: 'completed',
      items: [
        {
          id: 'call',
          type: 'mcpToolCall',
          server: 'source',
          tool: 'display',
          status: 'completed',
          arguments: {},
          result: { content: [] },
          mcpAppUi: { resourceUri: 'ui://source/app' }
        }
      ]
    }
  ])
  const tools = items.flatMap((item) =>
    item.type === 'working'
      ? item.items.flatMap((tool) =>
          tool.type === 'tool' ? [tool] : tool.type === 'toolGroup' ? tool.tools : []
        )
      : []
  )
  assert.deepEqual(tools[0].mcpApp, {
    callId: 'call',
    serverName: 'source',
    resourceUri: 'ui://source/app'
  })
})

test('renders Codex subagent spawn and wait as compact rows without the delegated prompt', () => {
  const items = getChatItems([
    {
      id: 'parent-turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'question', content: [{ type: 'text', text: 'Delegate' }] },
        {
          type: 'collabAgentToolCall',
          id: 'spawn',
          tool: 'spawnAgent',
          status: 'completed',
          prompt: 'Read every file and summarize.',
          receiverThreadIds: ['child-thread']
        },
        {
          type: 'collabAgentToolCall',
          id: 'wait',
          tool: 'wait',
          status: 'completed',
          receiverThreadIds: ['child-thread']
        },
        { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done.' }
      ]
    }
  ])
  const working = items.find((item) => item.type === 'working')
  assert.doesNotMatch(JSON.stringify(working), /Read every file/)
  const tools = working.items.flatMap((item) =>
    item.type === 'toolGroup' ? item.tools : item.type === 'tool' ? [item] : []
  )
  assert.deepEqual(
    tools.map(({ compact, icon, label }) => ({ compact, icon, label })),
    [
      { compact: true, icon: 'subagent', label: 'Started subagent' },
      { compact: true, icon: 'time', label: 'Waited for subagent' }
    ]
  )
})

test('native Codex start activity renders a compact delegation row before completion', () => {
  const items = getChatItems([
    {
      id: 'turn',
      status: 'inProgress',
      items: [
        {
          type: 'subAgentActivity',
          id: 'spawn',
          kind: 'started',
          agentThreadId: 'child',
          agentPath: '/root/nested_live_demo',
          prompt: 'Private delegated instruction'
        }
      ]
    }
  ])
  const tool = items.find((item) => item.type === 'working').items[0]
  assert.equal(tool.label, 'Started subagent for nested live demo')
  assert.equal(
    getToolDisplayLabel(tool.label, tool.activity, false),
    'Started subagent for nested live demo'
  )
  assert.equal(
    getToolDisplayLabel(tool.label, tool.activity, true),
    'Starting subagent for nested live demo'
  )
  assert.equal(tool.compact, true)
  assert.equal(tool.icon, 'subagent')
  assert.equal(JSON.stringify(items).includes('Private delegated instruction'), false)
})

test('native sleep-only child turns show their wait while running and retain it after completion', async () => {
  const { CodexTranscriptProjection } = await import('./CodexItemRenderers.ts')
  const projection = new CodexTranscriptProjection()
  const turn = {
    id: 'child-turn',
    status: 'inProgress',
    startedAt: 100,
    items: [{ type: 'sleep', id: 'native-sleep', durationMs: 30_000 }]
  }
  const live = getChatItems([turn], 100, {}, projection)
  const working = live.find((item) => item.type === 'working')
  assert.equal(working.status, 'working')
  assert.equal(working.items[0].type, 'tool')
  assert.equal(working.items[0].label, 'Waited 30s')
  assert.equal(working.items[0].status, 'running')
  assert.equal(working.items[0].compact, true)
  assert.equal(working.items[0].icon, 'time')

  const completed = {
    ...turn,
    status: 'completed',
    completedAt: 131,
    items: [
      ...turn.items,
      { type: 'agentMessage', id: 'answer', text: 'Nested child finished.', phase: 'final_answer' }
    ]
  }
  const finished = getChatItems([completed], 100, {}, projection)
  assert.deepEqual(finished, getChatItems([completed], 100))
  assert.equal(finished.find((item) => item.type === 'working').items[0].label, 'Waited 30s')
  assert.equal(finished.find((item) => item.type === 'working').items[0].icon, 'time')
  assert.equal(finished.at(-1).content, 'Nested child finished.')
})

test('wait and sleep calls use time icons while unrelated MCP tools keep their scope', () => {
  for (const status of ['inProgress', 'completed']) {
    for (const call of [
      { type: 'customToolCall', customToolName: 'clock.sleep', customToolInput: '{}' },
      { type: 'dynamicToolCall', namespace: 'clock', tool: 'sleep' },
      { type: 'dynamicToolCall', namespace: 'functions', tool: 'wait' },
      { type: 'customToolCall', customToolName: 'collaboration.wait_agent', customToolInput: '{}' },
      { type: 'commandExecution', command: 'await tools.clock__sleep({duration_ms: 10})' }
    ]) {
      const items = getChatItems([{ id: 'turn', status, items: [{ id: 'call', status, ...call }] }])
      const tool = items.find((item) => item.type === 'working').items[0]
      assert.equal(tool.icon, 'time', JSON.stringify(call))
      assert.equal(tool.status, status === 'inProgress' ? 'running' : 'finished')
    }
    const items = getChatItems([
      {
        id: 'turn',
        status,
        items: [{ id: 'call', type: 'mcpToolCall', server: 'custom', tool: 'wait', status }]
      }
    ])
    assert.equal(items.find((item) => item.type === 'working').items[0].icon, null)
  }
})

test('unrecognized native tools get a generic row in live and completed transcripts', async () => {
  const { getToolDisplayLabel } = await import('../../../renderer/src/toolDisplayLabel.ts')
  const tool = {
    type: 'futureNativeTool',
    id: 'new-tool',
    tool: 'inspect_runtime',
    arguments: { target: 'fixture' }
  }
  const live = getChatItems([{ id: 'turn', status: 'inProgress', items: [tool] }])
  const row = live.find((item) => item.type === 'working').items[0]
  assert.equal(row.toolId, 'inspect_runtime')
  assert.equal(row.status, 'running')
  assert.equal(getToolDisplayLabel(row.label, row.activity, true), 'Using tool inspect_runtime')
  assert.deepEqual(row.rawInput, { target: 'fixture' })

  const completed = getChatItems([{ id: 'turn', status: 'completed', items: [tool] }])
  const finished = completed.find((item) => item.type === 'working').items[0]
  assert.equal(finished.id, row.id)
  assert.equal(finished.status, 'finished')
  assert.equal(
    getToolDisplayLabel(finished.label, finished.activity, false),
    'Used tool inspect_runtime'
  )
})

test('generic fallback preserves intentionally hidden transcript content and collaboration metadata', () => {
  const items = getChatItems([
    {
      id: 'turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'empty-user' },
        { type: 'agentMessage', id: 'empty-agent', text: '' },
        ...[
          'hookPrompt',
          'functionCallOutput',
          'plan',
          'reasoning',
          'enteredReviewMode',
          'exitedReviewMode'
        ].map((type) => ({ type, id: type, text: 'Metadata' })),
        { type: 'subAgentActivity', id: 'interaction', kind: 'interacted', agentThreadId: 'child' },
        { type: 'collabAgentToolCall', id: 'send', tool: 'sendMessage' }
      ]
    }
  ])
  assert.equal(
    items.some((item) => item.type === 'working'),
    false
  )
})

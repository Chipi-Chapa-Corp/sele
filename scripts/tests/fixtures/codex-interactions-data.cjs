const base = { threadId: 'fixture', turnId: 'turn', serverName: 'Demo service' }
const form = (schema, extra = {}) => ({
  id: 101,
  method: 'mcpServer/elicitation/request',
  params: {
    ...base,
    mode: 'form',
    message: 'Choose the report settings before continuing.',
    requestedSchema: schema,
    ...extra
  }
})
exports.scenarios = {
  fields: form({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'count', 'enabled', 'region'],
    properties: {
      name: { type: 'string', title: 'Report name', minLength: 3 },
      email: { type: 'string', title: 'Contact email', format: 'email' },
      count: { type: 'integer', title: 'Number of rows', minimum: 1, maximum: 100, default: 10 },
      ratio: { type: 'number', title: 'Scale', minimum: 0, default: 1.5 },
      enabled: { type: 'boolean', title: 'Include archived records', default: false },
      region: {
        type: 'string',
        title: 'Workspace region',
        oneOf: [
          { const: 'eu', title: 'Europe' },
          { const: 'us', title: 'United States' }
        ]
      },
      tags: {
        type: 'array',
        title: 'Sections',
        minItems: 1,
        items: {
          type: 'string',
          anyOf: [
            { const: 'summary', title: 'Summary' },
            { const: 'details', title: 'Details' }
          ]
        },
        default: ['summary']
      },
      date: { type: 'string', title: 'Start date', format: 'date' },
      secret: { type: 'string', title: 'Secret value', writeOnly: true }
    }
  }),
  json: form({
    type: 'object',
    required: ['filter'],
    properties: {
      filter: {
        type: 'object',
        required: ['limit'],
        additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, maximum: 20 } }
      }
    }
  }),
  url: {
    id: 102,
    method: 'mcpServer/elicitation/request',
    params: {
      ...base,
      mode: 'url',
      elicitationId: 'demo-auth',
      message: 'Connect your Demo service account to continue this action.',
      url: 'https://example.com/authorize?demo=true'
    }
  },
  verification: {
    id: 103,
    method: 'mcpServer/elicitation/request',
    params: {
      ...base,
      mode: 'openai/userVerification',
      title: 'Verify your approval',
      description: 'This example requires a device-backed approval.',
      challenge: 'ZGVtby1jaGFsbGVuZ2U'
    }
  },
  invalidSchema: form({ type: 'object', $ref: 'https://example.com/unavailable-schema.json' }),
  permissions: {
    id: 104,
    method: 'item/permissions/requestApproval',
    params: {
      ...base,
      itemId: 'permission-tool',
      cwd: '/demo/project',
      reason: 'Read external reference files and fetch dependencies.',
      startedAtMs: 1,
      permissions: {
        network: { enabled: true },
        fileSystem: {
          entries: [
            { access: 'read', path: { type: 'path', path: '/demo/reference' } },
            { access: 'write', path: { type: 'glob_pattern', pattern: '/demo/output/**' } }
          ]
        }
      }
    }
  },
  command: {
    id: 105,
    method: 'item/commandExecution/requestApproval',
    params: {
      ...base,
      itemId: 'command',
      command: 'npm test',
      cwd: '/demo/project',
      reason: 'Run project tests.'
    }
  },
  file: {
    id: 106,
    method: 'item/fileChange/requestApproval',
    params: {
      ...base,
      itemId: 'file',
      grantRoot: '/demo/project',
      reason: 'Update the project configuration.'
    }
  },
  browser: form(
    { type: 'object', properties: {} },
    {
      _meta: { connector_id: 'browser-use', codex_approval_kind: 'mcp_tool_call' },
      message: 'Allow the browser to visit example.com?'
    }
  ),
  question: {
    id: 107,
    method: 'item/tool/requestUserInput',
    params: {
      ...base,
      itemId: 'question',
      questions: [
        {
          id: 'target',
          question: 'Which environment should we use?',
          isOther: true,
          options: [
            { label: 'Staging', description: 'Test the change first.' },
            { label: 'Local', description: 'Use the local fixture.' }
          ]
        }
      ]
    }
  }
}

import { record } from '../../../shared/elicitation.ts'
import { validateElicitation } from './CodexElicitationValidation.ts'

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const paths = nullable({ type: 'array', items: { type: 'string', minLength: 1 } })
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    network: nullable({
      type: 'object',
      additionalProperties: false,
      properties: { enabled: { type: ['boolean', 'null'] } }
    }),
    fileSystem: nullable({
      type: 'object',
      additionalProperties: false,
      properties: {
        read: paths,
        write: paths,
        globScanMaxDepth: { type: ['integer', 'null'], minimum: 1 },
        entries: nullable({
          type: 'array',
          items: {
            type: 'object',
            required: ['access', 'path'],
            additionalProperties: false,
            properties: {
              access: { enum: ['read', 'write', 'deny'] },
              path: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['type', 'path'],
                    additionalProperties: false,
                    properties: { type: { const: 'path' }, path: { type: 'string', minLength: 1 } }
                  },
                  {
                    type: 'object',
                    required: ['type', 'pattern'],
                    additionalProperties: false,
                    properties: {
                      type: { const: 'glob_pattern' },
                      pattern: { type: 'string', minLength: 1 }
                    }
                  },
                  {
                    type: 'object',
                    required: ['type', 'value'],
                    additionalProperties: false,
                    properties: {
                      type: { const: 'special' },
                      value: {
                        type: 'object',
                        required: ['kind'],
                        additionalProperties: false,
                        properties: {
                          kind: {
                            enum: [
                              'root',
                              'minimal',
                              'project_roots',
                              'tmpdir',
                              'slash_tmp',
                              'unknown'
                            ]
                          },
                          path: { type: 'string' },
                          subpath: { type: ['string', 'null'] }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        })
      }
    })
  }
}

export function parseCodexPermissions(value: unknown): {
  permissions: Record<string, unknown>
  details: string[]
} {
  const permissions = record(value)
  if (!permissions || validateElicitation(schema, permissions))
    throw new Error('Invalid or unsupported requested permission profile')
  const details: string[] = []
  const network = record(permissions.network)
  if (typeof network?.enabled === 'boolean')
    details.push(`Network: ${network.enabled ? 'enabled' : 'disabled'}`)
  const fileSystem = record(permissions.fileSystem)
  for (const access of ['read', 'write']) {
    const values = fileSystem?.[access]
    if (Array.isArray(values)) for (const path of values) details.push(`${access}: ${path}`)
  }
  if (Array.isArray(fileSystem?.entries))
    for (const entry of fileSystem.entries) {
      const path = entry.path
      const special = path.value
      const label =
        path.type === 'special'
          ? `${special.kind}${special.path ? ` (${special.path})` : ''}${special.subpath ? `/${special.subpath}` : ''}`
          : (path.path ?? path.pattern)
      details.push(`${entry.access}: ${label}`)
    }
  if (fileSystem?.globScanMaxDepth != null)
    details.push(`Pattern scan depth: ${fileSystem.globScanMaxDepth}`)
  return { permissions, details }
}

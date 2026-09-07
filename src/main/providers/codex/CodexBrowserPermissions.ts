function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

// A plain Browser Use permission can use Allow/Deny. Authentication challenges,
// input forms and strict automated reviews need their own broker.
export function isBrowserPermissionRequest(params: Record<string, unknown>): boolean {
  const meta = record(params._meta)
  const schema = record(params.requestedSchema)
  return (
    !!meta &&
    meta.connector_id === 'browser-use' &&
    meta.codex_approval_kind === 'mcp_tool_call' &&
    meta.codex_strict_auto_review !== true &&
    meta.codex_requires_user_input !== true &&
    ['form', 'openai/form', 'openaiForm'].includes(String(params.mode)) &&
    !!schema &&
    schema.type === 'object' &&
    Object.keys(record(schema.properties) ?? {}).length === 0 &&
    (!Array.isArray(schema.required) || schema.required.length === 0)
  )
}

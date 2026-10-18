import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const options = { allErrors: true, strict: false, validateFormats: true }
const legacy = addFormats(new Ajv(options))
const modern = addFormats(new Ajv2020(options))

// Compilation never fetches remote schemas. Cache only the most recent form in each process.
let lastSchema: Record<string, unknown> | null = null
let lastValidator: ReturnType<typeof modern.compile> | null = null
export function validateElicitation(
  schema: Record<string, unknown>,
  content: Record<string, unknown>
): string | null {
  try {
    if (lastSchema !== schema || !lastValidator) {
      if (lastSchema) {
        legacy.removeSchema(lastSchema)
        modern.removeSchema(lastSchema)
      }
      const engine = String(schema.$schema ?? '').includes('draft-07') ? legacy : modern
      lastValidator = engine.compile(schema)
      lastSchema = schema
    }
    if (lastValidator(content)) return null
    return (lastValidator.errors ?? [])
      .slice(0, 4)
      .map((error) => `${error.instancePath || 'Form'} ${error.message}`)
      .join('; ')
  } catch {
    return 'This form uses an unsupported or invalid schema. Decline it or cancel the request.'
  }
}

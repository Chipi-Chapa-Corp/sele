import type { ProviderCwdNote, ProviderId } from '../../shared/provider'
import { getDatabase } from './sqlite'

const unknownCwdKey = '__unknown__'
const maxCwdNotes = 100
const maxCwdNoteLength = 1000
const maxCwdNoteIdLength = 128

const getCwdKey = (cwd: string | null): string => cwd?.trim() || unknownCwdKey
const getCwdNotesRecordId = (providerId: ProviderId, cwd: string | null): string =>
  `${providerId}:${getCwdKey(cwd)}`

const normalizeCwdNotes = (value: unknown): ProviderCwdNote[] => {
  if (!Array.isArray(value)) return []

  const ids = new Set<string>()
  const notes: ProviderCwdNote[] = []

  for (let index = 0; index < value.length && notes.length < maxCwdNotes; index += 1) {
    const note = value[index]
    if (!note || typeof note !== 'object') continue

    const candidate = note as Partial<ProviderCwdNote>
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : ''
    const createdAt =
      typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
        ? Math.max(0, Math.floor(candidate.createdAt))
        : 0
    let id = typeof candidate.id === 'string' ? candidate.id.trim() : ''

    if (!text) continue
    if (!id) id = `${createdAt}-${index}`
    id = id.slice(0, maxCwdNoteIdLength)
    if (ids.has(id)) id = `${id}-${index}`.slice(0, maxCwdNoteIdLength)
    ids.add(id)

    notes.push({
      id,
      text: text.slice(0, maxCwdNoteLength),
      createdAt
    })
  }

  return notes
}

export const getCwdNotes = async (
  providerId: ProviderId,
  cwd: string | null
): Promise<ProviderCwdNote[]> => {
  const db = await getDatabase()
  const row = await db
    .selectFrom('cwd_notes')
    .select('notes_json')
    .where('id', '=', getCwdNotesRecordId(providerId, cwd))
    .executeTakeFirst()

  if (!row) return []

  try {
    return normalizeCwdNotes(JSON.parse(row.notes_json))
  } catch (error) {
    console.error('[caught:cwdNotes:getCwdNotes]', error)
    return []
  }
}

export const setCwdNotes = async (
  providerId: ProviderId,
  cwd: string | null,
  notes: ProviderCwdNote[]
): Promise<ProviderCwdNote[]> => {
  const db = await getDatabase()
  const normalizedNotes = normalizeCwdNotes(notes)
  const id = getCwdNotesRecordId(providerId, cwd)

  if (normalizedNotes.length === 0) {
    await db.deleteFrom('cwd_notes').where('id', '=', id).execute()
    return []
  }

  await db
    .insertInto('cwd_notes')
    .values({
      id,
      provider_id: providerId,
      cwd_key: getCwdKey(cwd),
      notes_json: JSON.stringify(normalizedNotes)
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        provider_id: providerId,
        cwd_key: getCwdKey(cwd),
        notes_json: JSON.stringify(normalizedNotes)
      })
    )
    .execute()

  return normalizedNotes
}

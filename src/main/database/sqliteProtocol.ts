import type { PreferenceRequest } from '../../shared/preferences'

export type SqliteOperation =
  | { kind: 'ready' | 'close' }
  | { kind: 'query'; sql: string; parameters: readonly unknown[] }
  | { kind: 'cursor'; sql: string; parameters: readonly unknown[] }
  | { kind: 'next'; cursor: number; size: number }
  | { kind: 'return'; cursor: number }
  | { kind: 'preferences'; request: PreferenceRequest; senderId: number }
  | { kind: 'forget'; senderId: number }

export type SqliteWorkerError = { message: string; name: string; stack?: string; code?: string }
export type SqliteWorkerReply = {
  id: number
  result?: unknown
  error?: SqliteWorkerError
  fatal?: boolean
}
export type SqliteWorkerRequest = {
  id: number
  operation: SqliteOperation
  barrier?: SharedArrayBuffer
}
export type SqliteWorkerOptions = { path: string; preferences?: boolean; legacyPath?: string }

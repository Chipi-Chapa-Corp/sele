import type { TokenUsage, TokenUsageSummary } from '../../../shared/tokenUsage.ts'

export type HistoricalUsageRow = {
  source_anchor: string | null
  database_identity?: string
  snapshot_at: number
  period: 'chat' | 'week' | 'month'
  calls: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  input_usd: number | null
  cached_input_usd: number | null
  output_usd: number | null
  total_usd: number | null
}

/** Read only billing metadata. Native event IDs are distinct from SDK event IDs. */
export const copilotHistoricalUsageQuery = (hasDetails = true): string => {
  const detail = (category: string) => `
    sum(case when json_extract(d.value, '$.tokenType') in (${category}) then
      case when json_extract(d.value, '$.batchSize') > 0
        and json_extract(d.value, '$.costPerBatch') >= 0
        and json_extract(d.value, '$.tokenCount') >= 0
      then json_extract(d.value, '$.tokenCount') * 1.0 * json_extract(d.value, '$.costPerBatch')
        / json_extract(d.value, '$.batchSize') / 100000000000.0 end else 0 end)`
  const detailTokens = (category: string) =>
    `sum(case when json_extract(d.value, '$.tokenType') in (${category}) then json_extract(d.value, '$.tokenCount') else 0 end)`
  const categories = [
    "'input', 'cache_write', 'cache_write_1h'",
    "'cache_read'",
    "'output', 'reasoning'"
  ]
  const names = ['input', 'cached_input', 'output']
  const details = hasDetails ? 'u.token_details_json' : 'null'
  return `with dated as (
    select u.*, cast(round((julianday(created_at) - 2440587.5) * 86400000) as integer) as recorded_at
    from assistant_usage_events u
  ), calls as (
    select u.id, u.session_id, u.recorded_at,
      max(coalesce(u.input_tokens, 0) - coalesce(u.cache_read_tokens, 0), 0) as input_tokens,
      coalesce(u.cache_read_tokens, 0) as cached_input_tokens,
      coalesce(u.output_tokens, 0) as output_tokens,
      case when u.total_nano_aiu >= 0 then u.total_nano_aiu / 100000000000.0 end as native_total,
      ${names.map((name, i) => `${detail(categories[i])} as ${name}_quoted, ${detailTokens(categories[i])} as ${name}_quoted_tokens`).join(',')},
      sum(case when json_extract(d.value, '$.tokenType') not in
        ('input','cache_write','cache_write_1h','cache_read','output','reasoning')
        and coalesce(json_extract(d.value, '$.tokenCount'), 0) > 0 then 1 else 0 end) as unknown_categories,
      sum(case when d.value is not null and (
        json_extract(d.value, '$.batchSize') is null or json_extract(d.value, '$.batchSize') <= 0 or
        json_extract(d.value, '$.costPerBatch') is null or json_extract(d.value, '$.costPerBatch') < 0 or
        json_extract(d.value, '$.tokenCount') is null or json_extract(d.value, '$.tokenCount') < 0
      ) then 1 else 0 end) as invalid_details
    from dated u left join json_each(case when json_valid(${details}) then ${details} else '[]' end) d
    where u.recorded_at <= @now and (u.recorded_at >= @month or u.session_id = @chat)
    group by u.id
  ), quoted as (
    select *, ${names.map((name) => `case when ${name}_tokens = 0 then 0 when invalid_details = 0 and ${name}_tokens = ${name}_quoted_tokens then ${name}_quoted end as ${name}_cost`).join(',')}
    from calls
  ), priced as (
    select *, case when unknown_categories = 0 then input_cost + cached_input_cost + output_cost end as quoted_total
    from quoted
  ), windows(period, since, chat) as (
    values ('week', @week, null), ('month', @month, null), ('chat', 0, @chat)
  )
  select windows.period, @now as snapshot_at,
    (select session_id || ':' || created_at from assistant_usage_events order by id limit 1) as source_anchor, count(priced.id) as calls,
    coalesce(sum(input_tokens), 0) as input_tokens,
    coalesce(sum(cached_input_tokens), 0) as cached_input_tokens,
    coalesce(sum(output_tokens), 0) as output_tokens,
    ${names
      .map((name) => {
        const cost = `case when native_total = 0 then 0
        when native_total is not null and quoted_total > 0 then ${name}_cost * native_total / quoted_total
        when native_total is not null and ${name}_tokens > 0 then null else ${name}_cost end`
        return `case when count(priced.id) = 0 then 0
        when sum(case when priced.id is not null and (${cost}) is null then 1 else 0 end) > 0 then null
        else sum(${cost}) end as ${name}_usd`
      })
      .join(',')},
    case when count(priced.id) = 0 then 0
      when sum(case when priced.id is not null and coalesce(native_total, quoted_total) is null then 1 else 0 end) > 0 then null
      else sum(coalesce(native_total, quoted_total)) end as total_usd
    from windows left join priced on priced.recorded_at >= windows.since
      and (windows.period != 'chat' or priced.session_id = windows.chat)
    group by windows.period`
}

export const historicalUsageFromRows = (
  rows: HistoricalUsageRow[],
  now: number
): TokenUsageSummary => {
  const usage = (row: HistoricalUsageRow): TokenUsage => ({
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    cost: {
      input: row.input_usd,
      cachedInput: row.cached_input_usd,
      output: row.output_usd,
      total: row.total_usd
    }
  })
  const period = (name: HistoricalUsageRow['period']) => {
    const row = rows.find((row) => row.period === name)
    if (!row) throw new Error('Copilot historical usage returned an incomplete snapshot.')
    return row
  }
  const chat = period('chat')
  return {
    chat: chat.calls > 0 ? usage(chat) : null,
    week: usage(period('week')),
    month: usage(period('month')),
    updatedAt: rows[0]?.snapshot_at ?? now,
    history: 'native'
  }
}

export const copilotUsageColumns = [
  'id',
  'session_id',
  'created_at',
  'input_tokens',
  'cache_read_tokens',
  'output_tokens',
  'total_nano_aiu'
]

/** Bind before transport; the resulting SQL is a single argument, never shell source. */
export const bindCopilotUsageQuery = (
  now: number,
  chatId: string | null,
  hasDetails = true
): string => {
  const values: Record<string, string> = {
    now: String(Math.trunc(now)),
    week: String(Math.trunc(now - 7 * 86_400_000)),
    month: String(Math.trunc(now - 30 * 86_400_000)),
    chat: chatId == null ? 'null' : `'${chatId.replaceAll("'", "''")}'`
  }
  return copilotHistoricalUsageQuery(hasDetails).replace(
    /@(now|week|month|chat)\b/g,
    (_, key) => values[key]
  )
}

// Prefer Python's standard-library SQLite driver remotely; sqlite3 CLI is an alternative.
// Never copy a live database file: its uncheckpointed WAL can contain recent usage.
export const copilotUsageReadScript = `set -eu
path="\${COPILOT_HOME:-$HOME/.copilot}/session-store.db"
if [ ! -f "$path" ]; then printf 'null'; exit 0; fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 -c 'import sqlite3,json,sys,pathlib
c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+"?mode=ro",uri=True,timeout=1)
c.row_factory=sqlite3.Row
identity=str(pathlib.Path(sys.argv[1]).stat().st_dev)+":"+str(pathlib.Path(sys.argv[1]).stat().st_ino)
columns={r["name"] for r in c.execute("pragma table_info(assistant_usage_events)")}
required=json.loads(sys.argv[4])
if not all(k in columns for k in required): print("null")
else: print(json.dumps([dict(r, database_identity=identity) for r in c.execute(sys.argv[2] if "token_details_json" in columns else sys.argv[3])]))
c.close()' "$path" "$1" "$2" "$3"
elif command -v sqlite3 >/dev/null 2>&1; then
  columns=$(sqlite3 -readonly "$path" 'select group_concat(name) from pragma_table_info("assistant_usage_events")')
  for name in id session_id created_at input_tokens cache_read_tokens output_tokens total_nano_aiu; do
    case ",$columns," in *",$name,"*) ;; *) printf 'null'; exit 0 ;; esac
  done
  case ",$columns," in *',token_details_json,'*) query="$1" ;; *) query="$2" ;; esac
  identity=$(stat -c '%d:%i' "$path" 2>/dev/null || stat -f '%d:%i' "$path")
  case "$identity" in *[!0-9:]*) exit 1 ;; esac
  exec sqlite3 -readonly -json "$path" "select snapshot.*, '$identity' as database_identity from ($query) snapshot"
else
  printf '%s\\n' 'Copilot historical usage requires python3 or sqlite3 in this source.' >&2
  exit 1
fi`

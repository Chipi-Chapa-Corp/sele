import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { HmrContext } from 'vite'

/** Keep dependency subsets consistent with app imports, including hot additions. */
export function iconImports(packageName: string, forceAll = false) {
  const root = resolve('src/renderer/src')
  const used = new Set<string>()
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const named = new RegExp(`(?:import|export)\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escaped}['"]`, 'g')
  const all = new RegExp(
    `\\b(?:import\\s*(?:\\*\\s+as\\s+\\w+\\s+from\\s*|\\(\\s*|\\w+\\s+from\\s*)|export\\s*\\*(?:\\s+as\\s+\\w+)?\\s*from\\s*)['"]${escaped}['"]`
  )
  const names = (source: string): string[] =>
    Array.from(source.matchAll(named), (match) =>
      match[1]
        .split(',')
        .map((specifier) => specifier.trim().match(/^(\w+)/)?.[1])
        .filter((name): name is string => !!name && name !== 'type')
    ).flat()
  let preserveAll = forceAll
  for (const file of readdirSync(root, { recursive: true })) {
    if (typeof file !== 'string' || !/\.tsx?$/.test(file)) continue
    const source = readFileSync(join(root, file), 'utf8')
    preserveAll ||= all.test(source)
    for (const name of names(source)) used.add(name)
  }
  preserveAll ||= used.has('icons')
  return {
    root,
    used,
    preserveAll,
    handleHotUpdate({ file, server }: HmrContext) {
      if (!/\.tsx?$/.test(file)) return undefined
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
      if (!preserveAll && (all.test(source) || names(source).some((name) => !used.has(name)))) {
        void server.restart(true)
        return []
      }
      return undefined
    }
  }
}

import { extractFile, getRawHeader } from '@electron/asar'
import { builtinModules } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function verifyPackagedRuntime(archive, platform = process.platform, arch = process.arch) {
  const { header } = getRawHeader(archive)
  const entry = (path) => path.split('/').reduce((node, name) => node?.files?.[name], header)
  const paths = (node, prefix = '') =>
    Object.entries(node.files ?? {}).flatMap(([name, child]) =>
      child.files ? paths(child, prefix + name + '/') : [prefix + name]
    )
  const builtins = new Set([...builtinModules, 'electron'])
  const modules = new Set(['@github/copilot-sdk', '@lydell/node-pty', 'better-sqlite3'])
  for (const path of paths(entry('out/main'), 'out/main/').filter((name) => name.endsWith('.js'))) {
    const source = extractFile(archive, path).toString()
    for (const match of source.matchAll(/(?:require\(|import\()["']([^"']+)["']/g)) {
      const name = match[1]
      if (name.startsWith('.') || name.startsWith('node:') || builtins.has(name)) continue
      modules.add(name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0])
    }
  }
  modules.add(`@github/copilot-sdk-${platform}-${arch}`)
  modules.add(`@lydell/node-pty-${platform}-${arch}`)
  for (const name of modules) {
    if (!entry(`node_modules/${name}/package.json`))
      throw new Error(`Packaged runtime dependency is missing: ${name}`)
  }
  const sqlite = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  if (!entry(sqlite)?.unpacked || !existsSync(`${archive}.unpacked/${sqlite}`))
    throw new Error('Packaged SQLite native module is missing or was not unpacked')
  for (const name of ['monaco-editor', 'mermaid', 'lucide-react', 'react-virtuoso']) {
    if (entry(`node_modules/${name}`))
      throw new Error(`Renderer build dependency was unnecessarily packaged: ${name}`)
  }
  console.log(
    `Verified ${modules.size} packaged runtime dependencies and native SQLite (${platform}/${arch}).`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyPackagedRuntime(process.argv[2])
}

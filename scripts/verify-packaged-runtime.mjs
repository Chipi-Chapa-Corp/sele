import { extractFile, getRawHeader } from '@electron/asar'
import { builtinModules } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'
import { spawnSync } from 'node:child_process'

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
    const source = extractFile(archive, path.split('/').join(sep)).toString()
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
  if (platform === 'darwin') {
    const plugin = `${archive}.unpacked/node_modules/@github/copilot-sdk-darwin-${arch}/plugins/computer-use`
    for (const name of ['computer-use-mcp', 'Copilot Computer Use.app']) {
      const path = `${plugin}/${name}`
      const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], {
        encoding: 'utf8'
      })
      if (verified.error || verified.status !== 0)
        throw new Error(
          `Bundled GitHub signature is invalid (${name}): ${verified.error?.message ?? verified.stderr}`
        )
      const identity = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', path], {
        encoding: 'utf8'
      })
      if (
        identity.error ||
        identity.status !== 0 ||
        !identity.stderr.split('\n').includes('TeamIdentifier=VEKTX9H2N7')
      )
        throw new Error(
          `Bundled GitHub identity was replaced (${name}); preserve the vendor signature when packaging.`
        )
    }
    console.log('Verified original GitHub Computer Use signatures.')
  }
  console.log(
    `Verified ${modules.size} packaged runtime dependencies and native SQLite (${platform}/${arch}).`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyPackagedRuntime(process.argv[2])
}

// Dependency-subset safety without changing application sources or starting a UI.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

;(async () => {
  const root = path.resolve(__dirname, '../..')
  await fs.mkdir(path.join(root, 'tmp'), { recursive: true })
  const directory = await fs.mkdtemp(path.join(root, 'tmp/sele-icon-imports-'))
  const project = path.join(directory, 'project')
  const source = path.join(project, 'src/renderer/src/App.tsx')
  const originalCwd = process.cwd()
  try {
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(path.join(project, 'package-lock.json'), JSON.stringify({ packages: {} }))
    await fs.writeFile(
      source,
      "import { Check as StatusCheck, type LucideIcon } from 'lucide-react'\n"
    )
    const modulePath = path.join(directory, 'plugins.cjs')
    await require('esbuild').build({
      stdin: {
        contents: `export {iconImports} from './vite.icon-imports';export {staticIcons} from './vite.static-icons';export {animatedIcons} from './vite.animated-icons'`,
        resolveDir: root,
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      packages: 'external',
      format: 'cjs',
      outfile: modulePath
    })
    const { iconImports, staticIcons, animatedIcons } = require(modulePath)
    const barrel = path.resolve(
      path.dirname(require.resolve('lucide-react')),
      '../esm/lucide-react.mjs'
    )
    const original = await fs.readFile(barrel, 'utf8')
    const names = async () => {
      const plugin = staticIcons()
      const code = await plugin.transform(original, barrel)
      const ast = require('@babel/core').parseSync(code, { sourceType: 'module' })
      return ast.program.body
        .filter((node) => node.type === 'ExportNamedDeclaration')
        .flatMap((node) =>
          node.specifiers.map((specifier) => specifier.exported.name ?? specifier.exported.value)
        )
    }
    process.chdir(project)
    let imports = iconImports('lucide-react')
    assert.deepEqual([...imports.used], ['Check'])
    assert.equal(imports.preserveAll, false)
    assert.deepEqual(await names(), ['Check'])
    const restarts = []
    const context = {
      file: source,
      server: {
        restart: (force) => {
          restarts.push(force)
          return Promise.resolve()
        }
      }
    }
    await fs.appendFile(source, 'export const unrelated = 1\n')
    assert.equal(imports.handleHotUpdate(context), undefined)
    assert.deepEqual(restarts, [])
    await fs.appendFile(source, "import { Plus } from 'lucide-react'\n")
    assert.deepEqual(imports.handleHotUpdate(context), [])
    assert.deepEqual(restarts, [true], 'new icon imports force a fresh optimized dependency')
    imports = iconImports('lucide-react')
    assert.equal(imports.handleHotUpdate(context), undefined)
    assert.deepEqual(new Set(await names()), new Set(['Check', 'Plus']))
    for (const declaration of [
      "import * as Icons from 'lucide-react'",
      "const icons = import('lucide-react')",
      "export * from 'lucide-react'",
      "export * as Icons from 'lucide-react'",
      "import { icons } from 'lucide-react'"
    ]) {
      await fs.writeFile(source, declaration)
      assert.equal(iconImports('lucide-react').preserveAll, true, declaration)
      assert.ok((await names()).includes('icons'), 'namespace consumers retain the complete API')
    }
    await fs.writeFile(source, "import { Check } from 'lucide-react'")
    await fs.writeFile(
      path.join(project, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/widget': { peerDependencies: { 'lucide-react': '*' } }
        }
      })
    )
    assert.ok((await names()).includes('icons'), 'third-party consumers retain the complete API')

    // Reproduce additions made while the dev server is stopped. HMR cannot
    // invalidate that disk cache, and Vite hashes optimizer plugins by name.
    await fs.writeFile(path.join(project, 'package-lock.json'), JSON.stringify({ packages: {} }))
    await fs.writeFile(source, "import { Check } from 'lucide-react'\n")
    const { resolveConfig, optimizeDeps } = await import('vite')
    const optimizedNames = async (metadata, name) => {
      const code = await fs.readFile(metadata.optimized[name].file, 'utf8')
      const ast = require('@babel/core').parseSync(code, { sourceType: 'module' })
      return ast.program.body
        .filter((node) => node.type === 'ExportNamedDeclaration')
        .flatMap((node) =>
          node.specifiers.map((specifier) => specifier.exported.name ?? specifier.exported.value)
        )
    }
    const optimize = async () => {
      const config = await resolveConfig(
        {
          configFile: false,
          root: project,
          cacheDir: path.join(project, '.vite'),
          logLevel: 'silent',
          plugins: [staticIcons(), animatedIcons()],
          optimizeDeps: { noDiscovery: true, include: ['lucide-react', 'lucide-animated'] }
        },
        'serve'
      )
      return optimizeDeps(config)
    }
    const first = await optimize()
    assert.ok(!(await optimizedNames(first, 'lucide-react')).includes('MoreHorizontal'))
    await fs.appendFile(source, "import { MoreHorizontal } from 'lucide-react'\n")
    const second = await optimize()
    assert.notEqual(first.configHash, second.configHash)
    assert.ok(
      (await optimizedNames(second, 'lucide-react')).includes('MoreHorizontal'),
      'restarting with a new icon must rebuild the cached dependency'
    )
    await fs.appendFile(source, "import { PlusIcon } from 'lucide-animated'\n")
    const third = await optimize()
    assert.notEqual(second.configHash, third.configHash)
    assert.ok(
      (await optimizedNames(third, 'lucide-animated')).includes('PlusIcon'),
      'animated icon additions must also rebuild the cached dependency'
    )
    const unchanged = await optimize()
    assert.equal(unchanged.hash, third.hash, 'unchanged imports reuse the dependency cache')
    await fs.rm(source)
    assert.equal(
      imports.handleHotUpdate(context),
      undefined,
      'removed source files do not break HMR'
    )
    console.log(
      'Icon dependency checks passed: aliases, type imports, HMR, cached restarts, new exports, namespace/dynamic imports, third-party consumers, and removed files.'
    )
  } finally {
    process.chdir(originalCwd)
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

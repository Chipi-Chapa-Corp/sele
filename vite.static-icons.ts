import { readFileSync } from 'node:fs'
import { transformAsync } from '@babel/core'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import type { Plugin } from 'vite'
import { iconImports } from './vite.icon-imports'

/** Prebundle one icon module, exposing the imports used by this renderer. */
export function staticIcons(): Plugin {
  // A third-party consumer can use exports outside our source scan. Preserve
  // the full API when any installed dependency declares this icon package.
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const thirdParty = Object.entries(lock.packages ?? {}).some(([name, entry]) => {
    const pkg = entry as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    return (
      !!name && !!(pkg.dependencies?.['lucide-react'] || pkg.peerDependencies?.['lucide-react'])
    )
  })
  const imports = iconImports('lucide-react', thirdParty)
  let cached: Promise<string | null> | undefined
  const subset = (source: string): Promise<string | null> =>
    (cached ??= transformAsync(source, {
      babelrc: false,
      configFile: false,
      plugins: [
        () => ({
          visitor: {
            ExportNamedDeclaration(path) {
              if (imports.preserveAll) return
              path.node.specifiers = path.node.specifiers.filter((specifier) =>
                imports.used.has(
                  specifier.exported.type === 'Identifier'
                    ? specifier.exported.name
                    : specifier.exported.value
                )
              )
              if (!path.node.specifiers.length && !path.node.declaration) path.remove()
            },
            ImportDeclaration(path) {
              if (!imports.preserveAll && path.node.source.value === './icons/index.mjs')
                path.remove()
            }
          }
        })
      ]
    }).then((result) => result?.code ?? null))
  const dependencyPlugin: EsbuildPlugin = {
    name: 'sele:static-icons',
    setup(build) {
      build.onLoad(
        { filter: /lucide-react[\\/]dist[\\/]esm[\\/]lucide-react\.mjs$/ },
        async ({ path }) => ({
          contents: (await subset(readFileSync(path, 'utf8'))) ?? readFileSync(path, 'utf8'),
          loader: 'js'
        })
      )
    }
  }
  return {
    name: 'sele:static-icons',
    config() {
      return { optimizeDeps: { esbuildOptions: { plugins: [dependencyPlugin] } } }
    },
    async transform(code, id) {
      if (!/[\\/]lucide-react[\\/]dist[\\/]esm[\\/]lucide-react\.mjs$/.test(id)) return
      return await subset(code)
    },
    handleHotUpdate: imports.handleHotUpdate
  }
}

import { readFileSync } from 'node:fs'
import { transformAsync } from '@babel/core'
import { build, type Plugin as EsbuildPlugin } from 'esbuild'
import type { Plugin } from 'vite'
import { iconImports } from './vite.icon-imports'

/** lucide-animated's generated barrel has impure forwardRef/displayName pairs. */
export function animatedIcons(): Plugin {
  const imports = iconImports('lucide-animated')
  const { used, preserveAll, root } = imports
  let cached: Promise<string | null> | undefined
  const subset = (source: string): Promise<string | null> => {
    cached ??= transformAsync(source, {
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [
        ({ types: t }) => ({
          visitor: {
            Program(path) {
              for (const statement of path.get('body')) {
                if (!preserveAll && statement.isExportNamedDeclaration()) {
                  statement.node.specifiers = statement.node.specifiers.filter((specifier) => {
                    const name = t.isIdentifier(specifier.exported)
                      ? specifier.exported.name
                      : specifier.exported.value
                    return used.has(name)
                  })
                }
                if (!statement.isExpressionStatement()) continue
                const assignment = statement.node.expression
                if (
                  !t.isAssignmentExpression(assignment) ||
                  !t.isMemberExpression(assignment.left) ||
                  !t.isIdentifier(assignment.left.object) ||
                  !t.isIdentifier(assignment.left.property, { name: 'displayName' }) ||
                  !t.isStringLiteral(assignment.right)
                )
                  continue
                const binding = path.scope.getBinding(assignment.left.object.name)
                if (!binding?.path.isVariableDeclarator()) continue
                const init = binding.path.node.init
                if (
                  !t.isCallExpression(init) ||
                  !t.isIdentifier(init.callee) ||
                  !/^forwardRef\d*$/.test(init.callee.name)
                )
                  continue
                // Keep names on retained icons, while letting unused components
                // disappear together with their otherwise observable assignment.
                t.addComment(init, 'leading', '#__PURE__')
                const named = t.callExpression(
                  t.memberExpression(t.identifier('Object'), t.identifier('assign')),
                  [
                    init,
                    t.objectExpression([
                      t.objectProperty(t.identifier('displayName'), assignment.right)
                    ])
                  ]
                )
                t.addComment(named, 'leading', '#__PURE__')
                binding.path.node.init = named
                statement.remove()
              }
            }
          }
        })
      ]
    }).then(async (result) => {
      if (!result?.code) return null
      // Vite intentionally ignores purity annotations in dependency bundles.
      // Shake only this library first, without changing that policy globally.
      const bundled = await build({
        stdin: { contents: result.code, resolveDir: root, sourcefile: 'lucide-animated.js' },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        minifySyntax: true,
        external: ['react', 'react/jsx-runtime', 'motion/react']
      })
      const cleaned = await transformAsync(bundled.outputFiles[0].text, {
        babelrc: false,
        configFile: false,
        compact: true,
        plugins: [
          () => ({
            visitor: {
              ImportDeclaration(path) {
                path.node.specifiers = path.node.specifiers.filter(
                  (specifier) => path.scope.getBinding(specifier.local.name)?.referenced
                )
                if (!path.node.specifiers.length) path.remove()
              }
            }
          })
        ]
      })
      return cleaned?.code ?? bundled.outputFiles[0].text
    })
    return cached
  }
  const dependencyPlugin: EsbuildPlugin = {
    name: 'sele:animated-icons',
    setup(build) {
      build.onLoad({ filter: /lucide-animated[\\/]dist[\\/]index\.js$/ }, async ({ path }) => ({
        contents: (await subset(readFileSync(path, 'utf8'))) ?? readFileSync(path, 'utf8'),
        loader: 'js'
      }))
    }
  }
  return {
    name: 'sele:animated-icons',
    config() {
      return { optimizeDeps: { esbuildOptions: { plugins: [dependencyPlugin] } } }
    },
    async transform(code, id) {
      if (!/[\\/]lucide-animated[\\/]dist[\\/]index\.js$/.test(id)) return
      return await subset(code)
    },
    handleHotUpdate: imports.handleHotUpdate
  }
}

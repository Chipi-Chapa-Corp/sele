import type { Plugin } from 'vite'

/** Track custom hook signatures even in modules that contain no JSX/components. */
export const hookRefresh = (): Plugin => ({
  name: 'sele:hook-refresh',
  apply: 'serve',
  enforce: 'post',
  async transform(code, id, options) {
    const file = id.split('?')[0]
    if (options?.ssr || !/\.tsx?$/.test(file) || /node_modules|\/\.vite\//.test(file)) return
    let transformed = code
    let map
    // plugin-react only runs its Refresh transform on JSX modules. Without a
    // signature, adding a state hook in a .ts dependency reuses incompatible state.
    if (file.endsWith('.ts') && /\buse[A-Z]\w*\s*(?:=|\()/.test(code)) {
      const { transformAsync } = await import('@babel/core')
      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        plugins: [['react-refresh/babel', { skipEnvCheck: true }]],
        sourceMaps: true
      })
      if (result?.code) {
        transformed = result.code
        map = result.map
      }
    }
    // Hook-only .tsx modules also have signatures but no component registration,
    // so plugin-react does not supply its scoped signature function there either.
    if (!transformed.includes('$RefreshSig$(') || transformed.includes('function $RefreshSig$('))
      return
    return {
      code: `${transformed}
import {createSignatureFunctionForTransform as __seleHookSignature} from '/@react-refresh';
function $RefreshSig$() { return __seleHookSignature(); }
`,
      map
    }
  }
})

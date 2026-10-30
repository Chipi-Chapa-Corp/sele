const path = require('node:path')

// Match electron-vite's ?nodeWorker factory in Node/Electron fixture bundles.
module.exports = (directory) => ({
  name: 'fixture-node-workers',
  setup(build) {
    build.onResolve({ filter: /\?nodeWorker$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?nodeWorker$/, '.ts')),
      namespace: 'fixture-node-worker'
    }))
    build.onLoad({ filter: /.*/, namespace: 'fixture-node-worker' }, async (args) => {
      const outfile = path.join(directory, `${path.basename(args.path, '.ts')}.cjs`)
      await require('esbuild').build({
        entryPoints: [args.path],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        plugins: [
          {
            name: 'worker-native-sqlite',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ],
        outfile
      })
      return {
        contents: `import {Worker} from 'node:worker_threads'; export default options => new Worker(${JSON.stringify(outfile)}, options);`,
        loader: 'js'
      }
    })
  }
})

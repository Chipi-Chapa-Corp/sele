const path = require('node:path')
// Vite's worker import, with a real worker in disposable esbuild GUI fixtures.
module.exports = (directory) => ({
  name: 'pasted-image-worker',
  setup(build) {
    build.onResolve({ filter: /pastedImage\.worker\?worker$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace('?worker', '.ts')),
      namespace: 'pasted-image-worker'
    }))
    build.onLoad({ filter: /.*/, namespace: 'pasted-image-worker' }, async ({ path: entry }) => {
      await require('esbuild').build({
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        outfile: path.join(directory, 'pasted-image.worker.js')
      })
      return {
        contents: `export default class extends Worker {constructor(){super(new URL('pasted-image.worker.js',document.baseURI))}}`
      }
    })
  }
})

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [suite = 'unit', ...args] = process.argv.slice(2)
const suites = ['unit', 'integration', 'ui', 'runtime', 'native']
const list = args.includes('--list')
const filters = args.filter(arg => arg !== '--list').map(arg => arg.toLowerCase())
const integration = new Set(['database', 'diff-viewer-dependencies', 'icon-imports'])
const runtime = new Set(['claude-discovery', 'codex-account-handoff'])

function walk(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? walk(file) : [file]
  })
}

function matches(file) {
  return !filters.length || filters.some(filter => file.toLowerCase().includes(filter))
}

function run(command, args, timeout) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout })
  if (result.error) console.error(result.error.message)
  return result.status === 0 && !result.error
}

if (!suites.includes(suite) || filters.some(filter => filter.startsWith('-'))) {
  console.error(`Usage: node scripts/tests/run.mjs <${suites.join('|')}> [--list] [file filters...]`)
  process.exit(1)
}

let files
if (suite === 'unit') {
  files = walk('src').filter(file => file.endsWith('.test.mjs'))
} else if (suite === 'native') {
  files = ['scripts/tests/test-native-computer.py']
} else {
  files = readdirSync(path.join(root, 'scripts/tests'))
    .filter(name => /^test-.*\.(cjs|mjs)$/.test(name))
    .filter(name => {
      const id = name.replace(/^test-|\.(cjs|mjs)$/g, '')
      return suite === 'integration' ? integration.has(id)
        : suite === 'runtime' ? runtime.has(id)
          : !integration.has(id) && !runtime.has(id)
    })
    .map(name => `scripts/tests/${name}`)
}
files = files.filter(matches).sort()
if (!files.length) {
  console.error(`No ${suite} tests matched: ${filters.join(', ')}`)
  process.exit(1)
}
if (list) {
  console.log(files.join('\n'))
  process.exit(0)
}

if (process.platform === 'linux' && ['ui', 'native'].includes(suite) &&
    (!process.env.ISOLATED_GUI_SESSION || !process.env.DISPLAY ||
      !process.env.DBUS_SESSION_BUS_ADDRESS || process.env.WAYLAND_DISPLAY)) {
  console.error('Run this suite through isolated-gui on a private display and D-Bus session; see README.md.')
  process.exit(1)
}

// GUI isolation is supplied by the caller: see README.md. Never launch a GUI
// implicitly as part of the default suite or fall back to the user's desktop.
console.log(`Running ${files.length} ${suite} test files.`)
if (suite === 'unit') {
  process.exit(run(process.execPath, [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types',
    '--test', '--test-concurrency=4', '--test-timeout=30000', ...files
  ], 600000) ? 0 : 1)
}

const failures = []
for (const file of files) {
  console.log(`\n=== ${file} ===`)
  const directElectron = file.endsWith('/test-touch-buttons.cjs')
  const command = suite === 'native' ? '/usr/bin/python3'
    : directElectron ? fileURLToPath(new URL('../../node_modules/electron/cli.js', import.meta.url))
      : process.execPath
  const childArgs = directElectron ? [command, file, '--no-sandbox'] : [file]
  if (!run(directElectron ? process.execPath : command, childArgs, 180000)) failures.push(file)
}
console.log(`\n${files.length - failures.length}/${files.length} ${suite} files passed.`)
if (failures.length) console.error(`Failed:\n${failures.join('\n')}`)
process.exitCode = failures.length ? 1 : 0

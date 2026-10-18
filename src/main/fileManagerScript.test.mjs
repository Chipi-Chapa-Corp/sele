import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { getFileManagerUri, showItemsScript } from './fileManagerScript.ts'

test('file manager URIs percent-encode characters that break D-Bus arguments', () => {
  assert.equal(getFileManagerUri('/home/me/a b.png'), 'file:///home/me/a%20b.png')
  assert.equal(
    getFileManagerUri('/tmp/x,y/"q"\\#é.mp4'),
    'file:///tmp/x%2Cy/%22q%22%5C%23%C3%A9.mp4'
  )
})

const mockFileManager = `
import sys
from gi.repository import Gio, GLib
node = Gio.DBusNodeInfo.new_for_xml('''<node><interface name="org.freedesktop.FileManager1">
<method name="ShowItems"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>''')
def call(conn, sender, path, iface, method, params, invocation):
    with open(sys.argv[1], 'a') as out:
        out.write(repr(params.unpack()[0]) + '\\n')
    invocation.return_value(None)
def acquired(conn, name):
    conn.register_object('/org/freedesktop/FileManager1', node.interfaces[0], call, None, None)
def owned(conn, name):
    print('ready', flush=True)
Gio.bus_own_name(Gio.BusType.SESSION, 'org.freedesktop.FileManager1', 0, acquired, owned, None)
GLib.MainLoop().run()
`

const hasMockDependencies =
  process.platform === 'linux' &&
  spawnSync('sh', ['-c', 'command -v dbus-daemon && command -v gdbus']).status === 0 &&
  spawnSync('python3', ['-c', 'from gi.repository import Gio']).status === 0

test('the reveal script asks FileManager1 to select the file', {
  skip: !hasMockDependencies && 'needs dbus-daemon, gdbus, and PyGObject'
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sele-file-manager-'))
  const daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'])
  let mock
  try {
    const address = await new Promise((resolve) =>
      daemon.stdout.once('data', (chunk) => resolve(chunk.toString().trim()))
    )
    // Never let a failed D-Bus call fall through to a real xdg-open on the desktop.
    const binPath = join(directory, 'bin')
    mkdirSync(binPath)
    writeFileSync(join(binPath, 'xdg-open'), '#!/bin/sh\necho "xdg-open $1" >&2\nexit 7\n', {
      mode: 0o755
    })
    const env = {
      ...process.env,
      DBUS_SESSION_BUS_ADDRESS: address,
      PATH: `${binPath}:${process.env.PATH}`
    }
    const mockPath = join(directory, 'mock.py')
    const callsPath = join(directory, 'calls.txt')
    writeFileSync(mockPath, mockFileManager)
    mock = spawn('python3', ['-I', mockPath, callsPath], { env })
    await new Promise((resolve) => mock.stdout.once('data', resolve))

    const filePath = '/tmp/odd dir/x,y "q".png'
    const uri = getFileManagerUri(filePath)
    execFileSync('sh', ['-c', showItemsScript, 'sele-test', uri, '/tmp/odd dir'], { env })
    assert.equal(readFileSync(callsPath, 'utf8'), `['${uri}']\n`)
    assert.equal(decodeURIComponent(new URL(uri).pathname), filePath)

    // Without gdbus, dbus-send must deliver the same single URI.
    writeFileSync(callsPath, '')
    execFileSync(
      'sh',
      ['-c', `gdbus() { return 1; }\n${showItemsScript}`, 'sele-test', uri, '/tmp/odd dir'],
      { env }
    )
    assert.equal(readFileSync(callsPath, 'utf8'), `['${uri}']\n`)
  } finally {
    mock?.kill()
    daemon.kill()
    rmSync(directory, { recursive: true, force: true })
  }
})

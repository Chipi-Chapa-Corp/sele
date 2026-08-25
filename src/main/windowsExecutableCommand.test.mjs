import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWindowsExecutableCommand } from './windowsExecutableCommand.ts'

test('wraps Windows command launchers with the configured command shell', () => {
  const command = {
    file: 'C:\\Users\\Example User\\AppData\\Roaming\\npm\\opencode.cmd',
    args: ['--version'],
    cwd: 'C:\\Users\\Example User',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
  }

  assert.deepEqual(normalizeWindowsExecutableCommand(command, 'win32'), {
    ...command,
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'call', command.file, '--version']
  })
})

test('matches Windows batch extensions case-insensitively', () => {
  const command = { file: 'C:\\tools\\provider.BAT', args: [], env: { COMSPEC: 'cmd.exe' } }

  assert.deepEqual(normalizeWindowsExecutableCommand(command, 'win32'), {
    ...command,
    file: 'cmd.exe',
    args: ['/d', '/s', '/c', 'call', command.file]
  })
})

test('leaves native executables and non-Windows commands unchanged', () => {
  const executable = { file: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', args: ['-V'] }
  const posixCommand = { file: '/usr/bin/provider.cmd', args: ['--version'] }

  assert.equal(normalizeWindowsExecutableCommand(executable, 'win32'), executable)
  assert.equal(normalizeWindowsExecutableCommand(posixCommand, 'linux'), posixCommand)
})

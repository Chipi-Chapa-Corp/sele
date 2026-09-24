import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join, posix, resolve } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import { isExpectedFileAbsenceError } from '../../../shared/expectedAbsence'
import { getHostCommand, type HostCommand, isRunningInFlatpak } from '../../hostProcess'
import { getCurrentContainerHostBridge } from '../../currentContainer'
import type { ClaudeAccountStorage } from './ClaudeAccountStore'

export const runClaudeAccountCommand = (command: HostCommand): Promise<string> =>
  new Promise((resolveResult, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        env: command.env,
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout) => {
        // Auth commands can print credentials/authorization URLs. Never include their output in errors.
        if (error)
          reject(new Error(`Unable to run Claude account command (${error.code ?? 'failed'}).`))
        else resolveResult(stdout)
      }
    )
    child.stdin?.end()
  })

const credentialService = (directory: string): string =>
  `Claude Code-credentials${directory ? `-${createHash('sha256').update(directory.normalize('NFC')).digest('hex').slice(0, 8)}` : ''}`

const credentialAccount = (): string => {
  const username = process.env.USER || userInfo().username
  return /^[a-zA-Z0-9._-]+$/.test(username) ? username : 'claude-code-user'
}

const readLocalKeychainEntry = (directory: string): Promise<string | null> =>
  new Promise((resolveResult, reject) => {
    execFile(
      '/usr/bin/security',
      [
        'find-generic-password',
        '-s',
        credentialService(directory),
        '-a',
        credentialAccount(),
        '-w'
      ],
      { timeout: 15_000, encoding: 'utf8', maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error?.code === 44) resolveResult(null)
        else if (error)
          reject(new Error('Unable to read Claude subscription credentials from Keychain.'))
        else resolveResult(stdout)
      }
    )
  })

const deleteLocalKeychainEntry = (directory: string): Promise<void> =>
  new Promise((resolveResult, reject) => {
    execFile(
      '/usr/bin/security',
      ['delete-generic-password', '-s', credentialService(directory), '-a', credentialAccount()],
      { timeout: 15_000, windowsHide: true },
      (error) => {
        if (error && error.code !== 44)
          reject(new Error('Unable to remove the Claude account from Keychain.'))
        else resolveResult()
      }
    )
  })

/** Native filesystem operations on Windows/macOS; host commands for remote/Flatpak targets. */
export const createClaudeAccountStorage = async (
  container?: AppContainerTarget | null
): Promise<ClaudeAccountStorage> => {
  const useHostCommands =
    container?.kind === 'container' ||
    isRunningInFlatpak() ||
    Boolean(await getCurrentContainerHostBridge())
  if (!useHostCommands) {
    const root = join(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')), 'sele')
    const registry = join(root, 'accounts.json')
    const credentialDirectory = (id: string): string => join(root, 'accounts', id)
    return {
      credentialDirectory,
      readCredentials: async (id) => {
        const directory =
          id === 'default'
            ? (process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? '')
            : credentialDirectory(id)
        if (process.platform === 'darwin') {
          const content = await readLocalKeychainEntry(directory)
          if (content !== null) return content
        }
        try {
          return await readFile(
            join(directory || join(homedir(), '.claude'), '.credentials.json'),
            'utf8'
          )
        } catch (error) {
          if (isExpectedFileAbsenceError(error)) return null
          throw new Error('Unable to read Claude subscription credentials.')
        }
      },
      usageEnvironment: async (id, env) => {
        const directory = join(root, 'usage', id)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        return {
          ...env,
          CLAUDE_CONFIG_DIR: directory,
          // Empty explicitly selects the default, unsuffixed macOS Keychain item.
          CLAUDE_SECURESTORAGE_CONFIG_DIR:
            env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR ?? ''
        }
      },
      read: async () => {
        try {
          return await readFile(registry, 'utf8')
        } catch (error) {
          if (isExpectedFileAbsenceError(error)) return null
          throw error
        }
      },
      write: async (value) => {
        await mkdir(root, { recursive: true, mode: 0o700 })
        const temporary = join(root, `.accounts-${randomUUID()}.json`)
        try {
          await writeFile(temporary, value, { mode: 0o600, flag: 'wx' })
          await rename(temporary, registry)
        } finally {
          await rm(temporary, { force: true })
        }
      },
      createCredentials: async (id) => {
        await mkdir(credentialDirectory(id), { recursive: true, mode: 0o700 })
      },
      removeCredentials: async (id) => {
        const directory = credentialDirectory(id)
        if (process.platform === 'darwin') await deleteLocalKeychainEntry(directory)
        await rm(directory, { recursive: true, force: true })
        await rm(join(root, 'usage', id), { recursive: true, force: true })
      }
    }
  }

  const run = async (script: string, args: string[] = []): Promise<string> =>
    runClaudeAccountCommand(
      await getHostCommand('sh', ['-lc', script, 'sele-claude-accounts', ...args], {
        container,
        env: process.env
      })
    )
  const fields = (
    await run(String.raw`
set -eu
root=${'${'}CLAUDE_CONFIG_DIR:-"$HOME/.claude"}
umask 077
mkdir -p "$root/sele"
cd "$root/sele"
printf '%s\0%s\0%s' "$(pwd -P)" "$(uname -s)" "${'${'}CLAUDE_SECURESTORAGE_CONFIG_DIR-${'${'}CLAUDE_CONFIG_DIR-}}"
`)
  ).split('\0')
  const root = fields[0]
  if (!root?.startsWith('/')) throw new Error('Unable to resolve the Claude account directory.')
  const registry = posix.join(root, 'accounts.json')
  const credentialDirectory = (id: string): string => posix.join(root, 'accounts', id)
  return {
    credentialDirectory,
    readCredentials: async (id) => {
      const directory = id === 'default' ? (fields[2] ?? '') : credentialDirectory(id)
      return (
        (await run(
          String.raw`
set -eu
if [ "$3" = Darwin ]; then
  user=${'${'}USER:-$(id -un)}
  case "$user" in *[!a-zA-Z0-9._-]*|'') user=claude-code-user;; esac
  result=0
  /usr/bin/security find-generic-password -s "$2" -a "$user" -w 2>/dev/null || result=$?
  [ "$result" -ne 0 ] || exit 0
  [ "$result" -eq 44 ] || exit "$result"
fi
directory=${'${'}1:-"$HOME/.claude"}
if [ -f "$directory/.credentials.json" ]; then cat "$directory/.credentials.json"; fi
`,
          [directory, credentialService(directory), fields[1]]
        )) || null
      )
    },
    usageEnvironment: async (id, env) => {
      const directory = posix.join(root, 'usage', id)
      await run('set -eu; umask 077; mkdir -p "$1"', [directory])
      return {
        ...env,
        CLAUDE_CONFIG_DIR: directory,
        CLAUDE_SECURESTORAGE_CONFIG_DIR: env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? fields[2] ?? ''
      }
    },
    read: async () => (await run('if [ -e "$1" ]; then cat "$1"; fi', [registry])) || null,
    write: async (value) => {
      await run(
        String.raw`
set -eu
umask 077
tmp="$1.tmp.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
printf '%s' "$2" > "$tmp"
mv -f "$tmp" "$1"
`,
        [registry, value]
      )
    },
    createCredentials: async (id) => {
      await run('set -eu; umask 077; mkdir -p "$1"', [credentialDirectory(id)])
    },
    removeCredentials: async (id) => {
      const directory = credentialDirectory(id)
      if (fields[1] === 'Darwin') {
        await run(
          String.raw`
user=${'${'}USER:-$(id -un)}
case "$user" in *[!a-zA-Z0-9._-]*|'') user=claude-code-user;; esac
/usr/bin/security delete-generic-password -s "$1" -a "$user" >/dev/null 2>&1
result=$?
[ "$result" -eq 0 ] || [ "$result" -eq 44 ]
`,
          [credentialService(directory)]
        )
      }
      await run('rm -rf -- "$1"', [directory])
      await run('rm -rf -- "$1"', [posix.join(root, 'usage', id)])
    }
  }
}

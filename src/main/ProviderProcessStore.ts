import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { AppContainerTarget } from '../shared/app'
import type { ProviderId } from '../shared/provider'
import { getContainerTargetKey } from './containerTarget.ts'

export type ProviderProcessGroup = {
  id: string
  providerId: ProviderId
  chatId: string | null
  container: AppContainerTarget | null
  status: 'tracked' | 'unavailable'
  reason: string | null
  processes: { pid: number; command: string; cwd: string | null; logs: string[] }[]
}

export type ProviderProcessRecord = {
  id: string
  providerId: ProviderId
  accountId: string | null
  chatId: string | null
  container: AppContainerTarget | null
  units: string[]
  gate: string | null
  stopped: boolean
  unavailable: string | null
}
export type ProviderProcessScope = {
  /** Source metadata used only while constructing a separate fork runtime. */
  sourceChatId?: string
  record: ProviderProcessRecord
  bind: (chatId: string) => Promise<void>
  prepare: (
    file: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv }
  ) => Promise<{ file: string; args: string[] }>
}
type Execute = (
  file: string,
  args: string[],
  container: AppContainerTarget | null
) => Promise<string>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const unitPattern = /^sele-chat-[0-9a-f-]{36}-[0-9a-f-]{36}\.service$/
const validGate = (id: string, gate: string): boolean =>
  isAbsolute(gate) &&
  basename(gate) === 'permit' &&
  basename(dirname(gate)).startsWith(`sele-chat-${id}-`)

/** Durable launch receipts, rather than process-name or environment heuristics. */
export class ProviderProcessStore {
  private records = new Map<string, ProviderProcessRecord>()
  private loading: Promise<void> | undefined
  private writes = new Map<string, Promise<void>>()
  private launches = new Map<string, Promise<void>>()
  private verified = new Set<string>()
  private preparing = new Map<string, Promise<void>>()
  private directory: string
  private execute: Execute
  constructor(directory: string, execute: Execute) {
    this.directory = directory
    this.execute = execute
  }

  private load = (): Promise<void> =>
    (this.loading ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      for (const file of await readdir(this.directory)) {
        if (!file.endsWith('.json') || !uuid.test(file.slice(0, -5))) continue
        const record = JSON.parse(
          await readFile(join(this.directory, file), 'utf8')
        ) as ProviderProcessRecord
        if (
          record.id !== file.slice(0, -5) ||
          !['codex', 'claude', 'copilot', 'opencode-v2'].includes(record.providerId) ||
          (record.chatId !== null && typeof record.chatId !== 'string') ||
          (record.accountId !== null && typeof record.accountId !== 'string') ||
          typeof record.stopped !== 'boolean' ||
          (record.gate !== null &&
            (typeof record.gate !== 'string' || !validGate(record.id, record.gate))) ||
          !Array.isArray(record.units) ||
          record.units.some(
            (unit) => !unitPattern.test(unit) || !unit.startsWith(`sele-chat-${record.id}-`)
          )
        )
          throw new Error('Invalid provider process ownership receipt.')
        this.records.set(record.id, record)
      }
    })())

  private save = (record: ProviderProcessRecord): Promise<void> => {
    const content = JSON.stringify(record)
    const pending = (this.writes.get(record.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const target = join(this.directory, `${record.id}.json`)
        const temporary = `${target}.tmp`
        await writeFile(temporary, content, { mode: 0o600 })
        await rename(temporary, target)
      })
    this.writes.set(record.id, pending)
    return pending
  }

  all = async (
    providerId: ProviderId,
    accountId: string | null
  ): Promise<ProviderProcessScope[]> => {
    await this.load()
    return [...this.records.values()]
      .filter((r) => r.providerId === providerId && r.accountId === accountId)
      .map(this.scope)
  }

  find = async (
    providerId: ProviderId,
    accountId: string | null,
    chatId: string,
    container: AppContainerTarget | null
  ): Promise<ProviderProcessScope | undefined> => {
    for (const scope of await this.all(providerId, accountId)) {
      const record = scope.record
      if (
        record.stopped ||
        record.chatId !== chatId ||
        getContainerTargetKey(record.container) !== getContainerTargetKey(container)
      )
        continue
      if (record.gate && !this.verified.has(record.id)) {
        const exists = await this.execute(
          'python3',
          [
            '-c',
            "import os,sys; print('present' if os.path.isfile(sys.argv[1]) else 'missing')",
            record.gate
          ],
          record.container
        )
        if (exists.trim() === 'missing') {
          for (const unit of record.units) {
            const state = await this.execute(
              'systemctl',
              ['--user', 'show', unit, '--property=LoadState'],
              record.container
            )
            if (!state.includes('LoadState=not-found'))
              throw new Error(
                'The launch permit is missing. Stop the existing chat process boundary before restarting it.'
              )
          }
          record.stopped = true
          await this.save(record)
          continue
        }
        if (exists.trim() !== 'present')
          throw new Error('Unable to verify the process launch permit.')
        this.verified.add(record.id)
      }
      return scope
    }
    return undefined
  }

  create = async (
    providerId: ProviderId,
    accountId: string | null,
    container: AppContainerTarget | null
  ): Promise<ProviderProcessScope> => {
    await this.load()
    const record: ProviderProcessRecord = {
      id: randomUUID(),
      providerId,
      accountId,
      chatId: null,
      container,
      units: [],
      gate: null,
      stopped: false,
      unavailable: null
    }
    this.records.set(record.id, record)
    await this.save(record)
    return this.scope(record)
  }

  private serializeLaunch = <T>(id: string, run: () => Promise<T>): Promise<T> => {
    const pending = (this.launches.get(id) ?? Promise.resolve()).then(run)
    const completed = pending.then(
      () => {},
      () => {}
    )
    this.launches.set(id, completed)
    void completed.then(() => {
      if (this.launches.get(id) === completed) this.launches.delete(id)
    })
    return pending
  }

  private scope = (record: ProviderProcessRecord): ProviderProcessScope => ({
    record,
    bind: async (chatId) => {
      if (record.chatId && record.chatId !== chatId)
        throw new Error('A process boundary cannot belong to two chats.')
      record.chatId = chatId
      await this.save(record)
    },
    prepare: (file, args, options) =>
      this.serializeLaunch(record.id, async () => {
        if (record.stopped) throw new Error('This chat process boundary has been stopped.')
        if (record.unavailable) return { file, args }
        // Probe in the execution environment, including the host outside Flatpak.
        // Requiring ExitType=cgroup keeps detached descendants alive after the CLI exits.
        try {
          const version = await this.execute('systemd-run', ['--version'], record.container)
          if (Number(/systemd (\d+)/.exec(version)?.[1] ?? 0) < 250)
            throw new Error('systemd 250 or newer is required.')
          await this.execute('systemctl', ['--user', 'show-environment'], record.container)
          await this.execute(
            'python3',
            [
              '-c',
              "from pathlib import Path; assert Path('/sys/fs/cgroup/cgroup.controllers').is_file(), 'cgroup v2 is required'"
            ],
            record.container
          )
        } catch {
          if (record.stopped) throw new Error('This chat process boundary has been stopped.')
          if (record.units.length)
            throw new Error(
              'The chat process manager is unavailable; refusing an untracked launch.'
            )
          record.unavailable =
            'Process tracking requires Linux cgroup v2, Python 3, and a reachable user systemd manager (version 250 or newer).'
          await this.save(record)
          return { file, args }
        }
        if (record.stopped) throw new Error('This chat process boundary has been stopped.')
        if (!record.gate) {
          // The permit lives in the target filesystem. Removing it before cleanup
          // also prevents a delayed systemd start from running after cleanup.
          const pending =
            this.preparing.get(record.id) ??
            this.execute(
              'python3',
              [
                '-c',
                "import os,tempfile; d=tempfile.mkdtemp(prefix='sele-chat-' + __import__('sys').argv[1] + '-'); p=os.path.join(d,'permit'); open(p,'x').close(); print(p)",
                record.id
              ],
              record.container
            ).then((gate) => {
              const path = gate.trim()
              if (!validGate(record.id, path)) throw new Error('Invalid process launch permit.')
              record.gate = path
            })
          this.preparing.set(record.id, pending)
          await pending
        }
        if (record.stopped) throw new Error('This chat process boundary has been stopped.')
        const unit = `sele-chat-${record.id}-${randomUUID()}.service`
        record.units.push(unit)
        // Persist before launching; a crash cannot leave an unrecorded owned service.
        await this.save(record)
        return {
          file: 'systemd-run',
          args: [
            '--user',
            '--pipe',
            '--wait',
            '--collect',
            '--quiet',
            '--expand-environment=no',
            `--unit=${unit}`,
            `--property=ConditionPathExists=${record.gate}`,
            '--property=ExitType=cgroup',
            '--property=KillMode=control-group',
            '--property=TimeoutStopSec=5s',
            ...(record.providerId === 'codex' &&
            options.env?.SELE_DISABLE_CODEX_RESOURCE_ISOLATION !== '1'
              ? [
                  '--property=CPUWeight=25',
                  '--property=IOWeight=25',
                  '--property=MemoryHigh=2G',
                  '--property=OOMScoreAdjust=500'
                ]
              : []),
            ...(options.cwd ? [`--working-directory=${options.cwd}`] : []),
            ...Object.entries(options.env ?? process.env).flatMap(([key, value]) =>
              value !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? [`--setenv=${key}`] : []
            ),
            '--',
            file,
            ...args
          ]
        }
      })
  })

  list = async (providerId?: ProviderId, chatId?: string): Promise<ProviderProcessGroup[]> => {
    await this.load()
    const groups: ProviderProcessGroup[] = []
    for (const record of this.records.values()) {
      if ((providerId && record.providerId !== providerId) || (chatId && record.chatId !== chatId))
        continue
      const group: ProviderProcessGroup = {
        id: record.id,
        providerId: record.providerId,
        chatId: record.chatId,
        container: record.container,
        status: record.unavailable ? 'unavailable' : 'tracked',
        reason: record.unavailable,
        processes: []
      }
      try {
        for (const unit of record.units) {
          const state = await this.execute(
            'systemctl',
            ['--user', 'show', unit, '--property=LoadState', '--property=ControlGroup'],
            record.container
          )
          if (state.includes('LoadState=not-found')) continue
          const cgroup = /^ControlGroup=(.+)$/m.exec(state)?.[1]
          if (!cgroup) continue
          const output = await this.execute(
            'python3',
            ['-c', processListSource, cgroup],
            record.container
          )
          group.processes.push(...JSON.parse(output))
        }
      } catch (error) {
        group.status = 'unavailable'
        group.reason = error instanceof Error ? error.message : String(error)
      }
      if (group.processes.length || group.status === 'unavailable' || !record.units.length)
        groups.push(group)
    }
    return groups
  }

  stop = async (id: string): Promise<void> => {
    await this.load()
    const record = this.records.get(id)
    if (!record) throw new Error('Unknown provider process boundary.')
    if (record.unavailable) throw new Error(record.unavailable)
    record.stopped = true
    // Reject new launches before awaiting anything. Even an in-flight prepare
    // must publish its gate before cleanup removes the target-side permit.
    await this.launches.get(record.id)
    await this.preparing.get(record.id)
    await this.save(record)
    const failures: unknown[] = []
    if (record.gate) {
      try {
        await this.execute(
          'python3',
          ['-c', 'import os,sys; p=sys.argv[1]; os.path.exists(p) and os.unlink(p)', record.gate],
          record.container
        )
      } catch (error) {
        failures.push(error)
      }
    }
    for (const unit of record.units) {
      try {
        const state = await this.execute(
          'systemctl',
          ['--user', 'show', unit, '--property=LoadState'],
          record.container
        )
        if (state.includes('LoadState=not-found')) continue
        try {
          await this.execute('systemctl', ['--user', 'stop', unit], record.container)
        } catch (error) {
          const current = await this.execute(
            'systemctl',
            ['--user', 'show', unit, '--property=LoadState'],
            record.container
          )
          if (!current.includes('LoadState=not-found')) throw error
        }
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Unable to stop all owned process services.')
  }

  stopChat = async (chatIds: string[], container: AppContainerTarget | null): Promise<void> => {
    await this.load()
    const failures: unknown[] = []
    for (const record of this.records.values()) {
      if (
        record.chatId &&
        chatIds.includes(record.chatId) &&
        !record.unavailable &&
        getContainerTargetKey(record.container) === getContainerTargetKey(container)
      ) {
        try {
          await this.stop(record.id)
        } catch (error) {
          failures.push(error)
        }
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Unable to stop all chat process boundaries.')
  }
}

// Membership comes only from the recorded service's kernel cgroup. Inspecting a
// member's command and file descriptors supplies display data, never ownership.
export const processListSource = String.raw`
import json, os, stat, sys
from pathlib import Path
root = Path('/sys/fs/cgroup')
group = (root / sys.argv[1].lstrip('/')).resolve()
if not group.is_relative_to(root):
    raise RuntimeError('Invalid cgroup path')
if not group.is_dir():
    raise RuntimeError('The process cgroup is not visible in this execution environment')
result = []
seen = set()
for members in group.rglob('cgroup.procs'):
    try: values = members.read_text().split()
    except FileNotFoundError: continue
    for value in values:
        pid = int(value)
        if pid in seen: continue
        seen.add(pid)
        proc = Path('/proc') / value
        try:
            # Read membership again after opening /proc: do not display a reused PID.
            if not any(line.rstrip().endswith(':' + sys.argv[1]) or
                       line.rstrip().split(':', 2)[-1].startswith(sys.argv[1].rstrip('/') + '/')
                       for line in (proc / 'cgroup').read_text().splitlines()): continue
            command = (proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace').strip()
            try: cwd = os.readlink(proc / 'cwd')
            except OSError: cwd = None
            logs = []
            for fd in ('1', '2'):
                try:
                    path = proc / 'fd' / fd
                    target = os.readlink(path)
                    if target.startswith('/') and stat.S_ISREG(path.stat().st_mode) and target not in logs:
                        logs.append(target)
                except OSError: pass
            result.append(dict(pid=pid, command=command, cwd=cwd, logs=logs))
        except (FileNotFoundError, ProcessLookupError, PermissionError): pass
print(json.dumps(result))
`

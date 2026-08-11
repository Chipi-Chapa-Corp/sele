import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getAppActionsForProject, normalizeAppActions } from './actions.ts'

const commandAction = {
  id: 'action-id',
  type: 'command',
  name: 'Run checks',
  icon: 'play',
  keybinding: null,
  command: 'npm test',
  openInTerminal: true,
  closeTerminalOnFinish: false
}

test('normalizes existing actions as global actions', () => {
  const [action] = normalizeAppActions([commandAction])

  assert.equal(action.scope, 'global')
  assert.equal(action.projectCwd, null)
})

test('keeps valid project action scopes and rejects project scopes without a project', () => {
  const [projectAction, invalidProjectAction] = normalizeAppActions([
    { ...commandAction, id: 'project', scope: 'project', projectCwd: ' /work/sele ' },
    { ...commandAction, id: 'invalid-project', scope: 'project' }
  ])

  assert.equal(projectAction.scope, 'project')
  assert.equal(projectAction.projectCwd, '/work/sele')
  assert.equal(invalidProjectAction.scope, 'global')
  assert.equal(invalidProjectAction.projectCwd, null)
})

test('returns global actions and actions for only the active project', () => {
  const actions = normalizeAppActions([
    { ...commandAction, id: 'global' },
    { ...commandAction, id: 'sele', scope: 'project', projectCwd: '/work/sele' },
    { ...commandAction, id: 'other', scope: 'project', projectCwd: '/work/other' }
  ])

  assert.deepEqual(
    getAppActionsForProject(actions, '/work/sele').map((action) => action.id),
    ['global', 'sele']
  )
  assert.deepEqual(
    getAppActionsForProject(actions, null).map((action) => action.id),
    ['global']
  )
})

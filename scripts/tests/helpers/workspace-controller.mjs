import { readdirSync, readFileSync } from 'node:fs'
import vm from 'node:vm'

const renderer = new URL('../../../src/renderer/src/', import.meta.url)
const directories = ['state', 'features', 'wiring', 'presentation', 'composition']

// These tests execute selected real callbacks in a VM, without opening provider sessions.
// Find those declarations in their feature modules after controller decomposition.
export const readWorkspaceControllerSource = () =>
  directories
    .flatMap((directory) => {
      const root = new URL(`workspace/${directory}/`, renderer)
      return readdirSync(root)
        .filter((name) => /\.tsx?$/.test(name))
        .sort()
        .map((name) => readFileSync(new URL(name, root), 'utf8'))
    })
    .join('\n')

// Existing VM fixtures provide flat state. Give the extracted callbacks access to that
// same fixture through the domain namespaces used by the running application.
const namespaces = [
  'preferences',
  'providerState',
  'dialogState',
  'chatState',
  'sourceState',
  'projectState',
  'searchState',
  'gitState',
  'subagentState',
  'viewportState',
  'settings',
  'provider',
  'panes',
  'resourceRefresh',
  'scroll',
  'chatCache',
  'chrome',
  'browser',
  'providerUpdates',
  'catalogs',
  'chatProjection',
  'chatRead',
  'session',
  'sidebarModel',
  'projectResources',
  'projectCatalog',
  'sourceControls',
  'accountActions',
  'resourceActions',
  'gitModels',
  'effectiveSelection',
  'settingsOptions',
  'sidebarActions',
  'navigation',
  'chatPreset',
  'settingsActions',
  'chatErrors',
  'listActions',
  'messaging',
  'interactions',
  'conversation',
  'changes',
  'gitPresentation',
  'files',
  'gitSync',
  'commits',
  'subagents',
  'subagentPresentation',
  'sidebarPresentation',
  'settingsPanel',
  'turnRendering'
]

export const workspaceTestGlobals = (globals) => {
  if (!('onConversationRequested' in globals)) globals.onConversationRequested = undefined
  for (const name of namespaces) {
    if (!(name in globals))
      globals[name] = new Proxy(globals, {
        get: (target, key) => target[key],
        set: (target, key, value) => {
          target[key] = value
          return true
        }
      })
  }
  return globals
}

export const createWorkspaceTestContext = (globals) =>
  vm.createContext(workspaceTestGlobals(globals))

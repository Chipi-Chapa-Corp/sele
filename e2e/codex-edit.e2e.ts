import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

const threadId = '01a0539f-bf34-7a01-a217-0a2fee104e4c'
const smallModelLabel = 'GPT 5.6 Luna'
const firstPrompt = 'Reply with exactly SELE_EDIT_E2E_INITIAL and do nothing else.'
const secondPrompt = 'Reply with exactly SELE_EDIT_E2E_EDITED and do nothing else.'
const codexExecutable = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()

const getLaunchEnvironment = (databasePath: string): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null)
  ),
  SELE_CODEX_PATH: codexExecutable,
  SELE_DATABASE_PATH: databasePath,
  SELE_DISABLE_CODEX_RESOURCE_ISOLATION: '1'
})

const launchSele = async (runDirectory: string): Promise<ElectronApplication> => {
  const repositoryRoot = resolve(__dirname, '..')
  return electron.launch({
    args: [repositoryRoot, `--user-data-dir=${join(runDirectory, 'electron')}`],
    cwd: repositoryRoot,
    env: getLaunchEnvironment(join(runDirectory, 'sele.sqlite'))
  })
}

const openThread = async (application: ElectronApplication): Promise<Page> => {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const chat = page.locator(`[data-chat-id="${threadId}"]`)
  await expect(chat).toBeVisible()
  const openButton = chat.locator('.chat-list-item__main')
  await openButton.focus()
  await openButton.press('Enter')
  await expect(page.locator('.chat-detail__message--user')).toHaveCount(1)

  return page
}

const selectSmallModel = async (page: Page): Promise<void> => {
  const settingsButton = page.locator('.message-box__chat-config-trigger')
  await expect(settingsButton).toBeEnabled()
  await settingsButton.click()

  const settings = page.getByRole('dialog', { name: 'Chat settings' })
  await settings.getByRole('button', { name: 'Model' }).click()
  const smallModel = settings.getByRole('button').filter({ hasText: smallModelLabel })
  await expect(smallModel).toBeVisible()
  await smallModel.click()
  await expect(settingsButton).toContainText(smallModelLabel)
  await page.keyboard.press('Escape')
}

test('edits a persisted Codex message', async () => {
  const runDirectory = mkdtempSync(join(tmpdir(), 'sele-codex-edit-e2e-'))
  let application: ElectronApplication | null = null

  try {
    application = await launchSele(runDirectory)
    let page = await openThread(application)
    await selectSmallModel(page)

    const userMessage = page.locator('.chat-detail__message--user').first()
    const currentPrompt = (await userMessage.innerText()).trim()
    expect([firstPrompt, secondPrompt]).toContain(currentPrompt)

    const replacementPrompt = currentPrompt === firstPrompt ? secondPrompt : firstPrompt
    const replacementAnswer =
      replacementPrompt === firstPrompt ? 'SELE_EDIT_E2E_INITIAL' : 'SELE_EDIT_E2E_EDITED'
    const userMessageBlock = page
      .locator('.chat-detail__message-block--user')
      .filter({ hasText: currentPrompt })

    await userMessageBlock.hover()
    await userMessageBlock.getByRole('button', { name: 'Edit message' }).click()

    const composer = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(composer).toHaveValue(currentPrompt)
    await composer.fill(replacementPrompt)
    await page.getByRole('button', { name: 'Save edit' }).click()

    await expect(page.locator('.chat-detail__message--user')).toHaveCount(1)
    await expect(page.locator('.chat-detail__message--user')).toHaveText(replacementPrompt)
    const replacementResponse = page
      .locator('.chat-detail__message-block--assistant')
      .filter({ hasText: replacementAnswer })
    await expect(replacementResponse).toBeVisible()

    await application.close()
    application = await launchSele(runDirectory)
    page = await openThread(application)

    await expect(page.locator('.chat-detail__message--user')).toHaveText(replacementPrompt)
    await expect(page.locator('.chat-detail__message--assistant')).toHaveText(replacementAnswer)
    await expect(page.getByText(currentPrompt, { exact: true })).toHaveCount(0)
  } finally {
    await application?.close().catch(() => {})
    rmSync(runDirectory, { recursive: true, force: true })
  }
})

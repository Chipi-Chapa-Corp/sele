const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

module.exports = async ({ runner, page, sele, providers, dirs, launch }) => {
  const cwd = dirs.work
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('symbolic-ref', 'HEAD', 'refs/heads/main')
  writeFileSync(join(cwd, '.gitignore'), 'agents/\n')
  git('add', '.gitignore', 'README.md')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'Benchmark base'
  )
  git('branch', 'fixture-upstream')
  git('branch', '--set-upstream-to=fixture-upstream', 'main')
  await page.eval(`window.appApi.addProject({cwd:${JSON.stringify(cwd)},name:'Benchmark fixture'})`)
  const launched = await launch()
  page = launched.page
  sele = launched.sele
  await page.click('[aria-label="All chats"]')

  for (const provider of providers) {
    await runner.check(
      `[${provider}] benchmark compares, votes, copies Git state, and exits`,
      async () => {
        await sele.openNewChat(provider)
        await page.click('[role="combobox"][aria-label="Project"]')
        const project = `[...document.querySelectorAll('[role="option"]')].find(el=>window.__sele.text(el).includes('Benchmark fixture'))`
        await page.click(`(${project})`)
        const preset = {
          agentMode: 'interactive',
          approvalMode: 'never',
          model: provider === 'claude' ? 'sonnet' : 'gpt-5.4',
          reasoningEffort: 'high',
          sandboxMode: 'workspace-write',
          serviceTier: null
        }
        assert.equal(
          await page.eval(
            `window.preferencesApi.setItem('sele:chat-presets:v1:${provider}', ${JSON.stringify(JSON.stringify([preset]))}).ok`
          ),
          true
        )
        const benchmarkRow = '.message-box__chat-config-benchmark'
        const benchmarkSwitch = `${benchmarkRow} input[role="switch"]`
        const benchmarkTrack = `${benchmarkRow} .ui-switch__control`
        await page.click('.message-box__chat-config-trigger')
        await page.waitFor(`document.querySelector('[data-menu-page="presets"] ${benchmarkRow}')`)
        await page.waitFor(`document.querySelector('${benchmarkSwitch}:not(:checked)')`)
        await page.center(benchmarkTrack)
        assert.ok(
          await page.eval(`(() => {
            const row = document.querySelector('${benchmarkRow}').getBoundingClientRect()
            const menu = document.querySelector('.message-box__chat-config-menu').getBoundingClientRect()
            const track = document.querySelector('${benchmarkTrack}').getBoundingClientRect()
            return track.right < Math.min(row.right, menu.right)
              && track.left > Math.max(row.left, menu.left)
              && track.bottom < Math.min(row.bottom, menu.bottom)
              && track.top > Math.max(row.top, menu.top)
          })()`),
          'The entire switch track fits inside the menu row'
        )
        await page.click(benchmarkTrack)
        await page.waitFor('document.querySelector(\'[aria-label="Secondary agent settings"]\')')
        assert.equal(await page.eval("Boolean(window.__sele.byLabel('Set goal'))"), false)
        await page.waitFor("!document.querySelector('.message-box__chat-config-menu')")
        await page.click('.changes-sidebar [aria-label="Git"]')
        const branchSelector = (side) => `[aria-label="${side} worktree"] .branch-switcher__trigger`
        const branchTitle = (side) => `document.querySelector('${branchSelector(side)}')?.title`
        await page.waitFor(`/benchmark-.*-primary$/.test(${branchTitle('Main')})`)
        await page.waitFor(`/benchmark-.*-secondary$/.test(${branchTitle('Secondary')})`)
        assert.ok(
          await page.eval(`(() => {
            const main = document.querySelector('[aria-label="Main worktree"]').getBoundingClientRect()
            const secondary = document.querySelector('[aria-label="Secondary worktree"]').getBoundingClientRect()
            return main.right <= secondary.left && main.top === secondary.top
          })()`),
          'Benchmark places Main on the left and Secondary on the right'
        )
        await page.click('.changes-sidebar [aria-label="Files"]')
        await page.waitFor(
          `document.querySelector('[aria-label="Main files"] [aria-label="Open README.md"]') && document.querySelector('[aria-label="Secondary files"] [aria-label="Open README.md"]')`
        )
        await page.click('.changes-sidebar [aria-label="Git"]')
        await page.eval('window.__sele.composer().focus()')

        const first = `benchmark-tie-${provider} #delay 3000`
        const second = `benchmark-vote-${provider}`
        const likes =
          'document.querySelectorAll(\'#chat-search-content [aria-label^="Like "]\').length'
        await page.fillComposer(first)
        assert.equal(await page.eval('window.__sele.composer().value'), first)
        await sele.send(first, { timeout: 30000 })
        await page.waitFor('window.__sele.active()', { message: 'The benchmark should be running' })
        assert.equal(
          await page.eval(
            `document.querySelectorAll('#chat-search-content [aria-label^="Copy"][aria-label$="worktree to the other agent"]').length`
          ),
          0
        )
        await page.waitFor(`${likes} === 2`, {
          timeout: 60000,
          message: 'Both benchmark agents should finish'
        })
        await page.waitFor('window.__sele.selectedChatId()', {
          message: 'The benchmark chat should be selected'
        })
        assert.equal(
          await page.eval(
            `document.querySelectorAll('#chat-search-content .chat-detail__message-footer .chat-detail__message-actions [aria-label^="Copy"][aria-label$="worktree to the other agent"]').length`
          ),
          2
        )
        assert.equal(
          await page.eval(
            `/Main agent|Secondary agent/.test(document.querySelector('#chat-search-content').innerText)`
          ),
          false
        )
        const benchmark = await page.eval(`(async () => {
        const id = window.__sele.selectedChatId();
        if (!id) throw new Error('The primary chat is not selected.');
        const main = await window.providerApi.getChat('${provider}', id);
        if (!main.benchmarkChatId) throw new Error('The primary chat is missing its benchmark link.');
        const secondary = await window.providerApi.getChat('${provider}', main.benchmarkChatId);
        return {id, secondaryId: secondary.id, mainCwd: main.cwd, secondaryCwd: secondary.cwd};
      })()`)
        assert.notEqual(benchmark.mainCwd, benchmark.secondaryCwd)
        assert.ok(existsSync(benchmark.mainCwd))
        assert.ok(existsSync(benchmark.secondaryCwd))
        assert.equal(git('branch', '--show-current'), 'main')
        const worktreeBranch = (path) => git('-C', path, 'branch', '--show-current')
        const mainBranch = worktreeBranch(benchmark.mainCwd)
        const secondaryBranch = worktreeBranch(benchmark.secondaryCwd)
        const selectSecondaryBranch = async (branch) => {
          const trigger = branchSelector('Secondary')
          await page.waitFor(`document.querySelector('${trigger}:not(:disabled)')`)
          await page.click(trigger)
          await page.waitFor("document.activeElement.matches('.branch-switcher__menu input')")
          await page.type(branch)
          const option = `([...document.querySelectorAll('.branch-switcher__menu [role="option"]')].find(el => el.textContent.trim() === ${JSON.stringify(branch)}))`
          await page.waitFor(option)
          await page.click(option)
          await page.waitFor(`${branchTitle('Secondary')} === ${JSON.stringify(branch)}`)
          assert.equal(worktreeBranch(benchmark.secondaryCwd), branch)
          assert.equal(worktreeBranch(benchmark.mainCwd), mainBranch)
          assert.equal(git('branch', '--show-current'), 'main')
        }
        writeFileSync(join(benchmark.mainCwd, 'shared.txt'), 'main-worktree-diff\n')
        writeFileSync(join(benchmark.secondaryCwd, 'shared.txt'), 'secondary-worktree-diff\n')
        await page.click('.changes-sidebar [aria-label="Refresh changes"]')
        await page.waitFor(
          `document.querySelectorAll('.changes-sidebar__benchmark [aria-label="Open shared.txt"]').length === 2`
        )
        for (const [side, marker] of [
          ['Main', 'main'],
          ['Secondary', 'secondary']
        ]) {
          const file = `[aria-label="${side} changes"] [aria-label="Open shared.txt"]`
          await page.waitFor(`document.querySelector('${file}')`)
          await page.click(file)
          await page.waitFor(
            `document.querySelector('.file-editor-dialog .file-editor-dialog__editor-pane')?.textContent.includes('${marker}-worktree-diff')`
          )
          assert.ok(
            await page.eval(
              `Boolean(document.querySelector('.file-editor-dialog [aria-label="Diff"][aria-pressed="true"]'))`
            )
          )
          await page.click('.file-editor-dialog [aria-label="Close file editor"]')
          await page.waitFor("!document.querySelector('.file-editor-dialog')")
        }

        await page.click('.changes-sidebar [aria-label="Files"]')
        await page.waitFor(
          `document.querySelectorAll('.changes-sidebar__benchmark [aria-label$=" files"][role="tree"]').length === 2`
        )
        await selectSecondaryBranch('fixture-upstream')
        await selectSecondaryBranch(secondaryBranch)
        for (const [path, marker] of [
          [benchmark.mainCwd, 'main'],
          [benchmark.secondaryCwd, 'secondary']
        ]) {
          const folder = join(path, 'examples', 'nested')
          mkdirSync(folder, { recursive: true })
          writeFileSync(join(folder, 'example.txt'), `${marker}-file-tree-content\n`)
        }
        const refreshFiles = '.changes-sidebar [aria-label="Refresh files"]'
        await page.waitFor(`document.querySelector('${refreshFiles}:not(:disabled)')`)
        await page.click(refreshFiles)
        for (const [side, marker] of [
          ['Main', 'main'],
          ['Secondary', 'secondary']
        ]) {
          const tree = `[aria-label="${side} files"]`
          const folder = `${tree} button[title="examples/nested"]`
          const file = `${tree} [aria-label="Open examples/nested/example.txt"]`
          await page.waitFor(`document.querySelector('${folder}')`)
          assert.equal(await page.eval(`Boolean(document.querySelector('${file}'))`), false)
          await page.click(folder)
          await page.click(file)
          await page.waitFor(
            `document.querySelector('.file-editor-dialog .file-editor-dialog__editor-pane')?.textContent.includes('${marker}-file-tree-content')`
          )
          assert.ok(
            await page.eval(
              `Boolean(document.querySelector('.file-editor-dialog [aria-label="Regular contents"][aria-pressed="true"]'))`
            )
          )
          await page.click('.file-editor-dialog [aria-label="Close file editor"]')
          await page.waitFor("!document.querySelector('.file-editor-dialog')")
        }
        assert.equal(
          await page.eval("window.__sele.messages().filter(m=>m.role==='user').length"),
          1
        )
        assert.equal(
          await page.eval(
            'Boolean(window.__sele.chatRow(window.__sele.selectedChatId()).querySelector(\'[aria-label="Benchmark"]\'))'
          ),
          true
        )

        for (const [direction, side, answerLabel] of [
          ['left', 'primary', 'Main agent'],
          ['right', 'secondary', 'Secondary agent']
        ]) {
          const prompt = `benchmark-only-${direction}-${provider}`
          const send = `[aria-label="Send only to the ${direction} agent"]`
          const round = `document.querySelector('[data-benchmark-side="${side}"]')`
          await page.fillComposer(prompt)
          await page.waitFor(`document.querySelector('${send}:not(:disabled)')`)
          await page.click(send)
          await page.waitFor(
            `${round}?.querySelector('[aria-label="${answerLabel}"]')?.textContent.includes('Reply to: ${prompt}')`
          )
          assert.equal(
            await page.eval(
              `[...${round}.querySelectorAll('.benchmark-round__answer')].filter(el=>!el.textContent.trim()).length`
            ),
            1
          )
          await page.waitFor('!window.__sele.active()')
        }

        await sele.send(second, { timeout: 30000 })
        const rounds = "[...document.querySelectorAll('#chat-search-content .benchmark-round')]"
        const lastRound = `${rounds}.at(-1)`
        const lastLike = `${lastRound}?.querySelector('[aria-label="Like secondary agent answer"]')`
        await page.waitFor(
          `${lastLike} && window.__sele.replyCount(${JSON.stringify(second)}) === 2 && !document.querySelector('[data-benchmark-side]')`,
          { timeout: 60000 }
        )
        const nativeMessages = (chatId) =>
          page.eval(
            `(async () => (await window.providerApi.getChat('${provider}',${JSON.stringify(chatId)})).items.filter(i => i.type === 'message').map(i => i.content))()`
          )
        for (const [id, side] of [
          [benchmark.id, 'primary'],
          [benchmark.secondaryId, 'secondary']
        ]) {
          const messages = await nativeMessages(id)
          assert.ok(
            messages.some((message) =>
              message.includes(`Reply to: ${second}\n\nBenchmark side: ${side}`)
            )
          )
          assert.equal(
            messages.some((message) => message.includes('benchmark-only-')),
            false
          )
        }
        writeFileSync(join(benchmark.secondaryCwd, 'result.txt'), 'secondary state\n')
        await page.click(
          `(${lastRound}.querySelector('[aria-label="Copy secondary agent worktree to the other agent"]'))`
        )
        await page.waitFor(
          '!document.querySelector(\'#chat-search-content [aria-label="Like secondary agent answer"]\')?.disabled'
        )
        assert.equal(
          readFileSync(join(benchmark.mainCwd, 'result.txt'), 'utf8'),
          'secondary state\n'
        )

        await page.click(`(${lastLike})`)
        await page.waitFor(
          "document.querySelector('#chat-search-content .benchmark-round__answers--single')",
          {
            timeout: 65000,
            message: 'Vote should collapse the compared answers'
          }
        )
        const verdicts = await page.eval(
          `window.providerApi.getBenchmarkResults('${provider}',${JSON.stringify(benchmark.id)})`
        )
        assert.deepEqual(
          verdicts.map(({ outcome }) => outcome),
          ['tie', 'secondary']
        )
        for (const id of [benchmark.id, benchmark.secondaryId]) {
          const messages = await nativeMessages(id)
          assert.ok(messages.includes(`Reply to: ${second}\n\nBenchmark side: secondary`))
          assert.ok(!messages.includes(`Reply to: ${second}\n\nBenchmark side: primary`))
        }

        const followup = `benchmark-context-${provider}`
        await sele.send(followup)
        await page.waitFor(
          `window.__sele.replyCount(${JSON.stringify(followup)}) === 2 && window.__sele.replyCount('Preferred answer in model context') === 2`,
          { message: 'Both models should continue with the winning answer' }
        )

        const firstLike = `${rounds}.at(0)?.querySelector('[aria-label="Like main agent answer"]')`
        await page.eval(
          'window.__benchmarkConfirmed = false; window.confirm = () => { window.__benchmarkConfirmed = true; return true }'
        )
        await page.click(`(${firstLike})`)
        await page.waitFor(
          `${rounds}.length === 1 && ${rounds}.at(0)?.querySelector('.benchmark-round__answers--single')`,
          {
            message: 'Liking the earlier answer should remove the later round'
          }
        )
        assert.equal(await page.eval('window.__benchmarkConfirmed'), true)
        for (const id of [benchmark.id, benchmark.secondaryId]) {
          const messages = await nativeMessages(id)
          assert.ok(messages.includes(`Reply to: ${first}\n\nBenchmark side: primary`))
          assert.ok(!messages.includes(`Reply to: ${first}\n\nBenchmark side: secondary`))
          assert.equal(
            messages.some((message) => message.includes(second) || message.includes(followup)),
            false
          )
        }

        await page.click('.message-box__chat-config-trigger')
        await page.waitFor(`document.querySelector('${benchmarkSwitch}:checked')`)
        await page.waitFor("document.activeElement.matches('.message-box__chat-config-menu-root')")
        await page.press('End')
        assert.ok(await page.eval(`document.activeElement.matches('${benchmarkSwitch}')`))
        await page.press(' ')
        await page.waitFor(
          "document.querySelector('.message-box__prompt-suggestion')?.textContent.includes('Merge current branch into main')"
        )
        assert.equal(existsSync(benchmark.secondaryCwd), false)
        assert.equal(existsSync(benchmark.mainCwd), true)
        assert.equal(git('branch', '--show-current'), 'main')
        await page.waitFor("!document.querySelector('.changes-sidebar__benchmark')")
        assert.ok(await page.eval("Boolean(document.querySelector('#changes-branch'))"))
        await sele.send(`benchmark-ended-${provider}`)
        await sele.waitForReply(`benchmark-ended-${provider}`)
        assert.equal(
          await page.eval("Boolean(document.querySelector('.changes-sidebar__benchmark'))"),
          false
        )
        assert.equal(
          await page.eval(
            `window.__sele.replyCount(${JSON.stringify(`benchmark-ended-${provider}`)})`
          ),
          1
        )
      }
    )
    await runner.check(
      `[${provider}] a benchmark can start with just the right agent`,
      async () => {
        await sele.openNewChat(provider)
        await page.click('[role="combobox"][aria-label="Project"]')
        await page.click(
          `([...document.querySelectorAll('[role="option"]')].find(el=>window.__sele.text(el).includes('Benchmark fixture')))`
        )
        await page.click('.message-box__chat-config-trigger')
        await page.click('.message-box__chat-config-benchmark .ui-switch__control')
        const right = '[aria-label="Send only to the right agent"]'
        await page.waitFor(`document.querySelector('${right}')`)
        const trial = `benchmark-first-right-${provider}`
        await page.fillComposer(trial)
        await page.waitFor(`document.querySelector('${right}:not(:disabled)')`)
        await page.click(right)
        await page.waitFor(
          `document.querySelector('[data-benchmark-side="secondary"] [aria-label="Secondary agent"]')?.textContent.includes('Reply to: ${trial}')`
        )
        assert.equal(
          await page.eval(
            `document.querySelector('[data-benchmark-side="secondary"] [aria-label="Main agent"]').textContent.trim()`
          ),
          ''
        )
        await page.waitFor('!window.__sele.active()')
        const both = `benchmark-first-shared-${provider}`
        await sele.send(both, { timeout: 30000 })
        await page.waitFor(
          `window.__sele.replyCount(${JSON.stringify(both)}) === 2 && !document.querySelector('[data-benchmark-side]')`
        )
      }
    )
  }
}

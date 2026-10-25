// Page objects for the Sele workspace. Selectors use roles, labels and stable data attributes.
const { sleep } = require('./harness.cjs')

const providerLabels = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  opencode: 'OpenCode'
}

// In-page helper library, evaluated once per document.
const helpers = String.raw`(() => {
  if (window.__sele) return true
  const text = element => (element?.innerText ?? element?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const visible = element => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  window.__sele = {
    text,
    visible,
    byLabel: (label, root = document) => [...root.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === label && visible(element)) ?? null,
    allByLabel: (label, root = document) => [...root.querySelectorAll('[aria-label]')].filter(element => element.getAttribute('aria-label') === label && visible(element)),
    scroller: () => document.querySelector('#chat-search-content'),
    selectedChatId: () => document.querySelector('.chat-list-item--selected')?.getAttribute('data-chat-id') ?? null,
    chatRow: id => document.querySelector('.chat-list-item[data-chat-id="' + CSS.escape(id) + '"]'),
    chatRows: () => [...document.querySelectorAll('.chat-list-item[data-chat-id]')].map(row => ({ id: row.getAttribute('data-chat-id'), title: text(row.querySelector('.chat-list-item__main')), selected: row.classList.contains('chat-list-item--selected') })),
    messages: () => [...document.querySelectorAll('#chat-search-content .chat-detail__message-block')].map(block => ({
      role: block.classList.contains('chat-detail__message-block--user') ? 'user' : 'assistant',
      pending: block.classList.contains('chat-detail__message-block--pending'),
      kind: block.classList.contains('chat-detail__message-block--pending-queued') ? 'queued' : block.classList.contains('chat-detail__message-block--pending-steering') ? 'steering' : null,
      id: block.getAttribute('data-motion-message-id'),
      text: text(block.querySelector('.chat-detail__message')),
    })),
    pending: () => window.__sele.messages().filter(message => message.pending),
    pendingBlock: needle => [...document.querySelectorAll('#chat-search-content .chat-detail__message-block--pending')].find(block => text(block.querySelector('.chat-detail__message')).includes(needle)) ?? null,
    hasText: needle => (document.querySelector('#chat-search-content')?.innerText ?? '').includes(needle),
    replyCount: needle => window.__sele.messages().filter(message => message.role === 'assistant' && !message.pending && message.text.includes(needle)).length,
    composer: () => document.querySelector('#message-input'),
    sendButton: () => document.querySelector('.message-box__send-controls button[aria-label]:not([aria-label="Cancel"]):not([aria-label="Stop response"]):not([aria-label="Message actions"])'),
    active: () => Boolean(window.__sele.byLabel('Stop response') || window.__sele.allByLabel('Queue message').length || document.querySelector('.chat-detail__working[data-status="working"], .chat-detail__working--working')),
    atBottom: () => { const s = window.__sele.scroller(); return Boolean(s) && s.scrollHeight - s.clientHeight - s.scrollTop <= 2 },
    turnIds: () => [...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')].map(turn => turn.getAttribute('data-chat-turn-id')),
    topVisibleTurn: () => {
      const scroller = window.__sele.scroller()
      if (!scroller) return null
      const top = scroller.getBoundingClientRect().top
      return [...scroller.querySelectorAll('[data-chat-turn-id]')].find(turn => turn.getBoundingClientRect().bottom > top + 1) ?? null
    },
    group: kind => document.querySelector('.chat-list-group--' + kind),
    errors: () => [...document.querySelectorAll('[role="alert"]')].filter(visible).map(text).filter(Boolean),
  }
  return true
})()`

class Sele {
  constructor(page) {
    this.page = page
  }

  async install() {
    await this.page.install()
    if (!this.installed) await this.page.inject(helpers)
    this.installed = true
  }

  q(expression) {
    return this.page.eval(expression)
  }

  async waitReady() {
    await this.install()
    await this.page.waitFor(
      `document.querySelector('#message-input') && document.querySelector('aside[aria-label="Recent conversations"]')`,
      {
        timeout: 60000,
        message: 'Workspace did not finish loading'
      }
    )
    // The window maximizes after first paint; clicking before that hits stale coordinates.
    await this.page.waitFor(
      `(() => { const size = innerWidth + 'x' + innerHeight; if (window.__e2eSize !== size) { window.__e2eSize = size; window.__e2eSizeAt = performance.now(); return false } return performance.now() - window.__e2eSizeAt > 700 && innerWidth > 1000 })()`,
      { timeout: 20000, message: 'Window size did not settle' }
    )
    await this.install()
  }

  async openNewChat(provider) {
    if (await this.q(`Boolean(window.__sele.selectedChatId())`)) {
      await this.page.click(`(window.__sele.byLabel('New chat'))`)
      await this.page.waitFor(
        `!window.__sele.selectedChatId() && document.querySelector('[role="combobox"][aria-label="Provider"]')`,
        {
          message: 'New chat view did not open'
        }
      )
    }
    const label = providerLabels[provider]
    await this.page.waitFor(
      `(() => { const box = document.querySelector('[role="combobox"][aria-label="Provider"]'); return box && !box.disabled && window.__sele.text(box) })()`,
      { timeout: 60000, message: 'Provider selector did not load' }
    )
    const current = await this.q(
      `window.__sele.text(document.querySelector('[role="combobox"][aria-label="Provider"]'))`
    )
    if (!current.includes(label)) {
      await this.page.click(`[role="combobox"][aria-label="Provider"]`)
      const option = `([...document.querySelectorAll('[role="option"]')].find(option => window.__sele.visible(option) && window.__sele.text(option).startsWith(${JSON.stringify(label)})))`
      await this.page.waitFor(option, { message: `${label} is not offered as a provider` })
      await this.page.click(option)
      await this.page.waitFor(
        `window.__sele.text(document.querySelector('[role="combobox"][aria-label="Provider"]')).includes(${JSON.stringify(label)})`,
        { message: `${label} was not selected` }
      )
    }
    // Models load asynchronously; sending before then is blocked by design.
    await this.page.waitFor(
      `window.__sele.sendButton() && !document.querySelector('.message-box[aria-busy="true"]')`,
      { timeout: 60000 }
    )
    if (!this.fullAccess?.has(provider)) {
      await this.setFullAccess()
      ;(this.fullAccess ??= new Set()).add(provider)
    }
  }

  /** Scripted turns run shell tools; approval prompts would stall them. */
  async setFullAccess() {
    const option = `([...document.querySelectorAll('.message-box__chat-config-menu button')].find(button => window.__sele.text(button.querySelector('.message-box__chat-config-option-label')) === 'Full access'))`
    const section = `document.querySelector('[data-chat-config-section="access"]')`
    const openAccess = async () => {
      if (await this.q(`window.__sele.visible(${option})`)) return
      if (!(await this.q(`Boolean(document.querySelector('.message-box__chat-config-menu'))`)))
        await this.page.click('.message-box__chat-config-trigger')
      const configure = `([...document.querySelectorAll('.message-box__chat-config-section-button')].find(button => window.__sele.text(button) === 'Configure'))`
      if (await this.q(`Boolean(${configure})`)) await this.page.click(configure)
      await this.page.waitFor(section, { message: 'Chat settings have no Access section' })
      await this.page.click(section)
      await this.page.waitFor(option, { message: 'Full access is not offered' })
    }
    const selected = `(${option}?.getAttribute('aria-pressed') === 'true')`
    for (let attempt = 0; ; attempt++) {
      await openAccess()
      if (await this.q(selected)) break
      if (attempt === 2) throw new Error('Full access was not selected')
      await this.page.click(option)
      await sleep(250)
    }
    for (
      let attempt = 0;
      attempt < 3 &&
      (await this.q(`Boolean(document.querySelector('.message-box__chat-config-menu'))`));
      attempt++
    ) {
      await this.page.press('Escape')
      await sleep(200)
    }
  }

  /** Start a chat and wait until Sele selects it. Returns the new chat id. */
  async startChat(provider, prompt) {
    await this.openNewChat(provider)
    const before = await this.q(`window.__sele.chatRows().map(row => row.id)`)
    this.lastStartAcceptMs = await this.send(prompt, { timeout: 15000 })
    const id = await this.page.waitFor(
      `(() => { const id = window.__sele.selectedChatId(); return id && !${JSON.stringify(before)}.includes(id) ? id : null })()`,
      { timeout: 60000, message: `${provider} chat was not created` }
    )
    return id
  }

  /**
   * Type and submit like a user. Returns how long the composer took to accept (clear) the
   * message. With `retry`, Enter is pressed again while a previous send is still in flight.
   */
  async send(text, { steer = false, timeout = 8000, retry = true } = {}) {
    await this.page.fillComposer(text)
    const started = Date.now()
    const accepted = `window.__sele.composer()?.value === ''`
    while (true) {
      await this.page.press('Enter', steer ? ['ctrl'] : [])
      try {
        await this.page.waitFor(accepted, { timeout: retry ? 400 : timeout })
        return Date.now() - started
      } catch {
        if (!retry || Date.now() - started > timeout)
          throw new Error(`Composer did not accept "${text}"`)
      }
    }
  }

  /** Open the composer edit session for a pending message. Returns the latency. */
  async editPending(needle, kind = 'queued') {
    const label = kind === 'steering' ? 'Edit steering message' : 'Edit queued message'
    const started = Date.now()
    await this.pendingAction(needle, label)
    await this.page.waitFor(
      `window.__sele.byLabel('Save edit') && window.__sele.composer()?.value.includes(${JSON.stringify(needle)})`,
      { message: `Edit session for "${needle}" did not open` }
    )
    return Date.now() - started
  }

  async saveEdit(text) {
    await this.page.fillComposer(text)
    await this.page.click(`(window.__sele.byLabel('Save edit'))`)
    await this.page.waitFor(`!window.__sele.byLabel('Save edit')`, {
      timeout: 10000,
      message: 'Edit was not saved'
    })
  }

  async cancelEdit() {
    await this.page.click(
      `([...document.querySelectorAll('.message-box__send-controls button')].find(button => window.__sele.text(button) === 'Cancel'))`
    )
    await this.page.waitFor(`!window.__sele.byLabel('Save edit')`, {
      message: 'Edit was not cancelled'
    })
  }

  /** Track one message's position each frame. */
  trackMessage(id) {
    return `[{ find: () => document.querySelector('[data-motion-message-id="' + CSS.escape(${JSON.stringify(id)}) + '"]'), key: element => element.getAttribute('data-motion-message-id'), scroller: () => window.__sele.scroller(), samples: [] }]`
  }

  /** Track the topmost visible turn, switching only when it leaves the viewport. */
  trackTopTurn() {
    return `[(() => { let current = null; return {
      find: () => {
        const scroller = window.__sele.scroller(); if (!scroller) return null
        const box = scroller.getBoundingClientRect()
        const inside = element => { const rect = element.getBoundingClientRect(); return rect.bottom > box.top + 1 && rect.top < box.bottom - 1 }
        if (current?.isConnected && inside(current)) return current
        current = [...scroller.querySelectorAll('[data-chat-turn-id]')].find(inside) ?? null
        return current
      },
      key: element => element.getAttribute('data-chat-turn-id'),
      scroller: () => window.__sele.scroller(),
      samples: []
    } })()]`
  }

  /** Click the chat title text (its hover toolbar covers the rest of the row). */
  async selectChat(id) {
    const target = JSON.stringify(id)
    const selected = `window.__sele.selectedChatId() === ${target}`
    // The sidebar re-renders and re-sorts while chats load, so a single click can land on a
    // row that just moved; click and verify instead of trusting one event pair.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (await this.page.eval(selected)) return
      const row = `window.__sele.chatRow(${target})?.querySelector('.chat-list-item__main')`
      if (await this.page.eval(`!!${row}`))
        await this.page
          .click(`(${row})`, { offsetX: 40 })
          .catch(() => {})
      await sleep(300)
    }
    await this.page.waitFor(selected, { timeout: 5000, message: 'chat did not open' })
  }

  async waitForReply(needle, { timeout = 60000 } = {}) {
    await this.page.waitFor(`window.__sele.replyCount(${JSON.stringify(needle)}) > 0`, {
      timeout,
      message: `No assistant reply containing "${needle}"`
    })
  }

  /** Wait until the selected chat has no running turn and no pending messages. */
  async waitIdle({ timeout = 90000 } = {}) {
    await this.page.waitFor(
      `!window.__sele.byLabel('Stop response') && window.__sele.pending().length === 0 && window.__sele.sendButton()?.getAttribute('aria-label') !== 'Queue message' && !document.querySelector('.chat-detail__working-placeholder')`,
      { timeout, message: 'Chat did not become idle' }
    )
  }

  async waitActive({ timeout = 60000 } = {}) {
    await this.page.waitFor(`Boolean(window.__sele.byLabel('Stop response'))`, {
      timeout,
      message: 'Turn did not become active'
    })
  }

  pendingButton(needle, label) {
    const block = `window.__sele.pendingBlock(${JSON.stringify(needle)})`
    return `(() => { const block = ${block}; if (!block) return null; return [...block.querySelectorAll('button[aria-label]')].find(button => button.getAttribute('aria-label') === ${JSON.stringify(label)} && window.__sele.visible(button)) ?? null })()`
  }

  async pendingAction(needle, label) {
    const button = this.pendingButton(needle, label)
    await this.page.hover(`(window.__sele.pendingBlock(${JSON.stringify(needle)}))`)
    await this.page.waitFor(button, {
      message: `"${label}" is unavailable for pending "${needle}"`
    })
    await this.page.click(button)
  }

  messages() {
    return this.q(`window.__sele.messages()`)
  }

  pending() {
    return this.q(`window.__sele.pending()`)
  }

  async settle(ms = 150) {
    await sleep(ms)
    await this.page.frames(2)
  }
}

module.exports = { Sele, providerLabels }

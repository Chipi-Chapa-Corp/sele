const ref = (current) => ({ current })
const noop = () => {}
const items = (start, count) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'message',
    id: `turn-${start + i}`,
    role: 'user',
    content: `Turn ${start + i}`
  }))
const makeDetail = (start, cursor = false) => ({
  id: 'chat',
  revision: 1,
  status: 'idle',
  items: items(start, cursor ? 10 : 20),
  itemsStartTurnIndex: cursor ? 0 : start,
  turnCount: cursor ? 10 : 60,
  ...(cursor
    ? {
        turnPagination: {
          kind: 'cursor',
          olderCursor: 'older',
          newerCursor: start < 30 ? 'newer' : null
        }
      }
    : {})
})
const element = document.getElementById('chat')
const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
let state
let resolvePage
let requests
const firstVisible = () => window.readChatScrollAnchor(element, window.selectedChatKey)?.turnId
const render = () => {
  window.chatDetail = state
  element.innerHTML = `<div class="chat-detail__messages-inner">${state.items
    .map(
      (item, index) =>
        `<div class="turn" data-chat-turn-id="${item.id}" data-chat-turn-index="${state.itemsStartTurnIndex + index}"><div data-chat-message-id="${item.id}">${item.content}</div></div>`
    )
    .join('')}</div>`
}
const reset = (provider = 'legacy') => {
  const cursor = provider === 'claude' || provider === 'codex'
  state = makeDetail(cursor ? 30 : 20, cursor)
  render()
  requests = []
  Object.assign(window, {
    useCallback: (fn) => fn,
    flushSync: (fn) => {
      fn()
      window.restorePageAnchor()
    },
    selectedChatKey: `${provider}:chat`,
    contentRef: ref(element),
    selectedChatRef: ref({ id: 'chat', providerId: provider }),
    selectedChatKeyRef: ref(`${provider}:chat`),
    chatInitialLayoutKeyRef: ref(`${provider}:chat`),
    chatDetailRef: ref(state),
    cursorWindowRef: ref(null),
    failedPageReadRef: ref(null),
    chatTurnWindowRef: ref({
      chatKey: `${provider}:chat`,
      startIndex: cursor ? 0 : 20,
      endIndex: cursor ? 10 : 40,
      totalCount: cursor ? 10 : 60
    }),
    chatTurnPageLoadRequestRef: ref(0),
    chatTurnPageLoadInFlightRef: ref(false),
    chatTurnScrollDirectionRef: ref('up'),
    chatAutoScrollEnabledRef: ref(false),
    chatAutoScrollTargetRef: ref(null),
    chatScrollAdjustmentTargetRef: ref(null),
    pendingChatScrollAnchorRef: ref(null),
    chatViewportAnchorRef: ref(null),
    scrollToLatestTurnAfterRenderRef: ref(false),
    previousChatScrollTopRef: ref(50),
    chatUserScrollIntentRef: ref(false),
    setChatAtConversationBottom: noop,
    chatAtConversationBottomRef: ref(true),
    setChatTurnPageLoadDirection: noop,
    setChatTurnWindow: (value) => {
      window.chatTurnWindowRef.current = value
    },
    setChatDetail: (fn) => {
      state = typeof fn === 'function' ? fn(state) : fn
      render()
    },
    getChatKey: (chat) => `${chat.providerId}:${chat.id}`,
    applyViewedChatDetail: noop,
    scheduleChatAutoScroll: noop,
    chatTurnLoadThresholdPx: 100,
    chatTurnPageSize: 10,
    chatTurnWindowSize: 20,
    providerApi: {
      getChatTurnPage: (_provider, _id, start, limit) =>
        new Promise((resolve) => {
          resolvePage = () =>
            resolve({ items: items(start, limit), startIndex: start, totalCount: 60 })
        }),
      getChatTurnCursorPage: (_provider, _id, direction) => {
        requests.push(direction)
        const page = makeDetail(
          direction === 'older'
            ? Number(state.items[0].id.slice(5)) - 10
            : Number(state.items.at(-1).id.slice(5)) + 1,
          true
        )
        return Promise.resolve({ ...page, startIndex: 0, totalCount: 10 })
      }
    }
  })
}
reset()
window.runScrollChecks = async () => {
  reset('codex')
  element.scrollTop = 20
  await settle()
  const onScroll = () => {
    if (requests.length < 6) window.handleNativeChatContentScroll()
  }
  element.addEventListener('scroll', onScroll)
  await window.loadChatTurnPage('older')
  await settle()
  element.scrollTop = 20
  await window.loadChatTurnPage('older')
  await settle()
  const cursorAutoFollow = window.chatAutoScrollEnabledRef.current
  element.scrollTop = element.scrollHeight - element.clientHeight
  await window.loadChatTurnPage('newer')
  await settle()
  element.removeEventListener('scroll', onScroll)
  const cursorRequests = [...requests]

  const normalPaging = []
  for (const direction of ['older', 'newer']) {
    reset()
    element.scrollTop = direction === 'older' ? 20 : 1700
    const before = firstVisible()
    const pending = window.loadChatTurnPage(direction)
    resolvePage()
    await pending
    normalPaging.push({ direction, before, after: firstVisible() })
  }

  const delayedPaging = []
  for (const provider of ['legacy', 'claude', 'codex']) {
    for (const direction of ['older', 'newer']) {
      reset(provider)
      if (provider !== 'legacy') {
        state = makeDetail(20, true)
        window.chatDetailRef.current = state
        render()
        window.providerApi.getChatTurnCursorPage = () =>
          new Promise((resolve) => {
            resolvePage = () =>
              resolve({
                ...makeDetail(direction === 'older' ? 10 : 30, true),
                startIndex: 0,
                totalCount: 10
              })
          })
      }
      element.scrollTop = direction === 'older' ? 20 : element.scrollHeight - element.clientHeight
      const pending = window.loadChatTurnPage(direction)
      element.scrollTop = direction === 'older' ? element.scrollHeight - element.clientHeight : 20
      window.handleChatContentScroll()
      const before = firstVisible()
      resolvePage()
      await pending
      delayedPaging.push({ provider, direction, before, after: firstVisible() })
    }
  }

  const liveUpdates = []
  for (const provider of ['legacy', 'claude', 'codex']) {
    const history = makeDetail(20, provider !== 'legacy')
    const latest = {
      ...makeDetail(provider !== 'legacy' ? 30 : 40, provider !== 'legacy'),
      revision: 2
    }
    const snapshot = window.getChatDetailFromSnapshot(latest, history, {
      preserveCurrentTurnWindow: true
    })
    const retained = window.retainLoadedChatDetailTurnWindow(snapshot, {
      startIndex: history.itemsStartTurnIndex,
      endIndex: history.itemsStartTurnIndex + history.items.length,
      totalCount: history.turnCount
    })
    const next = window.getChatDetailFromSnapshot({ ...latest, revision: 3 }, retained, {
      preserveCurrentTurnWindow: true
    })
    liveUpdates.push({
      provider,
      before: history.items.map((x) => x.id),
      after: next.items.map((x) => x.id)
    })
  }

  const cursorAnchors = []
  const replacedBoundaries = []
  const failedPages = []
  for (const provider of ['claude', 'codex']) {
    for (const direction of ['older', 'newer']) {
      reset(provider)
      state = makeDetail(20, true)
      window.chatDetailRef.current = state
      render()
      element.scrollTop = direction === 'older' ? 20 : element.scrollHeight - element.clientHeight
      const before = firstVisible()
      const top = () =>
        document.querySelector(`[data-chat-turn-id="${before}"]`).getBoundingClientRect().top
      const beforeTop = top()
      await window.loadChatTurnPage(direction)
      cursorAnchors.push({
        provider,
        direction,
        before,
        after: firstVisible(),
        beforeTop,
        afterTop: top()
      })

      reset(provider)
      state = makeDetail(20, true)
      window.chatDetailRef.current = state
      render()
      element.scrollTop = direction === 'older' ? 20 : element.scrollHeight - element.clientHeight
      const currentItems = state.items.map((item) => item.id)
      const page = {
        ...makeDetail(direction === 'older' ? 10 : 30, true),
        startIndex: 0,
        totalCount: 10
      }
      window.providerApi.getChatTurnCursorPage = () =>
        new Promise((resolve) => {
          resolvePage = () => resolve(page)
        })
      const pending = window.loadChatTurnPage(direction)
      state = {
        ...state,
        turnPagination: {
          ...state.turnPagination,
          [direction === 'older' ? 'olderCursor' : 'newerCursor']: 'changed-boundary'
        }
      }
      window.chatDetailRef.current = state
      resolvePage()
      await pending
      replacedBoundaries.push({
        provider,
        direction,
        before: currentItems,
        after: state.items.map((item) => item.id)
      })

      reset(provider)
      element.scrollTop = 20
      const beforeFailure = firstVisible()
      window.providerApi.getChatTurnCursorPage = async () => {
        throw new Error('Fixture transport failure')
      }
      const originalError = console.error
      console.error = noop
      try {
        await window.loadChatTurnPage('older')
      } finally {
        console.error = originalError
      }
      failedPages.push({
        provider,
        before: beforeFailure,
        after: firstVisible(),
        inFlight: window.chatTurnPageLoadInFlightRef.current
      })
    }
  }

  const resizes = []
  for (const kind of ['message', 'working row']) {
    reset()
    const attribute = kind === 'message' ? 'data-chat-message-id' : 'data-working-motion-id'
    element.innerHTML = `<div class="chat-detail__messages-inner"><div data-chat-turn-id="long-turn" data-chat-turn-index="20"><div ${attribute}="long-message"><div id="media" style="height:800px">Media placeholder</div><p id="reading" style="margin:0;height:100px">Currently reading this block</p><div style="height:1000px">Remaining response</div></div></div></div>`
    element.scrollTop = 800
    window.chatViewportAnchorRef.current = window.readChatScrollAnchor(
      element,
      window.selectedChatKey
    )
    const stop = window.observeContentResize()
    await settle()
    const reading = document.getElementById('reading')
    const top = () => reading.getBoundingClientRect().top - element.getBoundingClientRect().top
    const before = top()
    document.getElementById('media').style.height = '1200px'
    await settle()
    resizes.push({ kind, before, after: top() })
    // Shrinking content above the same block must preserve it too.
    document.getElementById('media').style.height = '600px'
    await settle()
    resizes.push({ kind: `${kind} shrinking`, before, after: top() })
    stop()
  }
  const autoFollow = []
  for (const kind of ['large block', 'replacing expanded block', 'active commit']) {
    reset()
    element.innerHTML =
      '<div class="chat-detail__messages-inner"><div id="tool" style="height:2000px">Tool output</div></div>'
    window.chatAutoScrollEnabledRef.current = true
    window.scrollChatContentToBottom(element)
    const onScroll = () => window.handleChatContentScroll()
    element.addEventListener('scroll', onScroll)
    const stop = window.observeContentResize()
    await settle()
    const tool = document.getElementById('tool')
    if (kind === 'replacing expanded block') {
      tool.style.height = '100px'
      // Force the browser to clamp scrollTop when the previous tool collapses.
      void element.scrollTop
    }
    tool.style.height = '4000px'
    let commitGap
    if (kind === 'active commit') {
      window.chatDetail = { ...window.chatDetail, status: 'running' }
      window.applyChatLayout()
      commitGap = window.getScrollBottomTop(element) - element.scrollTop
    }
    await settle()
    autoFollow.push({
      kind,
      commitGap,
      enabled: window.chatAutoScrollEnabledRef.current,
      gap: window.getScrollBottomTop(element) - element.scrollTop
    })
    stop()
    element.removeEventListener('scroll', onScroll)
  }
  return {
    cursorRequests,
    cursorAutoFollow,
    normalPaging,
    delayedPaging,
    liveUpdates,
    cursorAnchors,
    replacedBoundaries,
    failedPages,
    resizes,
    autoFollow
  }
}

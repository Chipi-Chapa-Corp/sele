/* Sele visualization host. Runs only in an opaque-origin, sandboxed frame. */
;(() => {
  const send = (type, value = {}) => parent.postMessage({ type, ...value }, '*')
  let initialized = false
  let nextId = 0
  const pending = new Map()
  window.openai = {
    sendFollowUpMessage({ prompt, title }) {
      return new Promise((resolve, reject) => {
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) {
          reject(new Error('Invalid follow-up prompt'))
          return
        }
        const id = ++nextId
        pending.set(id, { resolve, reject })
        send('visualization:follow-up', { id, prompt, title })
      })
    }
  }
  // Optional mockup controls remain local; they never mutate project files.
  window.Tweak = class {
    supported = true
    constructor({ container, onChange }) {
      this.onChange = onChange
      this.count = 0
      this.panel = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = container.getAttribute('aria-label') || 'Design options'
      this.panel.append(summary)
      document.body.append(this.panel)
    }
    add(object, property, options, type) {
      if (this.count++ >= 12) return
      const label = document.createElement('label')
      label.className = 'form-label'
      label.append(document.createTextNode(options.label || property))
      const input = document.createElement(type === 'select' ? 'select' : 'input')
      if (type === 'select') {
        input.className = 'form-select'
        for (const option of (options.options || []).slice(0, 12)) {
          const element = document.createElement('option')
          element.value = typeof option === 'string' ? option : option.value
          element.textContent = typeof option === 'string' ? option : option.label
          input.append(element)
        }
      } else {
        input.type = type
        input.className =
          type === 'range'
            ? 'form-range'
            : type === 'checkbox'
              ? 'form-check-input'
              : 'form-control form-control-color'
        for (const key of ['min', 'max', 'step'])
          if (options[key] !== undefined) input[key] = options[key]
      }
      const initial = object[property]
      const update = () => {
        input.value = String(object[property])
        input.checked = Boolean(object[property])
      }
      update()
      input.addEventListener('input', () => {
        object[property] =
          type === 'checkbox' ? input.checked : type === 'range' ? Number(input.value) : input.value
        this.onChange?.()
      })
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'btn btn-ghost'
      reset.textContent = 'Reset'
      reset.addEventListener('click', () => {
        object[property] = initial
        update()
        this.onChange?.()
      })
      label.append(input)
      this.panel.append(label, reset)
    }
    addSlider(object, property, options = {}) {
      this.add(object, property, { step: 1, ...options }, 'range')
    }
    addColorPicker(object, property, options = {}) {
      this.add(object, property, options, 'color')
    }
    addToggle(object, property, options = {}) {
      this.add(object, property, options, 'checkbox')
    }
    addSelect(object, property, options = {}) {
      this.add(object, property, options, 'select')
    }
    dispose() {
      this.panel.remove()
    }
  }
  addEventListener('message', async (event) => {
    if (event.source !== parent) return
    const data = event.data
    if (data?.type === 'visualization:theme') {
      document.documentElement.style.colorScheme = data.dark ? 'dark' : 'light'
    }
    if (data?.type === 'visualization:follow-up-result') {
      const request = pending.get(data.id)
      if (!request) return
      pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve({})
    }
    if (data?.type !== 'visualization:init' || initialized || typeof data.html !== 'string') return
    initialized = true
    document.documentElement.style.colorScheme = data.dark ? 'dark' : 'light'
    const root = document.getElementById('visualization-root')
    root.innerHTML = data.html
    // innerHTML keeps scripts inert. Recreate them in order, including CDN dependencies.
    for (const inert of root.querySelectorAll('script')) {
      const script = document.createElement('script')
      for (const attribute of inert.attributes) script.setAttribute(attribute.name, attribute.value)
      script.textContent = inert.textContent
      let loaded = Promise.resolve()
      if (script.type === 'module' && !script.src) {
        // Inline modules do not emit a load event. Signal from their final statement,
        // after any top-level await, before telling the host the frame can be shown.
        const completionEvent = 'sele-visualization-module-' + crypto.randomUUID()
        loaded = new Promise((resolve) => {
          addEventListener(completionEvent, resolve, { once: true })
          script.onerror = () => {
            send('visualization:warning')
            dispatchEvent(new Event(completionEvent))
          }
        })
        script.textContent +=
          '\n;globalThis.dispatchEvent(new Event(' + JSON.stringify(completionEvent) + '));'
      } else if (script.src) {
        loaded = new Promise((resolve) => {
          script.onload = resolve
          script.onerror = () => {
            send('visualization:warning')
            resolve()
          }
        })
      }
      inert.replaceWith(script)
      await loaded
    }
    globalThis.lucide?.createIcons({ attrs: { width: 16, height: 16 } })
    send('visualization:rendered', {
      height: Math.ceil(document.body.getBoundingClientRect().height)
    })
  })
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') send('visualization:escape')
  })
  let lastHeight = 0
  const measure = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height)
    if (height !== lastHeight) {
      lastHeight = height
      send('visualization:resize', { height })
    }
  }
  new ResizeObserver(measure).observe(document.body)
  addEventListener('error', () => send('visualization:warning'))
  send('visualization:ready', { supportsRenderedMessage: true })
})()

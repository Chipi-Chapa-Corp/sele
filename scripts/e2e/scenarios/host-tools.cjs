const assert = require('node:assert/strict')
const http = require('node:http')

module.exports = async function hostTools(session) {
  const { runner, providers } = session
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<!doctype html><title>Provider browser fixture</title><p>Browser tools reached the page.</p>'
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    for (const provider of providers) {
      await runner.check(
        `[${provider}] browser and shell tools execute through the installed CLI`,
        async () => {
          const token = `host-tools-${provider}`
          const providerUrl = url + encodeURIComponent(provider)
          await session.sele.startChat(provider, `${token} #browser ${providerUrl} #work 2`)
          await session.sele.waitForReply(token, { timeout: 60000 })
          const loaded = await session.page.eval(`(async () => {
          const views = [...document.querySelectorAll('webview')];
          for (const view of views) {
            if (view.getAttribute('src') === ${JSON.stringify(providerUrl)} &&
              await view.executeJavaScript('document.body.innerText.includes("Browser tools reached the page.")')) return true;
          }
          return false;
        })()`)
          assert.equal(loaded, true, 'The browser tool must load a real visible page')
        }
      )
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

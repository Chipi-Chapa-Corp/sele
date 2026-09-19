import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatConfigSectionHeader } from './ChatConfigSectionHeader.ts'

test('renders model discovery errors immediately below Back', () => {
  const markup = renderToStaticMarkup(
    createElement(ChatConfigSectionHeader, {
      modelError: 'Claude model discovery failed',
      onBack: () => undefined
    })
  )

  assert.match(markup, /role="alert"/)
  assert.ok(markup.indexOf('Back') < markup.indexOf('Claude model discovery failed'))
})

test('omits the alert when model discovery succeeded', () => {
  const markup = renderToStaticMarkup(
    createElement(ChatConfigSectionHeader, { modelError: null, onBack: () => undefined })
  )

  assert.doesNotMatch(markup, /role="alert"/)
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  getToolVisualization,
  getVisualizationToolPresentation
} from '../providers/VisualizationToolPresentation.ts'
import { createVisualizationTools, getVisualizationGuide } from './VisualizationTools.ts'

const withDirectory = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-visualization-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const getTool = (directory, name) =>
  createVisualizationTools(directory).find((tool) => tool.name === name)

test('read_me returns the core rules plus only the requested modules', async () => {
  const result = await getTool(tmpdir(), 'read_me').execute({ modules: ['chart'] })
  const guide = result.content[0].text
  assert.match(guide, /Fragment rules/)
  assert.match(guide, /--color-text-primary/)
  assert.match(guide, /sendPrompt/)
  assert.match(guide, /## Charts/)
  assert.doesNotMatch(guide, /## Diagrams/)
  assert.equal(getVisualizationGuide([]).includes('## '), true)
  await assert.rejects(() => getTool(tmpdir(), 'read_me').execute({ modules: ['video'] }))
})

test('show_widget saves the fragment and returns a result the chat resolves to a visualization', async () => {
  await withDirectory(async (directory) => {
    const result = await getTool(directory, 'show_widget').execute({
      i_have_seen_read_me: true,
      title: 'sales_by_region',
      loading_messages: ['Drawing bars'],
      widget_code: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>'
    })
    assert.equal(result.isError, undefined)
    const [file] = await readdir(directory)
    assert.match(file, /^sales-by-region-[0-9a-f]{8}\.html$/)
    assert.equal(
      await readFile(join(directory, file), 'utf8'),
      '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>'
    )

    const tool = { icon: 'visualization', rawInput: null }
    assert.deepEqual(getToolVisualization(tool, result.content, false), {
      path: join(directory, file),
      location: 'host',
      title: 'Sales by region'
    })
    // Claude transcripts may carry the content array or the bare text.
    assert.equal(getToolVisualization(tool, result.content[0].text, false).location, 'host')
    assert.equal(getToolVisualization(tool, result.content, true), undefined)
    assert.equal(getToolVisualization({ ...tool, icon: null }, result.content, false), undefined)
  })
})

test('show_widget requires read_me and bounds the fragment size', async () => {
  await withDirectory(async (directory) => {
    const tool = getTool(directory, 'show_widget')
    const unread = await tool.execute({
      i_have_seen_read_me: false,
      title: 'chart',
      widget_code: '<p>hi</p>'
    })
    assert.equal(unread.isError, true)
    assert.match(unread.content[0].text, /read_me/)
    const large = await tool.execute({
      i_have_seen_read_me: true,
      title: 'chart',
      widget_code: 'x'.repeat(1_000_001)
    })
    assert.equal(large.isError, true)
    assert.deepEqual(await readdir(directory), [])
  })
})

test('ordinary tool text is never mistaken for a widget result', () => {
  const tool = { icon: 'visualization', rawInput: null }
  for (const result of [
    'Rendered /tmp/chart.html',
    JSON.stringify({ sele_visualization: false, path: '/tmp/chart.html' }),
    JSON.stringify({ sele_visualization: true, path: 'relative.html' }),
    JSON.stringify({ sele_visualization: true, path: '/tmp/chart.js' }),
    '{"sele_visualization": tru'
  ])
    assert.equal(getToolVisualization(tool, result, false), undefined, result)
})

test('Claude Artifact publishes preview the local HTML and link the hosted page', () => {
  const presentation = getVisualizationToolPresentation(
    ['Artifact'],
    { file_path: 'report.html' },
    'claude'
  )
  assert.deepEqual(presentation, {
    activity: 'other',
    icon: 'visualization',
    label: 'Published artifact'
  })
  const tool = { icon: 'visualization', rawInput: { file_path: 'report.html', title: 'Draft' } }
  assert.deepEqual(
    getToolVisualization(
      tool,
      { url: 'https://claude.ai/artifact/abc', path: '/work/report.html', title: 'Q3 report' },
      false
    ),
    {
      path: '/work/report.html',
      location: 'workspace',
      title: 'Q3 report',
      url: 'https://claude.ai/artifact/abc'
    }
  )
  // Older results without a path fall back to the input; non-HTTPS URLs are not linked.
  assert.deepEqual(getToolVisualization(tool, { url: 'javascript:alert(1)' }, false), {
    path: 'report.html',
    location: 'workspace',
    title: 'Draft'
  })
  // Markdown artifacts and list results have no HTML to preview.
  assert.equal(
    getToolVisualization(tool, { url: 'https://claude.ai/a', path: '/work/notes.md' }, false),
    undefined
  )
  assert.equal(getToolVisualization(tool, { artifacts: [] }, false), undefined)

  assert.equal(
    getVisualizationToolPresentation(['Artifact'], { action: 'list' }, 'claude').label,
    'Listed artifacts'
  )
  assert.equal(
    getVisualizationToolPresentation(['Artifact'], { action: 'upload_asset' }, 'claude'),
    null
  )
  assert.equal(getVisualizationToolPresentation(['Artifact'], {}, 'copilot'), null)
  assert.equal(
    getVisualizationToolPresentation(['mcp__visualize__show_widget'], {}, 'claude').label,
    'Showed visualization'
  )
  assert.equal(
    getVisualizationToolPresentation(['mcp__visualize__read_me'], {}, 'claude').compact,
    true
  )
})

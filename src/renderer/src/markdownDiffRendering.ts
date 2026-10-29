import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Diff } from 'react-diff-view'
import { getRenderedDiffFiles } from './unifiedDiffRendering.ts'

// Keep large patches on the bounded, plain code path.
const maxDiffCharacters = 100_000
const maxDiffLines = 4_000

export const renderMarkdownDiffBlock = (code: string): string | null => {
  if (code.length > maxDiffCharacters || code.split('\n').length > maxDiffLines) return null
  const source = code.trimStart().replace(/\r\n?/g, '\n')
  if (!/^(?:diff --git |--- |@@ )/.test(source)) return null
  const patches = source.startsWith('diff --git ')
    ? source.split(/(?=^diff --git )/m).filter(Boolean)
    : [source]
  // Incomplete headers are normal during streaming; don't hand them to the parser.
  if (
    patches.some(
      (patch) =>
        !patch.startsWith('@@ ') &&
        patch
          .split('\n@@ ', 1)[0]
          .split('\n')
          .some(
            (line, index, lines) =>
              (line.startsWith('diff --git ') &&
                !/^diff --git (?:"?a\/).+ (?:"?b\/).+/.test(line)) ||
              (line.startsWith('--- ') && !lines[index + 1]?.startsWith('+++ '))
          )
    ) ||
    source
      .split('\n')
      .some((line) => line.startsWith('@@') && !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line))
  )
    return null

  const files = getRenderedDiffFiles(
    { path: '', kind: 'edit', diff: source },
    { includeMetadataOnly: true }
  )
  if (files.length === 0) return null

  return (
    renderToStaticMarkup(
      createElement(
        'div',
        { className: 'markdown-diff' },
        files.map(({ file, tokens }, index) => {
          const path = file.newPath === '/dev/null' ? file.oldPath : file.newPath
          const renamed = file.type === 'rename' || file.type === 'copy'
          // Preserve metadata-only changes (renames, modes, binary/empty files).
          const metadata = patches[index]
          return createElement(
            'section',
            { key: index },
            createElement(
              'div',
              { className: 'markdown-diff__path' },
              renamed ? `${file.oldPath} → ${file.newPath}` : path === 'file' ? 'Changes' : path
            ),
            createElement(
              'div',
              {
                className: 'markdown-diff__scroll',
                role: 'region',
                tabIndex: 0,
                'aria-label': `Diff for ${path}`
              },
              file.hunks.length > 0
                ? createElement(Diff, {
                    className: 'unified-diff',
                    diffType: file.type,
                    hunks: file.hunks,
                    tokens,
                    viewType: 'unified'
                  })
                : createElement('pre', { className: 'markdown-diff__metadata' }, metadata)
            )
          )
        })
      )
    ) + '\n'
  )
}

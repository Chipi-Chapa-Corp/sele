import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  readMeToolName,
  showWidgetToolName,
  widgetResultMarker
} from '../providers/VisualizationToolPresentation.ts'

export const maxWidgetBytes = 1_000_000

const modules = ['diagram', 'mockup', 'interactive', 'chart', 'art'] as const
type VisualizationModule = (typeof modules)[number]

export const visualizationToolInstructions =
  'Use the visualize tools to show charts, diagrams, interactive explainers, UI mockups and illustrations inline in Sele’s chat. Call read_me once per conversation with the modules you need, then call show_widget with an HTML or SVG fragment. Prefer a widget when a visual explains something better than prose; keep explanations in your reply text, not inside the widget.'

const core = `# Sele inline visualizations

show_widget renders \`widget_code\` inline in the conversation, inside a sandboxed frame on an opaque origin. The user sees it directly below your tool call; you do not see the rendered result.

## Fragment rules
- Send a fragment only: no doctype, \`<html>\`, \`<head>\` or \`<body>\`.
- Order content as a short \`<style>\` block, then markup, then \`<script>\` last. Scripts run once, in document order, after the markup is inserted. \`<script type="module">\` and top-level await work.
- External scripts, styles and fonts may load only from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh, fonts.googleapis.com, fonts.gstatic.com and fonts.bunny.net. Pin library versions.
- Network requests (fetch, XHR, WebSocket), nested frames, forms, objects, popups, navigation and storage are blocked. Embed all data inline.
- Keep the fragment self-contained and under 1 MB. Skip comments; they cost tokens.
- The frame height follows your content automatically. Width is the chat column (roughly 360–900 px); layouts must reflow. The user can expand the widget into a resizable dialog.

## Theme
Both light and dark mode are used; every color must work in both. The background is transparent, so do not paint a page background. Use these CSS variables instead of literal colors:
- Text: \`--color-text-primary\`, \`--color-text-secondary\`, \`--color-text-tertiary\`
- Surfaces: \`--color-background-primary\`, \`--color-background-secondary\`, \`--color-background-tertiary\`
- Borders: \`--color-border-primary\`, \`--color-border-secondary\`, \`--color-border-tertiary\`
- Accent: \`--color-accent\`; named hues \`--blue\`, \`--orange\`, \`--green\`, \`--red\`, \`--purple\`, \`--yellow\`
- Data series, in order: \`--viz-series-1\` … \`--viz-series-6\`
- Radii: \`--radius-sm\`, \`--radius-md\`, \`--radius-lg\`
In scripts, read a value with \`getComputedStyle(document.body).getPropertyValue('--color-text-secondary')\`. Theme changes update \`document.documentElement.style.colorScheme\`; colors defined through the variables follow automatically.

## Typography
Text inherits the system UI font at 14 px. Use 12–16 px for body text and labels, weights 400 and 500 only, sentence case, and \`.tabular-nums\` for aligned numbers.

## Built-in helpers
- Classes: \`.card\`, \`.btn\` with \`.btn-primary\` or \`.btn-ghost\`, \`.form-label\`, \`.form-control\`, \`.form-select\`, \`.form-range\`, \`.form-check\`, \`.form-switch\`, \`.table\`, \`.nav.nav-pills\` with \`.nav-link\`, \`.progress\`/\`.progress-bar\`, \`.viz-grid\`, \`.viz-row\`, \`.viz-controls\`, \`.viz-stat\`/\`.viz-stat-value\`, \`.viz-badge\`, \`.text-muted\`, \`.text-small\`.
- Tooltips: add \`data-tooltip="…"\` (optional \`data-tooltip-placement\`) to any element.
- Icons: \`<i data-lucide="chart-line"></i>\` renders a Lucide icon after your scripts finish.
- \`sendPrompt(text)\` asks the user to confirm, then sends \`text\` as their next chat message. Use it for drill-down or "explain this" buttons; it returns a promise that rejects if the user cancels.

## Quality
One idea per widget. Label units and axes, keep visible text short, and make every control keyboard accessible. Avoid heavy shadows, gradients and blur.`

const sections: Record<VisualizationModule, string> = {
  chart: `## Charts
- Chart.js: \`<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>\`. Put the canvas inside a wrapper with an explicit height (for example 280 px) and set \`maintainAspectRatio: false\`.
- Read colors from the CSS variables at render time; set \`color\`, grid and tick colors from the text and border variables so both themes stay legible.
- Show a legend only for more than one series. Format ticks and tooltips with units. Prefer bars for comparisons, lines for trends and scatter plots for correlation; avoid pie charts beyond five slices.
- For bespoke charts, D3 is available from esm.sh: \`import * as d3 from 'https://esm.sh/d3@7'\` in a module script.`,
  diagram: `## Diagrams
- Draw inline SVG with a \`viewBox\` and \`width="100%"\`; let height follow the aspect ratio. Keep text at 12 px or larger in rendered size.
- Use \`fill\`/\`stroke\` values from the CSS variables (or \`currentColor\`). Define arrowheads once with \`<marker>\`.
- Lay flows out left to right or top to bottom, align nodes to a grid, and keep labels inside their shapes. Prefer at most a dozen nodes; split larger systems into several widgets.
- Group related nodes with a tinted background (\`--color-background-secondary\`) rather than thick borders.`,
  interactive: `## Interactive explainers
- Keep state in plain variables and update only the affected DOM nodes on input; never rebuild the whole fragment.
- Use \`.viz-controls\` for sliders, selects and toggles, with visible labels and current values.
- Give immediate visual feedback, sensible defaults and a reset button. State is not persisted.
- Use \`sendPrompt\` only for actions that genuinely continue the conversation.`,
  mockup: `## UI mockups
- Compose screens from \`.card\`, buttons, form controls, \`.table\` and \`.nav\` helpers. Use realistic content, not lorem ipsum.
- Make primary actions obvious and keep spacing on a 4 px grid. Show the important state (empty, loading or error) the user asked about.
- Controls may be interactive, but nothing is saved or submitted.`,
  art: `## Illustrations
- Use inline SVG with a \`viewBox\`, a limited palette from the CSS variables, and simple geometric shapes.
- CSS animation is fine; wrap it in \`@media (prefers-reduced-motion: no-preference)\`.
- Keep illustrations decorative and lightweight; include \`role="img"\` and an \`aria-label\`.`
}

export const getVisualizationGuide = (requested: readonly string[]): string => {
  const selected = modules.filter((module) => requested.includes(module))
  return [core, ...selected.map((module) => sections[module])].join('\n\n')
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
export type VisualizationTool = {
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  execute(input: unknown): Promise<ToolResult>
}

const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(isError ? { isError: true } : {})
})

const fileStem = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'widget'

const readMeSchema = z.object({
  modules: z
    .array(z.enum(modules))
    .describe('Guidance modules to load for the widgets you plan to build.')
})
const showWidgetSchema = z.object({
  i_have_seen_read_me: z
    .boolean()
    .describe('Confirm that read_me has been called in this conversation.'),
  title: z.string().min(1).max(120).describe('Short snake_case identifier for the widget.'),
  loading_messages: z
    .array(z.string().max(120))
    .max(4)
    .optional()
    .describe('One to four short status lines shown while the widget renders.'),
  widget_code: z
    .string()
    .min(1)
    .describe('HTML or SVG fragment to render. No doctype, html, head or body elements.')
})

/** Provider-neutral inline widget tools; widgets are written beneath the given directory. */
export function createVisualizationTools(directory: string): VisualizationTool[] {
  return [
    {
      name: readMeToolName,
      description:
        'Load the rules for building inline visualizations in Sele. Call once before the first show_widget call in a conversation, with every module you need.',
      schema: readMeSchema,
      execute: async (input) => text(getVisualizationGuide(readMeSchema.parse(input).modules))
    },
    {
      name: showWidgetToolName,
      description:
        'Render an HTML or SVG fragment inline in the chat as an interactive widget: charts, diagrams, explainers, mockups or illustrations. Follow the read_me guidance.',
      schema: showWidgetSchema,
      execute: async (input) => {
        const args = showWidgetSchema.parse(input)
        if (!args.i_have_seen_read_me)
          return text('Call read_me with the modules you need before calling show_widget.', true)
        if (Buffer.byteLength(args.widget_code, 'utf8') > maxWidgetBytes)
          return text('The widget exceeds the 1 MB limit. Reduce embedded data and retry.', true)
        await mkdir(directory, { recursive: true })
        const path = join(directory, `${fileStem(args.title)}-${randomUUID().slice(0, 8)}.html`)
        await writeFile(path, args.widget_code, { encoding: 'utf8', mode: 0o600 })
        return text(
          JSON.stringify({
            [widgetResultMarker]: true,
            status: 'rendered',
            title: args.title,
            path
          })
        )
      }
    }
  ]
}

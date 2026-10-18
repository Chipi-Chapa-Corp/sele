import { z } from 'zod'
import { computerAutomation } from './ComputerAutomation'

export const computerToolSchema = z.object({
  action: z.enum(['screenshot', 'move', 'click', 'drag', 'key', 'type', 'scroll']),
  x: z.number().finite().nonnegative().optional(),
  y: z.number().finite().nonnegative().optional(),
  toX: z.number().finite().nonnegative().optional(),
  toY: z.number().finite().nonnegative().optional(),
  button: z.number().int().min(1).max(3).optional(),
  count: z.number().int().min(1).max(3).optional(),
  key: z.string().min(1).max(100).optional(),
  text: z.string().max(10000).optional(),
  dx: z.number().finite().min(-2000).max(2000).optional(),
  dy: z.number().finite().min(-2000).max(2000).optional()
})
export const computerToolDescription =
  'Control the user-shared native desktop. The user must connect it in Sele Settings first. Screenshot returns full-resolution coordinates. Use screenshot before choosing coordinates. click/move/drag require x,y; drag also requires toX,toY. key accepts chords such as ctrl+l, Return, Tab, Escape. type inserts text. scroll accepts dx,dy in pixels. Access is separate from the filesystem sandbox; respect the user’s requested app and task.'
export async function executeComputerTool(
  input: unknown
): Promise<{
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}> {
  try {
    const args = computerToolSchema.parse(input)
    if (['move', 'click', 'drag'].includes(args.action) && (args.x == null || args.y == null))
      throw new Error('This action requires x and y.')
    if (args.action === 'drag' && (args.toX == null || args.toY == null))
      throw new Error('Drag requires toX and toY.')
    if (args.action === 'key' && !args.key) throw new Error('Key is required.')
    if (args.action === 'type' && args.text == null) throw new Error('Text is required.')
    const result = await computerAutomation.execute(args)
    if (args.action === 'screenshot' && typeof result.data === 'string')
      return {
        content: [
          {
            type: 'text',
            text: `Shared desktop: ${result.width} × ${result.height}. Coordinates refer to this full image.`
          },
          { type: 'image', data: result.data, mimeType: 'image/png' }
        ]
      }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
    }
  }
}

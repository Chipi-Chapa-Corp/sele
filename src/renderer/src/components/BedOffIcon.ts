import { createLucideIcon } from 'lucide-react'

// Lucide has no crossed-out bed. This is its `bed` with the lines cut back around the
// slash, as Lucide's own `-off` icons are, so the slash stays legible at small sizes.
export const BedOff = createLucideIcon('bed-off', [
  ['path', { d: 'M2 6v14', key: 'post' }],
  ['path', { d: 'M2 8h3', key: 'head' }],
  ['path', { d: 'M11 8h9a2 2 0 0 1 2 2v7', key: 'mattress' }],
  ['path', { d: 'M2 17h12', key: 'frame' }],
  ['path', { d: 'M6 11v6', key: 'pillow' }],
  ['path', { d: 'm2 2 20 20', key: 'slash' }]
])

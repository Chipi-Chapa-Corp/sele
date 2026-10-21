import { Component, type ReactNode, type RefObject } from 'react'

type Props = {
  present: boolean
  enabled: boolean
  elementRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}
type Position = {
  node: HTMLDivElement
  width: string
  height: string
  top: number
  left: number
}
const properties = ['position', 'width', 'height', 'top', 'left'] as const

/**
 * Snapshot before DOM mutations, then pop the exiting element out of the flow.
 * Motion's popLayout does this with a new stylesheet per exit. Inline styles keep
 * completion local instead of invalidating styles for the entire workspace.
 */
export class InlinePopLayout extends Component<Props> {
  private restore: (() => void) | null = null

  getSnapshotBeforeUpdate(previous: Props): Position | null {
    const node = this.props.elementRef.current
    if (!previous.present || this.props.present || !this.props.enabled || !node) return null
    const style = getComputedStyle(node)
    return {
      node,
      width: style.width,
      height: style.height,
      top: node.offsetTop,
      left: node.offsetLeft
    }
  }

  componentDidUpdate(_previous: Props, _state: unknown, snapshot: Position | null): void {
    if (this.props.present || !this.props.enabled) {
      this.restore?.()
      this.restore = null
    } else if (snapshot && this.props.elementRef.current === snapshot.node) {
      const { node, width, height, top, left } = snapshot
      const before = properties.map((property) => [
        property,
        node.style.getPropertyValue(property),
        node.style.getPropertyPriority(property)
      ])
      this.restore = () => {
        for (const [property, value, priority] of before) {
          if (value) node.style.setProperty(property, value, priority)
          else node.style.removeProperty(property)
        }
      }
      node.style.position = 'absolute'
      node.style.width = width
      node.style.height = height
      node.style.top = `${top}px`
      node.style.left = `${left}px`
    }
  }

  render(): ReactNode {
    return this.props.children
  }
}

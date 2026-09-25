import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'

/** An indexed, ordered working set. Arrays handed to the renderer are never changed again. */
export class CopilotEventStore<Event extends { id: string }> {
  private records: Event[]
  private readonly positions = new Map<string, number>()
  private readonly times: number[] = []
  // A supplied array may already have been used as a renderer cache key.
  private published = true
  private previous: Event[] | null = null
  private changedFrom = Number.POSITIVE_INFINITY
  private readonly timestamp: (event: Event) => number

  constructor(records: Event[], timestamp: (event: Event) => number) {
    this.records = records
    this.timestamp = timestamp
    records.forEach((event, index) => {
      if (this.positions.has(event.id)) throw new Error(`Duplicate Copilot event ID: ${event.id}`)
      this.positions.set(event.id, index)
      this.times.push(this.effectiveTimestamp(event))
    })
  }

  get events(): Event[] {
    return this.records
  }

  /** Register provenance only when the complete batch is ready for a reader. */
  seal(): Event[] {
    if (this.previous) {
      markTranscriptRecordsChanged(this.previous, this.records, this.changedFrom)
      this.previous = null
      this.changedFrom = Number.POSITIVE_INFINITY
    }
    this.published = true
    return this.records
  }

  add(event: Event): Event[] {
    const time = this.effectiveTimestamp(event)
    const previousPosition = this.positions.get(event.id)
    if (
      previousPosition != null &&
      this.records[previousPosition] === event &&
      this.times[previousPosition] === time
    )
      return this.records

    if (this.published) {
      this.previous = this.records
      this.records = this.records.slice()
      this.published = false
    }

    if (previousPosition == null) {
      const position = this.upperBound(time)
      this.records.splice(position, 0, event)
      this.times.splice(position, 0, time)
      this.reindex(position)
      this.changedFrom = Math.min(this.changedFrom, position)
      return this.records
    }

    const oldTime = this.times[previousPosition]!
    if (oldTime === time) {
      this.records[previousPosition] = event
      this.changedFrom = Math.min(this.changedFrom, previousPosition)
      return this.records
    }

    this.records.splice(previousPosition, 1)
    this.times.splice(previousPosition, 1)
    const lower = this.lowerBound(time)
    const upper = this.upperBound(time)
    // Stable sorting keeps a replacement in its previous relative position among equal times.
    const position = Math.max(lower, Math.min(previousPosition, upper))
    this.records.splice(position, 0, event)
    this.times.splice(position, 0, time)
    this.reindex(Math.min(previousPosition, position))
    this.changedFrom = Math.min(this.changedFrom, previousPosition, position)
    return this.records
  }

  private lowerBound(time: number): number {
    let low = 0
    let high = this.times.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.times[middle]! < time) low = middle + 1
      else high = middle
    }
    return low
  }

  private upperBound(time: number): number {
    let low = 0
    let high = this.times.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.times[middle]! <= time) low = middle + 1
      else high = middle
    }
    return low
  }

  private reindex(start: number): void {
    for (let index = start; index < this.records.length; index += 1) {
      this.positions.set(this.records[index]!.id, index)
    }
  }

  private effectiveTimestamp(event: Event): number {
    const value = this.timestamp(event)
    return Number.isFinite(value) ? value : Date.now()
  }
}

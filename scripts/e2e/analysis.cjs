// Frame pacing and visual stability verdicts for recordings made by page.cjs.
const { budgets } = require('./runner.cjs')

/** Report frame pacing for a recording against the shared budgets. */
function frames(context, recording, prefix = '') {
  if (!recording || recording.frames < 3) {
    context.note(`${prefix}too few frames recorded (${recording?.frames ?? 0})`)
    return
  }
  context.metric(prefix + 'maxFrame', recording.maxFrame, budgets.maxFrame)
  context.metric(prefix + 'p95Frame', recording.p95Frame, budgets.p95Frame)
  context.metric(prefix + 'maxLongTask', recording.maxLongTask, budgets.maxLongTask)
  context.metric(
    prefix + 'slowFrameRatio',
    Number((recording.slowFrames / recording.frames).toFixed(3)),
    budgets.slowFrameRatio
  )
  if (recording.layoutShift > 0) context.metric(prefix + 'layoutShift', recording.layoutShift)
}

/**
 * Find visual jumps in element tracks. `direction` is the expected motion of content:
 * 'down' while scrolling up (content moves down), 'up' while scrolling down or while new
 * messages push content up, 'still' when nothing should move.
 */
function jumps(samples, direction, { tolerance = 2, maxStep = Infinity } = {}) {
  const problems = []
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (!previous.id || previous.id !== current.id || previous.top === null || current.top === null)
      continue
    const delta = current.top - previous.top
    const wrong =
      direction === 'still'
        ? Math.abs(delta) > tolerance
        : direction === 'down'
          ? delta < -tolerance
          : delta > tolerance
    if (wrong || Math.abs(delta) > maxStep)
      problems.push({
        frame: index,
        id: current.id,
        delta: Math.round(delta),
        scrollTop: current.scrollTop
      })
  }
  return problems
}

function reportJumps(context, samples, direction, options = {}, label = 'jumps') {
  const problems = jumps(samples ?? [], direction, options)
  context.metric(label, problems.length, 0)
  if (problems.length) {
    context.note(`${label}: ${JSON.stringify(problems.slice(0, 6))}`)
    const first = problems[0].frame
    const window = (samples ?? []).slice(Math.max(0, first - 3), first + 4)
    context.note(
      `${label} around frame ${first}: tops ${window.map((sample) => (sample.top === null ? 'null' : Math.round(sample.top))).join(' → ')}`
    )
  }
  return problems
}

module.exports = { frames, jumps, reportJumps }

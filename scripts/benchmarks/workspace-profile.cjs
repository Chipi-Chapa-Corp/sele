// Match renderer long-task timestamps to sampled call stacks on Chromium's
// monotonic clock, using NavigationStart rather than wall-clock timestamps.
exports.attributeTasks = (profile, phases) => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map(
    profile.nodes.flatMap((node) => (node.children ?? []).map((id) => [id, node.id]))
  )
  let time = profile.startTime
  const samples = profile.samples.map((id, index) => {
    const start = time
    time += profile.timeDeltas[index]
    return { id, start, end: time }
  })
  const stackOf = (id) => {
    const stack = []
    for (let node = nodes.get(id); node; node = nodes.get(parents.get(node.id))) {
      const f = node.callFrame
      if (f.functionName === '(root)') break
      stack.push({
        function: f.functionName || '(anonymous)',
        url: f.url,
        line: f.lineNumber + 1,
        column: f.columnNumber + 1
      })
    }
    return stack.reverse()
  }
  return phases.map((phase) => ({
    label: phase.label,
    tasks: phase.tasks.map((task) => {
      const start = phase.navigationStart * 1e6 + task.startTime * 1000
      const end = start + task.duration * 1000
      const costs = new Map()
      for (const sample of samples) {
        const overlap = Math.min(end, sample.end) - Math.max(start, sample.start)
        if (overlap > 0) costs.set(sample.id, (costs.get(sample.id) ?? 0) + overlap / 1000)
      }
      return {
        ...task,
        sampledMs: [...costs.values()].reduce((a, b) => a + b, 0),
        stacks: [...costs]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, ms]) => ({ selfMs: ms, stack: stackOf(id) }))
      }
    })
  }))
}

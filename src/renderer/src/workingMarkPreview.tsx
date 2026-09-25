import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkingMark, type WorkingMarkAnimation } from './components/WorkingMark'
import './assets/styles/tokens.css'
import './assets/styles/base.css'
import './components/ChatDetailItem.css'
import './workingMarkPreview.css'

function PreviewRow({
  animation,
  title,
  speed
}: {
  animation: WorkingMarkAnimation
  title: string
  speed: number
}) {
  return (
    <section className="working-mark-preview__row">
      <h2>{title}</h2>
      <div className="chat-detail__tool-read chat-detail__tool-read--active chat-detail__tool-placeholder">
        <span className="chat-detail__tool-icon">
          <WorkingMark animation={animation} speed={speed} />
        </span>
        <span className="chat-detail__tool-label">Working on your request…</span>
      </div>
    </section>
  )
}

function WorkingMarkPreview() {
  const [speed, setSpeed] = useState(1)
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.colorScheme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  return (
    <main className="working-mark-preview">
      <h1>Working placeholder preview</h1>
      <div className="working-mark-preview__controls">
        <div className="working-mark-preview__slider">
          <label htmlFor="working-mark-speed">Speed</label>
          <input
            id="working-mark-speed"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
          <output htmlFor="working-mark-speed">{speed.toFixed(1)}×</output>
        </div>
        <label className="working-mark-preview__toggle">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(event) => setDarkMode(event.target.checked)}
          />
          Dark mode
        </label>
        <p className="working-mark-preview__hint">
          Swap and depth swap run at 1.5× base speed; spin runs at 1×. The slider multiplies all
          three.
        </p>
      </div>
      <PreviewRow animation="swap" title="Swap" speed={speed} />
      <PreviewRow animation="spin" title="Spin" speed={speed} />
      <PreviewRow animation="depth" title="Depth swap" speed={speed} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<WorkingMarkPreview />)

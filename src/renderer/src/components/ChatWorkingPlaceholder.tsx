import { useEffect, useRef, useState } from 'react'
import 'react-diff-view/style/index.css'
import type { ProviderWorkingStep } from '../../../shared/provider'
import { useReducedMotionPreference } from '../motion/useReducedMotionPreference'
import './ChatDetailItem.css'
import './UnifiedDiff.css'
import { WorkingElapsedTime } from './WorkingElapsedTime'
import { WorkingMark, type WorkingMarkAnimation } from './WorkingMark'

export const placeholderOptions = [
  'Thinking',
  'Analyzing',
  'Processing',
  'Working',
  'Vibing',
  'Bribing beavers',
  'Bribing monkeys',
  'Bribing ducks',
  'Drinking water',
  'Drinking whisky',
  'Scrolling Instagram',
  'Scrolling YouTube',
  'Scrolling TikTok',
  'Bouncing logic trampolines',
  'Knitting cozy nonsense',
  'Brain buffering',
  'Consulting rubber duck',
  'Overclocking whimsy',
  'Brewing ideas',
  'Consulting the stars',
  'Hallucinating',
  'Overthinking',
  'Judging',
  'Consulting my cat',
  'Polishing pixels',
  'Negotiating with semicolons',
  'Asking the void nicely',
  'Herding stray thoughts',
  'Warming up neurons',
  'Untangling spaghetti logic',
  'Consulting ancient Stack Overflow',
  'Counting invisible chickens',
  'Shuffling imaginary paperwork',
  'Summoning the right answer',
  'Dusting off algorithms',
  'Feeding the hamsters',
  'Aligning cosmic brackets',
  'Interviewing suspicious variables',
  'Recalculating the vibes',
  'Chasing a runaway comma',
  'Teaching bytes to cooperate',
  'Decoding alien handwriting',
  'Inflating a fresh hypothesis',
  'Checking under the keyboard',
  'Arguing with probability',
  'Folding space-time',
  'Reticulating splines',
  'Spinning up tiny detectives',
  'Making electrons nervous',
  'Putting chaos in alphabetical order',
  'Convincing bugs to confess',
  'Reading tea leaves in binary',
  "Sharpening Occam's razor",
  'Loading common sense',
  'Borrowing a second brain',
  'Organizing the sock drawer',
  'Reversing the polarity',
  'Calibrating the nonsense detector',
  'Assembling a clue sandwich',
  'Poking the edge cases',
  'Translating from robot',
  'Sacrificing a semicolon',
  'Updating the prophecy',
  'Waiting for inspiration to compile',
  'Cross-examining the data',
  'Applying duct tape to logic',
  'Looking busy',
  'Running on pure audacity',
  'Dividing by not quite zero',
  'Making a long story longer',
  'Turning coffee into tokens',
  'Rehearsing the final answer',
  'Checking the manual upside down',
  'Pretending this is deterministic'
]

export const getRandomPlaceholderOption = (): (typeof placeholderOptions)[number] =>
  placeholderOptions[Math.floor(Math.random() * placeholderOptions.length)]

export const workingMarkAnimations: WorkingMarkAnimation[] = ['swap', 'spin', 'depth']

export const getRandomWorkingMarkAnimation = (): WorkingMarkAnimation =>
  workingMarkAnimations[Math.floor(Math.random() * workingMarkAnimations.length)]

export const WorkingPlaceholderLabel: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const [placeholder] = useState(() =>
    item.items.length === 0 ? 'Working…' : getRandomPlaceholderOption()
  )
  const labelRef = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotionPreference()

  // Match the composer's typewriter reveal without rerendering the conversation or timer.
  useEffect(() => {
    const node = labelRef.current
    if (!node) return
    if (reduced) {
      node.textContent = placeholder
      return
    }
    let index = 0
    node.textContent = ''
    const timer = window.setInterval(() => {
      index += 2
      node.textContent = placeholder.slice(0, index)
      if (index >= placeholder.length) window.clearInterval(timer)
    }, 30)
    return () => window.clearInterval(timer)
  }, [placeholder, reduced])

  return <span ref={labelRef}>{placeholder}</span>
}

export const WorkingPlaceholder: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const [animation] = useState(getRandomWorkingMarkAnimation)

  return (
    <div
      className="chat-detail__tool-read chat-detail__tool-read--active chat-detail__tool-placeholder"
      role="status"
      aria-label="Agent working"
    >
      <span className="chat-detail__tool-icon">
        <WorkingMark animation={animation} />
      </span>
      <span className="chat-detail__tool-label">
        {/* New activity changes the phrase without restarting the mark or timer.
            Provider ID handoffs keep the existing phrase and its reveal. */}
        <span className="chat-detail__working-phrase">
          <WorkingPlaceholderLabel key={item.itemCount ?? item.items.length} item={item} />
        </span>
        <WorkingElapsedTime item={item} />
      </span>
    </div>
  )
}

export const ChatWorkingPlaceholder: React.FC<{ item: ProviderWorkingStep }> = ({ item }) =>
  item.status === 'working' ? <WorkingPlaceholder item={item} /> : null

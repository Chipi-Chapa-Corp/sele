import { BotMessageSquare } from 'lucide-react'
import { useReducedMotionPreference } from '../motion/useReducedMotionPreference'
import { workingChatsImage } from './statusIconImages'
import './WorkingChatsIcon.css'

export function WorkingChatsIcon({ active }: { active: boolean }): React.ReactElement {
  const reducedMotion = useReducedMotionPreference()
  return active && !reducedMotion ? (
    <span className="working-chats-icon" aria-hidden="true">
      <span className="working-chats-icon__body" style={{ maskImage: workingChatsImage }} />
      <span className="working-chats-icon__dot working-chats-icon__dot--first" />
      <span className="working-chats-icon__dot working-chats-icon__dot--second" />
      <span className="working-chats-icon__dot working-chats-icon__dot--third" />
    </span>
  ) : (
    <BotMessageSquare aria-hidden="true" />
  )
}

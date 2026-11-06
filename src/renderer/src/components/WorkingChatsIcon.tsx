import { BotMessageSquare } from 'lucide-react'
import { Spinner } from './Spinner'

export function WorkingChatsIcon({ active }: { active: boolean }): React.ReactElement {
  return active ? (
    <Spinner className="working-chats-icon" aria-hidden="true" />
  ) : (
    <BotMessageSquare aria-hidden="true" />
  )
}

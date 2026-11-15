import {
  BookTextIcon as AnimatedBookTextIcon,
  BotIcon as AnimatedBotIcon,
  BoxIcon as AnimatedBoxIcon,
  CircleHelpIcon as AnimatedCircleHelpIcon,
  ClockIcon as AnimatedClockIcon,
  DeleteIcon as AnimatedDeleteIcon,
  EarthIcon as AnimatedEarthIcon,
  EyeIcon as AnimatedEyeIcon,
  FilePenLineIcon as AnimatedFilePenLineIcon,
  FileTextIcon as AnimatedFileTextIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  ListIcon as AnimatedListIcon,
  SearchIcon as AnimatedSearchIcon,
  SparklesIcon as AnimatedSparklesIcon,
  TerminalIcon as AnimatedTerminalIcon,
  WrenchIcon as AnimatedWrenchIcon,
  ZapIcon as AnimatedZapIcon
} from 'lucide-animated'
import {
  Blocks,
  BookOpenText,
  Bot,
  CircleQuestionMark,
  Clock,
  Eye,
  FileCode2,
  FilePlus2,
  FileText,
  GitBranch,
  Globe2,
  ListChecks,
  Package,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  Zap
} from 'lucide-react'
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react'
import { useEffect, useRef } from 'react'
import 'react-diff-view/style/index.css'
import type { ProviderToolActivity, ProviderToolIcon } from '../../../shared/provider'
import './ChatDetailItem.css'
import './UnifiedDiff.css'

type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number
    animateOnHover?: boolean
  } & RefAttributes<AnimatedIconHandle>
>

const animatedActivityIcons: Record<ProviderToolActivity, AnimatedIconComponent | null> = {
  'image-view': AnimatedEyeIcon,
  skill: AnimatedZapIcon,
  read: AnimatedFileTextIcon,
  search: AnimatedSearchIcon,
  git: AnimatedGitBranchIcon,
  edit: AnimatedFilePenLineIcon,
  create: AnimatedFileTextIcon,
  delete: AnimatedDeleteIcon,
  npm: AnimatedBoxIcon,
  npx: AnimatedBoxIcon,
  script: null,
  command: AnimatedTerminalIcon,
  other: AnimatedWrenchIcon
}

const animatedToolIcons: Record<ProviderToolIcon, AnimatedIconComponent> = {
  app: AnimatedBoxIcon,
  skill: AnimatedZapIcon,
  'image-view': AnimatedEyeIcon,
  'image-generation': AnimatedSparklesIcon,
  'openai-docs': AnimatedBookTextIcon,
  plan: AnimatedListIcon,
  question: AnimatedCircleHelpIcon,
  subagent: AnimatedBotIcon,
  time: AnimatedClockIcon,
  browser: AnimatedEarthIcon
}

const ToolTypeIcon: React.FC<{
  activity: ProviderToolActivity
  icon?: ProviderToolIcon | null
}> = ({ activity, icon }) => {
  if (icon === 'app') return <Blocks aria-hidden="true" />
  if (icon === 'skill' || activity === 'skill') return <Zap aria-hidden="true" />
  if (icon === 'browser') return <Globe2 aria-hidden="true" />
  if (icon === 'image-view' || activity === 'image-view') return <Eye aria-hidden="true" />
  if (icon === 'image-generation') return <Sparkles aria-hidden="true" />
  if (icon === 'openai-docs') return <BookOpenText aria-hidden="true" />
  if (icon === 'plan') return <ListChecks aria-hidden="true" />
  if (icon === 'question') return <CircleQuestionMark aria-hidden="true" />
  if (icon === 'subagent') return <Bot aria-hidden="true" />
  if (icon === 'time') return <Clock aria-hidden="true" />

  if (activity === 'read') return <FileText aria-hidden="true" />
  if (activity === 'search') return <Search aria-hidden="true" />
  if (activity === 'git') return <GitBranch aria-hidden="true" />
  if (activity === 'edit') return <Pencil aria-hidden="true" />
  if (activity === 'create') return <FilePlus2 aria-hidden="true" />
  if (activity === 'delete') return <Trash2 aria-hidden="true" />
  if (activity === 'npm' || activity === 'npx') return <Package aria-hidden="true" />
  if (activity === 'script') return <FileCode2 aria-hidden="true" />
  if (activity === 'command') return <Terminal aria-hidden="true" />

  return <Wrench aria-hidden="true" />
}

const ActiveAnimatedIcon: React.FC<{ Icon: AnimatedIconComponent }> = ({ Icon }) => {
  const iconRef = useRef<AnimatedIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current
    icon?.startAnimation()
    return () => icon?.stopAnimation()
  }, [])

  return (
    <Icon
      ref={iconRef}
      className="chat-detail__animated-icon"
      size={18}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

export const ToolStatusIcon: React.FC<{
  activity: ProviderToolActivity
  active: boolean
  icon?: ProviderToolIcon | null
}> = ({ activity, active, icon }) => {
  if (active) {
    const Icon = icon ? animatedToolIcons[icon] : animatedActivityIcons[activity]
    if (Icon) return <ActiveAnimatedIcon Icon={Icon} />
  }

  return <ToolTypeIcon activity={activity} icon={icon} />
}

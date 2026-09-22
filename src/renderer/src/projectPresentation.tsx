import {
  Gamepad2,
  Dices,
  Trophy,
  Network,
  Cloud,
  Shield,
  Settings,
  Cpu,
  Star,
  Sparkles,
  Moon,
  Sun,
  Rocket,
  Plane,
  Compass,
  Map,
  Mountain,
  Car,
  BriefcaseBusiness,
  Building2,
  ChartNoAxesCombined,
  Wallet,
  ShoppingCart,
  MessagesSquare,
  Mail,
  Users,
  Megaphone,
  Music,
  Camera,
  Video,
  Palette,
  BookOpen,
  GraduationCap,
  Heart,
  House,
  Coffee,
  Utensils,
  Leaf,
  Dumbbell,
  CalendarDays,
  Lightbulb,
  Code2,
  Database,
  Folder,
  GitBranch,
  Globe2,
  Package,
  Server,
  Smartphone
} from 'lucide-react'
import type { ElementType, ReactElement } from 'react'
import { appProjectGlyphIds, type AppProject, type AppProjectGlyph } from '../../shared/app'

const projectGlyphComponents = {
  folder: Folder,
  code: Code2,
  git: GitBranch,
  package: Package,
  database: Database,
  web: Globe2,
  mobile: Smartphone,
  server: Server,
  gamepad: Gamepad2,
  dice: Dices,
  trophy: Trophy,
  infrastructure: Network,
  cloud: Cloud,
  shield: Shield,
  settings: Settings,
  cpu: Cpu,
  star: Star,
  sparkles: Sparkles,
  moon: Moon,
  sun: Sun,
  rocket: Rocket,
  travel: Plane,
  compass: Compass,
  map: Map,
  mountain: Mountain,
  car: Car,
  business: BriefcaseBusiness,
  building: Building2,
  chart: ChartNoAxesCombined,
  wallet: Wallet,
  shopping: ShoppingCart,
  messaging: MessagesSquare,
  mail: Mail,
  users: Users,
  megaphone: Megaphone,
  music: Music,
  camera: Camera,
  video: Video,
  palette: Palette,
  book: BookOpen,
  graduation: GraduationCap,
  heart: Heart,
  home: House,
  coffee: Coffee,
  food: Utensils,
  leaf: Leaf,
  fitness: Dumbbell,
  calendar: CalendarDays,
  lightbulb: Lightbulb
} satisfies Record<AppProjectGlyph, ElementType>

export const projectGlyphLabels = {
  folder: 'Folder',
  code: 'Code project',
  git: 'Git repository',
  package: 'Package',
  database: 'Database',
  web: 'Web project',
  mobile: 'Mobile app',
  server: 'Backend service',
  gamepad: 'Games',
  dice: 'Dice & board games',
  trophy: 'Trophy',
  infrastructure: 'Infrastructure',
  cloud: 'Cloud',
  shield: 'Security',
  settings: 'Settings & tools',
  cpu: 'Hardware',
  star: 'Star',
  sparkles: 'Sparkles',
  moon: 'Moon',
  sun: 'Sun',
  rocket: 'Rocket',
  travel: 'Travel',
  compass: 'Explore',
  map: 'Map',
  mountain: 'Outdoors',
  car: 'Car',
  business: 'Business',
  building: 'Office',
  chart: 'Analytics',
  wallet: 'Finance',
  shopping: 'Shopping',
  messaging: 'Messaging',
  mail: 'Email',
  users: 'Team',
  megaphone: 'Announcements',
  music: 'Music',
  camera: 'Photography',
  video: 'Video',
  palette: 'Art & design',
  book: 'Books & learning',
  graduation: 'Education',
  heart: 'Heart',
  home: 'Home',
  coffee: 'Coffee',
  food: 'Food & cooking',
  leaf: 'Nature',
  fitness: 'Fitness',
  calendar: 'Calendar',
  lightbulb: 'Ideas'
} satisfies Record<AppProjectGlyph, string>

export const renderProjectGlyph = (glyph: AppProjectGlyph): ReactElement => {
  const Icon = projectGlyphComponents[glyph]
  return <Icon aria-hidden="true" />
}

export const formatProjectLabel = (label: string): string =>
  label.replaceAll('-', ' ').replace(/(^|\s)\S/g, (wordStart) => wordStart.toLocaleUpperCase())

export const getProjectFolderName = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export const getDefaultProjectName = (cwd: string): string =>
  formatProjectLabel(getProjectFolderName(cwd))

export const getProjectDisplayName = (project: Pick<AppProject, 'cwd' | 'name'>): string =>
  project.name.trim() || getDefaultProjectName(project.cwd)

export const projectGlyphOptions = appProjectGlyphIds.map((glyph) => ({
  value: glyph,
  label: projectGlyphLabels[glyph],
  icon: renderProjectGlyph(glyph)
}))

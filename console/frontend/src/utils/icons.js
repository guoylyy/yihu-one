// 应用图标库：从 Element Plus 图标里挑一批常用项
import {
  House, OfficeBuilding, User, UserFilled, Setting, Tools, DataAnalysis, DataLine,
  Document, Files, Folder, FolderOpened, Calendar, Clock, Bell, Message, ChatDotRound,
  Notebook, Edit, Search, Star, StarFilled, TrendCharts, PieChart, Histogram,
  Money, Wallet, CreditCard, ShoppingCart, Box, Goods, Grid, Monitor, Iphone,
  Printer, Picture, Camera, VideoCamera, Mic, MagicStick, Cpu, Coin, Ticket,
  Stamp, CollectionTag, Link, Share, Refresh, Flag, Trophy, Medal, AlarmClock,
  Timer, Lock, Key, Management, Platform, Location, MapLocation, Lightning, Opportunity, Present
} from '@element-plus/icons-vue'
import { BRAND_ICONS } from './brand-icons'

/** name → 组件。icon 字段用 `svg:<name>` 表示选中了某个内置图标 */
export const ICONS = {
  house: House,
  building: OfficeBuilding,
  user: User,
  userFilled: UserFilled,
  setting: Setting,
  tools: Tools,
  dataAnalysis: DataAnalysis,
  dataLine: DataLine,
  document: Document,
  files: Files,
  folder: Folder,
  folderOpened: FolderOpened,
  calendar: Calendar,
  clock: Clock,
  bell: Bell,
  message: Message,
  chat: ChatDotRound,
  notebook: Notebook,
  edit: Edit,
  search: Search,
  star: Star,
  starFilled: StarFilled,
  chart: TrendCharts,
  pie: PieChart,
  histogram: Histogram,
  money: Money,
  wallet: Wallet,
  creditCard: CreditCard,
  cart: ShoppingCart,
  box: Box,
  goods: Goods,
  grid: Grid,
  monitor: Monitor,
  phone: Iphone,
  printer: Printer,
  picture: Picture,
  camera: Camera,
  video: VideoCamera,
  mic: Mic,
  magic: MagicStick,
  cpu: Cpu,
  coin: Coin,
  ticket: Ticket,
  stamp: Stamp,
  tag: CollectionTag,
  link: Link,
  share: Share,
  refresh: Refresh,
  flag: Flag,
  trophy: Trophy,
  medal: Medal,
  alarm: AlarmClock,
  timer: Timer,
  lock: Lock,
  key: Key,
  management: Management,
  platform: Platform,
  location: Location,
  mapLocation: MapLocation,
  lightning: Lightning,
  opportunity: Opportunity,
  present: Present,
  ...BRAND_ICONS
}

/** 以虎官方图标：固定中性底 + 固定配色，不跟 iconColor */
export const isBrandIcon = (name) => !!name && name.startsWith('brand-')

/** 图标选择器「以虎官方」分组，按这个顺序显示 */
export const BRAND_OPTIONS = [
  { name: 'brand-inbox', label: '收件箱' },
  { name: 'brand-meeting', label: '会议与纪要' },
  { name: 'brand-expiry', label: '到期台账' },
  { name: 'brand-knowledge', label: '知识库' },
  { name: 'brand-hr', label: '人事考勤' },
  { name: 'brand-crm', label: '客户' },
  { name: 'brand-fde', label: '交付管理' },
  { name: 'brand-goods', label: '商品' },
  { name: 'brand-training', label: '培训' },
  { name: 'brand-finance', label: '财务' },
  { name: 'brand-account', label: '记账' },
  { name: 'brand-predict', label: '预测' }
]

export const ICON_OPTIONS = Object.keys(ICONS).filter(n => !isBrandIcon(n))

/** 图标选择器的预设颜色 */
export const PRESET_COLORS = [
  '#2563eb', '#0ea5e9', '#06b6d4', '#10b981', '#22c55e', '#eab308',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1'
]

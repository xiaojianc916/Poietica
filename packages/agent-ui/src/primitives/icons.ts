/*
 * 语义命名到图标库的唯一映射表，手工维护。
 *
 * 曾声明由根目录的 refactor.mjs 生成，但那个脚本已不在仓库里，声明因此是
 * 一句无法执行的话。别名与图标库的一致性由 typecheck 保证：库里改名或删掉
 * 某个字形，这里的 re-export 会直接编译失败。
 *
 * Aliases are resolved against the export list of the installed
 * @mynaui/icons-react build, so an icon-library upgrade that renames or removes a
 * glyph fails the script instead of the runtime.
 */

export {
  ArrowUp as SubmitIcon,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  DangerCircle as FailureIcon,
  Dots as MoreIcon,
  Edit as PencilIcon,
  File as FileIcon,
  FolderPlus as FolderPlusIcon,
  Globe as GlobeIcon,
  Message as ThreadIcon,
  Microphone as MicIcon,
  Paperclip as AttachIcon,
  Pin as PinIcon,
  PinSolid as PinFilledIcon,
  Plus as PlusIcon,
  Search as SearchIcon,
  Send as AgentIcon,
  Sparkles as ModelIcon,
  Spinner as SpinnerIcon,
  Square as StopIcon,
  Tool as ToolIcon,
  X as CloseIcon,
} from '@mynaui/icons-react'

/*
 * 设计系统里的本地字形（packages/ui/src/local-glyphs.tsx）。别名层在这里，
 * 所以调用点一个字都不用改。
 *
 * 它们不在图标库里，各有各的原因：库中没有 lightbulb；文件夹的开与合，库里
 * 只有「合」那一枚 —— 此前拿 FolderSolid 顶替 folder-open，而实心在本仓已经
 * 是「已固定」的说法（见 PinSolid），一种填法说两件事。
 */
export {
  FolderClosedIcon,
  FolderOpenIcon,
  LightbulbIcon as ThinkingIcon,
} from '@poietica/ui'

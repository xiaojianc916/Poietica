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
  Folder as FolderIcon,
  FolderPlus as FolderPlusIcon,
  FolderSolid as FolderFilledIcon,
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
 * 思考过程的字形不在图标库里：库中没有 lightbulb，所以它是设计系统里的一个
 * 本地字形（见 components/icons/local-glyphs.tsx 的说明）。别名层在这里，
 * 所以调用点一个字都不用改。
 */
export { LightbulbIcon as ThinkingIcon } from '@poietica/ui'

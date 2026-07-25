import type { SVGProps } from 'react'

/*
 * Inline glyphs traced against the product reference. currentColor only;
 * all sizing is owned by the skin stylesheet so geometry stays in one place.
 */

type IconProps = SVGProps<SVGSVGElement>

const BASE: IconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 1.6,
  viewBox: '0 0 24 24',
  xmlns: 'http://www.w3.org/2000/svg',
}

export function AsteriskMark(props: IconProps) {
  return (
    <svg {...BASE} strokeWidth={1.8} {...props}>
      <path d="M12 3.5v17M4.6 7.75l14.8 8.5M19.4 7.75l-14.8 8.5" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  )
}

export function ToolsIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="17" cy="7" r="2.6" />
      <circle cx="7" cy="17" r="2.6" />
      <path d="M14.4 17h5.2M17 14.4v5.2" />
    </svg>
  )
}

export function AgentIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M20.5 3.5 3.8 10.2a.5.5 0 0 0-.02.92l6.3 2.8 2.8 6.3a.5.5 0 0 0 .92-.02Z" />
      <path d="m10.1 13.9 4.6-4.6" />
    </svg>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect height="11" rx="3.2" width="6.4" x="8.8" y="2.6" />
      <path d="M5.6 11.2a6.4 6.4 0 0 0 12.8 0M12 17.6V21" />
    </svg>
  )
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...BASE} strokeWidth={2} {...props}>
      <path d="M12 19V5.6M6.2 11.4 12 5.6l5.8 5.8" />
    </svg>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <rect fill="currentColor" height="9" rx="1.8" stroke="none" width="9" x="7.5" y="7.5" />
    </svg>
  )
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg {...BASE} strokeWidth={2} {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" opacity="0.9" />
    </svg>
  )
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M18.4 11.6 12.1 17.9a4.1 4.1 0 0 1-5.8-5.8l7-7a2.9 2.9 0 0 1 4.1 4.1l-7 7a1.7 1.7 0 0 1-2.4-2.4l6.3-6.3" />
    </svg>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="M14 2.8H7.4A1.6 1.6 0 0 0 5.8 4.4v15.2a1.6 1.6 0 0 0 1.6 1.6h9.2a1.6 1.6 0 0 0 1.6-1.6V7Z" />
      <path d="M14 2.8V7h4.2" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2M12 3.4c2.3 2.4 3.4 5.3 3.4 8.6S14.3 18.2 12 20.6c-2.3-2.4-3.4-5.3-3.4-8.6S9.7 5.8 12 3.4Z" />
    </svg>
  )
}

import type { ReactNode } from 'react'
import { useCallback, useId, useState } from 'react'

import { ChevronDownIcon } from '../primitives/icons'

/*
 * A disclosure is a button and a region. A headless component library adds
 * nothing here that aria-expanded and aria-controls do not already provide,
 * and staying native keeps this package free of a second primitives stack.
 */

export type AgentDisclosureProps = {
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  summary: ReactNode
  tone?: 'default' | 'running' | 'failed'
}

export const AgentDisclosure = ({
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  summary,
  tone = 'default',
}: AgentDisclosureProps) => {
  const regionId = useId()
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : uncontrolled

  const toggle = useCallback(() => {
    const next = !isOpen
    if (!isControlled) {
      setUncontrolled(next)
    }
    onOpenChange?.(next)
  }, [isControlled, isOpen, onOpenChange])

  return (
    <div className="agent-disclosure" data-open={isOpen ? 'true' : 'false'} data-tone={tone}>
      <button
        aria-controls={regionId}
        aria-expanded={isOpen}
        className="agent-disclosure__summary"
        onClick={toggle}
        type="button"
      >
        <ChevronDownIcon className="agent-disclosure__chevron" />
        {summary}
      </button>
      <div className="agent-disclosure__region" hidden={!isOpen} id={regionId} role="group">
        {children}
      </div>
    </div>
  )
}

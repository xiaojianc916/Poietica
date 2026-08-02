import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * A section that opens.
 *
 * The default is the content's business, and in this product it is always the
 * same question: is this still happening? A live thought chain and a running
 * tool call are open; both close when they settle, however they settle. A click
 * is an opinion that outranks the default from then on, which is why the
 * override is state and the default is derived rather than synchronised in an
 * effect — the default must be free to keep changing until someone disagrees.
 */
export function useDisclosure(fallback: boolean): {
  readonly isOpen: boolean
  readonly toggle: () => void
} {
  const [override, setOverride] = useState<boolean | null>(null)
  const isOpen = override ?? fallback

  return {
    isOpen,
    toggle: () => {
      setOverride(!isOpen)
    },
  }
}

/**
 * The travelling part of a disclosure.
 *
 * The content stays mounted: unmounting it is why a panel snaps instead of
 * opening, as there is nothing to animate between a node and no node. It lives
 * in a grid row that travels between 0fr and 1fr, the one way an intrinsic
 * height animates without being measured in script. Closed, the row is inert,
 * so its content is out of reach of the keyboard and of a screen reader.
 *
 * The BEM prefix stays with the caller, so each panel keeps its own scope and
 * sharing this costs the stylesheet nothing.
 */
export function DisclosureBody({
  block,
  children,
  isOpen,
}: {
  readonly block: string
  readonly children: ReactNode
  readonly isOpen: boolean
}) {
  return (
    <div className={`${block}__reveal`} inert={!isOpen}>
      <div className={`${block}__clip`}>{children}</div>
    </div>
  )
}

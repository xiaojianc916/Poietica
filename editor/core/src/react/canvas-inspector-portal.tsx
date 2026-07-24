import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { StylePanelContextProvider, useEditor, useRelevantStyles, useValue } from 'tldraw'
import { PropertiesInspectorContent } from './PropertiesInspectorContent'

interface CanvasInspectorPortalContextValue {
  readonly host: HTMLElement | null
  readonly available: boolean
  readonly setHost: (host: HTMLElement | null) => void
  readonly publishAvailability: (owner: symbol, available: boolean) => void
  readonly releaseAvailability: (owner: symbol) => void
}

const CanvasInspectorPortalContext = createContext<CanvasInspectorPortalContextValue | null>(null)

export interface CanvasInspectorPortalProviderProps {
  readonly children: ReactNode
}

export function CanvasInspectorPortalProvider({ children }: CanvasInspectorPortalProviderProps) {
  const [host, setHostState] = useState<HTMLElement | null>(null)

  const [available, setAvailable] = useState(false)

  const publishers = useRef(new Map<symbol, boolean>())

  const setHost = useCallback((nextHost: HTMLElement | null) => {
    setHostState(nextHost)
  }, [])

  const recomputeAvailability = useCallback(() => {
    setAvailable(Array.from(publishers.current.values()).some(Boolean))
  }, [])

  const publishAvailability = useCallback(
    (owner: symbol, nextAvailable: boolean) => {
      publishers.current.set(owner, nextAvailable)

      recomputeAvailability()
    },
    [recomputeAvailability],
  )

  const releaseAvailability = useCallback(
    (owner: symbol) => {
      publishers.current.delete(owner)

      recomputeAvailability()
    },
    [recomputeAvailability],
  )

  const value = useMemo<CanvasInspectorPortalContextValue>(
    () => ({
      host,
      available,
      setHost,
      publishAvailability,
      releaseAvailability,
    }),
    [host, available, setHost, publishAvailability, releaseAvailability],
  )

  return (
    <CanvasInspectorPortalContext.Provider value={value}>
      {children}
    </CanvasInspectorPortalContext.Provider>
  )
}

export function CanvasInspectorRightSidebar() {
  const context = useRequiredCanvasInspectorPortal()

  const setHost = context.setHost

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      setHost(node)
    },
    [setHost],
  )

  return <div className="hc-properties-sidebar" data-properties-sidebar="" ref={ref} />
}

export function useCanvasInspectorAvailability(): boolean {
  return useRequiredCanvasInspectorPortal().available
}

export interface CanvasInspectorStylePanelProps {
  readonly active: boolean
}

export function CanvasInspectorStylePanel({ active }: CanvasInspectorStylePanelProps) {
  const context = useRequiredCanvasInspectorPortal()

  const editor = useEditor()
  const styles = useRelevantStyles()

  const selectedShapeCount = useValue(
    'properties inspector selected shape count',
    () => editor.getSelectedShapeIds().length,
    [editor],
  )

  const owner = useRef(Symbol('canvas-inspector-style-panel'))

  /*
   * useRelevantStyles() 决定官方样式内容。
   *
   * selectedShapeCount > 0 保证 Image、Frame、Group
   * 等没有普通 StyleProp 的对象仍可显示对象操作。
   */
  const available = active && (styles !== null || selectedShapeCount > 0)

  useEffect(() => {
    const currentOwner = owner.current

    context.publishAvailability(currentOwner, available)

    return () => {
      context.releaseAvailability(currentOwner)
    }
  }, [available, context.publishAvailability, context.releaseAvailability])

  if (!active || !context.host || !available) {
    return null
  }

  return createPortal(
    styles ? (
      <StylePanelContextProvider styles={styles}>
        <PropertiesInspectorContent selectedShapeCount={selectedShapeCount} styles={styles} />
      </StylePanelContextProvider>
    ) : (
      <PropertiesInspectorContent selectedShapeCount={selectedShapeCount} styles={null} />
    ),
    context.host,
  )
}

function useRequiredCanvasInspectorPortal(): CanvasInspectorPortalContextValue {
  const context = useContext(CanvasInspectorPortalContext)

  if (!context) {
    throw new Error('CANVAS_INSPECTOR_PORTAL_PROVIDER_MISSING')
  }

  return context
}

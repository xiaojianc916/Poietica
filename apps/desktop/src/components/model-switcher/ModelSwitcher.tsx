import { type KeyboardEvent, useCallback, useEffect, useRef } from 'react'
import './model-switcher.css'
import { ModelRow } from './ModelRow'
import {
  formatContext,
  type ModelDescriptor,
  optionDomId,
  RUN_MODES,
  THINKING_LEVELS,
} from './model-catalog'
import { SegmentedControl } from './SegmentedControl'
import { useModelSwitcher } from './useModelSwitcher'

const LIST_DOM_ID = 'ms-model-listbox'

interface ModelSwitcherProps {
  models?: readonly ModelDescriptor[]
  dark?: boolean
}

export function ModelSwitcher({ models, dark = false }: ModelSwitcherProps) {
  const switcher = useModelSwitcher(models)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { closePanel, openPanel, open } = switcher

  /* Capture-phase dismissal. More reliable than onBlur + relatedTarget, and it
   * keeps event handlers off the non-interactive wrapper element. */
  const dismissOnOutside = useCallback(
    (event: Event) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target) === true) {
        return
      }
      closePanel()
    },
    [closePanel],
  )

  useEffect(() => {
    if (!open) {
      return () => undefined
    }
    inputRef.current?.focus()
    document.addEventListener('pointerdown', dismissOnOutside, true)
    document.addEventListener('focusin', dismissOnOutside, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutside, true)
      document.removeEventListener('focusin', dismissOnOutside, true)
    }
  }, [open, dismissOnOutside])

  function togglePanel(): void {
    if (open) {
      closePanel()
      return
    }
    openPanel()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!open) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      switcher.move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      switcher.move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      switcher.commitActive()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePanel()
    }
  }

  function handleHover(id: string): void {
    const index = switcher.flat.findIndex((model) => model.id === id)
    if (index >= 0) {
      switcher.setActiveIndex(index)
    }
  }

  const activeDescendant =
    switcher.activeModel === undefined ? undefined : optionDomId(switcher.activeModel.id)

  return (
    <div className={dark ? 'ms-scope ms-theme-dark ms-shell' : 'ms-scope ms-shell'} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="ms-trigger ms-focus-ring"
        onClick={togglePanel}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span aria-hidden="true" className="ms-trigger__dot" />
        <span className="ms-trigger__name">{switcher.selected?.label ?? 'Select model'}</span>
        <span className="ms-trigger__meta">
          {switcher.selected === undefined ? '' : formatContext(switcher.selected.contextTokens)}
        </span>
        <span aria-hidden="true" className="ms-trigger__caret">
          ⌄
        </span>
      </button>

      {open ? (
        <section aria-label="Model and run settings" className="ms-panel">
          <header className="ms-panel__search">
            <span aria-hidden="true" className="ms-panel__icon">
              ⌕
            </span>
            <input
              aria-activedescendant={activeDescendant}
              aria-autocomplete="list"
              aria-controls={LIST_DOM_ID}
              aria-expanded={true}
              aria-label="Search models"
              className="ms-panel__input"
              onChange={(event) => {
                switcher.setQuery(event.target.value)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models, capabilities…"
              ref={inputRef}
              role="combobox"
              spellCheck={false}
              type="text"
              value={switcher.query}
            />
            <kbd className="ms-kbd">Esc</kbd>
          </header>

          <div
            aria-label="Available models"
            className="ms-panel__list"
            id={LIST_DOM_ID}
            role="listbox"
          >
            {switcher.groups.map((group) => (
              <div key={group.key} role="presentation">
                <p className="ms-panel__group">{group.label}</p>
                {group.models.map((model) => (
                  <ModelRow
                    active={switcher.activeModel?.id === model.id}
                    key={model.id}
                    model={model}
                    onChoose={switcher.select}
                    onHover={handleHover}
                    onPin={switcher.toggleFavorite}
                    pinned={switcher.favorites.includes(model.id)}
                    selected={model.id === switcher.modelId}
                  />
                ))}
              </div>
            ))}
            {switcher.flat.length === 0 ? (
              <p className="ms-panel__empty">No model matches “{switcher.query}”.</p>
            ) : null}
          </div>

          <footer className="ms-panel__footer">
            <SegmentedControl
              label="Thinking"
              onChange={switcher.setThinking}
              options={THINKING_LEVELS}
              value={switcher.thinking}
            />
            <SegmentedControl
              label="Mode"
              onChange={switcher.setMode}
              options={RUN_MODES}
              value={switcher.mode}
            />
            <p className="ms-panel__hint">
              <kbd className="ms-kbd">↑</kbd>
              <kbd className="ms-kbd">↓</kbd> navigate · <kbd className="ms-kbd">↵</kbd> select ·{' '}
              <kbd className="ms-kbd">★</kbd> pin
            </p>
          </footer>
        </section>
      ) : null}
    </div>
  )
}

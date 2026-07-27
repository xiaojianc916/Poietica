import { useEffect } from 'react'

import type { CommandRegistry } from '../../application/public-api'

/*
 * 快捷键的唯一真相源是命令自身声明的 shortcut，写作与平台无关的逻辑形式
 * （Mod+K、Mod+Shift+P）。本模块是这份声明的唯一消费者：
 *
 *   - 匹配按物理键位（event.code），不受 CapsLock、输入法与键盘布局影响；
 *   - 修饰键全等比较，Mod+Shift+K 不会命中 Mod+K；
 *   - 显示按平台渲染，macOS 给 ⌘ / ⌥ / ⇧，其余平台给 Ctrl / Alt / Shift。
 *
 * 曾经存在第二份声明（桌面壳里的绑定常量表），它与 register 的 shortcut 各自
 * 演化，已经出现只有一边有绑定的命令。派生优于同步：这里只留一份。
 */

const APPLE = /Mac|iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent ?? '')

interface Keybinding {
  readonly code: string
  readonly mod: boolean
  readonly shift: boolean
  readonly alt: boolean
}

const parsed = new Map<string, Keybinding | null>()

function toKeyCode(key: string): string {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`
  }

  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`
  }

  return key
}

function parseKeybinding(shortcut: string): Keybinding | null {
  const cached = parsed.get(shortcut)

  if (cached !== undefined) {
    return cached
  }

  const parts = shortcut.split('+')
  const key = parts.at(-1)
  const binding =
    key === undefined || key === ''
      ? null
      : {
          code: toKeyCode(key),
          mod: parts.includes('Mod'),
          shift: parts.includes('Shift'),
          alt: parts.includes('Alt'),
        }

  parsed.set(shortcut, binding)

  return binding
}

/** 把逻辑快捷键渲染成当前平台的习惯写法。 */
export function formatKeybinding(shortcut: string): string {
  const parts = shortcut.split('+').map((part) => {
    switch (part) {
      case 'Mod':
        return APPLE ? '⌘' : 'Ctrl'

      case 'Alt':
        return APPLE ? '⌥' : 'Alt'

      case 'Shift':
        return APPLE ? '⇧' : 'Shift'

      default:
        return part.length === 1 ? part.toUpperCase() : part
    }
  })

  return parts.join(APPLE ? '' : '+')
}

/*
 * 文本录入区内不接管按键：Mod+B 在编辑器里是加粗，不是切换侧边栏。
 * 这与专业编辑器的 when-context 隔离是同一个约定。
 */
const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_ENTRY_SELECTOR) !== null
}

/** 把注册表里所有命令的 shortcut 声明接上真实键盘事件。 */
export function useCommandKeybindings(registry: CommandRegistry): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || event.repeat || isTextEntry(event.target)) {
        return
      }

      const mod = event.ctrlKey || event.metaKey

      for (const command of registry.getSnapshot()) {
        if (command.shortcut === undefined) {
          continue
        }

        const binding = parseKeybinding(command.shortcut)

        if (
          binding === null ||
          binding.code !== event.code ||
          binding.mod !== mod ||
          binding.shift !== event.shiftKey ||
          binding.alt !== event.altKey
        ) {
          continue
        }

        event.preventDefault()
        void registry.execute(command.id)

        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [registry])
}

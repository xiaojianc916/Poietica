import { invoke } from '@poietica/desktop-ipc'

export interface SystemTheme {
  getTheme(): Promise<'light' | 'dark' | 'system'>
  setTheme(theme: 'light' | 'dark' | 'system'): Promise<void>
}

export function createSystemTheme(): SystemTheme {
  return {
    getTheme: () => invoke('theme_get'),
    setTheme: (theme) => invoke('theme_set', { theme }),
  }
}

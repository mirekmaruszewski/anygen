export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'anygen-theme'

/** Light/dark switch; the choice is stored in localStorage and applied as `<html data-theme>`. */
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'light')

  const apply = (value: Theme) => {
    theme.value = value
    document.documentElement.dataset.theme = value
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Storage may be unavailable (private mode); the switch still works for this session.
    }
  }

  const init = () => {
    const current = document.documentElement.dataset.theme
    theme.value = current === 'dark' ? 'dark' : 'light'
  }

  const toggle = () => apply(theme.value === 'dark' ? 'light' : 'dark')

  return { theme, init, toggle }
}

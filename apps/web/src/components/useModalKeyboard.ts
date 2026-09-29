import { useEffect, useLayoutEffect, useRef } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function useModalKeyboard(open: boolean, titleId: string, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useLayoutEffect(() => {
    if (!open) return
    const dialog = document.getElementById(titleId)?.closest<HTMLElement>('[aria-modal="true"]')
    if (!dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0)
    const initial = focusable().find((element) => element.hasAttribute('autofocus')) ?? focusable()[0] ?? dialog
    const addedTabIndex = initial === dialog && !dialog.hasAttribute('tabindex')
    if (addedTabIndex) dialog.tabIndex = -1
    initial.focus({ preventScroll: true })

    const isTopmost = () => Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1) === dialog
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmost()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      if (elements.length === 0) { event.preventDefault(); dialog.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!isTopmost() || dialog.contains(event.target as Node)) return
      ;(focusable()[0] ?? dialog).focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      if (addedTabIndex) dialog.removeAttribute('tabindex')
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true })
        else {
          const main = document.querySelector<HTMLElement>('main.page-content')
          if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }) }
        }
      })
    }
  }, [open, titleId])
}

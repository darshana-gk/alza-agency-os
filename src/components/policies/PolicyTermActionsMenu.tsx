import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, FileText, Plus, RefreshCw, Repeat } from 'lucide-react'

export function PolicyTermActionsMenu({
  policyNumber,
  canView = true,
  canAddTransaction = false,
  canRenew = false,
  canRewrite = false,
  onView,
  onAddTransaction,
  onRenew,
  onRewrite,
}: {
  policyNumber: string
  canView?: boolean
  canAddTransaction?: boolean
  canRenew?: boolean
  canRewrite?: boolean
  onView?: () => void
  onAddTransaction?: () => void
  onRenew?: () => void
  onRewrite?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const items = [
    ...(canView && onView
      ? [{ id: 'view' as const, label: 'View Policy', icon: FileText, onSelect: onView }]
      : []),
    ...(canAddTransaction && onAddTransaction
      ? [{ id: 'add' as const, label: 'Add Transaction', icon: Plus, onSelect: onAddTransaction }]
      : []),
    ...(canRenew && onRenew
      ? [{ id: 'renew' as const, label: 'Renew Policy', icon: RefreshCw, onSelect: onRenew }]
      : []),
    ...(canRewrite && onRewrite
      ? [{ id: 'rewrite' as const, label: 'Rewrite Policy', icon: Repeat, onSelect: onRewrite }]
      : []),
  ]

  function closeMenu(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  function placeMenu() {
    const button = buttonRef.current
    const menu = menuRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuWidth = menu?.offsetWidth || 168
    const menuHeight = menu?.offsetHeight || 96
    const gap = 4
    let left = rect.right - menuWidth
    if (left < 8) left = 8
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8)
    }
    let top = rect.bottom + gap
    if (top + menuHeight > window.innerHeight - 8 && rect.top - gap - menuHeight >= 8) {
      top = rect.top - gap - menuHeight
    }
    setMenuPos({ top, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    placeMenu()
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    first?.focus()

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
        return
      }
      const menuItems = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      )
      if (menuItems.length === 0) return
      const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = currentIndex < 0 ? 0 : (currentIndex + 1) % menuItems.length
        menuItems[next]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        const next = currentIndex <= 0 ? menuItems.length - 1 : currentIndex - 1
        menuItems[next]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        menuItems[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        menuItems[menuItems.length - 1]?.focus()
      } else if (event.key === 'Tab') {
        closeMenu()
      }
    }
    function onReposition() {
      placeMenu()
    }
    function onScrollClose(event: Event) {
      const target = event.target
      if (target === document || target === document.documentElement || target === document.body) {
        placeMenu()
        return
      }
      closeMenu()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onScrollClose, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onScrollClose, true)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${policyNumber}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="inline-flex h-8 items-center gap-0.5 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Actions
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={`Actions for ${policyNumber}`}
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-50 min-w-[10.5rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                  onClick={() => {
                    closeMenu()
                    item.onSelect()
                  }}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

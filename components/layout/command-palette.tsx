"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { Session } from "next-auth"
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"
import { MagnifyingGlass, ArrowElbowDownLeft } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { NAV_ICONS } from "./nav-icons"
import { flattenNavTargets, type NavTarget } from "./nav-items"

const OPEN_EVENT = "open-command-palette"

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

// When the user types a record code prefix, inject a direct "jump to list filtered"
// result so they can land on that record without knowing which page to go to.
const CODE_SHORTCUTS: { pattern: RegExp; href: (q: string) => string; label: (q: string) => string; areaLabel: string; iconName: string }[] = [
  {
    pattern:   /^sol/i,
    href:      (q) => `/solicitudes?q=${encodeURIComponent(q.trim().toUpperCase())}`,
    label:     (q) => `Buscar "${q.trim().toUpperCase()}" en Solicitudes`,
    areaLabel: "Adquisiciones",
    iconName:  "ClipboardText",
  },
  {
    pattern:   /^oc/i,
    href:      (q) => `/compras?q=${encodeURIComponent(q.trim().toUpperCase())}`,
    label:     (q) => `Buscar "${q.trim().toUpperCase()}" en Compras`,
    areaLabel: "Adquisiciones",
    iconName:  "ShoppingCart",
  },
]

export function CommandPalette({ session, enabledModuleIds }: { session: Session; enabledModuleIds?: string[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLUListElement>(null)

  const enabledSet = React.useMemo(
    () => (enabledModuleIds ? new Set(enabledModuleIds) : undefined),
    [enabledModuleIds],
  )
  const targets = React.useMemo(() => flattenNavTargets(session, enabledSet), [session, enabledSet])

  const results = React.useMemo(() => {
    const raw = query.trim()
    const q = normalize(raw)
    const navResults = q
      ? targets.filter((t) => normalize(t.label).includes(q) || normalize(t.areaLabel).includes(q))
      : targets

    if (!raw) return navResults

    // Prepend direct-jump shortcuts for record code prefixes (SOL-/OC-)
    const shortcuts: NavTarget[] = CODE_SHORTCUTS
      .filter((s) => s.pattern.test(raw))
      .map((s) => ({ href: s.href(raw), label: s.label(raw), areaLabel: s.areaLabel, iconName: s.iconName }))

    return [...shortcuts, ...navResults]
  }, [targets, query])

  // Global hotkey + imperative open
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    function onOpen() { setOpen(true) }
    window.addEventListener("keydown", onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  React.useEffect(() => {
    if (open) { setQuery(""); setActive(0) }
  }, [open])

  function go(target: NavTarget | undefined) {
    if (!target) return
    setOpen(false)
    router.push(target.href)
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]) }
  }

  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="left-1/2 top-[12vh] z-[61] -translate-x-1/2 translate-y-0 w-[min(36rem,calc(100vw-2rem))] max-w-none p-0 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] shadow-[var(--shadow-lg)] [&>button:last-child]:hidden"
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>Buscar y navegar</DialogTitle>
        </VisuallyHidden>

          <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4">
            <MagnifyingGlass size={18} className="shrink-0 text-(--color-text-subtle)" />
            <input
              autoFocus
              value={query}
              // Reiniciar el resaltado aquí (y no en un efecto sobre `query`)
              // evita un frame en que la fila resaltada apunta a otro resultado.
              onChange={(e) => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onInputKey}
              placeholder="Ir a... o escribe SOL-/OC- para buscar registros"
              aria-label="Buscar páginas"
              className="h-12 flex-1 bg-transparent text-[15px] text-(--color-text) outline-none placeholder:text-(--color-text-subtle)"
            />
            <kbd className="hidden shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-(--color-text-subtle) sm:block">esc</kbd>
          </div>

          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-(--color-text-muted)">Sin resultados para “{query}”.</p>
          ) : (
            <ul ref={listRef} className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
              {results.map((t, i) => {
                const Icon = NAV_ICONS[t.iconName]
                const isActive = i === active
                return (
                  <li key={`${t.href}-${t.label}`}>
                    <button
                      type="button"
                      data-active={isActive}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(t)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors duration-(--duration-fast)",
                        isActive ? "bg-[var(--color-primary-tint)]" : "hover:bg-surface-2",
                      )}
                    >
                      {Icon && <Icon size={18} className={cn("shrink-0", isActive ? "text-(--color-primary)" : "text-(--color-text-muted)")} />}
                      <span title={t.label} className="flex-1 truncate text-sm font-medium text-(--color-text)">{t.label}</span>
                      <span className="shrink-0 text-xs text-(--color-text-subtle)">{t.areaLabel}</span>
                      {isActive && <ArrowElbowDownLeft size={14} className="shrink-0 text-(--color-text-faint)" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </DialogContent>
    </Dialog>
  )
}

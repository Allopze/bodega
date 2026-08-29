"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { SelectSearchableContext, SelectFilterContext, getNodeText } from "./select-context"
import { SelectScrollDownButton, SelectScrollUpButton } from "./select-parts"

export {
  SelectGroup,
  SelectValue,
  SelectScrollUpButton,
  SelectScrollDownButton,
  SelectLabel,
  SelectSeparator,
} from "./select-parts"

// ─── Select (wrapper around Radix Root) ─────────────────────────────
function Select({
  searchable,
  onOpenChange,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root> & {
  searchable?: boolean
}) {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)

  if (!searchable) {
    return (
      <SelectPrimitive.Root onOpenChange={onOpenChange} {...props}>
        {children}
      </SelectPrimitive.Root>
    )
  }

  return (
    <SelectSearchableContext.Provider value={{ query, setQuery, open }}>
      <SelectPrimitive.Root
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setQuery("")
          onOpenChange?.(nextOpen)
        }}
        {...props}
      >
        {children}
      </SelectPrimitive.Root>
    </SelectSearchableContext.Provider>
  )
}

// ─── SelectTrigger ──────────────────────────────────────────────────
const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { error?: boolean }
>(({ className, error, children, ...props }, ref) => {
  const searchCtx = React.useContext(SelectSearchableContext)
  const inputRef  = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (searchCtx?.open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [searchCtx?.open])

  React.useEffect(() => {
    const el = inputRef.current
    if (!el || !searchCtx?.open) return

    function blockRadix(e: KeyboardEvent) {
      if (["ArrowUp", "ArrowDown", "Home", "End", "Tab", "Escape"].includes(e.key)) return
      e.stopImmediatePropagation()
    }
    el.addEventListener("keydown", blockRadix, true)
    return () => el.removeEventListener("keydown", blockRadix, true)
  }, [searchCtx?.open])

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        // Sin `min-w-0` en el trigger a propósito: dejarlo encoger por debajo de
        // su contenido lo llevaba a ~23px de ancho en layouts apretados (lo
        // detectó zoom-200.spec.ts a 960px; el mínimo de WCAG 2.5.8 es 24px).
        // El truncado no lo necesita: lo resuelve el `min-w-0` del span.
        "flex h-11 sm:h-9 w-full items-center justify-between gap-2 rounded-(--radius-lg)",
        "border border-[var(--color-border-control)] bg-[var(--color-surface)]",
        "px-3.5 py-1.5 text-base sm:text-sm text-[var(--color-text)]",
        // El trigger tiene altura fija: sin truncado, una opción larga (nombre
        // de actividad, razón social) se parte en varias líneas y el texto se
        // dibuja FUERA del borde, encima del contenido vecino. El span es el
        // que renderiza SelectValue; el icono es un svg y no lo alcanza.
        "[&>span]:block [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left",
        "transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "active:scale-[0.99]",
        "hover:border-[var(--color-border-control-hover)]",
        "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[placeholder]:text-[var(--color-text-subtle)]",
        "",
        error && "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger-line)]",
        className,
      )}
      {...props}
    >
      {searchCtx && searchCtx.open ? (
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={searchCtx.query}
          onChange={(e) => searchCtx.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (["ArrowUp", "ArrowDown", "Home", "End", "Tab", "Escape"].includes(e.key)) return
            e.stopPropagation()
          }}
          placeholder="Buscar..."
          aria-label="Buscar en opciones"
          className="min-w-0 flex-1 bg-transparent text-base sm:text-sm text-(--color-text) outline-none placeholder:text-[var(--color-text-subtle)]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        children
      )}
      <SelectPrimitive.Icon asChild>
        <CaretDown className="h-3.5 w-3.5 text-[var(--color-text-subtle)] shrink-0" weight="bold" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

// ─── SelectContent ──────────────────────────────────────────────────
const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => {
  const searchCtx = React.useContext(SelectSearchableContext)

  const [localQuery, setLocalQuery] = React.useState("")
  const query   = searchCtx ? searchCtx.query : localQuery

  const searchInputRef     = React.useRef<HTMLInputElement>(null)
  const stoleInitialFocusRef = React.useRef(false)

  function handleContentFocus(event: React.FocusEvent<HTMLDivElement>) {
    if (searchCtx) return
    if (stoleInitialFocusRef.current || event.target === searchInputRef.current) return
    stoleInitialFocusRef.current = true
    searchInputRef.current?.focus()
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (["ArrowUp", "ArrowDown", "Home", "End", "Tab", "Escape"].includes(event.key)) return
    event.stopPropagation()
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 min-w-[8rem] max-h-(--radix-select-content-available-height) overflow-x-hidden overflow-y-auto",
          "rounded-[var(--radius-xl)] border border-[var(--color-border)]",
          "bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
          "origin-[var(--radix-select-content-transform-origin)]",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "duration-[var(--duration-default)] ease-[var(--ease-out)]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
        onFocus={handleContentFocus}
      >
        {!searchCtx && (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5">
            <MagnifyingGlass size={13} weight="bold" className="shrink-0 text-[var(--color-text-subtle)]" />
            <input
              ref={searchInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar..."
              aria-label="Buscar en opciones"
              className="h-5 w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-text-subtle"
            />
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          <SelectFilterContext.Provider value={query.trim().toLowerCase()}>
            {children}
          </SelectFilterContext.Provider>
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

// ─── SelectItem ─────────────────────────────────────────────────────
const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, textValue, ...props }, ref) => {
  const query   = React.useContext(SelectFilterContext)
  const searchableText = textValue ?? getNodeText(children)
  const matches = query === "" || searchableText.toLowerCase().includes(query)

  return (
    <SelectPrimitive.Item
      ref={ref}
      hidden={!matches}
      className={cn(
        "relative w-full cursor-default select-none items-center",
        matches ? "flex" : "hidden",
        "rounded-[var(--radius-sm)] py-1.5 pl-2 pr-8 text-sm",
        "text-[var(--color-text)] outline-none",
        "focus:bg-[var(--color-primary-tint)] focus:text-[var(--color-primary-ink)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        "transition-colors duration-[var(--duration-fast)]",
        className,
      )}
      textValue={textValue}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" weight="bold" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
})
SelectItem.displayName = SelectPrimitive.Item.displayName

export {
  Select, SelectTrigger,
  SelectContent, SelectItem,
}

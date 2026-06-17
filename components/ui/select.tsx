"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CaretDown, CaretUp, Check, MagnifyingGlass } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

// ─── Search contexts ────────────────────────────────────────────────
// SelectSearchableContext: shared between Trigger and Content when a
// <Select searchable> is used.  The Trigger renders the search input;
// the Content reads the query to filter items.
const SelectSearchableContext = React.createContext<{
  query:   string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  open:    boolean
} | null>(null)

// SelectFilterContext: always provided by SelectContent so that
// SelectItem can filter itself.  When searchable, the value comes from
// the Trigger's input; otherwise from the Content's own search bar.
const SelectFilterContext = React.createContext("")

function getNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getNodeText).join("")
  if (React.isValidElement(node)) {
    return getNodeText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}

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
      // Wait for Radix open animation before focusing
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [searchCtx?.open])

  // Capture-phase listener to block Radix typeahead before it sees keystrokes
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
        "flex h-9 w-full items-center justify-between gap-2 rounded-(--radius-lg)",
        "border border-[var(--color-border)] bg-[var(--color-surface)]",
        "px-3.5 py-1.5 text-sm text-[var(--color-text)]",
        "transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-[var(--color-border-strong)]",
        "focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary-line)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[placeholder]:text-[var(--color-text-subtle)]",
        "active:scale-[0.99]",
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
          className="min-w-0 flex-1 bg-transparent text-sm text-(--color-text) outline-none placeholder:text-[var(--color-text-subtle)]"
          onClick={(e) => { e.stopPropagation(); e.preventDefault() }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
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

// ─── Scroll buttons ─────────────────────────────────────────────────
const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <CaretUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <CaretDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName

// ─── SelectContent ──────────────────────────────────────────────────
const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => {
  const searchCtx = React.useContext(SelectSearchableContext)

  // When searchable, the query lives in the Trigger's input.
  // Otherwise, Content manages its own search bar.
  const [localQuery, setLocalQuery] = React.useState("")
  const query   = searchCtx ? searchCtx.query : localQuery
  const setQuery = searchCtx ? searchCtx.setQuery : setLocalQuery

  const searchInputRef     = React.useRef<HTMLInputElement>(null)
  const stoleInitialFocusRef = React.useRef(false)

  function handleContentFocus(event: React.FocusEvent<HTMLDivElement>) {
    // When searchable, the Trigger input owns focus — don't steal it.
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

// ─── SelectLabel ────────────────────────────────────────────────────
const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-medium text-[var(--color-text-subtle)] uppercase tracking-wide", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

// ─── SelectItem ─────────────────────────────────────────────────────
const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => {
  const query   = React.useContext(SelectFilterContext)
  const matches = query === "" || getNodeText(children).toLowerCase().includes(query)

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

// ─── SelectSeparator ────────────────────────────────────────────────
const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[var(--color-border)]", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select, SelectGroup, SelectValue, SelectTrigger,
  SelectContent, SelectLabel, SelectItem, SelectSeparator,
}

"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, onClick, onKeyDown, ...props }, forwardedRef) => {
  const listRef = React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null)

  React.useImperativeHandle(forwardedRef, () => listRef.current as React.ElementRef<typeof TabsPrimitive.List>, [])

  const revealActiveTab = React.useCallback(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    // jsdom no implementa scrollIntoView, así que sin la guardia cualquier
    // prueba de componente que monte pestañas revienta al primer render con
    // "scrollIntoView is not a function" — y la pestaña sólo se revela para
    // hacerla alcanzable, nunca es un requisito de corrección.
    if (typeof active?.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
  }, [])

  const scheduleActiveTabReveal = React.useCallback(() => {
    queueMicrotask(revealActiveTab)
  }, [revealActiveTab])

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    revealActiveTab()
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "aria-selected" || mutation.attributeName === "data-state")) revealActiveTab()
    })
    observer.observe(list, { attributes: true, attributeFilter: ["aria-selected", "data-state"], subtree: true })

    return () => observer.disconnect()
  }, [revealActiveTab])

  return (
    <TabsPrimitive.List
      ref={listRef}
      onClick={(event) => {
        onClick?.(event)
        scheduleActiveTabReveal()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        scheduleActiveTabReveal()
      }}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto p-1 rounded-[var(--radius)]",
        "bg-[var(--color-surface-2)]",
        className,
      )}
      {...props}
    />
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex min-h-11 sm:min-h-0 items-center justify-center px-4 py-1.5",
      "text-sm font-semibold text-[var(--color-text-muted)]",
      "rounded-[var(--radius)]",
      "transition-[color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
      "active:bg-[var(--color-surface-3)]",
      "hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]",
      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
      "data-[state=active]:text-[var(--color-text)] data-[state=active]:bg-[var(--color-surface)] data-[state=active]:shadow-[var(--shadow-xs)]",
      "disabled:pointer-events-none disabled:opacity-45",
      "whitespace-nowrap",
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none",
      // Emil: subtle fade on tab switch — prevents jarring content swap
      "data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-top-1",
      "data-[state=active]:duration-[var(--duration-fast)] data-[state=active]:ease-[var(--ease-out)]",
      "data-[state=inactive]:hidden",
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }

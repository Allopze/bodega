"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 p-1 rounded-[var(--radius)]",
      "bg-[var(--color-surface-2)]",
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative px-4 py-1.5",
      "text-sm font-semibold text-[var(--color-text-muted)]",
      "rounded-[var(--radius)]",
      "transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
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

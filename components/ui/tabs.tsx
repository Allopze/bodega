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
      "flex gap-0 border-b border-[var(--color-border)]",
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
      "relative px-4 py-2.5 -mb-px",
      "text-sm font-medium text-[var(--color-text-muted)]",
      "border-b-2 border-transparent",
      "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
      "hover:text-[var(--color-text)]",
      // Focus: show ring above the tab bar (outline-offset negative keeps it inside)
      "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] focus-visible:rounded-[var(--radius-sm)]",
      "data-[state=active]:text-[var(--color-primary)] data-[state=active]:border-[var(--color-primary)]",
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

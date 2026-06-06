"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

// ── Re-export Dialog root primitives unchanged ────────────────────────────────
const Sheet      = DialogPrimitive.Root
const SheetClose = DialogPrimitive.Close

// ── Overlay ───────────────────────────────────────────────────────────────────
const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[var(--color-overlay)]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "duration-[250ms]",
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = "SheetOverlay"

// ── Panel content ─────────────────────────────────────────────────────────────
const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Position: right side, full height
        "fixed right-0 top-0 z-50 h-full w-full max-w-md",
        "bg-[var(--color-surface)]",
        "border-l border-[var(--color-border)]",
        "shadow-[var(--shadow-lg)]",
        "flex flex-col",
        // Entry/exit: slide from the right
        // Tailwind animate-in/animate-out + translate for the drawer curve
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
        "duration-[250ms]",
        // Use the --ease-drawer CSS variable via inline style (see style prop below)
        className,
      )}
      style={{ animationTimingFunction: "var(--ease-drawer)" }}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
SheetContent.displayName = "SheetContent"

// ── Header ────────────────────────────────────────────────────────────────────
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-start justify-between gap-4",
      "px-6 py-5",
      "border-b border-[var(--color-border)]",
      "shrink-0",
      className,
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

// ── Body (scrollable) ─────────────────────────────────────────────────────────
const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 overflow-y-auto px-6 py-5", className)} {...props} />
)
SheetBody.displayName = "SheetBody"

// ── Footer ────────────────────────────────────────────────────────────────────
const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-end gap-2",
      "px-6 py-4",
      "border-t border-[var(--color-border)]",
      "shrink-0",
      className,
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

// ── Title & Description ───────────────────────────────────────────────────────
const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-base font-semibold text-[var(--color-text)]", className)}
    {...props}
  />
))
SheetTitle.displayName = "SheetTitle"

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[var(--color-text-muted)] mt-0.5", className)}
    {...props}
  />
))
SheetDescription.displayName = "SheetDescription"

// ── Close button ──────────────────────────────────────────────────────────────
function SheetCloseButton() {
  return (
    <DialogPrimitive.Close
      className={cn(
        "shrink-0 rounded-[var(--radius-sm)]",
        "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
        "transition-[color,transform] duration-[var(--duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        "active:scale-[0.95]",
      )}
    >
      <X size={16} weight="bold" />
      <span className="sr-only">Cerrar</span>
    </DialogPrimitive.Close>
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
}

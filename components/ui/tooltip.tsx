"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const TooltipRoot     = TooltipPrimitive.Root
const TooltipTrigger  = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { instant?: boolean }
>(({ className, sideOffset = 6, instant, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-[var(--radius-sm)]",
        "bg-[var(--color-text)] text-[var(--color-surface)] text-xs px-2 py-1",
        "shadow-[var(--shadow-md)]",
        "max-w-[16rem] text-center select-none",
        // Emil: origin-aware — scale from trigger, not center
        "origin-[var(--radix-tooltip-content-transform-origin)]",
        // Emil: entrance with scale(0.95) + opacity — never scale(0)
        "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95",
        "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
        // Emil: tooltips < 200ms — tight, responsive
        "duration-[var(--duration-fast)]",
        // Emil: skip animation on subsequent tooltips (once one is open, instant rest)
        instant && "data-[instant]:!duration-0",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

/** Convenience wrapper — wraps a single trigger child with a tooltip.
 *  - Uses state to track whether any tooltip in the group has been opened.
 *  - Once the first tooltip opens, subsequent tooltips skip animation (instant).
 *  - Emil: "once one tooltip is open, hovering over adjacent tooltips
 *    should open them instantly with no animation." */
function Tooltip({
  content,
  side = "bottom",
  delayDuration = 400,
  children,
}: {
  content:        React.ReactNode
  side?:          "top" | "right" | "bottom" | "left"
  delayDuration?: number
  children:       React.ReactNode
}) {
  const [hasOpened, setHasOpened] = React.useState(false)

  return (
    <TooltipProvider delayDuration={delayDuration} skipDelayDuration={0}>
      <TooltipRoot
        onOpenChange={(open) => {
          if (open) setHasOpened(true)
        }}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} instant={hasOpened}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent }

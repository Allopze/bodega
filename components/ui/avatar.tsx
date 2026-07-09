import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { cn, getInitials } from "@/lib/utils"

const AvatarRoot = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
))
AvatarRoot.displayName = AvatarPrimitive.Root.displayName

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center",
      "font-sans font-semibold",
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName

/* ── Avatar: high-level component ────────────────────────────────────────── */
// Uses initials from name — no egg icons, no broken Unsplash links.
// Color is generated deterministically from the user's name/email.

interface AvatarProps {
  name:       string
  hue?:       number   // if provided, overrides the generated hue
  size?:      "xs" | "sm" | "default" | "lg"
  className?: string
}

const SIZE_CLASSES = {
  xs:      "h-6 w-6 text-[10px]",
  sm:      "h-7 w-7 text-xs",
  default: "h-8 w-8 text-sm",
  lg:      "h-10 w-10 text-base",
}

export function Avatar({ name, hue, size = "default", className }: AvatarProps) {
  const initials = getInitials(name)
  // Deterministic hue from name if not provided; medium lightness, medium chroma
  const h = React.useMemo(
    () => hue ?? (Array.from(name).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360),
    [name, hue],
  )
  // Background: medium lightness, low-medium chroma — avoids garish extremes (impeccable law)
  const bg    = `oklch(0.72 0.09 ${h})`
  const color = `oklch(0.28 0.06 ${h})`

  return (
    <AvatarRoot
      className={cn(SIZE_CLASSES[size], className)}
      style={{ backgroundColor: bg }}
    >
      <AvatarFallback style={{ color }} delayMs={0}>
        {initials}
      </AvatarFallback>
    </AvatarRoot>
  )
}

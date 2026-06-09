"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/* ── Stagger ─────────────────────────────────────────────────────────────────
 * Applies cascading entrance animations to children.
 *
 * Usage: wrap a list of elements — each one fades in + slides up slightly
 * with a small delay between each, creating a natural cascading effect.
 *
 * Emil: "When multiple elements enter together, stagger their appearance.
 * Keep stagger delays short (30-80ms between items). Long delays make
 * the interface feel slow. Stagger is decorative — never block interaction
 * while stagger animations are playing."
 *
 * Respects prefers-reduced-motion via CSS variables (duration becomes 0ms).
 * ─────────────────────────────────────────────────────────────────────────── */

interface StaggerProps {
  children: React.ReactNode
  /** Delay increment between each item in ms. Default: 50 */
  stepDelay?: number
  /** Total duration of each item's animation in ms. Default: 250 */
  duration?: number
  /** Slide distance in px. Default: 6 */
  slideUp?: number
  className?: string
  /** Render as a different tag. Default: "div" */
  as?: "div" | "ol" | "ul"
}

export function Stagger({
  children,
  stepDelay = 50,
  duration = 250,
  slideUp = 6,
  className,
  as: Tag = "div",
}: StaggerProps) {
  const items = React.Children.toArray(children)

  return (
    <Tag className={cn(className)}>
      {items.map((child, i) => (
        <StaggerItem
          key={(child as React.ReactElement)?.key ?? i}
          delay={i * stepDelay}
          duration={duration}
          slideUp={slideUp}
        >
          {child}
        </StaggerItem>
      ))}
    </Tag>
  )
}

/* ── StaggerItem ──────────────────────────────────────────────────────────── */

interface StaggerItemProps {
  children: React.ReactNode
  delay: number
  duration: number
  slideUp: number
}

function StaggerItem({ children, delay, duration, slideUp }: StaggerItemProps) {
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    const timer = setTimeout(() => setMounted(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  return (
    <div
      className={cn(
        "transition-all ease-[var(--ease-out)]",
        mounted
          ? "opacity-100 translate-y-0"
          : "opacity-0",
      )}
      style={{
        transitionDuration: `${duration}ms`,
        transform: mounted ? "translateY(0)" : `translateY(${slideUp}px)`,
      }}
    >
      {children}
    </div>
  )
}

"use client"

import * as React from "react"

/** Pixels of scroll movement to consider "intentional" (filters micro-jitter). */
const SCROLL_THRESHOLD = 4

/**
 * Milliseconds of inactivity before the bar reappears.
 * Matches the "headroom + idle" pattern chosen by the user.
 */
const IDLE_DELAY = 150

/**
 * Returns `true` when the pill header should be hidden.
 *
 * Behavior:
 * - Scrolling **down** → hidden (immediately)
 * - Scrolling **up** → visible (immediately)
 * - Scroll **stopped** (~150ms idle) → visible
 * - At the **top** (scrollTop ≤ 8px) → always visible
 *
 * Under `prefers-reduced-motion: reduce` always returns `false`
 * to avoid disorienting motion for users who opted out.
 */
export function useHideOnScroll(
  containerRef: React.RefObject<HTMLElement | null>,
): boolean {
  const [hidden, setHidden] = React.useState(false)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Honour the user's reduced-motion preference — never hide the bar.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let lastScrollTop = el.scrollTop
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    function clearIdle() {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    /** After IDLE_DELAY ms without a scroll event, bring the bar back. */
    function scheduleShow() {
      clearIdle()
      idleTimer = setTimeout(() => setHidden(false), IDLE_DELAY)
    }

    function onScroll() {
      const scrollTop = el!.scrollTop

      // Always visible at the top of the container.
      if (scrollTop <= 8) {
        clearIdle()
        setHidden(false)
        lastScrollTop = scrollTop
        return
      }

      const delta = scrollTop - lastScrollTop

      // Only act on intentional movement (threshold filters micro-jitter).
      if (Math.abs(delta) >= SCROLL_THRESHOLD) {
        setHidden(delta > 0)   // down → hide; up → show
        lastScrollTop = scrollTop
      }

      // Reset idle timer on every scroll event, regardless of direction.
      scheduleShow()
    }

    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("scroll", onScroll)
      clearIdle()
    }
  }, [containerRef])

  return hidden
}

"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [loading, setLoading] = React.useState(false)
  const [width, setWidth] = React.useState("0%")
  const prevPathRef = React.useRef(pathname)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname
      start()
    }
  }, [pathname, searchParams])

  function start() {
    setLoading(true)
    setWidth("0%")
    // Simulate a loading bar that starts fast then slows
    const steps = [
      { delay: 100, width: "30%" },
      { delay: 300, width: "55%" },
      { delay: 600, width: "75%" },
      { delay: 1000, width: "90%" },
    ]
    for (const step of steps) {
      timerRef.current = setTimeout(() => setWidth(step.width), step.delay)
    }
    timerRef.current = setTimeout(() => {
      setWidth("100%")
      timerRef.current = setTimeout(() => {
        setLoading(false)
        setWidth("0%")
      }, 200)
    }, 1500)
  }

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!loading) return null

  return (
    <div
      role="progressbar"
      aria-label="Cargando página"
      aria-valuemin={0}
      aria-valuemax={100}
      className="fixed top-0 left-0 z-60 h-[2.5px] w-full pointer-events-none"
    >
      <div
        className="h-full rounded-r-sm bg-[var(--color-primary)] transition-all duration-[var(--duration-default)] ease-[var(--ease-out)] shadow-[0_0_6px_var(--color-primary)]"
        style={{ width, transitionDuration: "400ms" }}
      />
    </div>
  )
}

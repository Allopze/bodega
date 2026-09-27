"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

export function NavigationProgress() {
  const pathname = usePathname()
  const [loading, setLoading] = React.useState(false)
  const [width, setWidth] = React.useState("0%")
  const prevPathRef = React.useRef(pathname)

  // Los timers los crea y los libera el mismo efecto: una navegación nueva
  // (cambio de pathname) corre el cleanup de la anterior antes de reiniciar la
  // barra, y desmontar la limpia. Antes vivían en un ref compartido que sólo se
  // vaciaba desde otro efecto. `useSearchParams` no se comparaba nunca —la
  // barra sólo reacciona al pathname— y se retiró.
  React.useEffect(() => {
    if (prevPathRef.current === pathname) return
    prevPathRef.current = pathname
    setLoading(true)
    setWidth("0%")
    // Simulate a loading bar that starts fast then slows
    const step30 = setTimeout(() => setWidth("30%"), 100)
    const step55 = setTimeout(() => setWidth("55%"), 300)
    const step75 = setTimeout(() => setWidth("75%"), 600)
    const step90 = setTimeout(() => setWidth("90%"), 1000)
    const complete = setTimeout(() => setWidth("100%"), 1500)
    const hide = setTimeout(() => {
      setLoading(false)
      setWidth("0%")
    }, 1700)
    return () => {
      clearTimeout(step30)
      clearTimeout(step55)
      clearTimeout(step75)
      clearTimeout(step90)
      clearTimeout(complete)
      clearTimeout(hide)
    }
  }, [pathname])

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
        className="h-full rounded-r-sm bg-[var(--color-primary)] transition-[width] duration-[var(--duration-default)] ease-[var(--ease-out)] shadow-[0_0_6px_var(--color-primary)]"
        style={{ width, transitionDuration: "400ms" }}
      />
    </div>
  )
}

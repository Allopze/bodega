import * as React from "react"
import { cn } from "@/lib/utils"

interface PageContainerProps {
  children:   React.ReactNode
  /**
   * wide — tablas, dashboards, listas (default). Tope 110rem / 1760px.
   * form — formularios y vistas de detalle. Tope max-w-4xl / 896px.
   * full — sin límite de ancho (tablas que necesitan scroll horizontal propio).
   */
  width?:     "wide" | "form" | "full"
  className?: string
}

export function PageContainer({
  children,
  width = "wide",
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 md:px-8 py-2 md:py-3",
        width === "wide" && "max-w-440",
        width === "form" && "max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  )
}

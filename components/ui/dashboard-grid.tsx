"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * DashboardGrid — layout principal + lateral para páginas con tendencias.
 *
 * C1 (PLAN_MIGRACION_VISUAL_SIDEBAR_HEADER): replica la composición 8+4 de la
 * referencia sin acoplarla a ningún componente externo. En desktop (lg+) pinta
 * un grid de 12 columnas con `main` a 8 y `aside` a 4; en móvil colapsa a una
 * sola columna manteniendo el orden main → aside.
 *
 * Reglas (heredadas de AGENTS.md screen-density):
 * - No introduce una segunda toolbar ni una segunda búsqueda.
 * - `aside` es para lectura de apoyo (alertas, cumplimiento, próximas acciones),
 *   no para duplicar KPIs del main.
 * - Quien lo use debe respetar el máximo de 4 KPIs accionables en `main`.
 *
 * Uso:
 *   <DashboardGrid
 *     main={<Kpis /><Chart /><WorkQueue />}
 *     aside={<Alerts /><PdtpCompliance />}
 *   />
 */
export interface DashboardGridProps {
  /** Columna principal (lg: col-span-8). Recibe KPIs, gráfico y cola de trabajo. */
  main: React.ReactNode
  /** Columna lateral (lg: col-span-4). Lectura de apoyo: alertas, cumplimiento. */
  aside?: React.ReactNode
  /** Espacio entre slots. Por defecto usa el gap-6 de la referencia. */
  gap?: "default" | "compact"
  className?: string
}

const GAP = {
  default: "gap-6",
  compact: "gap-4",
} as const

export function DashboardGrid({
  main,
  aside,
  gap = "default",
  className,
}: DashboardGridProps) {
  // Sin aside: no montamos el grid de 12 col — evita un hueco vacío a la derecha
  // y deja que el contenido respire a ancho completo.
  if (!aside) {
    return (
      <div className={cn("flex flex-col", GAP[gap], className)}>
        {main}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-12",
        GAP[gap],
        className,
      )}
    >
      <div className="lg:col-span-8 flex flex-col gap-6">
        {main}
      </div>
      <div className="lg:col-span-4 flex flex-col gap-6">
        {aside}
      </div>
    </div>
  )
}

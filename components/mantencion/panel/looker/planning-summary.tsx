"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { SummaryBarStatCell } from "@/components/ui/summary-bar-stat-cell"
import type { SummaryLinkProps, SummaryStat } from "@/components/ui/summary-bar"
import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import type { MantUnit } from "@/lib/mantencion/types"
import { planningStateHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { PlanningData, PlanningState } from "@/lib/services/mantencion/looker/types"
import { cn } from "@/lib/utils"

interface SummaryCell {
  key: "total" | PlanningState
  state: PlanningState | null
  stat: Omit<SummaryStat, "href" | "hint">
}

function cells(counts: PlanningData["counts"], unit: MantUnit): SummaryCell[] {
  return [
    { key: "total", state: null, stat: { key: "total", label: "Equipos controlados", value: counts.total, valueKind: "number", secondary: unit === "km" ? "por kilómetros" : "por horas" } },
    { key: "vencida", state: "vencida", stat: { key: "vencida", label: "Vencidas", value: counts.vencida, tone: "danger", secondary: "superaron la próxima" } },
    { key: "proxima", state: "proxima", stat: { key: "proxima", label: "Próximas", value: counts.proxima, tone: "signal", secondary: `dentro del ${Math.round(NEXT_THRESHOLD * 100)} % final` } },
    { key: "al_dia", state: "al_dia", stat: { key: "al_dia", label: "Al día", value: counts.al_dia, secondary: "con margen" } },
    { key: "sin_dato", state: "sin_dato", stat: { key: "sin_dato", label: "Sin pauta o lectura", value: counts.sin_dato, secondary: "no se puede calcular" } },
  ]
}

/**
 * La tira de cifras de Planificación. Cada una FILTRA la tabla y los gráficos por estado (`estado=`): navega con
 * `replace` y sin mover el scroll, y un segundo clic sobre la vigente la quita. «Equipos controlados» quita el
 * filtro. La vigente se marca con `aria-current`, el fondo y la palabra «filtrando» (el color no va solo). Las
 * cifras cuentan con todos los demás filtros (faena, equipo, frecuencia, fechas), no con el estado.
 */
export function PlanningSummary({ counts, unit }: { counts: PlanningData["counts"]; unit: MantUnit }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = React.useMemo(() => new URLSearchParams(Array.from(searchParams.entries())), [searchParams])
  const activeState = current.get("estado")

  return (
    <div data-planning-summary="" className="overflow-hidden border-y border-[var(--color-border)]">
      <div className="-ml-px -mt-px flex flex-wrap">
        {cells(counts, unit).map(({ key, state, stat }) => {
          const active = state === null ? !activeState : activeState === state
          const renderLink = ({ href, className, children, ...rest }: SummaryLinkProps) => (
            <Link
              href={href}
              replace
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={cn(className, active && "bg-[var(--color-primary-tint)]")}
              {...rest}
            >
              {children}
            </Link>
          )
          return (
            <SummaryBarStatCell
              key={key}
              numerals="sans"
              renderLink={renderLink}
              stat={{ ...stat, href: planningStateHref(pathname, current, state), ...(active && state ? { hint: "filtrando" } : {}) }}
            />
          )
        })}
      </div>
    </div>
  )
}

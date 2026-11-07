import { PeriodControl } from "@/components/ui/period-control"

/**
 * Selector del mes de un resumen (`?periodo=YYYY-MM`): Facturación y Documentos
 * DTE. Es `PeriodControl` en modo mes, el mismo control de período del resto de
 * la plataforma (ver la regla en `period-control.tsx`): cambia la URL con
 * `router.replace` y sin mover el scroll, no con `router.push`, que llenaba el
 * historial de pasos intermedios y devolvía el scroll al inicio.
 *
 * El período va en la URL porque identifica *qué* se está mirando: es
 * compartible y sobrevive a un refresco. (Los filtros de interfaz que no
 * cambian el contenido no deben ir a la URL — ver la nota de `router.refresh`
 * en el módulo de Prevención.)
 */
export function PeriodPicker({ period }: { period: string }) {
  return <PeriodControl mode="month" month={period} />
}

/** Últimos N períodos hasta el mes actual, del más reciente al más antiguo. */
export function recentPeriods(count: number): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - index, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
  })
}

/** "2026-08" → "Agosto de 2026", siempre en es-CL (no depende del navegador). */
export function formatPeriodOption(period: string): string {
  return formatOption(period)
}

function formatOption(period: string): string {
  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("es-CL", {
    month: "long", year: "numeric", timeZone: "UTC",
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

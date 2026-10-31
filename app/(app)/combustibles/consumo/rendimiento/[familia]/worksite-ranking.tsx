import { EmptyState } from "@/components/ui/empty-state"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { PERFORMANCE_UNIT_LABELS, PERFORMANCE_UNIT_TITLES, type PerformanceUnit } from "@/lib/combustibles/control/contracts"
import type { WorksiteStatRow } from "@/lib/combustibles/control/queries/performance"
import { CV_ALERT_THRESHOLD } from "@/lib/combustibles/control/view-helpers"
import { formatQty } from "@/lib/utils"

const UNITS: PerformanceUnit[] = ["km_per_liter", "liters_per_hour"]

/** «Parejo», «irregular» o por qué no se sabe: el texto va siempre, el color no es lo único que lo dice. */
function regularityText(cv: number | null): string {
  if (cv === null) return "Aún sin 2 cargas para saber si es parejo"
  return cv > CV_ALERT_THRESHOLD ? "Irregular" : "Parejo"
}

/**
 * «Por faena»: el promedio de la familia en cada faena, las mejores arriba
 * (km/L: más es mejor; L/h: menos es mejor), con «parejo» o «irregular» en
 * lugar de la desviación estándar. Un ranking por unidad: km/L y L/h no
 * comparten escala ni polaridad (regla A5b). Una faena sin cargas válidas no
 * tiene promedio y no aparece.
 */
export function WorksiteRanking({ rows, hrefForWorksite }: { rows: WorksiteStatRow[]; hrefForWorksite?: (worksiteId: string) => string }) {
  const present = UNITS.filter((unit) => rows.some((row) => row.unit === unit && row.mean !== null))
  if (present.length === 0) {
    return <EmptyState compact title="Sin rendimientos calculados" description="Ninguna faena tiene cargas con rendimiento calculado y sin decisión pendiente con estos filtros. Amplía el período o quita la faena." />
  }
  return (
    <div className={present.length > 1 ? "grid gap-8 lg:grid-cols-2" : undefined}>
      {present.map((unit) => {
        const items: RankedListItem[] = rows
          .filter((row) => row.unit === unit && row.mean !== null)
          .map((row) => ({
            key: `${row.worksiteId}-${unit}`,
            label: row.worksiteName,
            value: Math.round(row.mean! * 100) / 100,
            detail: `${regularityText(row.cv)} · ${formatQty(row.n)} ${row.n === 1 ? "carga" : "cargas"}`,
            href: hrefForWorksite?.(row.worksiteId),
          }))
        return (
          <div key={unit}>
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
              <abbr title={PERFORMANCE_UNIT_TITLES[unit]} className="no-underline">{PERFORMANCE_UNIT_LABELS[unit]}</abbr>
              <span className="ml-1.5 font-normal text-[var(--color-text-muted)]">{unit === "km_per_liter" ? "más es mejor" : "menos es mejor"}</span>
            </h3>
            <RankedList
              items={items}
              format="count"
              unit={` ${PERFORMANCE_UNIT_LABELS[unit]}`}
              order={unit === "km_per_liter" ? "desc" : "asc"}
              showShare={false}
              limit={12}
              ariaLabel={`Promedio de rendimiento en ${PERFORMANCE_UNIT_LABELS[unit]} por faena`}
            />
          </div>
        )
      })}
    </div>
  )
}

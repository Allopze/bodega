import Link from "next/link"
import { AgingBar, type AgingBucket } from "@/components/charts/aging-bar"
import { ChartSection } from "@/components/charts/chart-section"
import {
  APPROVAL_AGE_BUCKETS,
  approvalAgeHref,
  approvalAgeSummary,
  type ApprovalAgeCounts,
  type ApprovalAgeFilter,
} from "@/lib/approvals-age"

/**
 * CHART-030 · Antigüedad de lo que espera tu decisión.
 *
 * La cola lista por solicitud y sólo muestra la fecha; quien aprueba no ve de un
 * vistazo cuánto de lo suyo lleva más de una semana. Aquí es una barra de cuatro
 * tramos cronológicos (coloreados de gris a rojo según cuánto esperan: el color
 * sólo expresa la urgencia, no hay un control nuevo —A5, la urgencia de la
 * solicitud ya tiene su filtro—) y cada tramo filtra la cola por `?antiguedad=`.
 *
 * Es la foto del momento y cuenta lo mismo que lista la cola —el mismo alcance de
 * permisos y filtros—, sin ampliarlo. Sin nada pendiente no se dibuja: la página
 * ya tiene su estado vacío.
 */
export function ApprovalAgeChart({
  counts,
  active,
  searchParams,
}: {
  counts: ApprovalAgeCounts
  /** Tramo vigente en la URL; `""` si la cola no está filtrada por antigüedad. */
  active: ApprovalAgeFilter
  searchParams: Record<string, string | string[] | undefined>
}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total === 0) return null

  const buckets: AgingBucket[] = APPROVAL_AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: counts[bucket.key],
    active: active === bucket.key,
    // Elegir el tramo vigente otra vez es la salida: quita el filtro.
    href: approvalAgeHref("/aprobaciones", searchParams, active === bucket.key ? "" : bucket.key),
  }))

  return (
    <ChartSection
      title="Antigüedad de lo pendiente"
      summary={approvalAgeSummary(counts, active)}
      aside={
        active ? (
          <Link
            href={approvalAgeHref("/aprobaciones", searchParams, "")}
            replace
            scroll={false}
            className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
          >
            Quitar filtro
          </Link>
        ) : undefined
      }
    >
      <AgingBar label="Ítems pendientes de decisión por antigüedad" unit="ítems" buckets={buckets} inPlace />
    </ChartSection>
  )
}

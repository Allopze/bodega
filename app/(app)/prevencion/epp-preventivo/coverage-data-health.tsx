import Link from "next/link"
import { Warning } from "@phosphor-icons/react/dist/ssr"

interface Props {
  unclassifiedFamilies: number
  ignoredDeliveries: number
  /** Sólo quien administra el catálogo puede resolverlo. */
  canFix: boolean
}

/**
 * Declara sobre qué universo se calculó la cobertura.
 *
 * `computeEppCoverageGaps` llega a las entregas por dos INNER JOIN
 * (`products.family_id` → `epp_product_families.epp_type_id`), así que una
 * familia sin clasificar hace desaparecer sus entregas del cálculo. El reporte
 * se veía completo y no lo estaba.
 */
export function CoverageDataHealth({ unclassifiedFamilies, ignoredDeliveries, canFix }: Props) {
  if (unclassifiedFamilies === 0) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-4 py-3 text-sm"
    >
      <Warning size={18} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-[var(--color-text)]">
          Este cálculo está incompleto: {unclassifiedFamilies} familia(s) de EPP sin clasificar.
        </p>
        <p className="mt-0.5 text-[var(--color-text-muted)]">
          Una familia sin tipo de EPP no acredita cobertura a nadie
          {ignoredDeliveries > 0 && <> y {ignoredDeliveries} entrega(s) a trabajador quedaron fuera</>}
          . Los trabajadores pueden aparecer con brecha aunque hayan recibido el EPP.
          {canFix && (
            <>
              {" "}
              <Link href="/admin/epps" className="font-medium text-[var(--color-primary)] underline">
                Clasificar en el catálogo de EPP
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

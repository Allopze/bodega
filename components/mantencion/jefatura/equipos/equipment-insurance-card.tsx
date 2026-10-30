import Link from "next/link"
import { FileText } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { DetailItem } from "@/components/ui/detail-item"
import { EmptyState } from "@/components/ui/empty-state"
import { plural } from "@/lib/mantencion/format"
import type { EquipmentInsurance, InsuranceState } from "@/lib/services/mantencion/equipment-life"
import { formatDate } from "@/lib/utils"
import { SectionCard } from "../shared/section-card"

const STATE_BADGE: Record<InsuranceState, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  vigente: { label: "Vigente", variant: "success" },
  por_vencer: { label: "Por vencer", variant: "warning" },
  vencido: { label: "Vencido", variant: "danger" },
  sin_fecha: { label: "Sin vencimiento", variant: "neutral" },
}

/** Con texto, no sólo color: «vence en 12 días» / «venció hace 3 días». */
function expiryText(insurance: EquipmentInsurance): string | null {
  const { days } = insurance
  if (days == null) return null
  if (days === 0) return "vence hoy"
  return days > 0 ? `vence en ${plural(days, "día", "días")}` : `venció hace ${plural(-days, "día", "días")}`
}

/** ¿Hay algo que hacer con el seguro? Un vencimiento próximo o pasado sube en la ficha; el resto va abajo. */
export function insuranceNeedsAttention(insurance: EquipmentInsurance): boolean {
  return insurance.hasData && (insurance.state === "por_vencer" || insurance.state === "vencido")
}

/**
 * Antecedentes de seguro que la flota ya guarda: póliza, vencimiento y los
 * documentos de tipo «Seguro». Los documentos se abren por la ruta de flota
 * (`/api/flota/documentos/[id]`, que exige `flota:view`), así que sólo se
 * enlazan si la persona puede verla. Qué más registrar (siniestros, etc.) está
 * pendiente de definición.
 */
export function EquipmentInsuranceCard({
  insurance,
  vehicleId,
  canViewFleet,
}: {
  insurance: EquipmentInsurance
  vehicleId: string
  canViewFleet: boolean
}) {
  if (!insurance.hasData) {
    // Vacío compacto: sin la caja alta de un estado vacío de pantalla, que en la ficha era lo primero que se veía.
    return (
      <SectionCard title="Seguro">
        <EmptyState
          compact
          as="p"
          align="start"
          className="px-0 py-1"
          title="Sin datos de seguro en la flota"
          description={canViewFleet
            ? "La póliza y su vencimiento se cargan en la ficha del vehículo de la flota."
            : "La póliza y su vencimiento se cargan en la ficha del vehículo de la flota; pídeselo a quien la administra."}
          action={canViewFleet
            ? <Button asChild variant="secondary" size="sm"><Link href={`/flota/${vehicleId}`}>Cargar en la ficha de flota</Link></Button>
            : undefined}
        />
      </SectionCard>
    )
  }
  const badge = STATE_BADGE[insurance.state]
  const text = expiryText(insurance)
  return (
    <SectionCard
      title="Seguro"
      action={canViewFleet ? <Link href={`/flota/${vehicleId}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0">Ficha de flota</Link> : undefined}
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <DetailItem layout="stacked" mono label="Póliza" value={insurance.policyNumber} />
        <DetailItem
          layout="stacked"
          label="Vencimiento"
          value={insurance.expiresAt
            ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-mono">{formatDate(insurance.expiresAt)}</span>
                <MetaBadge meta={badge} size="sm" />
                {text && <span className="text-xs text-[var(--color-text-muted)]">{text}</span>}
              </span>
            )
            : null}
        />
      </dl>
      {insurance.documents.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {insurance.documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <FileText size={14} aria-hidden className="shrink-0 text-[var(--color-text-subtle)]" />
                {canViewFleet
                  ? <a href={`/api/flota/documentos/${doc.id}`} target="_blank" rel="noopener noreferrer" className="block min-w-0 truncate py-3 font-medium text-[var(--color-primary-ink)] hover:underline sm:py-0" title={doc.fileName}>{doc.fileName}</a>
                  : <span className="truncate font-medium" title={doc.fileName}>{doc.fileName}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
                {doc.expiresAt && <span>{doc.current ? "Vence" : "Vencía"} {formatDate(doc.expiresAt)}</span>}
                <MetaBadge meta={doc.current ? { label: "Vigente", variant: "success" } : { label: "Anterior", variant: "outline" }} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

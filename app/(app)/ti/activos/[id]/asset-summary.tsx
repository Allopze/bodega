import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { todayInChile, formatDate, formatDateTime, formatCLP } from "@/lib/utils"
import { DetailItem } from "@/components/ui/detail-item"
import { itStatusLabel, IT_ASSIGNMENT_KIND_META, IT_ACCEPTANCE_META, IT_LOAN_OVERDUE_META, isLoanOverdue } from "@/lib/services/ti/constants"
import { WarrantyBadge } from "../warranty-badge"

interface AssetSummaryProps {
  asset: {
    id: string
    serialNumber: string | null
    status: string
    location: string | null
    purchaseDate: string | null
    cost: number | null
    warrantyEndDate: string | null
    processor: string | null
    ram: string | null
    storage: string | null
    os: string | null
    observations: string | null
    maintenanceCount: number
    maintenanceCost: number
    lastMaintenanceDate: string | null
  }
  activeAssignment: {
    id: string
    code: string
    kind: string
    deliveredAt: string
    acceptanceStatus: string
    expectedReturnDate?: string | null
    returnedAt: string | null
    photos: { stage: string }[]
  } | null
}

// La identidad (modelo, tipo, estado, faena, custodio) vive en la cabecera de la
// ficha; acá solo quedan los datos del equipo que la cabecera no repite.
export function AssetSummary({ asset, activeAssignment }: AssetSummaryProps) {
  const deliveryPhotos = activeAssignment?.photos.filter((p) => p.stage === "delivery").length ?? 0
  const overdue = activeAssignment ? isLoanOverdue(activeAssignment, todayInChile()) : false
  const acceptance = activeAssignment ? IT_ACCEPTANCE_META[activeAssignment.acceptanceStatus] : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Datos del equipo</h2>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <dl className="divide-y divide-[var(--color-border)]">
            <DetailItem label="Número de serie" value={asset.serialNumber ?? "—"} mono />
            <DetailItem label="Ubicación" value={asset.location ?? "—"} />
            <DetailItem label="Fecha de compra" value={asset.purchaseDate ? formatDate(asset.purchaseDate) : "—"} />
          </dl>
          <dl className="divide-y divide-[var(--color-border)]">
            <DetailItem label="Costo" value={asset.cost != null ? formatCLP(asset.cost) : "—"} mono />
            <DetailItem label="Garantía" value={<WarrantyBadge endDate={asset.warrantyEndDate} />} />
            <DetailItem
              label="Mantenciones"
              value={asset.maintenanceCount === 0
                ? "Ninguna"
                : `${asset.maintenanceCount} · ${formatCLP(asset.maintenanceCost)}${asset.lastMaintenanceDate ? ` · última ${formatDate(asset.lastMaintenanceDate)}` : ""}`}
            />
          </dl>
        </div>

        {(asset.processor || asset.ram || asset.storage || asset.os) && (
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Especificaciones</h3>
            <dl className="grid gap-x-6 text-sm sm:grid-cols-2">
              {asset.processor && <div className="py-0.5"><dt className="inline text-xs text-[var(--color-text-muted)]">Procesador: </dt><dd className="inline text-[var(--color-text)]">{asset.processor}</dd></div>}
              {asset.ram && <div className="py-0.5"><dt className="inline text-xs text-[var(--color-text-muted)]">RAM: </dt><dd className="inline text-[var(--color-text)]">{asset.ram}</dd></div>}
              {asset.storage && <div className="py-0.5"><dt className="inline text-xs text-[var(--color-text-muted)]">Almacenamiento: </dt><dd className="inline text-[var(--color-text)]">{asset.storage}</dd></div>}
              {asset.os && <div className="py-0.5"><dt className="inline text-xs text-[var(--color-text-muted)]">Sistema operativo: </dt><dd className="inline text-[var(--color-text)]">{asset.os}</dd></div>}
            </dl>
          </div>
        )}

        {asset.observations && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">{asset.observations}</p>
        )}
      </section>

      <aside>
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Custodia vigente</h2>
          {activeAssignment ? (
            <div className="mt-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                Acta <span className="font-mono">{activeAssignment.code}</span>
                {acceptance && <MetaBadge meta={acceptance} />}
                {overdue && <MetaBadge meta={IT_LOAN_OVERDUE_META} />}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {IT_ASSIGNMENT_KIND_META[activeAssignment.kind] ?? activeAssignment.kind} del {formatDateTime(activeAssignment.deliveredAt)}
                {deliveryPhotos > 0 && ` · con ${deliveryPhotos} ${deliveryPhotos === 1 ? "fotografía" : "fotografías"}`}
              </p>
              {activeAssignment.kind === "loan" && activeAssignment.expectedReturnDate && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Devolver antes del {formatDate(activeAssignment.expectedReturnDate)}</p>
              )}
              <Link href={`/ti/actas/${activeAssignment.id}/print`} className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-0">
                Ver acta de entrega →
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              {asset.status === "disponible" ? "El activo está disponible para entrega." : `Sin asignación abierta (estado: ${itStatusLabel(asset.status)}).`}
            </p>
          )}
        </section>
      </aside>
    </div>
  )
}

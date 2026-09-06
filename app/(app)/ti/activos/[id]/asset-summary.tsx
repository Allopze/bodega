import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { formatDate, formatCLP } from "@/lib/utils"
import { DetailItem } from "@/components/ui/detail-item"
import { isCivilDateBefore } from "@/lib/services/ti/civil-dates"
import { IT_ASSET_STATUS_META } from "@/lib/services/ti/constants"
import { itStatusLabel } from "@/lib/services/ti/constants"
import { Laptop, Wrench, Ticket, ShieldCheck, Warning } from "@phosphor-icons/react/dist/ssr"
import { AssetStatusControl } from "./asset-status-control"

interface AssetSummaryProps {
  asset: {
    id: string
    code: string
    brand: string | null
    model: string | null
    serialNumber: string | null
    status: string
    workerId: string | null
    workerName: string | null
    worksiteId: string | null
    worksiteName: string | null
    location: string | null
    purchaseDate: string | null
    supplierId: string | null
    purchaseDocType: string | null
    purchaseDocRef: string | null
    cost: number | null
    warrantyEndDate: string | null
    processor: string | null
    ram: string | null
    storage: string | null
    os: string | null
    observations: string | null
    typeName: string
    maintenanceCount: number
    maintenanceCost: number
    lastMaintenanceDate: string | null
    ticketCount: number
    createdAt: string
    updatedAt: string
  }
  activeAssignment: { id: string; code: string } | null
  canManage: boolean
}

// Detalle: mismo patrón que el resto de las fichas (`DetailItem`), con
// separadores horizontales vía `className`.

export function AssetSummary({ asset, activeAssignment, canManage }: AssetSummaryProps) {
  const statusMeta = IT_ASSET_STATUS_META[asset.status]
  const warrantyActive = asset.warrantyEndDate && !isCivilDateBefore(asset.warrantyEndDate)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]">
              <Laptop size={20} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                {[asset.brand, asset.model].filter(Boolean).join(" ") || asset.typeName}
              </h2>
              <p className="font-mono text-xs text-[var(--color-text-muted)]">{asset.code}</p>
            </div>
          </div>
          {statusMeta ? (
            <MetaBadge meta={statusMeta} dot size="lg" />
          ) : (
            <MetaBadge meta={{ label: asset.status, variant: "default" }} />
          )}
        </div>

        <div className="grid gap-x-8 sm:grid-cols-2">
          <div>
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Asignado a" value={asset.workerName ?? "—"} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Faena" value={asset.worksiteName ?? "—"} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Ubicación" value={asset.location ?? "—"} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Número de serie" value={asset.serialNumber ?? "—"} mono />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Tipo" value={asset.typeName} />
          </div>
          <div>
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Fecha de compra" value={asset.purchaseDate ? formatDate(asset.purchaseDate) : "—"} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Costo" value={asset.cost != null ? formatCLP(asset.cost) : "—"} mono />
            <DetailItem
  className="border-b border-[var(--color-border)] last:border-b-0"
              label="Garantía"
              value={
                asset.warrantyEndDate ? (
                  <span className="flex items-center gap-1.5">
                    {warrantyActive
                      ? <ShieldCheck size={14} className="text-[var(--color-success-ink)]" />
                      : <Warning size={14} className="text-[var(--color-danger-ink)]" />}
                    {formatDate(asset.warrantyEndDate)}
                  </span>
                ) : "Sin garantía"
              }
            />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Mantenciones" value={`${asset.maintenanceCount} · ${formatCLP(asset.maintenanceCost)} acumulado`} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Última mantención" value={asset.lastMaintenanceDate ? formatDate(asset.lastMaintenanceDate) : "—"} />
            <DetailItem className="border-b border-[var(--color-border)] last:border-b-0" label="Tickets" value={String(asset.ticketCount)} />
          </div>
        </div>

        {(asset.processor || asset.ram || asset.storage || asset.os) && (
          <div className="mt-4 rounded-xl bg-[var(--color-surface-2)] p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Especificaciones</p>
            <div className="grid gap-x-6 text-sm sm:grid-cols-2">
              {asset.processor && <p className="py-0.5 text-[var(--color-text)]"><span className="text-xs text-[var(--color-text-muted)]">Procesador: </span>{asset.processor}</p>}
              {asset.ram && <p className="py-0.5 text-[var(--color-text)]"><span className="text-xs text-[var(--color-text-muted)]">RAM: </span>{asset.ram}</p>}
              {asset.storage && <p className="py-0.5 text-[var(--color-text)]"><span className="text-xs text-[var(--color-text-muted)]">Almacenamiento: </span>{asset.storage}</p>}
              {asset.os && <p className="py-0.5 text-[var(--color-text)]"><span className="text-xs text-[var(--color-text-muted)]">SO: </span>{asset.os}</p>}
            </div>
          </div>
        )}

        {asset.observations && (
          <p className="mt-4 text-sm text-[var(--color-text-muted)]">{asset.observations}</p>
        )}
      </section>

      <aside className="space-y-4">
        {canManage && (
          <AssetStatusControl assetId={asset.id} currentStatus={asset.status} />
        )}

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Custodia vigente</h3>
          {activeAssignment ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-[var(--color-text)]">
                Acta <span className="font-mono">{activeAssignment.code}</span>
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Entrega vigente con evidencia fotográfica.</p>
              <Link href={`/ti/actas/${activeAssignment.id}/print`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)] hover:underline">
                Ver acta de entrega →
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              {asset.status === "disponible" ? "El activo está disponible para entrega." : `Sin asignación abierta (estado: ${itStatusLabel(asset.status)}).`}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Ciclo de vida</h3>
          <div className="mt-3 space-y-2">
            <Link href={`/ti/activos/${asset.id}?tab=asignaciones`} className="flex items-center justify-between text-sm text-[var(--color-text)] hover:text-[var(--color-primary)]">
              <span className="flex items-center gap-2"><Laptop size={14} className="text-[var(--color-text-subtle)]" /> Asignaciones</span>
              <ArrowRight size={12} />
            </Link>
            <Link href={`/ti/activos/${asset.id}?tab=mantenciones`} className="flex items-center justify-between text-sm text-[var(--color-text)] hover:text-[var(--color-primary)]">
              <span className="flex items-center gap-2"><Wrench size={14} className="text-[var(--color-text-subtle)]" /> Mantenciones</span>
              <ArrowRight size={12} />
            </Link>
            <Link href={`/ti/activos/${asset.id}?tab=tickets`} className="flex items-center justify-between text-sm text-[var(--color-text)] hover:text-[var(--color-primary)]">
              <span className="flex items-center gap-2"><Ticket size={14} className="text-[var(--color-text-subtle)]" /> Tickets</span>
              <ArrowRight size={12} />
            </Link>
            <Link href={`/ti/activos/${asset.id}?tab=historial`} className="flex items-center justify-between text-sm text-[var(--color-text)] hover:text-[var(--color-primary)]">
              <span className="flex items-center gap-2"><ClockIcon size={14} className="text-[var(--color-text-subtle)]" /> Historial completo</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        </section>
      </aside>
    </div>
  )
}

function ArrowRight({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="text-[var(--color-text-subtle)]" aria-hidden>
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

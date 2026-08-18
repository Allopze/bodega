import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { serviceEquipment, worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Badge } from "@/components/ui/badge"
import { StateBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { getEquipmentServiceHistory } from "@/lib/services/service-equipment-history"
import { formatCLP, formatDate, formatDateTime } from "@/lib/utils"
import { equipmentKindLabel } from "../catalog-contract"

export const metadata: Metadata = { title: "Equipo de servicio" }

function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="text-right text-xs font-medium text-[var(--color-text)]">{value}</dd>
    </div>
  )
}

/**
 * Ficha de un instrumento y su historial de intervenciones. Es lo que el
 * registro existe para responder: cuándo se calibró por última vez, quién lo
 * pidió y cuánto costó.
 */
export default async function EquipoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  try { await requirePermission("admin:service_equipment") }
  catch { redirect("/forbidden") }

  const { id } = await params

  const [equipment] = await db
    .select({
      id: serviceEquipment.id, code: serviceEquipment.code, name: serviceEquipment.name,
      kind: serviceEquipment.kind, brand: serviceEquipment.brand, model: serviceEquipment.model,
      serialNumber: serviceEquipment.serialNumber, notes: serviceEquipment.notes,
      isActive: serviceEquipment.isActive, needsReview: serviceEquipment.needsReview,
      createdAt: serviceEquipment.createdAt,
      worksiteName: worksites.name,
    })
    .from(serviceEquipment)
    .innerJoin(worksites, eq(serviceEquipment.worksiteId, worksites.id))
    .where(eq(serviceEquipment.id, id))

  if (!equipment) notFound()

  const history = await getEquipmentServiceHistory(equipment.id)
  const lastServiced = history.find((record) => record.costRecordedAt) ?? history[0]

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`${equipment.code} · ${equipment.name}`}
        description={`${equipmentKindLabel(equipment.kind)} · ${equipment.worksiteName}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Equipos de servicio", href: "/admin/equipos" },
            { label: equipment.code },
          ]} />
        }
        actions={
          <div className="flex items-center gap-2">
            {/* La ficha la dio de alta una solicitud: le falta nombre real,
                marca, modelo y serie. Se apaga al editarla desde la lista. */}
            {equipment.needsReview && (
              <Badge variant="warning">Por completar</Badge>
            )}
            <Badge variant={equipment.isActive ? "success" : "default"} dot>
              {equipment.isActive ? "Activo" : "De baja"}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <aside className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4 lg:sticky lg:top-6">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Ficha</h2>
          <dl className="mt-3 divide-y divide-[var(--color-border)]">
            <DetailLine label="Código interno" value={<span className="font-mono">{equipment.code}</span>} />
            <DetailLine label="Tipo" value={equipmentKindLabel(equipment.kind)} />
            <DetailLine label="Faena" value={equipment.worksiteName} />
            <DetailLine label="Marca" value={equipment.brand ?? "—"} />
            <DetailLine label="Modelo" value={equipment.model ?? "—"} />
            <DetailLine label="N° de serie" value={<span className="font-mono">{equipment.serialNumber ?? "—"}</span>} />
            <DetailLine label="Alta en el registro" value={formatDate(equipment.createdAt)} />
            <DetailLine
              label="Última intervención"
              value={lastServiced ? formatDate(lastServiced.requestedAt) : "Sin registro"}
            />
          </dl>
          {equipment.notes && (
            <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
              {equipment.notes}
            </p>
          )}
        </aside>

        <section className="min-w-0">
          <h2 className="text-h2 text-[var(--color-text)]">
            Historial de servicios
            <span className="ml-2 text-xs font-normal text-[var(--color-text-subtle)]">
              {history.length === 0 ? "sin intervenciones" : `${history.length} ${history.length === 1 ? "intervención" : "intervenciones"}`}
            </span>
          </h2>

          {history.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Sin intervenciones registradas"
                description="Aquí aparecerán las mantenciones y calibraciones que se soliciten para este equipo."
              />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Solicitud</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Orden</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((record) => (
                    <TableRow key={record.requestItemId}>
                      <TableCell>
                        <p className="text-sm font-medium text-[var(--color-text)]">{record.serviceName}</p>
                        <p className="text-xs text-[var(--color-text-subtle)]">
                          {formatDate(record.requestedAt)}
                          {record.requesterName ? ` · ${record.requesterName}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/solicitudes/${record.requestId}`}
                          className="font-mono text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {record.requestCode}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={record.itemStatus} entity="item" size="sm" />
                      </TableCell>
                      <TableCell>
                        {record.orderId && record.orderCode ? (
                          <Link
                            href={`/compras/${record.orderId}`}
                            className="font-mono text-xs text-[var(--color-primary)] hover:underline"
                          >
                            {record.orderCode}
                          </Link>
                        ) : (
                          <span className="text-xs text-[var(--color-text-subtle)]">Sin OC</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Costo desconocido ≠ $0: mientras no se registre, se dice. */}
                        {record.orderId === null ? (
                          <span className="text-xs text-[var(--color-text-subtle)]">—</span>
                        ) : record.subtotal === null ? (
                          <span className="text-xs text-[var(--color-warning-ink)]">Costo pendiente</span>
                        ) : (
                          <>
                            <span className="font-mono text-sm tabular-nums text-[var(--color-text)]">
                              {formatCLP(record.subtotal)}
                            </span>
                            {record.costRecordedAt && (
                              <p className="text-[11px] text-[var(--color-text-subtle)]">
                                registrado {formatDateTime(record.costRecordedAt)}
                              </p>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  )
}

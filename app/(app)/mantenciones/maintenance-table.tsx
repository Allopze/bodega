"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCLP, formatDate, formatQty } from "@/lib/utils"
import { maintenanceStatusMeta } from "@/lib/validation/maintenance"
import type { getMaintenancePageData } from "@/lib/services/maintenance"
import { MaintenanceRowActions } from "./maintenance-row-actions"
import { MaintenanceCreateButton } from "./maintenance-create-button"

type MaintenanceRecord = Awaited<ReturnType<typeof getMaintenancePageData>>["records"][number]
type OptionRow = { id: string; name: string }
type VehicleOption = { id: string; plate: string; type: string; worksiteId: string }
type CostCenterOption = { id: string; code: string; name: string; worksiteId: string | null }

const formatNumber = (value: number | null) => (value == null ? "—" : formatQty(value, undefined, { maximumFractionDigits: 1 }))

const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  preventiva: "Preventiva",
  correctiva: "Correctiva",
  neumaticos: "Neumáticos",
  lubricacion: "Lubricación",
  revision_tecnica: "Revisión técnica",
}
const maintenanceTypeLabel = (value: string) => MAINTENANCE_TYPE_LABELS[value] ?? value

export function MaintenanceTable({
  records, canEdit, canCreate, canViewCosts, hasActiveFilters, vehicleOptions, supplierOptions, costCenterOptions, assigneeOptions, serverPageSize,
}: {
  records: MaintenanceRecord[]
  canEdit: boolean
  canCreate: boolean
  canViewCosts: boolean
  hasActiveFilters: boolean
  vehicleOptions: VehicleOption[]
  supplierOptions: OptionRow[]
  costCenterOptions: CostCenterOption[]
  assigneeOptions: Array<OptionRow & { worksiteIds: string[] | null }>
  serverPageSize: number
}) {
  const rows = records.map((r) => ({
    ...r,
    plate: r.vehicle?.plate ?? r.vehicleId,
    supplierName: r.supplier?.name ?? "",
    worksiteName: r.worksite?.name ?? "",
    costCenterLabel: r.costCenter ? `${r.costCenter.code} - ${r.costCenter.name}` : "",
    documentLabel: r.documentNumber ?? r.documentName ?? "",
  }))

  const columns = [
    { key: "maintenanceDate", label: "Fecha", sortable: true },
    { key: "plate", label: "Vehículo", sortable: true },
    { key: "maintenanceType", label: "Tipo", sortable: true },
    { key: "supplierName", label: "Proveedor", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "status", label: "Estado", sortable: true },
    { key: "odometerReading", label: "Km", sortable: true, numeric: true },
    { key: "hourMeterReading", label: "Hr", sortable: true, numeric: true },
    { key: "costCenterLabel", label: "Centro de costo", sortable: true },
    { key: "documentLabel", label: "Documento", sortable: true },
    ...(canViewCosts ? [{ key: "totalAmount", label: "Total", sortable: true, numeric: true }] : []),
    { key: "_actions", label: "Acciones", sortable: false, numeric: true },
  ]

  return (
    <DataTable
      caption="Historial de mantenciones"
      columns={columns}
      rows={rows}
      searchKeys={["plate", "maintenanceType", "supplierName", "costCenterLabel", "documentLabel"]}
      tableClassName="min-w-[1100px]"
      pageSize={serverPageSize}
      disableInternalSearch
      emptyTitle={hasActiveFilters ? "Ninguna mantención coincide con los filtros" : "Todavía no hay mantenciones registradas"}
      emptyDescription={hasActiveFilters
        ? "Prueba con otro vehículo, faena o estado, o quita los filtros para ver el historial completo."
        : "Cada servicio que registres suma al costo operacional del vehículo en Flota y alimenta las alertas de mantención por uso."}
      emptyAction={hasActiveFilters
        ? <Button asChild size="sm" variant="secondary"><Link href="/mantenciones">Quitar filtros</Link></Button>
        : canCreate
          ? <MaintenanceCreateButton vehicles={vehicleOptions} suppliers={supplierOptions} costCenters={costCenterOptions} assignees={assigneeOptions} canViewCosts={canViewCosts} />
          : undefined}
      renderMobileCard={(record) => {
        const statusMeta = maintenanceStatusMeta(record.status)
        return (
          <article className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-[var(--color-text)]">{record.plate}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{maintenanceTypeLabel(record.maintenanceType)} · {formatDate(record.maintenanceDate)}</p>
              </div>
              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div><dt className="text-[var(--color-text-subtle)]">Faena</dt><dd>{record.worksite?.name ?? "—"}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Proveedor</dt><dd>{record.supplier?.name ?? "—"}</dd></div>
              <div><dt className="text-[var(--color-text-subtle)]">Lectura</dt><dd>{record.odometerReading != null ? `${formatNumber(record.odometerReading)} km` : record.hourMeterReading != null ? `${formatNumber(record.hourMeterReading)} hr` : "—"}</dd></div>
              {canViewCosts && <div><dt className="text-[var(--color-text-subtle)]">Total</dt><dd className="font-mono">{formatCLP(record.totalAmount ?? 0)}</dd></div>}
            </dl>
            <div className="mt-3 flex justify-end gap-2">
              <Button asChild size="sm" variant="ghost"><Link href={`/mantenciones/${record.id}`}>Ver OT</Link></Button>
              {canEdit &&
              <MaintenanceRowActions
                record={{
                  id: record.id,
                  vehicleId: record.vehicleId,
                  supplierId: record.supplierId,
                  costCenterId: record.costCenterId,
                  costCenterOption: record.costCenter
                    ? { id: record.costCenter.id, code: record.costCenter.code, name: record.costCenter.name, worksiteId: record.costCenter.worksiteId }
                    : null,
                  maintenanceDate: record.maintenanceDate,
                  maintenanceType: record.maintenanceType,
                  status: record.status,
                  odometerReading: record.odometerReading,
                  hourMeterReading: record.hourMeterReading,
                  netAmount: canViewCosts ? record.netAmount : undefined,
                  taxAmount: canViewCosts ? record.taxAmount : undefined,
                  documentNumber: record.documentNumber,
                  documentName: record.documentName,
                  notes: record.notes,
                  priority: record.priority,
                  assignedToUserId: record.assignedToUserId,
                  assignedToName: record.assignee?.name,
                  slaDueAt: record.slaDueAt,
                  rootCause: record.rootCause,
                  underWarranty: record.underWarranty,
                  operationalImpact: record.operationalImpact,
                }}
                vehicles={vehicleOptions}
                suppliers={supplierOptions}
                costCenters={costCenterOptions}
                assignees={assigneeOptions}
                canViewCosts={canViewCosts}
              />}
            </div>
          </article>
        )
      }}
      renderRow={(record) => {
        const statusMeta = maintenanceStatusMeta(record.status)
        return (
          <TableRow key={record.id}>
            <TableCell className="font-mono text-sm">{formatDate(record.maintenanceDate)}</TableCell>
            <TableCell>{record.plate}</TableCell>
            <TableCell>{maintenanceTypeLabel(record.maintenanceType)}</TableCell>
            <TableCell>{record.supplier?.name ?? "—"}</TableCell>
            <TableCell>{record.worksite?.name ?? "—"}</TableCell>
            <TableCell><Badge variant={statusMeta.variant}>{statusMeta.label}</Badge></TableCell>
            <TableCell className="text-right font-mono">{formatNumber(record.odometerReading)}</TableCell>
            <TableCell className="text-right font-mono">{formatNumber(record.hourMeterReading)}</TableCell>
            <TableCell>{record.costCenterLabel || "—"}</TableCell>
            <TableCell>{record.documentNumber ?? record.documentName ?? "—"}</TableCell>
            {canViewCosts && <TableCell className="text-right font-mono">{formatCLP(record.totalAmount ?? 0)}</TableCell>}
            <TableCell className="text-right">
              <div className="flex justify-end gap-1">
                <Button asChild size="sm" variant="ghost"><Link href={`/mantenciones/${record.id}`}>Ver</Link></Button>
                {canEdit &&
                <MaintenanceRowActions
                  record={{
                    id: record.id,
                    vehicleId: record.vehicleId,
                    supplierId: record.supplierId,
                    costCenterId: record.costCenterId,
                    costCenterOption: record.costCenter
                      ? { id: record.costCenter.id, code: record.costCenter.code, name: record.costCenter.name, worksiteId: record.costCenter.worksiteId }
                      : null,
                    maintenanceDate: record.maintenanceDate,
                    maintenanceType: record.maintenanceType,
                    status: record.status,
                    odometerReading: record.odometerReading,
                    hourMeterReading: record.hourMeterReading,
                    netAmount: canViewCosts ? record.netAmount : undefined,
                    taxAmount: canViewCosts ? record.taxAmount : undefined,
                    documentNumber: record.documentNumber,
                    // Sin reenviarlo, el update lo pisaba con NULL.
                    documentName: record.documentName,
                    notes: record.notes,
                    priority: record.priority,
                    assignedToUserId: record.assignedToUserId,
                    assignedToName: record.assignee?.name,
                    slaDueAt: record.slaDueAt,
                    rootCause: record.rootCause,
                    underWarranty: record.underWarranty,
                    operationalImpact: record.operationalImpact,
                  }}
                  vehicles={vehicleOptions}
                  suppliers={supplierOptions}
                  costCenters={costCenterOptions}
                  assignees={assigneeOptions}
                  canViewCosts={canViewCosts}
                />}
              </div>
            </TableCell>
          </TableRow>
        )
      }}
    />
  )
}

"use client"

import * as React from "react"
import { Plus, PencilSimple, Power } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MetaBadge } from "@/components/states/state-badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { setEmergencyScenarioTypeActiveAction } from "./actions"
import { EmergencyScenarioTypeForm, type EmergencyScenarioTypeRow } from "./scenario-type-form"

const COLUMNS = [
  { key: "label", label: "Tipo de escenario", sortable: true },
  { key: "obligationLabel", label: "Clasificación", sortable: true },
  { key: "useCount", label: "Uso", sortable: true, width: "w-40" },
  { key: "isActive", label: "Estado", sortable: true, width: "w-28" },
  { key: "actions", label: "Acciones", sortable: false, width: "w-40" },
]

const OBLIGATION_LABELS: Record<string, string> = {
  mandatory: "Base obligatoria",
  senapred_detected: "Según exposición territorial",
  operational: "Operativo",
  optional: "Complementario",
  custom: "Propio",
}

type ScenarioTypeTableRow = EmergencyScenarioTypeRow & {
  obligationLabel: string
  statusLabel: string
  useCount: number
}

export function EmergencyScenarioTypeCatalog({ rows }: { rows: EmergencyScenarioTypeRow[] }) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<EmergencyScenarioTypeRow | null>(null)
  const [confirmRow, setConfirmRow] = React.useState<EmergencyScenarioTypeRow | null>(null)
  const [pendingCode, setPendingCode] = React.useState<string | null>(null)

  function create() {
    setEditRow(null)
    setFormOpen(true)
  }

  function edit(row: EmergencyScenarioTypeRow) {
    setEditRow(row)
    setFormOpen(true)
  }

  async function setActive(row: EmergencyScenarioTypeRow, isActive: boolean) {
    setPendingCode(row.code)
    const result = await setEmergencyScenarioTypeActiveAction(row.code, isActive)
    if (result.ok) toast.success(result.message ?? "Estado actualizado")
    else toast.error(result.message ?? "No se pudo cambiar el estado")
    setPendingCode(null)
  }

  const tableRows = rows.map((row) => ({
    ...row,
    obligationLabel: OBLIGATION_LABELS[row.obligation] ?? row.obligation,
    statusLabel: row.isActive ? "Activo" : "Inactivo",
    useCount: row.scenarioCount + row.drillCount,
  })) as (ScenarioTypeTableRow & Record<string, unknown>)[]

  return (
    <PageContainer>
      <PageHeader
        title="Escenarios de emergencia"
        description="Tipos disponibles para los planes de emergencia y sus simulacros."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Escenarios de emergencia" },
        ]} />}
        actions={<Button size="sm" onClick={create}><Plus size={15} />Nuevo tipo</Button>}
      />

      <DataTable
        caption="Catálogo de escenarios de emergencia"
        columns={COLUMNS}
        rows={tableRows}
        searchKeys={["label", "obligationLabel", "statusLabel"]}
        pageSize={25}
        emptyTitle="Sin tipos de escenario"
        emptyDescription="Crea un tipo propio para incorporarlo en los próximos planes."
        emptyAction={<Button size="sm" onClick={create}><Plus size={14} />Nuevo tipo</Button>}
        renderMobileCard={(row) => {
          const item = row as unknown as ScenarioTypeTableRow
          return (
            <article key={item.code} className="rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-[var(--color-text)]">{item.label}</h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {item.isSystem ? "Incluido por la plataforma" : "Tipo propio"} · {OBLIGATION_LABELS[item.obligation] ?? item.obligation}
                  </p>
                </div>
                <MetaBadge meta={{ label: item.isActive ? "Activo" : "Inactivo", variant: item.isActive ? "success" : "default" }} dot />
              </div>
              <p className="mt-3 text-xs tabular-nums text-[var(--color-text-muted)]">
                {item.scenarioCount} escenario(s) en planes · {item.drillCount} simulacro(s)
              </p>
              {!item.isSystem && (
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                  <Button size="sm" variant="ghost" onClick={() => edit(item)}><PencilSimple size={15} />Editar</Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pendingCode === item.code}
                    onClick={() => item.isActive ? setConfirmRow(item) : void setActive(item, true)}
                  >
                    <Power size={15} />{item.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </div>
              )}
            </article>
          )
        }}
        renderRow={(row) => {
          const item = row as ScenarioTypeTableRow
          return (
            <TableRow key={item.code}>
              <TableCell>
                <span className="font-medium">{item.label}</span>
                <span className="ml-2 text-xs text-[var(--color-text-muted)]">{item.isSystem ? "Base protegida" : "Tipo propio"}</span>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">{item.obligationLabel}</TableCell>
              <TableCell className="text-sm tabular-nums">
                {item.scenarioCount} escenario(s) · {item.drillCount} simulacro(s)
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: item.isActive ? "Activo" : "Inactivo", variant: item.isActive ? "success" : "default" }} />
              </TableCell>
              <TableCell>
                {item.isSystem ? <span className="text-xs text-[var(--color-text-muted)]">Protegido</span> : (
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => edit(item)}><PencilSimple size={15} />Editar</Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pendingCode === item.code}
                      onClick={() => item.isActive ? setConfirmRow(item) : void setActive(item, true)}
                    >
                      <Power size={15} />{item.isActive ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          )
        }}
      />

      <EmergencyScenarioTypeForm
        key={editRow?.code ?? "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditRow(null) }}
        editRow={editRow}
      />
      <ConfirmDialog
        open={confirmRow !== null}
        onOpenChange={(open) => { if (!open) setConfirmRow(null) }}
        title="Desactivar tipo de escenario"
        description={confirmRow
          ? `«${confirmRow.label}» dejará de aparecer al declarar escenarios nuevos. Los ${confirmRow.scenarioCount} escenario(s) y ${confirmRow.drillCount} simulacro(s) existentes conservarán su historial.`
          : ""}
        confirmLabel="Desactivar"
        variant="warning"
        loading={confirmRow ? pendingCode === confirmRow.code : false}
        onConfirm={() => {
          if (confirmRow) void setActive(confirmRow, false)
          setConfirmRow(null)
        }}
      />
    </PageContainer>
  )
}

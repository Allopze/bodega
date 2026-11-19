"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { VehicleIdentity } from "@/components/fleet/vehicle-identity"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import type { MandanteOptions } from "@/lib/services/contracts/contracts"
import type { WorksiteContractView } from "@/lib/services/contracts/worksite-view"
import { formatDate } from "@/lib/utils"
import { AssignVehiclesSheet } from "./assign-vehicles-sheet"
import { ContractSheet } from "./contract-sheet"

type ViewContract = WorksiteContractView["contracts"][number]

export interface WorksiteContractsViewProps {
  view: WorksiteContractView
  mandantes: MandanteOptions
  /** `mant:equipment:manage`: sin él no hay botones de asignar (la acción también lo exige). */
  canAssign: boolean
  /** Hoy en Chile (`YYYY-MM-DD`). */
  today: string
}

const STATUS_META = {
  active: { label: "Vigente", variant: "success" },
  suspended: { label: "Suspendido", variant: "warning" },
  closed: { label: "Cerrado", variant: "default" },
} as const

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** «Vigente desde 01-03-2026», o el rango de fechas de un contrato que ya no rige. */
function periodLabel(contract: ViewContract): string {
  const from = contract.startDate ? formatDate(contract.startDate) : null
  const to = contract.endDate ? formatDate(contract.endDate) : null
  if (contract.status === "active") {
    return [from ? `Vigente desde ${from}` : "Vigente", to ? `hasta ${to}` : null].filter(Boolean).join(" · ")
  }
  if (from && to) return `${from} a ${to}`
  if (from) return `Desde ${from}`
  if (to) return `Hasta ${to}`
  return "Sin fechas"
}

/**
 * Detalle de una faena: un panel por contrato con sus equipos («separación
 * visual» del costo), los contratos suspendidos o cerrados plegados y los
 * equipos sin contrato aparte. Vive en un componente de cliente porque la
 * cabecera y las hojas comparten estado (AGENTS.md, regla 5 de layout).
 */
export function WorksiteContractsView({ view, mandantes, canAssign, today }: WorksiteContractsViewProps) {
  const [contractSheet, setContractSheet] = React.useState<{ contract: ViewContract | null } | null>(null)
  const [assignSheet, setAssignSheet] = React.useState<{ contractId: string | null } | null>(null)

  const activeContracts = view.contracts.filter((contract) => contract.status === "active")
  const otherContracts = view.contracts.filter((contract) => contract.status !== "active")
  const description = `${view.worksite.code} · ${plural(view.assignableVehicles.length, "equipo", "equipos")} · ${plural(view.contracts.length, "contrato", "contratos")}`
  const newContract = () => setContractSheet({ contract: null })

  return (
    <>
      <PageHeader
        title={view.worksite.name}
        description={description}
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Faenas", href: "/admin/faenas" },
          { label: view.worksite.name },
        ]}
        actions={<Button onClick={newContract}><Plus size={14} aria-hidden /> Nuevo contrato</Button>}
      />

      {view.contracts.length === 0 ? (
        <EmptyState
          title="Esta faena no tiene contratos"
          description="Crea un contrato por cada servicio que se presta aquí para separar sus equipos y costos."
          action={<Button onClick={newContract}><Plus size={14} aria-hidden /> Nuevo contrato</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {activeContracts.map((contract) => (
            <ContractCard
              key={contract.id}
              contract={contract}
              canAssign={canAssign}
              onEdit={() => setContractSheet({ contract })}
              onAssign={() => setAssignSheet({ contractId: contract.id })}
            />
          ))}

          {otherContracts.length > 0 && (
            <details className="group rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <summary className="cursor-pointer select-none px-5 py-3 text-sm font-medium text-[var(--color-text-muted)]">
                Contratos suspendidos o cerrados ({otherContracts.length})
              </summary>
              <div className="flex flex-col gap-4 border-t border-[var(--color-border)] p-4">
                {otherContracts.map((contract) => (
                  <ContractCard
                    key={contract.id}
                    contract={contract}
                    canAssign={false}
                    onEdit={() => setContractSheet({ contract })}
                    onAssign={() => undefined}
                  />
                ))}
              </div>
            </details>
          )}

          {view.unassignedVehicles.length > 0 && (
            <ContractPanel
              heading="Sin contrato"
              meta={<p className="text-xs text-[var(--color-text-muted)]">Equipos de la faena que todavía no trabajan para un contrato.</p>}
              actions={canAssign && activeContracts.length > 0
                ? <Button variant="secondary" size="sm" onClick={() => setAssignSheet({ contractId: null })}>Asignar</Button>
                : undefined}
            >
              <VehicleList vehicles={view.unassignedVehicles.map((vehicle) => ({ ...vehicle, validFrom: null }))} />
            </ContractPanel>
          )}
        </div>
      )}

      {contractSheet && (
        <ContractSheet
          open
          onClose={() => setContractSheet(null)}
          worksiteId={view.worksite.id}
          contract={contractSheet.contract}
          mandantes={mandantes}
        />
      )}
      {assignSheet && (
        <AssignVehiclesSheet
          open
          onClose={() => setAssignSheet(null)}
          contractId={assignSheet.contractId}
          contracts={activeContracts}
          vehicles={view.assignableVehicles}
          today={today}
        />
      )}
    </>
  )
}

function ContractCard({ contract, canAssign, onEdit, onAssign }: {
  contract: ViewContract
  canAssign: boolean
  onEdit: () => void
  onAssign: () => void
}) {
  return (
    <ContractPanel
      heading={contract.name}
      meta={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
          <span className="font-medium text-[var(--color-text)]">{contract.clientName}</span>
          <span>{periodLabel(contract)}</span>
          {contract.status !== "active" && <MetaBadge meta={STATUS_META[contract.status]} dot />}
        </div>
      }
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onEdit}>Editar</Button>
          {canAssign && <Button variant="secondary" size="sm" onClick={onAssign}>Asignar equipos</Button>}
        </>
      }
    >
      {contract.vehicles.length === 0
        ? <p className="text-sm text-[var(--color-text-muted)]">Sin equipos asignados todavía.</p>
        : <VehicleList vehicles={contract.vehicles} />}
    </ContractPanel>
  )
}

/** Tarjeta con título, línea de contexto, acciones y cuerpo: la usan los contratos y «Sin contrato». */
function ContractPanel({ heading, meta, actions, children }: {
  heading: string
  meta: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const headingId = React.useId()
  return (
    <section aria-labelledby={headingId}>
      <Card variant="feature" className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={headingId} className="text-h2 text-[var(--color-text)]">{heading}</h2>
            {meta}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {children}
      </Card>
    </section>
  )
}

function VehicleList({ vehicles }: { vehicles: { id: string; code: string | null; plate: string | null; typeName: string; validFrom: string | null }[] }) {
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {vehicles.map((vehicle) => (
        <li key={vehicle.id} className="flex items-center justify-between gap-3 py-2">
          <VehicleIdentity code={vehicle.code} plate={vehicle.plate} type={vehicle.typeName} href={vehicleFichaHref(vehicle.id, "flota")} />
          {vehicle.validFrom && (
            <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">desde {formatDate(vehicle.validFrom)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

"use client"

import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HardHat } from "@phosphor-icons/react"
import { EPP_REQUIREMENT_SCOPE_LABELS, canCreateEppRequirement } from "@/lib/prevention/epp"
import { NewRequirementDialog, EditRequirementDialog, DeactivateRequirementDialog } from "./epp-dialogs"

export interface RequirementItem {
  id: string
  eppTypeLabel: string
  scopeType: string
  scopeValue: string | null
  worksiteName: string | null
  enforcement: string
  reason: string
  isActive: boolean
  /** Familia sugerida: el hint del formulario promete que llega a Bodega. */
  preferredFamilyName: string | null
  /** Alcance persistido que el cálculo todavía no sabe evaluar. */
  isEvaluable: boolean
  /** Sin faena (global o por cargo), editarlo exige alcance total en el servidor. */
  hasWorksite: boolean
}

interface Props {
  requirements: RequirementItem[]
  eppTypes: { id: string; label: string }[]
  families: { id: string; name: string; eppTypeId: string | null }[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  /** Alcance total de faenas: ver `NewRequirementDialog.allowOrgWideScopes`. */
  allowOrgWideScopes: boolean
}

export function EppRequirementList({ requirements, eppTypes, families, worksites, canManage, allowOrgWideScopes }: Props) {
  const canCreate = canCreateEppRequirement({ canManage, eppTypes, worksites, allowOrgWideScopes })
  return (
    <div className="space-y-4">
      {/* Layout 5 / A3: "Nuevo requisito" es acción de página y vive en el
          header, junto a Exportar. Aquí queda sólo el conteo. */}
      <span className="block text-sm text-[var(--color-text-subtle)]">{requirements.length} requisito(s)</span>

      {requirements.length === 0 ? (
        <EmptyState
          icon={<HardHat size={20} />}
          title="Aún no hay requisitos de EPP declarados"
          description="Un requisito declara qué tipo de EPP exige un cargo o una faena. Sin requisitos, el panel de cobertura no puede detectar brechas."
          action={canCreate ? <NewRequirementDialog eppTypes={eppTypes} families={families} worksites={worksites} allowOrgWideScopes={allowOrgWideScopes} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de EPP</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Familia sugerida</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Fundamento</TableHead>
                {canManage && <TableHead className="w-28"><span className="sr-only">Acciones</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((item) => (
                <TableRow key={item.id} className={!item.isActive ? "opacity-50" : undefined}>
                  <TableCell className="text-sm font-medium">{item.eppTypeLabel}</TableCell>
                  <TableCell className="text-sm">
                    {EPP_REQUIREMENT_SCOPE_LABELS[item.scopeType] ?? item.scopeType}
                    {item.scopeType === "worksite" && item.worksiteName && <span className="block text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>}
                    {item.scopeType === "position" && item.scopeValue && <span className="block text-xs text-[var(--color-text-subtle)]">{item.scopeValue}</span>}
                    {!item.isEvaluable && (
                      <span className="mt-1 block">
                        <MetaBadge meta={{ label: "No evaluado", variant: "warning" }} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-[var(--color-text-muted)]">
                    {item.preferredFamilyName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <MetaBadge meta={item.enforcement === "blocking" ? { label: "Bloqueante", variant: "danger" } : { label: "Advertencia", variant: "warning" }} />
                  </TableCell>
                  <TableCell className="max-w-md text-xs text-[var(--color-text-subtle)]">{item.reason}</TableCell>
                  {canManage && (
                    <TableCell>
                      {item.isActive && !item.hasWorksite && !allowOrgWideScopes ? (
                        // Mismo motivo que en el alta: sin faena, el servidor
                        // rechaza editarlo o desactivarlo a quien no ve todas.
                        <span className="text-xs text-[var(--color-text-subtle)]" title="Rige en todas las faenas: lo gestiona quien tiene alcance sobre todas.">Alcance total</span>
                      ) : item.isActive ? (
                        <div className="flex items-center gap-3">
                          <EditRequirementDialog
                            id={item.id}
                            currentEnforcement={item.enforcement}
                            currentReason={item.reason}
                          />
                          <DeactivateRequirementDialog id={item.id} />
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--color-text-subtle)]">Inactivo</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

"use client"

import { MetaBadge } from "@/components/states/state-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HardHat } from "@phosphor-icons/react"
import { EPP_REQUIREMENT_SCOPE_LABELS } from "@/lib/prevention/epp"
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
}

interface Props {
  requirements: RequirementItem[]
  eppTypes: { id: string; label: string }[]
  families: { id: string; name: string; eppTypeId: string | null }[]
  worksites: { id: string; name: string }[]
  canManage: boolean
}

export function EppRequirementList({ requirements, eppTypes, families, worksites, canManage }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-subtle)]">{requirements.length} requisito(s)</span>
        {canManage && eppTypes.length > 0 && <NewRequirementDialog eppTypes={eppTypes} families={families} worksites={worksites} />}
      </div>

      {requirements.length === 0 ? (
        <EmptyState
          icon={<HardHat size={20} />}
          title="Aún no hay requisitos de EPP declarados"
          description="Un requisito declara qué tipo de EPP exige un cargo o una faena. Sin requisitos, el panel de cobertura no puede detectar brechas."
          action={canManage && eppTypes.length > 0 ? <NewRequirementDialog eppTypes={eppTypes} families={families} worksites={worksites} /> : undefined}
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
                      {item.isActive ? (
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

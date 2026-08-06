"use client"

import * as React from "react"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Briefcase, Car } from "@phosphor-icons/react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { deleteEvaluationAction } from "@/app/(app)/prevencion/actions"
import type { SstEvaluation } from "@/db/schema/sst"
import { EvaluationCard } from "./worker-evaluations-card"
import { CreateEvaluationDialog } from "./worker-evaluations-create-dialog"
import { adminContratoLabel } from "@/lib/prevention/admin-contrato-label"
import type { WorkerEvaluationsProps } from "./worker-evaluations.types"

export function WorkerEvaluations({
  worker,
  evaluations,
  weeklyEvals,
  permissions,
  userEvaluatorRole,
  openVisits,
}: WorkerEvaluationsProps) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<SstEvaluation | null>(null)
  const [isDeletePending, startDelete] = useTransition()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [startRole, setStartRole] = React.useState<'prevencionista_faena' | 'admin_contrato' | 'conductor_lider'>('prevencionista_faena')

  const prevEval = evaluations.find(e => e.evaluatorRole === 'prevencionista_faena' || e.evaluatorRole === null)
  const adminEval = evaluations.find(e => e.evaluatorRole === 'admin_contrato')
  const condEval = evaluations.find(e => e.evaluatorRole === 'conductor_lider')
  const defaultVisitId = openVisits.length === 1 ? openVisits.at(0)?.id : undefined
  // El contrato de la faena decide si el cargo se llama "Administrador de
  // contrato" o "Supervisor de faena": es la misma persona.
  const adminLabel = adminContratoLabel(worker.adminContratoLabel)

  const handleDelete = () => {
    if (!deleteTarget) return
    startDelete(async () => {
      const formData = new FormData()
      formData.append("evaluationId", deleteTarget.id)
      const result = await deleteEvaluationAction({ ok: false }, formData)
      if (result.ok) {
        toast.success("Evaluación eliminada correctamente")
        setDeleteTarget(null)
        router.refresh()
      } else {
        toast.error(result.message ?? "Error al eliminar")
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* 3-Column Grid */}
      {openVisits.length !== 1 && (
        <div className="rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-tint)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          {openVisits.length === 0
            ? "No hay una visita en borrador. Al iniciar una evaluación se creará una nueva visita."
            : "Hay varias visitas en borrador. Elige la visita correspondiente antes de agregar una participación."}
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-3">
        <EvaluationCard
          title="Prevencionista de Faena"
          role="prevencionista_faena"
          worksiteAdminContratoLabel={worker.adminContratoLabel}
          icon={<ShieldCheck size={18} />}
          evaluation={prevEval}
          weeklyEvals={weeklyEvals}
          permissions={permissions}
          userEvaluatorRole={userEvaluatorRole}
          onStart={(role) => { setStartRole(role); setCreateOpen(true) }}
          onDelete={setDeleteTarget}
        />
        <EvaluationCard
          title={adminLabel}
          role="admin_contrato"
          worksiteAdminContratoLabel={worker.adminContratoLabel}
          icon={<Briefcase size={18} />}
          evaluation={adminEval}
          weeklyEvals={weeklyEvals}
          permissions={permissions}
          userEvaluatorRole={userEvaluatorRole}
          onStart={(role) => { setStartRole(role); setCreateOpen(true) }}
          onDelete={setDeleteTarget}
        />
        <EvaluationCard
          title="Conductor Líder (Acompañamiento)"
          role="conductor_lider"
          worksiteAdminContratoLabel={worker.adminContratoLabel}
          icon={<Car size={18} />}
          evaluation={condEval}
          weeklyEvals={weeklyEvals}
          permissions={permissions}
          userEvaluatorRole={userEvaluatorRole}
          onStart={(role) => { setStartRole(role); setCreateOpen(true) }}
          onDelete={setDeleteTarget}
        />
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar evaluación"
        description="Esta acción eliminará permanentemente esta evaluación SST, sus respuestas, seguimientos y plan de acción."
        confirmLabel="Eliminar"
        variant="destructive"
        loading={isDeletePending}
        onConfirm={handleDelete}
      />

      {/* Create Dialog */}
      <CreateEvaluationDialog
        worker={worker}
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialRole={startRole}
        defaultVisitId={defaultVisitId}
        openVisits={openVisits}
      />
    </div>
  )
}

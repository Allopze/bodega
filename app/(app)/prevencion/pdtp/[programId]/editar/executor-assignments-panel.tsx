"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useOperation } from "@/lib/hooks/use-operation"
import { setPdtpActivityExecutorAssignmentsAction } from "../../actions"
import { pdtpDestinationModuleLabel, pdtpPermissionLabel } from "../pdtp-destination-labels"

type Activity = { id: string; n: number; activity: string; status: string }
type Role = { id: string; name: string; label: string; permissions: string[] }
type Assignment = { activityId: string; roleId: string; roleName: string; roleLabel: string }
type CoverageIssue = {
  n: number
  status: string
  reason: string
  destinationModule?: string
  requiredPermission?: string
  suggestedExecutorRoleIds?: string[]
}

export function ExecutorAssignmentsPanel({
  programId,
  activities,
  roleOptions,
  assignments,
  coverageIssues,
}: {
  programId: string
  activities: Activity[]
  roleOptions: Role[]
  assignments: Assignment[]
  coverageIssues: CoverageIssue[]
}) {
  const router = useRouter()
  const operation = useOperation({ onSuccess: () => router.refresh() })
  const issues = coverageIssues.filter((issue) => issue.status === "executor_required" || issue.status === "executor_permission_gap")
  const activityByNumber = new Map(activities.map((activity) => [activity.n, activity]))
  const initial = React.useMemo(() => new Map<string, string[]>(
    activities.map((activity) => [
      activity.id,
      assignments.filter((assignment) => assignment.activityId === activity.id).map((assignment) => assignment.roleId),
    ]),
  ), [activities, assignments])
  const [selected, setSelected] = React.useState(initial)

  React.useEffect(() => setSelected(initial), [initial])

  if (issues.length === 0) {
    return (
      <section className="rounded-xl border border-[var(--color-success-line)] bg-[var(--color-success-tint)] p-4">
        <h3 className="text-sm font-semibold text-[var(--color-success-ink)]">Sin brechas de ejecutor acreditador</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">No hay brechas de ejecutor pendientes en esta versión. Si una versión nueva necesita acreditar un destino, asígnale al menos un rol con el permiso requerido. Los responsables de planificación no se modificaron.</p>
      </section>
    )
  }

  function toggle(activityId: string, roleId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      const values = new Set(next.get(activityId) ?? [])
      if (checked) values.add(roleId)
      else values.delete(roleId)
      next.set(activityId, [...values])
      return next
    })
  }

  function save(activityId: string) {
    operation.run(() => setPdtpActivityExecutorAssignmentsAction({
        programId,
        activityId,
        roleIds: selected.get(activityId) ?? [],
      }))
  }

  return (
    <section className="rounded-xl border border-[var(--color-warning-line)] bg-[var(--color-surface)] p-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text)]">Ejecutores acreditadores</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Elige los roles que registran el hecho en el módulo de destino. Esto no cambia responsables de planificación ni concede permisos.
        </p>
      </div>
      {operation.message && <p className="mt-3 text-sm text-[var(--color-text-muted)]" role="status">{operation.message}</p>}
      <div className="mt-4 space-y-4">
        {issues.map((issue) => {
          const activity = activityByNumber.get(issue.n)
          if (!activity) return null
          const chosen = new Set(selected.get(activity.id) ?? [])
          const suggested = new Set(issue.suggestedExecutorRoleIds ?? [])
          return (
            <article key={`${issue.status}:${activity.id}`} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-[var(--color-text)]">N°{activity.n} · {activity.activity}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{issue.reason}</p>
                  {issue.destinationModule && <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Destino: {pdtpDestinationModuleLabel(issue.destinationModule)}{issue.requiredPermission ? ` · se necesita permiso para ${pdtpPermissionLabel(issue.requiredPermission)}` : ""}</p>}
                </div>
                <Button size="sm" variant="secondary" loading={operation.pending} onClick={() => save(activity.id)}>
                  Guardar ejecutores
                </Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {roleOptions.map((role) => (
                  <Checkbox
                    key={role.id}
                    id={`${activity.id}-${role.id}`}
                    checked={chosen.has(role.id)}
                    onChange={(event) => toggle(activity.id, role.id, event.target.checked)}
                    label={<span>{role.label}{suggested.has(role.id) ? <span className="ml-1 text-xs text-[var(--color-success-ink)]">(ya tiene el permiso)</span> : null}</span>}
                  />
                ))}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

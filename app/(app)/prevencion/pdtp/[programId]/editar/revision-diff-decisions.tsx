"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useOperation } from "@/lib/hooks/use-operation"
import { decidePdtpRevisionDiffAction } from "../../actions"

type DiffItem = {
  identity: string
  activityNumber: number | null
  kind: "only_in_revision" | "only_in_base" | "content_changed" | "catalog_revision_changed"
  changedSections?: string[]
}

type Decision = { activityIdentity: string; decision: "applied" | "kept"; decidedAt: string }

export function RevisionDiffDecisions({
  programId,
  items,
  decisions,
}: {
  programId: string
  items: DiffItem[]
  decisions: Decision[]
}) {
  const router = useRouter()
  const operation = useOperation({ onSuccess: () => router.refresh() })
  const decisionByIdentity = new Map(decisions.map((decision) => [decision.activityIdentity, decision]))

  function decide(item: DiffItem, decision: "applied" | "kept") {
    operation.run(() => decidePdtpRevisionDiffAction({
        programId,
        activityIdentity: item.identity,
        decision,
      }))
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Decide cada diferencia: aplicar toma el contenido y programación de la Base vigente; conservar mantiene esta revisión. No hay cambios automáticos.
      </p>
      {operation.message && <p className="mt-2 text-xs text-[var(--color-text-muted)]" role="status">{operation.message}</p>}
      <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
        {items.map((item) => {
          const decision = decisionByIdentity.get(item.identity)
          return (
            <li key={`${item.identity}:${item.kind}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
              <span className="text-[var(--color-text)]">
                N°{item.activityNumber ?? "—"} · {revisionDiffLabel(item.kind)}
                {item.changedSections && item.changedSections.length > 0 ? ` · ${item.changedSections.map(revisionSectionLabel).join(", ")}` : ""}
              </span>
              <span className="flex items-center gap-2">
                {decision?.decision === "kept" && <span className="text-[var(--color-text-muted)]" role="status">Conservada</span>}
                {decision?.decision === "applied" && <span className="text-[var(--color-success-ink)]" role="status">Aplicada desde la Base</span>}
                <Button
                  size="sm"
                  variant="secondary"
                  loading={operation.pending}
                  disabled={operation.pending || !!decision}
                  onClick={() => decide(item, "kept")}
                >Conservar</Button>
                <Button
                  size="sm"
                  loading={operation.pending}
                  disabled={operation.pending || !!decision}
                  onClick={() => decide(item, "applied")}
                >Aplicar Base</Button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function revisionDiffLabel(kind: DiffItem["kind"]) {
  if (kind === "only_in_base") return "incorporada en la Base vigente"
  if (kind === "only_in_revision") return "propia de esta revisión"
  if (kind === "catalog_revision_changed") return "con nueva revisión de catálogo"
  return "con contenido distinto"
}

function revisionSectionLabel(section: string) {
  const labels: Record<string, string> = {
    activity: "actividad",
    schedules: "programación",
    memberships: "hojas",
    checklists: "checklist",
    sourceLinks: "vínculos",
    exclusions: "exclusiones",
    executorAssignments: "ejecutores",
    documentRequirements: "carpeta documental",
    worksiteAdjustments: "parámetros por faena",
    scheduleOverrides: "overrides",
  }
  return labels[section] ?? section
}

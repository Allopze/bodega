"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { INITIAL_STATE } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { IT_ACCESS_STATUS_META } from "@/lib/services/ti/constants"
import { revokeSystemAccessAction } from "./actions"

interface InactiveWorker {
  id: string
  name: string
  worksiteName: string
  accesses: { systemId: string; systemName: string; status: string }[]
}

/**
 * TIUX-19 · `?revision=inactivos`. Trabajadores que ya no figuran como activos
 * pero conservan un acceso vigente: la matriz solo lista activos, así que esas
 * cuentas vivas eran invisibles. Revocar usa la misma acción (y las mismas
 * guardas de faena) que la hoja de acceso.
 */
export function InactiveAccessReview({ workers, canManage }: { workers: InactiveWorker[]; canManage: boolean }) {
  const pathname = usePathname()
  const [pending, setPending] = React.useState<{ workerId: string; workerName: string; systemId: string; systemName: string } | null>(null)
  const revoke = useOperation({ feedback: "toast" })

  function confirm() {
    const target = pending
    if (!target) return
    setPending(null)
    void revoke.run(async () => {
      const formData = new FormData()
      formData.set("workerId", target.workerId)
      formData.set("systemId", target.systemId)
      return revokeSystemAccessAction(INITIAL_STATE, formData)
    })
  }

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h2">Inactivos con accesos vigentes</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Personas que ya no figuran como activas pero conservan acceso a algún sistema. Revócalo para cerrar la cuenta.
          </p>
        </div>
        <Link
          href={pathname}
          scroll={false}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] hover:underline sm:min-h-0"
        >
          Volver a la matriz
        </Link>
      </div>

      {workers.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Ningún trabajador inactivo conserva accesos"
          description="Cuando alguien se desactive con un acceso vigente, aparecerá aquí para que lo revoques."
          action={<Button asChild variant="secondary" size="sm"><Link href={pathname} scroll={false}>Volver a la matriz</Link></Button>}
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {workers.map((worker) => (
            <li key={worker.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <p className="text-sm font-semibold text-[var(--color-text)]">{worker.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{worker.worksiteName} · inactivo</p>
              <ul className="mt-2 space-y-1">
                {worker.accesses.map((access) => (
                  <li key={access.systemId} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-sm sm:min-h-9">
                    <span className="text-[var(--color-text)]">
                      {access.systemName}{" "}
                      <MetaBadge meta={IT_ACCESS_STATUS_META[access.status] ?? { label: access.status, variant: "default" }} />
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--color-danger-ink)] hover:underline sm:min-h-0 sm:px-0"
                        aria-label={`Revocar el acceso de ${worker.name} a ${access.systemName}`}
                        onClick={() => setPending({ workerId: worker.id, workerName: worker.name, systemId: access.systemId, systemName: access.systemName })}
                      >
                        Revocar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(v) => { if (!v) setPending(null) }}
        title={`¿Revocar el acceso a ${pending?.systemName ?? "este sistema"}?`}
        description={pending ? `${pending.workerName} ya no figura como activo. Su acceso a ${pending.systemName} quedará Revocado y se puede volver a otorgar.` : ""}
        confirmLabel="Revocar"
        variant="destructive"
        loading={revoke.pending}
        onConfirm={confirm}
      />
    </section>
  )
}

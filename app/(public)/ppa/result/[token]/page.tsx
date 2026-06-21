import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpaByToken } from "@/lib/services/ppa"
import { estadoPpaLabel } from "@/lib/ppa/badges"
import { PPA_STOP_REASON_LABELS, tipoTrabajoLabel, type PpaStopReason } from "@/lib/ppa/types"

export default async function PpaResultPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const ppa = await getPpaByToken(token)
  if (!ppa) notFound()

  const detenido = ppa.resultado === "detenido"
  const reasons = (ppa.triggeredReasons as PpaStopReason[] | null) ?? []

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <div
        className={
          "rounded-xl border-2 p-6 text-center " +
          (detenido
            ? "border-[var(--color-danger)] bg-[var(--color-danger-tint)]"
            : "border-[var(--color-success)] bg-[var(--color-success-tint)]")
        }
      >
        {detenido ? (
          <>
            <p className="text-2xl font-extrabold uppercase tracking-tight text-[var(--color-danger-ink)]">
              Detenga el trabajo
            </p>
            <p className="mt-2 text-base font-medium text-[var(--color-danger-ink)]">
              Comuníquese con su supervisor.
            </p>
            <p className="mt-3 text-sm text-[var(--color-danger-ink)]">
              El trabajo no debe comenzar hasta que el supervisor revise la situación y autorice el inicio.
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-extrabold tracking-tight text-[var(--color-success-ink)]">
              Puede iniciar el trabajo de forma segura
            </p>
            <p className="mt-2 text-sm text-[var(--color-success-ink)]">
              Recuerde mantener los controles durante toda la tarea.
            </p>
          </>
        )}
      </div>

      {detenido && reasons.length > 0 && (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Motivos de la detención</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-muted)]">
            {reasons.map((r) => (
              <li key={r}>{PPA_STOP_REASON_LABELS[r] ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[var(--color-text-subtle)]">Trabajador</dt>
          <dd className="font-medium">{ppa.workerName}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)]">Faena</dt>
          <dd className="font-medium">{ppa.worksiteName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)]">Tarea</dt>
          <dd className="font-medium">{tipoTrabajoLabel(ppa.tipoTrabajo)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-subtle)]">Estado</dt>
          <dd className="font-medium">{estadoPpaLabel(ppa.estado)}</dd>
        </div>
      </dl>

      <div className="mt-8 text-center">
        <Link href="/ppa" className="text-sm font-medium text-[var(--color-primary)] underline">
          Realizar otro PPA
        </Link>
      </div>
    </main>
  )
}

import { notFound } from "next/navigation"
import Link from "next/link"
import { CheckCircle, WarningOctagon, Warning, Info } from "@phosphor-icons/react/dist/ssr"
import { getPpaByToken } from "@/lib/services/ppa"
import { estadoPpaLabel, workerResultView, type WorkerResultView } from "@/lib/ppa/badges"
import { PPA_STOP_REASON_LABELS, tipoTrabajoLabel, type PpaStopReason } from "@/lib/ppa/types"

const TONE: Record<
  WorkerResultView["tone"],
  { border: string; bg: string; ink: string; Icon: typeof CheckCircle }
> = {
  success: {
    border: "border-[var(--color-success)]",
    bg: "bg-[var(--color-success-tint)]",
    ink: "text-[var(--color-success-ink)]",
    Icon: CheckCircle,
  },
  danger: {
    border: "border-[var(--color-danger)]",
    bg: "bg-[var(--color-danger-tint)]",
    ink: "text-[var(--color-danger-ink)]",
    Icon: WarningOctagon,
  },
  warning: {
    border: "border-[var(--color-warning)]",
    bg: "bg-[var(--color-warning-tint)]",
    ink: "text-[var(--color-warning-ink)]",
    Icon: Warning,
  },
  neutral: {
    border: "border-[var(--color-border-strong)]",
    bg: "bg-[var(--color-surface-2)]",
    ink: "text-[var(--color-text)]",
    Icon: Info,
  },
}

export default async function PpaResultPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const ppa = await getPpaByToken(token)
  if (!ppa) notFound()

  const view = workerResultView(ppa.estado)
  const tone = TONE[view.tone]
  const reasons = (ppa.triggeredReasons as PpaStopReason[] | null) ?? []
  const { Icon } = tone

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <div className={`rounded-xl border-2 p-6 text-center ${tone.border} ${tone.bg}`} role="status" aria-live="polite">
        <Icon size={40} weight="fill" className={`mx-auto ${tone.ink}`} aria-hidden />
        <p
          className={
            `mt-3 text-2xl font-extrabold tracking-tight ${tone.ink} ` +
            (view.tone === "danger" ? "uppercase" : "")
          }
        >
          {view.title}
        </p>
        {view.message && <p className={`mt-2 text-sm font-medium ${tone.ink}`}>{view.message}</p>}
      </div>

      {view.showReasons && reasons.length > 0 && (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Motivos de la detención</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-text-muted)]">
            {reasons.map((r) => (
              <li key={r}>{PPA_STOP_REASON_LABELS[r] ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      {!view.canStart && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Qué hacer ahora</h2>
          {ppa.supervisor || ppa.prevencionista ? (
            <dl className="space-y-1 text-sm">
              {ppa.supervisor && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--color-text-subtle)]">Supervisor</dt>
                  <dd className="font-medium">{ppa.supervisor}</dd>
                </div>
              )}
              {ppa.prevencionista && (
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--color-text-subtle)]">Prevencionista</dt>
                  <dd className="font-medium">{ppa.prevencionista}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">
              Comunícate con tu supervisor o prevencionista a cargo de la faena antes de iniciar el trabajo.
            </p>
          )}
        </div>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
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

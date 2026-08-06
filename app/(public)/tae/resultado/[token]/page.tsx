import { notFound } from "next/navigation"
import { CheckCircle, ClockCounterClockwise, XCircle } from "@phosphor-icons/react/dist/ssr"
import { getTaeSubmissionByToken } from "@/lib/services/fuel-tae"
import { TaeResultActions } from "./tae-result-actions"

export default async function TaeResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const submission = await getTaeSubmissionByToken(token)
  if (!submission) notFound()
  const state = submission.status === "voided"
    ? { icon: <XCircle size={38} className="mx-auto text-[var(--color-danger)]" />, eyebrow: "Carga anulada", title: "Registro sin vigencia", message: submission.reviewNote ?? "Esta carga fue anulada durante la revisión." }
    : submission.status === "observed"
      ? { icon: <ClockCounterClockwise size={38} className="mx-auto text-[var(--color-signal-ink)]" />, eyebrow: "En revisión", title: "Carga observada", message: submission.reviewNote ?? "El equipo responsable está revisando este registro." }
      : { icon: <CheckCircle size={38} className="mx-auto text-[var(--color-success)]" />, eyebrow: submission.status === "validated" ? "Carga validada" : "Control TAE", title: "Carga registrada", message: submission.status === "validated" ? "El registro fue revisado y validado." : "El registro fue recibido y está pendiente de revisión." }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-6">
      <section className="w-full rounded-[var(--radius-2xl)] border border-(--color-border) bg-(--color-surface) p-6 text-center shadow-[var(--shadow-lg)]">
        {state.icon}
        <p className="mt-4 text-eyebrow">{state.eyebrow}</p>
        <h1 className="mt-1 text-h2">{state.title}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{state.message}</p>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{submission.worksite?.name}{submission.loadingPoint ? ` · ${submission.loadingPoint.name}` : ""}</p>
        <p className="mt-4 font-mono text-xl tabular-nums">{Number(submission.liters).toLocaleString("es-CL")} L</p>
        <TaeResultActions />
      </section>
    </main>
  )
}

import { notFound } from "next/navigation"
import { getPermitCrewAckPublicView, getTrainingAckPublicView } from "@/lib/services/prevention-ack-public"
import { PublicAcknowledgementForm } from "./ack-form"

export const dynamic = "force-dynamic"

/**
 * `CAP-002` / `PER-002` (auditoría 2026-09-14): la puerta de acuse para el
 * trabajador **sin cuenta de usuario**. Antes de esto, el acuse del AST de un
 * permiso y el de una capacitación exigían sesión y que la persona estuviera
 * vinculada a un `users.id`; para la mayoría del personal de faena no había
 * forma de dejar constancia, y el respaldo del briefing quedaba en papel.
 *
 * La pantalla es deliberadamente mínima —qué se acusa, quién lo acusa y un
 * botón—, igual que el formulario público de PPA: quien la abre está en
 * terreno, con el teléfono, y no tiene contexto de la plataforma.
 */
export default async function PublicAcknowledgementPage({
  params,
}: {
  params: Promise<{ kind: string; targetId: string; token: string }>
}) {
  const { kind, targetId, token } = await params
  if (kind !== "capacitacion" && kind !== "permiso") notFound()

  const view = kind === "capacitacion"
    ? await getTrainingAckPublicView(targetId, token)
    : await getPermitCrewAckPublicView(targetId, token)
  // Un token inválido y un id inexistente responden igual: el enlace no puede
  // servir de oráculo para saber qué ids existen.
  if (!view) notFound()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-(--color-text-subtle)">
          {kind === "capacitacion" ? "Acuse de capacitación" : "Acuse de AST"}
        </p>
        <h1 className="mt-1 text-lg font-semibold text-(--color-text)">{view.title}</h1>
        <p className="mt-1 text-sm text-(--color-text-muted)">{view.detail}</p>
      </header>

      <section className="rounded-(--radius-2xl) border border-(--color-border) bg-(--color-surface) p-4">
        <p className="text-sm text-(--color-text)">
          <span className="text-(--color-text-muted)">Trabajador:</span> {view.workerName}
        </p>
        <PublicAcknowledgementForm
          kind={view.kind}
          targetId={view.targetId}
          token={token}
          alreadyAcknowledgedAt={view.acknowledgedAt}
          eligible={view.eligible}
          ineligibleReason={view.ineligibleReason}
        />
      </section>

      <p className="text-xs text-(--color-text-subtle)">
        Este enlace es personal: acusa recibo únicamente por la persona indicada arriba.
      </p>
    </main>
  )
}

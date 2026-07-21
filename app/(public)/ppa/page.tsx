import { listActiveWorkPermitsForPublicForm, listWorksitesForPublicForm } from "@/lib/services/ppa"
import { PPA_TIPO_TRABAJO_OPTIONS, PPA_CONTROL_OPTIONS, PPA_COMPLEMENTARIAS } from "@/lib/ppa/types"
import { PpaForm } from "./ppa-form"
import { OfflineSavedMessage } from "./offline-saved"

/**
 * Formulario PPA público (sin login). Acceso por enlace directo o QR.
 * Se puede precargar la faena con `?faena=<worksiteId>`.
 *
 * Cuando `?saved=offline` está presente, muestra la confirmación de guardado
 * offline en vez del formulario (el trabajador fue redirigido aquí tras un
 * envío offline exitoso).
 */
export default async function PpaPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string; saved?: string }>
}) {
  const { faena, saved } = await searchParams

  // ── Offline saved confirmation ──────────────────────────────────────
  if (saved === "offline") {
    return <OfflineSavedMessage />
  }

  const [worksites, workPermits] = await Promise.all([
    listWorksitesForPublicForm(),
    listActiveWorkPermitsForPublicForm(),
  ])

  const initialWorksiteId = faena && worksites.some((w) => w.id === faena) ? faena : ""
  const hasFaenaParam = !!faena

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight">PPA Digital</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Para, Piensa y Actúa — evaluación preventiva antes de iniciar el trabajo.
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-faint)]">
          Funciona sin conexión a internet.
        </p>
      </header>

      <PpaForm
        worksites={worksites}
        workPermits={workPermits}
        initialWorksiteId={initialWorksiteId}
        hasFaenaParam={hasFaenaParam}
        tipoTrabajoOptions={PPA_TIPO_TRABAJO_OPTIONS}
        controlOptions={PPA_CONTROL_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
        complementarias={PPA_COMPLEMENTARIAS.map((c) => ({ key: c.key, label: c.label }))}
      />
    </main>
  )
}

import { listWorksitesForPublicForm, listWorkersForWorksite } from "@/lib/services/ppa"
import { PPA_TIPO_TRABAJO_OPTIONS, PPA_CONTROL_OPTIONS, PPA_COMPLEMENTARIAS } from "@/lib/ppa/types"
import { PpaForm } from "./ppa-form"

/**
 * Formulario PPA público (sin login). Acceso por enlace directo o QR.
 * Se puede precargar la faena con `?faena=<worksiteId>`.
 */
export default async function PpaPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string }>
}) {
  const { faena } = await searchParams
  const worksites = await listWorksitesForPublicForm()

  const initialWorksiteId = faena && worksites.some((w) => w.id === faena) ? faena : ""
  const initialWorkers = initialWorksiteId
    ? (await listWorkersForWorksite(initialWorksiteId)).map((w) => ({
        id: w.id,
        label: `${w.firstName} ${w.lastName}${w.rut ? ` · ${w.rut}` : ""}`,
      }))
    : []

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight">PPA Digital</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Para, Piensa y Actúa — evaluación preventiva antes de iniciar el trabajo.
        </p>
      </header>

      <PpaForm
        worksites={worksites}
        initialWorksiteId={initialWorksiteId}
        initialWorkers={initialWorkers}
        tipoTrabajoOptions={PPA_TIPO_TRABAJO_OPTIONS}
        controlOptions={PPA_CONTROL_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
        complementarias={PPA_COMPLEMENTARIAS.map((c) => ({ key: c.key, label: c.label }))}
      />
    </main>
  )
}

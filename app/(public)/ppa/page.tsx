import { listActiveWorkPermitsForPublicForm, listWorksitesForPublicForm, verifyPpaWorksiteAccessToken } from "@/lib/services/ppa"
import { PPA_TIPO_TRABAJO_OPTIONS, PPA_CONTROL_OPTIONS, PPA_COMPLEMENTARIAS } from "@/lib/ppa/types"
import { PpaForm } from "./ppa-form"
import { OfflineSavedMessage } from "./offline-saved"

/**
 * El layout de esta ruta consulta el toggle del módulo en la base de datos, y
 * `isRouteOperational` falla cerrado. Durante `next build` no hay base, así que
 * un intento de prerender renderiza "PPA Digital no disponible" y lo hornea.
 * Hoy Next infiere el dinamismo desde `searchParams`, pero eso deja el
 * formulario que los trabajadores abren por QR a merced de esa inferencia.
 * Declararlo explícito es la misma garantía que ya tiene /tae, que comparte el
 * gate.
 */
export const dynamic = "force-dynamic"

/**
 * Formulario PPA público (sin login). Acceso por enlace directo o QR.
 *
 * PPA-001 (auditoría 2026-09-14): la faena se precargaba con `?faena=<id>` a
 * secas. Ese parámetro no acredita nada —el id de una faena no es un secreto—,
 * así que ahora la precarga exige además el token `?t=` que el panel interno
 * emite con el enlace (`ppaWorksiteAccessQuery`) y que el servidor verifica.
 * Un enlace antiguo sin token sigue abriendo el formulario: lo que ya no hace
 * es acreditar la faena. Quien lo use se identifica con su RUT y el servidor
 * deriva la faena del catálogo de trabajadores.
 *
 * Cuando `?saved=offline` está presente, muestra la confirmación de guardado
 * offline en vez del formulario (el trabajador fue redirigido aquí tras un
 * envío offline exitoso).
 */
export default async function PpaPublicPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string; t?: string; saved?: string }>
}) {
  const { faena, t, saved } = await searchParams

  // ── Offline saved confirmation ──────────────────────────────────────
  if (saved === "offline") {
    return <OfflineSavedMessage />
  }

  const [worksites, workPermits] = await Promise.all([
    listWorksitesForPublicForm(),
    listActiveWorkPermitsForPublicForm(),
  ])

  // PPA-001: acredita el enlace, no el parámetro. Sin token válido la faena no
  // se precarga y el formulario queda en el modo de identificación por RUT.
  const accredited = !!faena && verifyPpaWorksiteAccessToken(faena, t)
  const initialWorksiteId = accredited && worksites.some((w) => w.id === faena) ? faena! : ""
  const hasFaenaParam = !!initialWorksiteId
  const accessToken = initialWorksiteId ? t! : ""

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <header className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight">PPA Digital</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Para, Piensa y Actúa: evaluación preventiva antes de iniciar el trabajo.
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
        accessToken={accessToken}
        tipoTrabajoOptions={PPA_TIPO_TRABAJO_OPTIONS}
        controlOptions={PPA_CONTROL_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
        complementarias={PPA_COMPLEMENTARIAS.map((c) => ({ key: c.key, label: c.label }))}
      />
    </main>
  )
}

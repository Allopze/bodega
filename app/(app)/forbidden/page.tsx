import type { Metadata } from "next"
import Link from "next/link"
import { LockSimple } from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Sin acceso" }

/**
 * U-06: dedicated 403 page. Pages whose `requirePermission` check fails
 * redirect here instead of silently bouncing to /dashboard, so the user
 * understands *why* they landed somewhere else and what to do next.
 *
 * No usa <PageHeader> con `actions`: en desktop ese componente es
 * `lg:sr-only` (solo reenvía título/acciones al TopBar) y esta página no
 * tenía contenido propio debajo, así que el <main> quedaba en blanco.
 * Sigue el mismo patrón autocontenido que `not-found.tsx`.
 */
export default function ForbiddenPage() {
  return (
    <PageContainer width="form">
      <div className="mx-auto max-w-2xl py-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
          <LockSimple size={22} />
        </div>
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">Sin acceso</p>
        <h1 className="mt-1 text-h1 text-[var(--color-text)]">Sin permisos suficientes</h1>
        <p className="mt-2 max-w-[60ch] text-sub">
          Tu cuenta no cuenta con los permisos necesarios. Si crees que es un error, pide a un
          administrador que revise tus roles o el alcance de tus faenas.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/dashboard">Volver al panel</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/solicitudes">Ver mis solicitudes</Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  )
}

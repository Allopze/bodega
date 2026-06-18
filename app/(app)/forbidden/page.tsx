import type { Metadata } from "next"
import Link from "next/link"
import { ShieldWarning } from "@phosphor-icons/react/dist/ssr"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Sin acceso" }

/**
 * U-06: dedicated 403 page. Pages whose `requirePermission` check fails
 * redirect here instead of silently bouncing to /dashboard, so the user
 * understands *why* they landed somewhere else and what to do next.
 */
export default function ForbiddenPage() {
  return (
    <PageContainer>
      <EmptyState
        as="h1"
        icon={<ShieldWarning size={24} />}
        title="No tienes acceso a esta sección"
        description="Tu cuenta no cuenta con los permisos necesarios. Si crees que es un error, pide a un administrador que revise tus roles o el alcance de tus faenas."
        action={
          <Button asChild>
            <Link href="/dashboard">Volver al panel</Link>
          </Button>
        }
      />
    </PageContainer>
  )
}

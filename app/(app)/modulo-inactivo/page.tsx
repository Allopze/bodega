import Link from "next/link"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"

export default async function ModuleDisabledPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string }>
}) {
  const { desde } = await searchParams
  return (
    <PageContainer width="form">
      <PageHeader
        title="Módulo inactivo"
        description="Esta función fue desactivada para toda la plataforma."
      />
      <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-xs">
        <p className="text-sm text-[var(--color-text-muted)]">
          Tus permisos no cambiaron. Un administrador puede volver a activar el módulo o submódulo desde Configuración de módulos.
        </p>
        {desde && <p className="mt-2 break-all text-xs text-[var(--color-text-subtle)]">Destino solicitado: {desde}</p>}
        <div className="mt-5">
          <Button asChild variant="primary"><Link href="/dashboard">Volver al inicio</Link></Button>
        </div>
      </section>
    </PageContainer>
  )
}

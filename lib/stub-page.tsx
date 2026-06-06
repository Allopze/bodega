import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Hourglass } from "@phosphor-icons/react/dist/ssr"

interface StubPageProps {
  title:       string
  description?: string
  phase:       number
}

/** Placeholder for not-yet-implemented phases. */
export function StubPage({ title, description, phase }: StubPageProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Hourglass size={22} />}
        title={`Disponible en Fase ${phase}`}
        description="Este módulo está planificado en el roadmap. La estructura de rutas y permisos está lista."
      />
    </>
  )
}

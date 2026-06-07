import Link from "next/link"
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

export default function NotFound() {
  return (
    <EmptyState
      icon={<MagnifyingGlass size={24} />}
      title="Recurso no encontrado"
      description="El registro que buscas no existe o fue eliminado."
      action={
        <Button asChild variant="secondary">
          <Link href="/dashboard">Volver al inicio</Link>
        </Button>
      }
    />
  )
}

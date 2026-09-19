import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

// El breadcrumb no se declara acá a propósito: el TopBar lo deriva de
// NAV_ITEMS + usePathname(). Tampoco se pinta un conteo de relleno — un
// esqueleto con números inventados hace que el usuario lea una cifra falsa
// antes de la real.
export default function Loading() {
  return (
    <PageContainer width="wide">
      <PageHeader title="Habilitar actividades" />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}

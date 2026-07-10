import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader title="Mi perfil" />
      <SkeletonPage rows={6} />
    </>
  )
}

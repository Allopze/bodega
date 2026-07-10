import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader title="Sin acceso" />
      <SkeletonPage rows={3} />
    </>
  )
}

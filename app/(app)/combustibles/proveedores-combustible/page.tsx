import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelSuppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SupplierCatalogTable } from "./supplier-table"
import { NewSupplierDialog } from "./new-supplier-dialog"

export default async function ProveedoresCombustiblePage() {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { redirect("/forbidden") }

  const suppliers = await db.query.fuelSuppliers.findMany({
    orderBy: [fuelSuppliers.name],
  })

  return (
    <PageContainer>
      <PageHeader
        title="Proveedores de combustible"
        description="Catálogo de proveedores de combustible (COPEC, ARAMCO, etc.)"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Proveedores de combustible" }]} />}
        actions={<NewSupplierDialog />}
      />
      <SupplierCatalogTable suppliers={suppliers} />
    </PageContainer>
  )
}

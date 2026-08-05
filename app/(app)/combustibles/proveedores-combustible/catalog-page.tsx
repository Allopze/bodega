import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelSuppliers, suppliers } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { FuelSupplierList } from "./supplier-table"

export async function FuelSuppliersCatalogPage() {
  try { await requirePermission("combustibles:manage_suppliers") }
  catch { redirect("/forbidden") }

  const [fuelRows, generalRows] = await Promise.all([
    db.query.fuelSuppliers.findMany({
      with: { supplier: true },
      orderBy: [fuelSuppliers.name],
    }),
    db.query.suppliers.findMany({ orderBy: [suppliers.name] }),
  ])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Proveedores de combustible"
        description="Catálogo administrativo de proveedores de combustible y su identidad comercial compartida."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de flota", href: "/admin/flota-catalogos" },
          { label: "Proveedores de combustible" },
        ]} />}
      />
      <FuelSupplierList
        suppliers={fuelRows.map((row) => ({
          id: row.id,
          supplierId: row.supplierId,
          name: row.supplier?.name ?? row.name,
          rut: row.supplier?.rut ?? row.rut,
          contactName: row.supplier?.contactName ?? row.contactName,
          contactPhone: row.supplier?.phone ?? row.contactPhone,
          contactEmail: row.supplier?.email ?? row.contactEmail,
          notes: row.supplier?.notes ?? row.notes,
          isActive: row.isActive,
        }))}
        generalSuppliers={generalRows.map((row) => ({ id: row.id, name: row.name, rut: row.rut, isActive: row.isActive }))}
      />
    </PageContainer>
  )
}

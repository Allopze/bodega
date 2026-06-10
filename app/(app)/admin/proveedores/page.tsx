import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SupplierList } from "./supplier-list"

export const metadata: Metadata = { title: "Proveedores" }

export default async function ProveedoresPage() {
  try { await requirePermission("admin:suppliers") }
  catch { redirect("/dashboard") }

  const allSuppliers = await db.query.suppliers.findMany({ orderBy: (s, { asc }) => [asc(s.name)] })

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Gestión de proveedores y precios referenciales."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Proveedores" },
          ]} />
        }
      />
      <SupplierList suppliers={allSuppliers.map((s) => ({
        id: s.id, name: s.name, rut: s.rut, contactName: s.contactName,
        businessActivity: s.businessActivity,
        email: s.email, phone: s.phone, address: s.address,
        commune: s.commune, city: s.city,
        paymentTerms: s.paymentTerms, notes: s.notes,
        isActive: s.isActive, createdAt: s.createdAt,
      }))} />
    </>
  )
}

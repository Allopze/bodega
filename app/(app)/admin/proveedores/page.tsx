import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { SupplierList } from "./supplier-list"
import { SupplierActions } from "./supplier-actions"

export const metadata: Metadata = { title: "Proveedores" }

export default async function ProveedoresPage() {
  try { await requirePermission("admin:suppliers") }
  catch { redirect("/forbidden") }

  const allSuppliers = await db.query.suppliers.findMany({ orderBy: (s, { asc }) => [asc(s.name)] })

  const activeCount = allSuppliers.filter((s) => s.isActive).length
  const inactiveCount = allSuppliers.length - activeCount
  const paymentTermsCount = new Set(allSuppliers.flatMap((s) => s.paymentTerms ? [s.paymentTerms] : [])).size
  // Solo "Inactivos" es accionable; total/condiciones de pago van en descripción.
  const headerSignals: HeaderSignal[] = [
    { key: "inactive", label: "Inactivos", value: inactiveCount, tone: "signal" },
  ]
  const description = allSuppliers.length > 0
    ? `${allSuppliers.length} proveedores · ${activeCount} activos · ${paymentTermsCount} condiciones de pago`
    : "Gestión de proveedores y precios referenciales."

  return (
    <PageContainer>
      <PageHeader
        title="Proveedores"
        description={description}
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Proveedores" },
        ]}
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<SupplierActions />}
      />
      <SupplierList suppliers={allSuppliers.map((s) => ({
        id: s.id, name: s.name, rut: s.rut, contactName: s.contactName,
        businessActivity: s.businessActivity,
        email: s.email, phone: s.phone, address: s.address,
        commune: s.commune, city: s.city,
        paymentTerms: s.paymentTerms, notes: s.notes,
        isActive: s.isActive, createdAt: s.createdAt,
      }))} />
    </PageContainer>
  )
}

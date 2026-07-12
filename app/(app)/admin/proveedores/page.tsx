import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { Storefront, CheckCircle, PauseCircle, Receipt } from "@phosphor-icons/react/dist/ssr"
import { SupplierList } from "./supplier-list"
import { SupplierActions } from "./supplier-actions"

export const metadata: Metadata = { title: "Proveedores" }

export default async function ProveedoresPage() {
  try { await requirePermission("admin:suppliers") }
  catch { redirect("/forbidden") }

  const allSuppliers = await db.query.suppliers.findMany({ orderBy: (s, { asc }) => [asc(s.name)] })

  const activeCount = allSuppliers.filter((s) => s.isActive).length
  const paymentTermsCount = new Set(allSuppliers.flatMap((s) => s.paymentTerms ? [s.paymentTerms] : [])).size
  const summaryStats: SummaryStat[] = [
    { key: "total",    label: "Proveedores",   value: allSuppliers.length,             icon: <Storefront size={13} /> },
    { key: "active",   label: "Activos",       value: activeCount,                     icon: <CheckCircle size={13} /> },
    { key: "inactive", label: "Inactivos",     value: allSuppliers.length - activeCount, icon: <PauseCircle size={13} /> },
    { key: "terms",    label: "Cond. de pago", value: paymentTermsCount,               icon: <Receipt size={13} /> },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Proveedores"
        description="Gestión de proveedores y precios referenciales."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Proveedores" },
        ]}
        actions={<SupplierActions />}
      />
      {allSuppliers.length > 0 && <SummaryBar className="mb-4" stats={summaryStats} />}
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

import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelAnomalyRules } from "@/db/schema/fuel-anomalies"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { AnomalyRuleCatalog } from "./rule-catalog"

export const metadata: Metadata = { title: "Reglas de anomalía" }

export default async function AnomalyRulesPage() {
  try { await requirePermission("combustibles:manage_anomaly_rules") }
  catch { redirect("/forbidden") }

  const rows = await db.select().from(fuelAnomalyRules).orderBy(fuelAnomalyRules.name)

  return (
    <PageContainer>
      <PageHeader
        title="Reglas de anomalía"
        description="Activa, desactiva y ajusta los parámetros de las reglas de detección de combustible."
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Anomalías", href: "/combustibles/anomalias" }, { label: "Reglas" }]} />}
      />
      <AnomalyRuleCatalog rows={rows} />
    </PageContainer>
  )
}

import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, count, gte, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelAnomalyCases, fuelAnomalyRules } from "@/db/schema/fuel-anomalies"
import { settle } from "@/lib/async-settle"
import { requirePermission } from "@/lib/auth/can"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { chileLocalDateTimeToUtc, todayInChile } from "@/lib/utils"
import { NewAnomalyRuleButton } from "./new-rule-button"
import { AnomalyRuleCatalog } from "./rule-catalog"

export const metadata: Metadata = { title: "Reglas de detección" }

export default async function AjustesReglasPage() {
  try { await requirePermission("combustibles:manage_anomaly_rules", FUEL_PATHS.ajustes) } catch { redirect("/forbidden") }

  const failed = Symbol("failed")
  const rules = await settle<Awaited<ReturnType<typeof loadRules>> | typeof failed>(loadRules(), failed, "ajustes-reglas")
  const ruleRows = rules === failed ? [] : rules
  const codes = ruleRows.map((rule) => rule.code)

  // Casos que abrió cada regla desde el primer día del mes, en hora de Chile.
  const monthStart = chileLocalDateTimeToUtc(`${todayInChile().slice(0, 7)}-01T00:00`)
  const counts = codes.length === 0
    ? { value: [] as Array<{ ruleCode: string; total: number }>, failed: false }
    : await countCases(codes, monthStart)
  const caseCounts = Object.fromEntries(counts.value.map((row) => [row.ruleCode, row.total]))

  const degraded = [rules === failed ? "reglas de detección" : null, counts.failed ? "casos abiertos por regla" : null].filter((label): label is string => label !== null)

  return (
    <PageContainer>
      <PageHeader
        title="Reglas de detección"
        description="Las reglas que abren casos"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: "Reglas de detección" }]} />}
        actions={<FuelHeaderActions><NewAnomalyRuleButton existingCodes={codes} /></FuelHeaderActions>}
      />
      <div className="space-y-4">
        <DegradedDataBanner degraded={degraded} total={2} />
        <p className="max-w-3xl text-sm text-[var(--color-text-muted)]">
          Cada regla abre un caso cuando se cumple. La gravedad nueva se aplica a los casos nuevos; los que ya están abiertos no cambian.
        </p>
        {rules === failed ? null : (
          <AnomalyRuleCatalog
            rows={ruleRows}
            caseCounts={caseCounts}
            caseCountsFailed={counts.failed}
            emptyAction={<NewAnomalyRuleButton existingCodes={codes} label="Crear una regla" withIcon={false} />}
          />
        )}
      </div>
    </PageContainer>
  )
}

async function loadRules() {
  return await db.select().from(fuelAnomalyRules).orderBy(asc(fuelAnomalyRules.name))
}

async function countCases(codes: string[], since: string): Promise<{ value: Array<{ ruleCode: string; total: number }>; failed: boolean }> {
  const failed = Symbol("failed")
  const rows = await settle<Array<{ ruleCode: string; total: number }> | typeof failed>(
    db.select({ ruleCode: fuelAnomalyCases.ruleCode, total: count() }).from(fuelAnomalyCases)
      .where(and(inArray(fuelAnomalyCases.ruleCode, codes), gte(fuelAnomalyCases.detectedAt, since)))
      .groupBy(fuelAnomalyCases.ruleCode),
    failed,
    "ajustes-reglas-casos",
  )
  return rows === failed ? { value: [], failed: true } : { value: rows, failed: false }
}

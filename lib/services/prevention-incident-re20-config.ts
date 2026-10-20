import { asc } from "drizzle-orm"
import { db } from "@/db"
import { preventionIncidentClassificationCatalog, preventionIncidentRe20Policy } from "@/db/schema"
import { DEFAULT_RE20_SLA_POLICY, RE20_CLASSIFICATION_OPTIONS, type Re20SlaPolicy } from "@/lib/prevention/incidents"
import { requireAccess, type IncidentAccess } from "@/lib/services/prevention-incident-access"

export type Re20ConfigOption = {
  id: string
  category: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
  parentCode: string | null
}

/**
 * Lo que administra `/prevencion/incidentes/configuracion`: el catálogo completo (con inactivos y
 * listas anteriores, que el caso no ofrece) y la política vigente de plazos operacionales internos.
 */
export async function getPreventionIncidentRe20Configuration(access: IncidentAccess): Promise<{ policy: Re20SlaPolicy; options: Re20ConfigOption[] }> {
  requireAccess(access, "prevention:incidents:configure_re20")
  const [globalPolicy] = await db.select().from(preventionIncidentRe20Policy).limit(1)
  const stored = (globalPolicy?.policy ?? {}) as Partial<Record<keyof Re20SlaPolicy, number>>
  const policy: Re20SlaPolicy = {
    version: globalPolicy?.version ?? DEFAULT_RE20_SLA_POLICY.version,
    preliminaryHours: stored.preliminaryHours ?? DEFAULT_RE20_SLA_POLICY.preliminaryHours,
    witnessStatementsHours: stored.witnessStatementsHours ?? DEFAULT_RE20_SLA_POLICY.witnessStatementsHours,
    injuredInterviewHours: stored.injuredInterviewHours ?? DEFAULT_RE20_SLA_POLICY.injuredInterviewHours,
    definitiveHours: stored.definitiveHours ?? DEFAULT_RE20_SLA_POLICY.definitiveHours,
    diffusionHours: stored.diffusionHours ?? DEFAULT_RE20_SLA_POLICY.diffusionHours,
    followupDays: stored.followupDays ?? DEFAULT_RE20_SLA_POLICY.followupDays,
  }
  const rows = await db.select().from(preventionIncidentClassificationCatalog).orderBy(
    asc(preventionIncidentClassificationCatalog.category),
    asc(preventionIncidentClassificationCatalog.sortOrder),
    asc(preventionIncidentClassificationCatalog.name),
  )
  const options: Re20ConfigOption[] = rows.length
    ? rows.map((row) => ({ id: row.id, category: row.category, code: row.code, name: row.name, isActive: row.isActive, sortOrder: row.sortOrder, parentCode: row.parentCode }))
    : RE20_CLASSIFICATION_OPTIONS.map((option, index) => ({ id: `${option.category}:${option.code}`, category: option.category, code: option.code, name: option.name, isActive: option.isActive, sortOrder: index, parentCode: null }))
  return { policy, options }
}

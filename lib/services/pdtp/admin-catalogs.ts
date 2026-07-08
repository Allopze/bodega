/**
 * Admin-side PDTP catalog services.
 *
 * Wraps the underlying CRUD in catalog.ts / sheet-management.ts with the
 * stricter contracts Admin actions in `app/(app)/admin/pdtp-catalogos` need.
 */

import { asc, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpPrograms, pdtpResponsibleCatalog, pdtpSheets } from "@/db/schema"
import { nanoid } from "@/lib/id"

export async function listPdtpAdminCatalogs() {
  const [responsibles, programs, sheets] = await Promise.all([
    db.select().from(pdtpResponsibleCatalog).orderBy(asc(pdtpResponsibleCatalog.displayName)),
    db.select({ id: pdtpPrograms.id, year: pdtpPrograms.year, version: pdtpPrograms.version, status: pdtpPrograms.status, title: pdtpPrograms.title })
      .from(pdtpPrograms).orderBy(desc(pdtpPrograms.year), desc(pdtpPrograms.version)),
    db.select().from(pdtpSheets).orderBy(asc(pdtpSheets.code)),
  ])
  return { responsibles, programs, sheets }
}

export interface PdtpResponsibleInput {
  id?: string
  slug: string
  displayName: string
  roleName?: string
  kind: string
  notes?: string
}

function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
}

export async function upsertPdtpResponsible(input: PdtpResponsibleInput) {
  const slug = input.id || normalizeSlug(input.slug) || `resp-${nanoid()}`
  if (!slug) throw new Error("Slug de responsable requerido")
  const displayName = input.displayName.trim()
  if (!displayName) throw new Error("Nombre visible requerido")
  if (!input.kind?.trim()) throw new Error("Tipo (kind) del responsable requerido")

  await db.insert(pdtpResponsibleCatalog).values({
    slug,
    displayName,
    roleName: input.roleName ?? null,
    kind: input.kind,
    notes: input.notes ?? null,
  }).onConflictDoUpdate({
    target: pdtpResponsibleCatalog.slug,
    set: {
      displayName,
      roleName: input.roleName ?? null,
      kind: input.kind,
      notes: input.notes ?? null,
    },
  })

  const rows = await db.select().from(pdtpResponsibleCatalog).where(eq(pdtpResponsibleCatalog.slug, slug))
  return rows[0]
}

export interface PdtpSheetInput {
  id?: string
  code: string
  programId: string | null
  label: string
  area: string
  defaultScopeRoles: string[]
}

export async function upsertPdtpSheet(input: PdtpSheetInput) {
  if (!input.code?.trim()) throw new Error("Código de hoja requerido")
  if (!input.label?.trim()) throw new Error("Etiqueta de hoja requerida")
  if (!input.area?.trim()) throw new Error("Área de hoja requerida")

  const id = input.id ?? `sht-${normalizeSlug(input.code)}-${nanoid()}`

  await db.insert(pdtpSheets).values({
    id,
    code: input.code,
    programId: input.programId ?? null,
    label: input.label,
    area: input.area,
    defaultScopeRoles: input.defaultScopeRoles,
  }).onConflictDoUpdate({
    target: pdtpSheets.id,
    set: {
      code: input.code,
      programId: input.programId ?? null,
      label: input.label,
      area: input.area,
      defaultScopeRoles: input.defaultScopeRoles,
    },
  })

  const rows = await db.select().from(pdtpSheets).where(eq(pdtpSheets.id, id))
  return rows[0]
}

/** Look up distinct role slugs present in the registry so the defaultScopeRoles picker is data-driven. */
export async function listRoleSlugs(): Promise<string[]> {
  const registry = (await import("@/modules/registry")).registry as ReadonlyArray<{ defaultGrants?: ReadonlyArray<{ roleSlug: string }> }>
  const collected = new Set<string>()
  for (const m of registry) {
    for (const g of m.defaultGrants ?? []) collected.add(g.roleSlug)
  }
  return Array.from(collected).sort()
}

/** Validate defaultScopeRoles against the registry-derived role slugs; returns the cleaned, deduped list. */
export function parseDefaultScopeRoles(raw: FormDataEntryValue | null | undefined, registry: string[]): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  const allowed = new Set(registry)
  const seen = new Set<string>()
  const out: string[] = []
  for (const rawEntry of raw.split(",")) {
    const trimmed = rawEntry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    if (allowed.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

/** Hydrate expected defaultScopeRoles (helper for metrics/dashboards). */
export async function defaultScopeRolesForSheetIds(sheetIds: string[]): Promise<Record<string, string[]>> {
  if (sheetIds.length === 0) return {}
  const rows = await db
    .select({ id: pdtpSheets.id, defaultScopeRoles: pdtpSheets.defaultScopeRoles })
    .from(pdtpSheets)
    .where(inArray(pdtpSheets.id, sheetIds))
  return Object.fromEntries(rows.map((r) => [r.id, r.defaultScopeRoles as string[]]))
}

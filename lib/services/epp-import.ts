import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  eppImportBatches,
  eppImportCorrections,
  eppImportMatches,
  eppImportRows,
  eppProductFamilies,
  productAttributes,
  productCategories,
  productExternalReferences,
  productSuppliers,
  products,
  suppliers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { toCode } from "@/lib/utils"
import {
  findProductMatches,
  buildCorrections,
  normalizeEppRow,
  parseEppWorkbook,
  type NormalizedEppRow,
  type EppAttribute,
  type ImportCorrection,
  type ImportDecision,
} from "./epp-import.types"

export {
  // Re-export types & constants so existing imports continue to work
  normalizeEppRow,
  parseEppWorkbook,
  findProductMatches,
  buildCorrections,
  buildEppFamilyIdentityKey,
  type NormalizedEppRow,
  type ImportCorrection,
  type ImportDecision,
} from "./epp-import.types"
export {
  UNIT_ALIASES,
  COLOR_ALIASES,
  EPP_TYPES,
  VALID_UNITS,
  VALID_COLORS,
  RULE_LABELS,
  type ImportSeverity,
  type EppAttribute,
} from "./epp-import.types"

const RULES_VERSION = "epp-normalization-v1"
const DEFAULT_CATEGORY = { id: "cat-epp", name: "Elementos de Protección Personal", slug: "epp" }

export async function stageEppImportXlsx(input: { buffer: Buffer; fileName: string; userId: string }) {
  const parsed = await parseEppWorkbook(input.buffer)
  if (parsed.errors.length) return { ok: false as const, errors: parsed.errors }
  const fileHash = createHash("sha256").update(input.buffer).digest("hex")
  const duplicate = await db.query.eppImportBatches.findFirst({ where: eq(eppImportBatches.fileHash, fileHash) })
  if (duplicate) return { ok: false as const, errors: [`Este archivo ya fue cargado como lote ${duplicate.id}.`] }

  const existingProducts = await db.query.products.findMany({
    with: { productAttributes: true },
    orderBy: (table, { asc }) => [asc(table.name)],
  })
  const batchId = nanoid()
  const seenIdentityKeys = new Set<string>()

  await db.transaction(async (tx) => {
    await tx.insert(eppImportBatches).values({
      id: batchId, source: "xlsx", fileName: input.fileName, fileHash, status: "review",
      headersJson: JSON.stringify(parsed.headers), sourceFileJson: JSON.stringify({ rowCount: parsed.rows.length, sheetName: parsed.sheetName, encoding: "base64" }), sourceFileData: input.buffer.toString("base64"),
      rulesVersion: RULES_VERSION, createdBy: input.userId,
    })

    for (const source of parsed.rows) {
      const normalized = normalizeEppRow(source.values)
      const duplicateInBatch = seenIdentityKeys.has(normalized.identityKey)
      seenIdentityKeys.add(normalized.identityKey)
      if (duplicateInBatch) normalized.issues.push({ severity: "blocking", message: "Duplicado dentro del mismo archivo." })

      const matches = findProductMatches(normalized, existingProducts)
      const severity = normalized.issues.some((issue) => issue.severity === "blocking")
        ? "blocking"
        : matches.length > 0 || normalized.issues.some((issue) => issue.severity === "warning") ? "warning" : "info"
      const decision: ImportDecision = severity === "blocking" ? "blocked" : matches.length > 0 ? "pending" : "create"
      const rowId = nanoid()
      await tx.insert(eppImportRows).values({
        id: rowId, batchId, rowNumber: source.rowNumber, sourceCode: normalized.sourceCode,
        originalJson: JSON.stringify(source.values), normalizedJson: JSON.stringify(normalized), identityKey: normalized.identityKey,
        severity, decision,
        reviewReason: [...normalized.issues.map((issue) => issue.message), ...(matches.length ? ["Posible producto existente."] : [])].join(" ") || null,
      })
      const corrections = buildCorrections(source.values, normalized)
      if (corrections.length) await tx.insert(eppImportCorrections).values(corrections.map((correction) => ({ id: nanoid(), rowId, field: correction.field, originalValue: correction.from, proposedValue: correction.to, ruleId: correction.ruleId, confidence: correction.confidence })))
      if (matches.length) await tx.insert(eppImportMatches).values(matches.map((match) => ({ id: nanoid(), rowId, productId: match.productId, score: match.score, reasonsJson: JSON.stringify(match.reasons) })))
    }
  })
  return { ok: true as const, batchId, rowCount: parsed.rows.length }
}

export async function getEppImportBatch(batchId: string) {
  return db.query.eppImportBatches.findFirst({
    where: eq(eppImportBatches.id, batchId),
    with: {
      rows: {
        orderBy: (row, { asc }) => [asc(row.rowNumber)],
        with: { corrections: true, matches: { with: { product: true }, orderBy: (match, { desc }) => [desc(match.score)] } },
      },
    },
  })
}

export async function reviewEppImportRow(input: { batchId: string; rowId: string; decision: Exclude<ImportDecision, "blocked" | "pending">; targetProductId?: string | null; normalizedJson?: string; reason?: string | null }) {
  const row = await db.query.eppImportRows.findFirst({ where: and(eq(eppImportRows.id, input.rowId), eq(eppImportRows.batchId, input.batchId)) })
  if (!row) throw new Error("Fila de importación no encontrada")
  const previous = JSON.parse(row.normalizedJson) as NormalizedEppRow
  const normalized = input.normalizedJson ? validateReviewedNormalized(input.normalizedJson, previous.sourceCode) : previous
  if (input.decision === "update" && !input.targetProductId) throw new Error("Selecciona el producto que se actualizará")
  if (normalized.issues.some((issue) => issue.severity === "blocking")) throw new Error(normalized.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.message).join(" "))
  const corrections = buildManualCorrections(previous, normalized)
  await db.transaction(async (tx) => {
    await tx.update(eppImportRows).set({ decision: input.decision, targetProductId: input.targetProductId ?? null, normalizedJson: JSON.stringify(normalized), severity: normalized.issues.some((issue) => issue.severity === "warning") ? "warning" : "info", reviewReason: input.reason ?? null, updatedAt: new Date().toISOString() }).where(eq(eppImportRows.id, row.id))
    if (corrections.length) await tx.insert(eppImportCorrections).values(corrections.map((correction) => ({ id: nanoid(), rowId: row.id, field: correction.field, originalValue: correction.from, proposedValue: correction.to, ruleId: "manual_review", confidence: 100, disposition: "accepted" })))
  })
}

export async function confirmEppImportBatch(batchId: string, userId: string) {
  const batch = await getEppImportBatch(batchId)
  if (!batch) throw new Error("Lote no encontrado")
  if (batch.status !== "review") throw new Error("El lote ya fue confirmado o no está disponible")
  if (batch.rows.some((row) => row.decision === "blocked" || row.decision === "pending")) throw new Error("Resuelve o descarta todas las filas bloqueadas y en revisión antes de confirmar")

  let created = 0
  let updated = 0
  await db.transaction(async (tx) => {
    for (const row of batch.rows) {
      if (row.decision === "skip") continue
      const normalized = JSON.parse(row.normalizedJson) as NormalizedEppRow
      const category = await resolveCategory(tx, normalized.categoryName)
      const family = await resolveFamily(tx, category.id, normalized)
      const supplier = normalized.supplierName ? await resolveSupplier(tx, normalized.supplierName) : null
      const productId = row.decision === "update" ? row.targetProductId : null
      if (row.decision === "update" && !productId) throw new Error(`La fila ${row.rowNumber} no tiene producto de destino`)
      if (productId) {
        updated += 1
        await tx.update(products).set({ name: normalized.name, categoryId: category.id, familyId: family.id, description: normalized.description, unitOfMeasure: normalized.unitOfMeasure, isEpp: true, requiresPrevencion: true, referencePrice: normalized.price, updatedAt: new Date().toISOString() }).where(eq(products.id, productId))
        await tx.delete(productAttributes).where(eq(productAttributes.productId, productId))
      } else {
        created += 1
        const id = nanoid()
        const sku = await generateUniqueEppSku(tx)
        await tx.insert(products).values({ id, sku, name: normalized.name, categoryId: category.id, familyId: family.id, description: normalized.description, unitOfMeasure: normalized.unitOfMeasure, isEpp: true, requiresPrevencion: true, referencePrice: normalized.price, isActive: true })
        await tx.update(eppImportRows).set({ targetProductId: id }).where(eq(eppImportRows.id, row.id))
        await persistProductDetails(tx, id, normalized, supplier?.id ?? null)
        if (normalized.sourceCode) await tx.insert(productExternalReferences).values({ id: nanoid(), productId: id, supplierId: supplier?.id ?? null, source: "xlsx", externalCode: normalized.sourceCode }).onConflictDoNothing()
        continue
      }
      await persistProductDetails(tx, productId, normalized, supplier?.id ?? null)
      if (normalized.sourceCode) await tx.insert(productExternalReferences).values({ id: nanoid(), productId, supplierId: supplier?.id ?? null, source: "xlsx", externalCode: normalized.sourceCode }).onConflictDoNothing()
    }
    await tx.update(eppImportBatches).set({ status: "confirmed", approvedBy: userId, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(eppImportBatches.id, batchId))
  })
  return { created, updated, skipped: batch.rows.filter((row) => row.decision === "skip").length }
}

export async function cancelEppImportBatch(batchId: string) { await db.update(eppImportBatches).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(eppImportBatches.id, batchId)) }

function validateReviewedNormalized(value: string, sourceCode: string | null) {
  let raw: Partial<NormalizedEppRow>
  try { raw = JSON.parse(value) as Partial<NormalizedEppRow> } catch { throw new Error("Los datos corregidos no son válidos") }
  const rawAttrs = Array.isArray(raw.attributes) ? raw.attributes.filter((a): a is EppAttribute => typeof a?.name === "string" && typeof a?.value === "string") : []

  // Preserve multi-value attributes: extract from raw and pass as explicit params
  const tallaAttr = rawAttrs.find((a) => a.name.startsWith("Talla"))
  const size = tallaAttr?.values ? tallaAttr.values.join(", ") : (tallaAttr?.value ?? "")
  const colorAttr = rawAttrs.find((a) => a.name === "Color")
  const color = colorAttr?.values ? colorAttr.values.join(", ") : (colorAttr?.value ?? "")

  // Build attributes string excluding talla and color (handled via explicit params)
  const attrString = rawAttrs.filter((a) => !a.name.startsWith("Talla") && a.name !== "Color").map((a) => `${a.name}: ${a.value}`).join("; ")

  const normalized = normalizeEppRow({
    sourceCode: sourceCode ?? "", name: raw.name ?? "", description: raw.description ?? "", supplierName: raw.supplierName ?? "",
    price: raw.price == null ? "" : String(raw.price), categoryName: raw.categoryName ?? DEFAULT_CATEGORY.name,
    unitOfMeasure: raw.unitOfMeasure ?? "", attributes: attrString,
    size,
    color,
    brand: raw.brand ?? "", model: raw.model ?? "", material: raw.material ?? "",
  })
  return normalized
}

function buildManualCorrections(previous: NormalizedEppRow, next: NormalizedEppRow): ImportCorrection[] {
  const corrections: ImportCorrection[] = []
  for (const field of ["name", "unitOfMeasure", "supplierName", "price", "categoryName"] as const) {
    const before = previous[field] == null ? null : String(previous[field])
    const after = next[field] == null ? null : String(next[field])
    if (before !== after) corrections.push({ field, from: before, to: after, ruleId: "manual_review", confidence: 100 })
  }
  const beforeAttributes = JSON.stringify(previous.attributes)
  const afterAttributes = JSON.stringify(next.attributes)
  if (beforeAttributes !== afterAttributes) corrections.push({ field: "attributes", from: beforeAttributes, to: afterAttributes, ruleId: "manual_review", confidence: 100 })
  return corrections
}

async function resolveCategory(tx: Tx, categoryName: string) { const slug = toCode(categoryName).toLowerCase(); const existing = await tx.query.productCategories.findFirst({ where: eq(productCategories.slug, slug) }); if (existing) return existing; const id = slug === "epp" ? DEFAULT_CATEGORY.id : `cat-${slug}`; await tx.insert(productCategories).values({ id, name: categoryName, slug, isEpp: true, requiresPrevencion: true, sortOrder: 10 }).onConflictDoNothing(); return { id, name: categoryName } }
async function resolveFamily(tx: Tx, categoryId: string, normalized: NormalizedEppRow) { const existing = await tx.query.eppProductFamilies.findFirst({ where: eq(eppProductFamilies.identityKey, normalized.familyIdentityKey) }); if (existing) return existing; const id = nanoid(); await tx.insert(eppProductFamilies).values({ id, categoryId, canonicalName: normalized.canonicalName, identityKey: normalized.familyIdentityKey, eppType: normalized.eppType, brand: normalized.brand, model: normalized.model }); return { id } }
async function resolveSupplier(tx: Tx, supplierName: string) { const existing = await tx.query.suppliers.findFirst({ where: eq(suppliers.name, supplierName) }); if (existing) return existing; const id = `sup-${toCode(supplierName).toLowerCase()}`; await tx.insert(suppliers).values({ id, name: supplierName, isActive: true, notes: "Aprobado durante importación de EPP." }).onConflictDoNothing(); return { id } }
async function generateUniqueEppSku(tx: Tx) { for (let attempt = 0; attempt < 5; attempt++) { const sku = `EPP-${nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`; const existing = await tx.query.products.findFirst({ where: eq(products.sku, sku) }); if (!existing) return sku } throw new Error("No se pudo generar un SKU único") }
async function persistProductDetails(tx: Tx, productId: string, normalized: NormalizedEppRow, supplierId: string | null) { if (normalized.attributes.length) await tx.insert(productAttributes).values(normalized.attributes.map((attribute, index) => ({ id: nanoid(), productId, categoryId: null, name: attribute.name, type: "select", isRequired: true, options: JSON.stringify(attribute.values ?? [attribute.value]), sortOrder: index }))); if (supplierId) await tx.insert(productSuppliers).values({ id: nanoid(), productId, supplierId, unitPrice: normalized.price, isPreferred: true }).onConflictDoUpdate({ target: [productSuppliers.productId, productSuppliers.supplierId], set: { unitPrice: normalized.price, isPreferred: true, lastUpdated: new Date().toISOString() } }) }

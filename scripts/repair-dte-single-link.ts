import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { and, eq, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { auditLog, dteDocuments } from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  findDtePurchaseInvoiceDuplicateConflicts,
  findDteSingleBusinessLinkConflicts,
} from "./preflight-dte-single-link"

type KeepTarget = "purchase_order_invoice" | "fuel_load" | "none"
type RepairMapping = { dteDocumentId: string; keep: KeepTarget }

type Snapshot = {
  id: string
  purchaseOrderInvoiceId: string | null
  fuelLoadId: string | null
}

type RepairResult = {
  mode: "report" | "apply"
  conflicts: number
  repaired: number
  singleBusinessLink: Awaited<ReturnType<typeof findDteSingleBusinessLinkConflicts>>
  duplicatePurchaseInvoices: Awaited<ReturnType<typeof findDtePurchaseInvoiceDuplicateConflicts>>
}

/**
 * Reporta o aplica decisiones explícitas sobre vínculos DTE históricos.
 *
 * El mapping es una lista, por ejemplo:
 * [{"dteDocumentId":"dte-1","keep":"purchase_order_invoice"},
 *  {"dteDocumentId":"dte-2","keep":"none"}]
 *
 * Por defecto no escribe. `--apply` exige `--mapping`, bloquea cada fila y
 * aborta si el estado cambió desde el reporte. Nunca elige un ganador.
 */
export async function repairDteSingleLink(input: {
  apply: boolean
  mappingPath?: string
  actor?: string
}): Promise<RepairResult> {
  const dual = await findDteSingleBusinessLinkConflicts()
  const duplicateGroups = await findDtePurchaseInvoiceDuplicateConflicts()
  const snapshots = new Map<string, Snapshot>()

  for (const row of dual) {
    snapshots.set(row.id, row)
  }
  for (const group of duplicateGroups) {
    const rows = await db.select({
      id: dteDocuments.id,
      purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
      fuelLoadId: dteDocuments.fuelLoadId,
    }).from(dteDocuments).where(and(
      isNotNull(dteDocuments.purchaseOrderInvoiceId),
      eq(dteDocuments.purchaseOrderInvoiceId, group.purchaseOrderInvoiceId),
    ))
    for (const row of rows) snapshots.set(row.id, row)
  }

  const conflictCount = dual.length + duplicateGroups.length
  if (!input.apply) {
    return {
      mode: "report",
      conflicts: conflictCount,
      repaired: 0,
      singleBusinessLink: dual,
      duplicatePurchaseInvoices: duplicateGroups,
    }
  }
  if (!input.mappingPath) throw new Error("--apply exige --mapping <archivo.json>.")

  const mapping = await readMapping(input.mappingPath)
  validateMapping(mapping, snapshots, duplicateGroups)
  const actor = input.actor?.trim() || process.env.DTE_REPAIR_ACTOR?.trim() || "dte-repair-cli"
  let repaired = 0

  await db.transaction(async (tx) => {
    for (const decision of mapping) {
      const expected = snapshots.get(decision.dteDocumentId)!
      const [current] = await tx.select({
        id: dteDocuments.id,
        purchaseOrderInvoiceId: dteDocuments.purchaseOrderInvoiceId,
        fuelLoadId: dteDocuments.fuelLoadId,
      }).from(dteDocuments).where(eq(dteDocuments.id, decision.dteDocumentId)).for("update").limit(1)
      if (!current) throw new Error(`El DTE ${decision.dteDocumentId} ya no existe; no se aplicó ningún cambio.`)
      if (current.purchaseOrderInvoiceId !== expected.purchaseOrderInvoiceId || current.fuelLoadId !== expected.fuelLoadId) {
        throw new Error(`El DTE ${decision.dteDocumentId} cambió desde el reporte; genere un mapping nuevo.`)
      }

      const next = nextLinks(current, decision.keep)
      if (next.purchaseOrderInvoiceId === current.purchaseOrderInvoiceId && next.fuelLoadId === current.fuelLoadId) continue

      await tx.update(dteDocuments).set(next).where(eq(dteDocuments.id, current.id))
      await tx.insert(auditLog).values({
        id: nanoid(),
        userId: null,
        userEmail: actor,
        action: "update",
        entityType: "dte_single_link_repair",
        entityId: current.id,
        oldState: JSON.stringify({ purchaseOrderInvoiceId: current.purchaseOrderInvoiceId, fuelLoadId: current.fuelLoadId }),
        newState: JSON.stringify(next),
        reason: "Reparación explícita de vínculo DTE previa a índice único.",
      })
      repaired++
    }
  })

  return {
    mode: "apply",
    conflicts: conflictCount,
    repaired,
    singleBusinessLink: dual,
    duplicatePurchaseInvoices: duplicateGroups,
  }
}

function nextLinks(row: Snapshot, keep: KeepTarget): { purchaseOrderInvoiceId: string | null; fuelLoadId: string | null } {
  if (keep === "purchase_order_invoice") {
    if (!row.purchaseOrderInvoiceId) throw new Error(`El DTE ${row.id} no tiene vínculo de OC para conservar.`)
    return { purchaseOrderInvoiceId: row.purchaseOrderInvoiceId, fuelLoadId: null }
  }
  if (keep === "fuel_load") {
    if (!row.fuelLoadId) throw new Error(`El DTE ${row.id} no tiene vínculo de combustible para conservar.`)
    return { purchaseOrderInvoiceId: null, fuelLoadId: row.fuelLoadId }
  }
  return { purchaseOrderInvoiceId: null, fuelLoadId: null }
}

function validateMapping(
  mapping: RepairMapping[],
  snapshots: Map<string, Snapshot>,
  duplicateGroups: Awaited<ReturnType<typeof findDtePurchaseInvoiceDuplicateConflicts>>,
): void {
  const seen = new Set<string>()
  for (const decision of mapping) {
    if (!decision || typeof decision.dteDocumentId !== "string" || !["purchase_order_invoice", "fuel_load", "none"].includes(decision.keep)) {
      throw new Error("Mapping inválido: cada fila requiere dteDocumentId y keep válido.")
    }
    if (seen.has(decision.dteDocumentId)) throw new Error(`Mapping repetido para ${decision.dteDocumentId}.`)
    if (!snapshots.has(decision.dteDocumentId)) throw new Error(`El mapping incluye un DTE sin conflicto: ${decision.dteDocumentId}.`)
    seen.add(decision.dteDocumentId)
  }
  const missing = [...snapshots.keys()].filter((id) => !seen.has(id))
  if (missing.length > 0) throw new Error(`Faltan decisiones explícitas para: ${missing.join(", ")}.`)

  // A mapping is not a winner-selection shortcut: every historical duplicate
  // must explicitly leave exactly one DTE on the OC invoice. Without this
  // check, two rows could both say `keep: purchase_order_invoice`, the
  // transaction would succeed today, and the unique-index migration would
  // still fail later.
  for (const group of duplicateGroups) {
    const decisions = group.dteDocumentIds.map((id) => mapping.find((item) => item.dteDocumentId === id)!)
    const kept = decisions.filter((decision) => decision.keep === "purchase_order_invoice")
    if (kept.length !== 1) {
      throw new Error(
        `La factura de OC ${group.purchaseOrderInvoiceId} requiere exactamente un DTE conservado; ` +
        `el mapping seleccionó ${kept.length}.`,
      )
    }
  }
}

async function readMapping(filePath: string): Promise<RepairMapping[]> {
  const parsed: unknown = JSON.parse(await readFile(resolve(filePath), "utf8"))
  if (!Array.isArray(parsed)) throw new Error("El mapping debe ser un arreglo JSON.")
  return parsed as RepairMapping[]
}

function parseArgs(argv: string[]): { apply: boolean; mappingPath?: string; actor?: string } {
  const apply = argv.includes("--apply")
  const mappingIndex = argv.indexOf("--mapping")
  const actorIndex = argv.indexOf("--actor")
  return {
    apply,
    mappingPath: mappingIndex >= 0 ? argv[mappingIndex + 1] : undefined,
    actor: actorIndex >= 0 ? argv[actorIndex + 1] : undefined,
  }
}

async function main() {
  const result = await repairDteSingleLink(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}

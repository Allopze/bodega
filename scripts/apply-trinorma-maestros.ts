/**
 * scripts/apply-trinorma-maestros.ts
 *
 * Maestros de faenas y equipos de la Fase 1 Trinorma (CONTRATOS.md, WP1). Seis pasos,
 * todos idempotentes y en UNA transacción; sin `--apply` el informe es el de una corrida
 * real y la transacción se deshace.
 *
 *   1. Tipos: Flor del Laja → depósito, Oficina Central → administración.
 *   2. Unión de las dos «Arauco» (HORCONES + MANT-ARA), con el traspaso del folio de
 *      Mantención. SÓLO con `--unir-arauco`. El usuario eligió el 2026-11-21 unirlas con el
 *      nombre «Arauco» y el contrato «Horcones» (el contrato no lo crea este script); como
 *      toda carga en producción, `--apply` corre después de revisar la simulación.
 *   3. Alias de faena que no son ya el nombre exacto de una faena.
 *   4. Códigos de los tres tractos de Biodiversa que la carga de vencimientos del 13-11 rotó
 *      (decisión del usuario, 2026-11-21). Va antes de los propietarios: con los códigos
 *      rotados, el inventario no los reconoce.
 *   5. Propietarios desde el inventario de octubre (sólo con `--inventario <xlsx>`).
 *   6. «Ubicación por confirmar» a los equipos activos de faenas inactivas y de Pacífico.
 *   7. El contrato «Horcones» de la faena Arauco y su mandante, Celulosa Arauco y Constitución S.A.
 *      (decisión del usuario, 2026-11-21). Sólo lo operacional: nombre, mandante, faena e inicio;
 *      el cobro (plazo, ciclo, tarifas) es de Facturación y queda descrito en las notas. Sin equipos
 *      asignados: falta decidir los de Asir y trasladar KCH-130.
 *
 * Ningún paso cambia la faena de un equipo (sólo cambia por «Trasladar equipos») y el
 * informe nunca imprime nombres de personas: los propietarios `tercero` salen por cantidad.
 *
 *   npx tsx scripts/apply-trinorma-maestros.ts --actor-email <correo> [--inventario <xlsx>] [--unir-arauco]           # simulación
 *   npx tsx scripts/apply-trinorma-maestros.ts --actor-email <correo> [--inventario <xlsx>] [--unir-arauco] --apply   # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { and, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  contracts, fleetOwners, fuelVehicles, mantFolioCounters, mantHistoricalRecords, mantRecords, mantWorkOrders, mantWorksiteSettings, users, worksiteAliases, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { equipmentCodeKey, matchVehicle, plateKey, type IdentifiedVehicle } from "@/lib/mantencion/equipment-identity"
import { cleanName, nameKey } from "@/lib/mantencion/normalize"
import { loadXlsxTolerant } from "@/lib/reports/xlsx-normalize"
import { createMandante, saveOperationalContract } from "@/lib/services/contracts/contracts"
import { classifyFleetOwnerName, createFleetOwnerTx, setVehicleOwnershipTx, type FleetOwnerKind } from "@/lib/services/fleet-owners"
import { addWorksiteAliasTx, worksiteAliasConflict } from "@/lib/services/worksite-aliases"
import { setWorksiteKindTx, WORKSITE_KIND_LABELS, type WorksiteKind } from "@/lib/services/worksite-kind"
import { worksiteAliasKey } from "@/lib/worksites/resolve-worksite"

const REASON = "Maestros de faenas y equipos de Trinorma (2026-11-21)"

/** Códigos de las faenas que el script toca (CONTRATOS.md, WP1). */
export const WORKSITE_CODES = {
  florDelLaja: "FLOR-DEL-LAJA",
  oficinaCentral: "OFICINA-CENTRAL",
  horcones: "HORCONES",
  manteraArauco: "MANT-ARA",
  pacifico: "FA-007",
  cholguan: "CHOLGUAN-ARAUCO",
  santaFe: "SANTA-FE",
  masisa: "MASISA",
  teno: "TENO-ARAUCO",
} as const

export const KIND_ASSIGNMENTS: ReadonlyArray<{ code: string; kind: WorksiteKind }> = [
  { code: WORKSITE_CODES.florDelLaja, kind: "deposito" },
  { code: WORKSITE_CODES.oficinaCentral, kind: "administracion" },
]

/** Alias que no son ya el nombre exacto de una faena. «Mininco» y «Cabrero» no van: existen como faenas. */
export const ALIAS_ASSIGNMENTS: ReadonlyArray<{ alias: string; code: string }> = [
  { alias: "Horcones", code: WORKSITE_CODES.horcones },
  { alias: "Cholguan", code: WORKSITE_CODES.cholguan },
  { alias: "Cholguan Maderas", code: WORKSITE_CODES.cholguan },
  { alias: "Cholguan Residuos", code: WORKSITE_CODES.cholguan },
  { alias: "Rodantes Santa Fe", code: WORKSITE_CODES.santaFe },
  { alias: "Administración", code: WORKSITE_CODES.oficinaCentral },
  { alias: "Masisa Maderas", code: WORKSITE_CODES.masisa },
  { alias: "Masisa Tableros", code: WORKSITE_CODES.masisa },
  { alias: "Teno", code: WORKSITE_CODES.teno },
]

export const ARAUCO_NAME = "Arauco"
export const ARAUCO_OLD_NAME = "Arauco (anterior)"

/**
 * Los tres tractos MAN TGS 33.400 de Biodiversa. La carga de vencimientos del 2026-11-13 les cambió el
 * código («la planilla manda en el código»), pero la planilla de la faena los traía rotados. El
 * emparejamiento correcto es el que había antes, el mismo del inventario de octubre, la base de
 * equipos del Jefe de Mantención, el GPS, las tarjetas de combustible y los formularios (decisión del
 * usuario, 2026-11-21). La patente y los vencimientos ya estaban bien: sólo vuelve el código.
 */
export const TRACTOR_CODES: ReadonlyArray<{ plate: string; code: string; codeFromVencimientos: string }> = [
  { plate: "SRCJ-47", code: "KCH-133", codeFromVencimientos: "KCH-136" },
  { plate: "SRCJ-42", code: "KCH-135", codeFromVencimientos: "KCH-133" },
  { plate: "SRCJ-39", code: "KCH-136", codeFromVencimientos: "KCH-135" },
]
/**
 * El contrato de la faena Arauco (decisión del usuario, 2026-11-21): uno solo, porque L2 y L3 tienen el
 * mismo mandante, administrador, tarifas y estado de pago. Para el cliente son dos centros con OC, HES y
 * facturas separadas; la plataforma no tiene líneas dentro de un contrato, así que van en las notas.
 * Datos del informe de evidencia del 21-11: las facturas de octubre (13563 y 13589) salieron a Celulosa
 * Arauco y Constitución; el «Maderas Arauco» del estado de pago es un error de la plantilla.
 */
export const HORCONES_CONTRACT = {
  name: "Horcones",
  mandante: { rut: "93.458.000-1", name: "Celulosa Arauco y Constitución S.A." },
  startDate: "2025-08-01",
  notes: [
    "Celulosa Planta Arauco, dos centros del cliente con OC, HES y facturas separadas: CE07 Línea 3 desde agosto de 2025 y CE01 Línea 2 desde mayo de 2026 (fecha inferida de la primera OC y del primer estado de pago que la incluye).",
    "Sin contrato marco: una OC por período (código de proveedor 14038).",
    "Cobro por viaje, sin costo fijo; período del 21 al 20; pago a 30 días desde la recepción de la factura (OC de octubre de 2026); CLP.",
    "Un solo estado de pago, con una hoja por línea. Fuente: informe de evidencia del 2026-11-21.",
  ].join(" "),
} as const

const TRACTOR_REASON = "Trinorma (2026-11-21): vuelve el código anterior a la carga de vencimientos del 13-11, que lo traía rotado; manda el inventario de octubre"

/** Lo que el script aprendió del inventario: una fila por equipo con empresa y (código o patente). */
export interface InventoryOwnerRow { company: string; code: string; plate: string }

export type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { step: string; item: string; action: string; result: Result; detail?: string }
export interface MaestrosReport {
  outcomes: Outcome[]
  notes: string[]
  /** Propietarios por tipo, sólo cantidades (los nombres de los terceros nunca salen). */
  ownersByKind: Record<FleetOwnerKind, number>
}
type Actor = { userId: string; email: string }

class DryRunRollback extends Error {}

/* ── Inventario ──────────────────────────────────────────────────────────── */

function cellText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Date) return value.toISOString()
  const object = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
  if (Array.isArray(object.richText)) return object.richText.map((part) => part.text ?? "").join("").trim()
  if (object.text != null) return cellText(object.text)
  if (object.result != null) return cellText(object.result)
  return ""
}

const headerKey = (value: unknown) => cellText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "")

/**
 * Lee la hoja «Base de Datos» del inventario de octubre (encabezados en la fila 3: EMPRESA, C.INT,
 * PATENTE). Las filas de notas, que no traen código ni patente, se ignoran.
 */
export async function readInventoryOwners(bytes: ArrayBuffer | Uint8Array): Promise<InventoryOwnerRow[]> {
  const workbook = await loadXlsxTolerant(bytes)
  if (!workbook) throw new Error("No se pudo leer el inventario: el archivo no es un Excel válido.")
  const sheet = workbook.getWorksheet("Base de Datos")
  if (!sheet) throw new Error("El inventario no tiene la hoja «Base de Datos».")
  const header = sheet.getRow(3)
  let company = 0
  let code = 0
  let plate = 0
  for (let column = 1; column <= 40; column++) {
    const key = headerKey(header.getCell(column).value)
    if (key === "EMPRESA") company = column
    else if (key === "CINT") code = column
    else if (key === "PATENTE") plate = column
  }
  if (!company || !code || !plate) throw new Error("La hoja «Base de Datos» no tiene las columnas EMPRESA, C.INT y PATENTE en la fila 3.")
  const rows: InventoryOwnerRow[] = []
  for (let number = 4; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number)
    const parsed = { company: cleanName(cellText(row.getCell(company).value)), code: cellText(row.getCell(code).value), plate: cellText(row.getCell(plate).value) }
    if (!parsed.code && !parsed.plate) continue
    rows.push(parsed)
  }
  return rows
}

/* ── Pasos ───────────────────────────────────────────────────────────────── */

type SiteRow = { id: string; name: string; code: string; isActive: boolean; kind: string }

async function loadSites(tx: Tx) {
  const sites = await tx.select({ id: worksites.id, name: worksites.name, code: worksites.code, isActive: worksites.isActive, kind: worksites.kind }).from(worksites)
  const byCode = new Map<string, SiteRow>(sites.map((site) => [site.code, site]))
  return { sites, byCode }
}

const result = (apply: boolean): Result => (apply ? "aplicado" : "dry-run")

async function stepKinds(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  const { byCode } = await loadSites(tx)
  for (const { code, kind } of KIND_ASSIGNMENTS) {
    const site = byCode.get(code)
    const action = `tipo → ${WORKSITE_KIND_LABELS[kind]}`
    if (!site) { out.push({ step: "1 · Tipos", item: code, action, result: "omitido", detail: "falta la faena" }); continue }
    const done = await setWorksiteKindTx(tx, actor, { worksiteId: site.id, kind, reason: REASON })
    if (!done.ok) { out.push({ step: "1 · Tipos", item: code, action, result: "omitido", detail: done.message }); continue }
    out.push({ step: "1 · Tipos", item: site.name, action, result: done.changed ? result(apply) : "ya estaba" })
  }
}

async function stepArauco(tx: Tx, apply: boolean, actor: Actor, enabled: boolean, out: Outcome[]) {
  const step = "2 · Unión de las dos Arauco"
  const { byCode } = await loadSites(tx)
  const horcones = byCode.get(WORKSITE_CODES.horcones)
  const seed = byCode.get(WORKSITE_CODES.manteraArauco)
  if (!horcones || !seed) {
    out.push({ step, item: "Arauco", action: "unir", result: "omitido", detail: `falta la faena ${!horcones ? WORKSITE_CODES.horcones : WORKSITE_CODES.manteraArauco}` })
    return
  }
  const otherArauco = (await loadSites(tx)).sites.find((site) => site.id !== horcones.id && site.id !== seed.id && nameKey(site.name) === nameKey(ARAUCO_NAME))
  if (otherArauco) {
    out.push({ step, item: "Arauco", action: "unir HORCONES con MANT-ARA", result: "omitido", detail: `ya hay otra faena llamada «${ARAUCO_NAME}» (${otherArauco.code}): resolverlo antes` })
    return
  }
  // Equipos y contratos que cuelgan de la Arauco del seed: moverlos es un traslado, no un renombre.
  const [seedVehicles, seedContracts] = await Promise.all([
    tx.select({ id: fuelVehicles.id }).from(fuelVehicles).where(eq(fuelVehicles.worksiteId, seed.id)),
    tx.select({ id: contracts.id }).from(contracts).where(eq(contracts.worksiteId, seed.id)),
  ])
  if (seedVehicles.length > 0 || seedContracts.length > 0) {
    out.push({
      step, item: "Arauco", action: "unir HORCONES con MANT-ARA", result: "omitido",
      detail: `${seed.code} tiene ${seedVehicles.length} equipo(s) y ${seedContracts.length} contrato(s): la unión no se aplica; los equipos sólo cambian de faena con «Trasladar equipos»`,
    })
    return
  }
  const pendingRows = await tx.select({ key: mantHistoricalRecords.sourceKey }).from(mantHistoricalRecords).where(eq(mantHistoricalRecords.worksiteId, seed.id))
  const renameHorcones = horcones.name !== ARAUCO_NAME
  const renameSeed = nameKey(seed.name) === nameKey(ARAUCO_NAME)
  // El folio de Mantención lo tiene la Arauco del seed (lo creó la carga de mantención del 13-11) y no la
  // faena real. El Panel sólo ofrece las faenas con folio: sin traspasarlo, la faena unida no aparece ahí
  // y la anterior, vacía, sí.
  const folioOf = async (worksiteId: string) =>
    (await tx.select({ folioCode: mantWorksiteSettings.folioCode }).from(mantWorksiteSettings).where(eq(mantWorksiteSettings.worksiteId, worksiteId)))[0]?.folioCode
  const [seedFolio, ownFolio] = [await folioOf(seed.id), await folioOf(horcones.id)]
  const folioPending = Boolean(seedFolio && !ownFolio)
  const vehicles = await tx.select({ id: fuelVehicles.id }).from(fuelVehicles).where(eq(fuelVehicles.worksiteId, horcones.id))
  const summary = `${vehicles.length} equipo(s) de ${horcones.code}, ${pendingRows.length} fila(s) de historial en ${seed.code}${folioPending ? `, folio ${seedFolio} de Mantención` : ""}`
  const alreadyJoined = !renameHorcones && !renameSeed && pendingRows.length === 0 && !folioPending
  if (!enabled) {
    out.push({
      step, item: "Arauco", action: "unir HORCONES con MANT-ARA", result: alreadyJoined ? "ya estaba" : "omitido",
      detail: alreadyJoined ? undefined : `no se aplica sin --unir-arauco (requiere autorización explícita); lo que haría: ${summary}`,
    })
    return
  }
  if (alreadyJoined) {
    out.push({ step, item: "Arauco", action: "unir HORCONES con MANT-ARA", result: "ya estaba" })
    return
  }
  // El nombre del seed se libera primero: no pueden coexistir dos faenas llamadas «Arauco».
  if (renameSeed) {
    await tx.update(worksites).set({ name: ARAUCO_OLD_NAME, updatedAt: new Date().toISOString() }).where(eq(worksites.id, seed.id))
    await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "worksite", entityId: seed.id, entityCode: seed.code, oldState: { name: seed.name }, newState: { name: ARAUCO_OLD_NAME }, reason: REASON, worksiteId: seed.id }, tx)
    out.push({ step, item: seed.code, action: `renombrar «${seed.name}» → «${ARAUCO_OLD_NAME}»`, result: result(apply) })
  }
  if (renameHorcones) {
    await tx.update(worksites).set({ name: ARAUCO_NAME, updatedAt: new Date().toISOString() }).where(eq(worksites.id, horcones.id))
    await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "worksite", entityId: horcones.id, entityCode: horcones.code, oldState: { name: horcones.name }, newState: { name: ARAUCO_NAME }, reason: REASON, worksiteId: horcones.id }, tx)
    out.push({ step, item: horcones.code, action: `renombrar «${horcones.name}» → «${ARAUCO_NAME}»`, result: result(apply) })
  }
  if (pendingRows.length > 0) {
    await tx.update(mantHistoricalRecords).set({ worksiteId: horcones.id }).where(eq(mantHistoricalRecords.worksiteId, seed.id))
    await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "mant_historical_records", entityId: seed.id, entityCode: seed.code, oldState: { worksiteId: seed.id, rows: pendingRows.length }, newState: { worksiteId: horcones.id, rows: pendingRows.length }, reason: REASON, worksiteId: horcones.id }, tx)
    out.push({ step, item: seed.code, action: `mover ${pendingRows.length} fila(s) del historial a ${horcones.code}`, result: result(apply) })
  }
  if (folioPending && seedFolio) {
    const action = `traspasar el folio ${seedFolio} de Mantención a ${horcones.code}`
    // Un folio ya emitido (orden, registro o contador) se lee con su faena: si el seed lo usó, no se mueve.
    const [order, record, counter] = await Promise.all([
      tx.select({ id: mantWorkOrders.id }).from(mantWorkOrders).where(eq(mantWorkOrders.worksiteId, seed.id)).limit(1),
      tx.select({ id: mantRecords.id }).from(mantRecords).where(eq(mantRecords.worksiteId, seed.id)).limit(1),
      tx.select({ kind: mantFolioCounters.kind }).from(mantFolioCounters).where(eq(mantFolioCounters.worksiteId, seed.id)).limit(1),
    ])
    if (order.length || record.length || counter.length) {
      out.push({ step, item: seed.code, action, result: "omitido", detail: `${seed.code} ya emitió folios ${seedFolio}: se conserva; ${horcones.code} recibirá uno propio en su primer registro` })
    } else {
      await tx.update(mantWorksiteSettings).set({ worksiteId: horcones.id, updatedAt: new Date().toISOString(), updatedBy: actor.userId }).where(eq(mantWorksiteSettings.worksiteId, seed.id))
      await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "mant_worksite_settings", entityId: horcones.id, entityCode: seedFolio, oldState: { worksiteId: seed.id, folioCode: seedFolio }, newState: { worksiteId: horcones.id, folioCode: seedFolio }, reason: REASON, worksiteId: horcones.id }, tx)
      out.push({ step, item: seed.code, action, result: result(apply) })
    }
  } else if (seedFolio && ownFolio) {
    out.push({ step, item: horcones.code, action: "folio de Mantención", result: "ya estaba", detail: `${horcones.code} ya tiene el folio ${ownFolio}; ${seed.code} conserva ${seedFolio}` })
  }
}

async function stepTractorCodes(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  const step = "4 · Códigos de tres tractos"
  const vehicles = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId }).from(fuelVehicles)
  const plan: Array<{ vehicle: (typeof vehicles)[number]; target: string }> = []
  const problems: string[] = []
  for (const tractor of TRACTOR_CODES) {
    const matches = vehicles.filter((vehicle) => plateKey(vehicle.plate) === plateKey(tractor.plate))
    if (matches.length !== 1) { problems.push(`${tractor.plate}: ${matches.length === 0 ? "no está en la flota" : "patente repetida"}`); continue }
    const vehicle = matches[0]!
    const current = vehicle.code ? equipmentCodeKey(vehicle.code) : ""
    if (current === equipmentCodeKey(tractor.code)) { out.push({ step, item: tractor.plate, action: `código ${tractor.code}`, result: "ya estaba" }); continue }
    if (current !== equipmentCodeKey(tractor.codeFromVencimientos)) {
      problems.push(`${tractor.plate} tiene ${vehicle.code ?? "sin código"}, que no es el que puso la carga del 13-11 (${tractor.codeFromVencimientos})`)
      continue
    }
    plan.push({ vehicle, target: tractor.code })
  }
  // Otro equipo, fuera de los que se corrigen, con uno de los códigos de destino: no se crea un duplicado.
  const planned = new Set(plan.map(({ vehicle }) => vehicle.id))
  for (const { target } of plan) {
    const holder = vehicles.find((vehicle) => !planned.has(vehicle.id) && vehicle.code && equipmentCodeKey(vehicle.code) === equipmentCodeKey(target))
    if (holder) problems.push(`${target} ya lo lleva ${holder.plate ?? holder.code}`)
  }
  if (problems.length > 0) {
    // Los tres códigos rotan entre sí: se corrigen juntos o no se toca ninguno.
    out.push({ step, item: "KCH-133/135/136", action: "volver al código anterior al 13-11", result: "omitido", detail: problems.join("; ") })
    return
  }
  // Dos fases: el índice único no admite un código repetido ni por un instante, y estos rotan entre sí.
  const now = new Date().toISOString()
  for (const { vehicle } of plan) {
    await tx.update(fuelVehicles).set({ code: `ZZTMP-${plateKey(vehicle.plate)}`, updatedAt: now }).where(eq(fuelVehicles.id, vehicle.id))
  }
  for (const { vehicle, target } of plan) {
    await tx.update(fuelVehicles).set({ code: target, updatedAt: now }).where(eq(fuelVehicles.id, vehicle.id))
    await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "fuel_vehicle", entityId: vehicle.id, entityCode: vehicle.plate ?? target, oldState: { code: vehicle.code }, newState: { code: target }, reason: TRACTOR_REASON, worksiteId: vehicle.worksiteId }, tx)
    out.push({ step, item: vehicle.plate ?? target, action: `código ${vehicle.code} → ${target}`, result: result(apply) })
  }
}

async function stepAliases(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  const step = "3 · Alias"
  const { byCode } = await loadSites(tx)
  const existing = await tx.select({ aliasKey: worksiteAliases.aliasKey, worksiteId: worksiteAliases.worksiteId }).from(worksiteAliases)
  for (const { alias, code } of ALIAS_ASSIGNMENTS) {
    const site = byCode.get(code)
    const item = `«${alias}»`
    if (!site) { out.push({ step, item, action: `alias de ${code}`, result: "omitido", detail: "falta la faena" }); continue }
    const key = worksiteAliasKey(alias)
    const action = `alias de ${site.name}`
    if (existing.some((row) => row.aliasKey === key && row.worksiteId === site.id)) { out.push({ step, item, action, result: "ya estaba" }); continue }
    // Recarga los nombres en cada vuelta: la unión de Arauco puede haber cambiado alguno.
    const current = (await tx.select({ id: worksites.id, name: worksites.name }).from(worksites))
    const sameName = current.find((row) => nameKey(row.name) === key)
    if (sameName) { out.push({ step, item, action, result: "omitido", detail: sameName.id === site.id ? "ya es el nombre exacto de la faena" : `es el nombre de la faena ${sameName.name}` }); continue }
    const conflict = await worksiteAliasConflict(tx, site.id, alias)
    if (conflict) { out.push({ step, item, action, result: "omitido", detail: conflict }); continue }
    const added = await addWorksiteAliasTx(tx, actor, { worksiteId: site.id, aliasText: alias, reason: REASON })
    if (!added.ok) { out.push({ step, item, action, result: "omitido", detail: added.message }); continue }
    existing.push({ aliasKey: key, worksiteId: site.id })
    out.push({ step, item, action, result: result(apply) })
  }
}

const OWNER_PRINTABLE: ReadonlySet<FleetOwnerKind> = new Set(["propia", "relacionada", "financiera"])

async function stepOwners(tx: Tx, apply: boolean, actor: Actor, rows: readonly InventoryOwnerRow[] | undefined, out: Outcome[]) {
  const step = "5 · Propietarios"
  if (!rows) {
    out.push({ step, item: "inventario", action: "asignar propietarios", result: "omitido", detail: "sin --inventario no se asignan" })
    return
  }
  const vehicles = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, ownerId: fuelVehicles.ownerId }).from(fuelVehicles)
  const identified: IdentifiedVehicle[] = vehicles.map((vehicle) => ({ id: vehicle.id, code: vehicle.code, plate: vehicle.plate }))
  const byId = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  // Una empresa por equipo (comparada por `nameKey`: «CHOME» = «Chome»); si el inventario lo repite con
  // empresas distintas, ninguna se elige. Se conserva el primer texto escrito de cada empresa.
  const companyByVehicle = new Map<string, Map<string, string>>()
  const unmatched: string[] = []
  let conflicts = 0
  let withoutCompany = 0
  for (const row of rows) {
    if (!row.company) { withoutCompany++; continue }
    const match = matchVehicle({ code: row.code, plate: row.plate }, identified)
    if (match.state === "unmatched") { unmatched.push(row.code || row.plate); continue }
    if (match.state === "conflict") { conflicts++; continue }
    const map = companyByVehicle.get(match.vehicleId) ?? new Map<string, string>()
    if (!map.has(nameKey(row.company))) map.set(nameKey(row.company), row.company)
    companyByVehicle.set(match.vehicleId, map)
  }

  // Empresas: sólo las que van a recibir algún equipo (uno sin propietario y sin ambigüedad).
  const companies = new Map<string, string>()
  for (const [vehicleId, map] of companyByVehicle) {
    if (map.size !== 1 || byId.get(vehicleId)?.ownerId) continue
    const [key, text] = [...map][0]!
    if (!companies.has(key)) companies.set(key, text)
  }
  const ownerIds = new Map<string, { id: string; kind: FleetOwnerKind }>()
  const createdByKind: Record<FleetOwnerKind, number> = { propia: 0, relacionada: 0, financiera: 0, tercero: 0 }
  for (const [key, company] of companies) {
    const kind = classifyFleetOwnerName(company)
    const created = await createFleetOwnerTx(tx, actor, { name: company, kind })
    if (!created.ok) {
      // El mensaje del servicio nombra la empresa: un tercero puede ser una persona, así que sale un texto fijo.
      const printable = OWNER_PRINTABLE.has(kind)
      out.push({ step, item: printable ? company : "(tercero)", action: "crear empresa", result: "omitido", detail: printable ? created.message : "la empresa existe pero no se puede usar (inactiva o con datos inválidos)" })
      continue
    }
    ownerIds.set(key, { id: created.data.id, kind })
    if (created.data.created) {
      createdByKind[kind]++
      if (OWNER_PRINTABLE.has(kind)) out.push({ step, item: company, action: `crear empresa (${kind})`, result: result(apply) })
    }
  }
  const tercerosCreated = createdByKind.tercero
  if (tercerosCreated > 0) out.push({ step, item: `${tercerosCreated} empresa(s) o persona(s)`, action: "crear empresas de tipo tercero (nombres no se imprimen)", result: result(apply) })

  // Asignación: sin pisar un propietario ya informado.
  const assigned: Record<FleetOwnerKind, number> = { propia: 0, relacionada: 0, financiera: 0, tercero: 0 }
  let alreadyOwned = 0
  let ambiguous = 0
  for (const [vehicleId, map] of companyByVehicle) {
    if (map.size > 1) { ambiguous++; continue }
    const owner = ownerIds.get([...map.keys()][0]!)
    const vehicle = byId.get(vehicleId)
    if (!owner || !vehicle) continue
    if (vehicle.ownerId) { alreadyOwned++; continue }
    const done = await setVehicleOwnershipTx(tx, actor, { vehicleId, ownerId: owner.id, reason: REASON })
    if (done.ok && done.data.changed) assigned[owner.kind]++
  }
  for (const kind of ["propia", "relacionada", "financiera", "tercero"] as const) {
    if (assigned[kind] > 0) out.push({ step, item: `${assigned[kind]} equipo(s)`, action: `asignar propietario de tipo ${kind}`, result: result(apply) })
  }
  const totalAssigned = Object.values(assigned).reduce((a, b) => a + b, 0)
  if (totalAssigned === 0) out.push({ step, item: "equipos", action: "asignar propietarios", result: "ya estaba", detail: alreadyOwned > 0 ? `${alreadyOwned} ya tienen propietario` : undefined })
  if (alreadyOwned > 0 && totalAssigned > 0) out.push({ step, item: `${alreadyOwned} equipo(s)`, action: "ya tenían propietario: no se sobrescribe", result: "ya estaba" })
  if (ambiguous > 0) out.push({ step, item: `${ambiguous} equipo(s)`, action: "el inventario lo repite con empresas distintas", result: "omitido" })
  if (conflicts > 0) out.push({ step, item: `${conflicts} fila(s)`, action: "código y patente de equipos distintos (conflicto)", result: "omitido" })
  if (unmatched.length > 0) out.push({ step, item: `${unmatched.length} fila(s)`, action: "no están en la flota", result: "omitido", detail: unmatched.slice(0, 40).join(", ") + (unmatched.length > 40 ? ` y ${unmatched.length - 40} más` : "") })
  if (withoutCompany > 0) out.push({ step, item: `${withoutCompany} fila(s)`, action: "sin empresa en el inventario", result: "omitido" })
}

async function stepLocationPending(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  const step = "6 · Ubicación por confirmar"
  const { sites, byCode } = await loadSites(tx)
  const pacifico = byCode.get(WORKSITE_CODES.pacifico)
  const targetIds = new Set(sites.filter((site) => !site.isActive).map((site) => site.id))
  if (pacifico) targetIds.add(pacifico.id)
  else out.push({ step, item: WORKSITE_CODES.pacifico, action: "equipos de Pacífico", result: "omitido", detail: "falta la faena" })
  const nameOf = new Map(sites.map((site) => [site.id, site.name]))
  const vehicles = targetIds.size === 0 ? [] : await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, pending: fuelVehicles.locationPendingConfirmation })
    .from(fuelVehicles).where(and(eq(fuelVehicles.isActive, true), inArray(fuelVehicles.worksiteId, [...targetIds])))
  let already = 0
  const marked = new Map<string, number>()
  for (const vehicle of vehicles) {
    if (vehicle.pending) { already++; continue }
    const done = await setVehicleOwnershipTx(tx, actor, { vehicleId: vehicle.id, locationPendingConfirmation: true, reason: REASON })
    if (done.ok && done.data.changed) marked.set(vehicle.worksiteId, (marked.get(vehicle.worksiteId) ?? 0) + 1)
  }
  for (const [worksiteId, count] of marked) out.push({ step, item: nameOf.get(worksiteId) ?? worksiteId, action: `marcar ${count} equipo(s) activo(s)`, result: result(apply) })
  if (marked.size === 0) out.push({ step, item: "equipos", action: "marcar ubicación por confirmar", result: "ya estaba", detail: `${already} ya marcados de ${vehicles.length}` })
}

async function stepHorconesContract(tx: Tx, apply: boolean, actor: Actor, out: Outcome[]) {
  const step = "7 · Contrato Horcones"
  const { byCode } = await loadSites(tx)
  const site = byCode.get(WORKSITE_CODES.horcones)
  const item = `«${HORCONES_CONTRACT.name}»`
  if (!site) { out.push({ step, item, action: "crear el contrato", result: "omitido", detail: `falta la faena ${WORKSITE_CODES.horcones}` }); return }
  const existing = await tx.select({ code: contracts.code, name: contracts.name }).from(contracts).where(eq(contracts.worksiteId, site.id))
  const same = existing.find((row) => nameKey(row.name) === nameKey(HORCONES_CONTRACT.name))
  if (same) { out.push({ step, item, action: `contrato de ${site.name}`, result: "ya estaba", detail: same.code }); return }
  // Los servicios de contratos abren su propia transacción; dentro de la del script es un punto de guardado.
  const client = tx as unknown as Parameters<typeof createMandante>[2]
  const mandante = await createMandante(actor, HORCONES_CONTRACT.mandante, client)
  if (!mandante.ok) { out.push({ step, item: HORCONES_CONTRACT.mandante.name, action: "crear el mandante", result: "omitido", detail: mandante.message }); return }
  out.push({ step, item: HORCONES_CONTRACT.mandante.name, action: `mandante ${HORCONES_CONTRACT.mandante.rut}`, result: mandante.existed ? "ya estaba" : result(apply) })
  const saved = await saveOperationalContract(actor, {
    worksiteId: site.id, clientId: mandante.id, name: HORCONES_CONTRACT.name, startDate: HORCONES_CONTRACT.startDate, status: "active",
  }, client)
  if (!saved.ok) { out.push({ step, item, action: "crear el contrato", result: "omitido", detail: saved.message }); return }
  await tx.update(contracts).set({ notes: HORCONES_CONTRACT.notes, updatedAt: new Date().toISOString() }).where(eq(contracts.id, saved.id))
  await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "update", entityType: "contract", entityId: saved.id, entityCode: saved.code, newState: { notes: HORCONES_CONTRACT.notes }, reason: REASON, worksiteId: site.id }, tx)
  out.push({ step, item, action: `crear el contrato de ${site.name} desde el ${HORCONES_CONTRACT.startDate}, sin equipos asignados`, result: result(apply), detail: saved.code })
}

/* ── Orquestación ────────────────────────────────────────────────────────── */

export interface ApplyMaestrosOptions {
  actorEmail: string
  apply?: boolean
  /** Filas del inventario ya leídas (`readInventoryOwners`); sin ellas el paso 5 no hace nada. */
  inventory?: readonly InventoryOwnerRow[]
  /** Autorización explícita para unir las dos «Arauco». */
  unirArauco?: boolean
}

export async function applyTrinormaMaestros(options: ApplyMaestrosOptions): Promise<MaestrosReport> {
  const apply = options.apply ?? false
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor: Actor = { userId: actorRow.id, email: actorRow.email }
  const report: MaestrosReport = {
    outcomes: [],
    notes: [
      "No se crean los alias «Mininco» → Pacífico ni «Cabrero» → Masisa: existen faenas con esos nombres y el inventario dice que Cabrero es una faena propia.",
      "Ningún paso cambia la faena de un equipo: eso sólo se hace con «Trasladar equipos».",
    ],
    ownersByKind: { propia: 0, relacionada: 0, financiera: 0, tercero: 0 },
  }
  try {
    await db.transaction(async (tx) => {
      await stepKinds(tx, apply, actor, report.outcomes)
      await stepArauco(tx, apply, actor, options.unirArauco ?? false, report.outcomes)
      await stepAliases(tx, apply, actor, report.outcomes)
      await stepTractorCodes(tx, apply, actor, report.outcomes)
      await stepOwners(tx, apply, actor, options.inventory, report.outcomes)
      await stepLocationPending(tx, apply, actor, report.outcomes)
      await stepHorconesContract(tx, apply, actor, report.outcomes)
      for (const owner of await tx.select({ kind: fleetOwners.kind }).from(fleetOwners)) report.ownersByKind[owner.kind as FleetOwnerKind]++
      // La simulación corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return report
}

export function printMaestrosReport(report: MaestrosReport, apply: boolean) {
  let step = ""
  for (const o of report.outcomes) {
    if (o.step !== step) { step = o.step; console.log(`\n${step}`) }
    console.log(`  ${o.item.padEnd(34)} ${o.action.padEnd(58)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  }
  const n = (r: Result) => report.outcomes.filter((o) => o.result === r).length
  console.log(`\n${apply ? `${n("aplicado")} aplicado(s)` : `${n("dry-run")} por aplicar (simulación)`}, ${n("ya estaba")} ya estaban, ${n("omitido")} omitido(s).`)
  const kinds = report.ownersByKind
  console.log(`Empresas propietarias en el catálogo: ${kinds.propia} propia(s), ${kinds.relacionada} relacionada(s), ${kinds.financiera} financiera(s), ${kinds.tercero} tercero(s).`)
  for (const note of report.notes) console.log(`Nota: ${note}`)
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${flag}.`)
  return value
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argValue(argv, "--actor-email")
  if (!actorEmail) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  const inventoryPath = argValue(argv, "--inventario")
  const unirArauco = argv.includes("--unir-arauco")
  const inventory = inventoryPath ? await readInventoryOwners(readFileSync(inventoryPath)) : undefined
  console.log(`Maestros de Trinorma — ${apply ? "escribiendo" : "simulación (no escribe)"}${unirArauco ? " · con unión de las dos Arauco" : ""}`)
  printMaestrosReport(await applyTrinormaMaestros({ actorEmail, apply, inventory, unirArauco }), apply)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}

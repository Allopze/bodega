/**
 * scripts/apply-trinorma-equipos-faltantes.ts
 *
 * Alta en la flota de los equipos del consolidado de mantención que no estaban en ella
 * (Trinorma, decisión del usuario del 2026-11-21). Sin ellos, sus trabajos del historial quedan
 * sin equipo ligado. Después de correrlo, una nueva corrida del importador del consolidado
 * completa esos vínculos (sólo llena vínculos vacíos).
 *
 * De los 16 equipos que el consolidado trae y la flota no, se dan de alta 10. La faena sale de
 * la base de equipos por faena de noviembre (Jefe de Mantención), que manda; si no está ahí, del
 * inventario de octubre; y si su faena terminó sin destino, va a Flor del Laja con la marca
 * «ubicación por confirmar» (regla del usuario del 2026-11-19). Los otros 6 no se crean:
 *   - CA-47, CA-81, CA-82: dados de baja en el inventario de octubre y sin trabajos de mantención.
 *   - ESTRUCTURA DE LIMPIEZA, HIDROLAVADORA: sin código ni patente; no son equipos con mantención.
 *   - LCTC-21: es la patente del cargador CR-50, que ya está en la flota.
 *
 * Segunda tanda (decisión del usuario del 2026-11-21, tras el informe de evidencia), dos más que
 * el consolidado traía sin identificar:
 *   - GRDW-63: remolque batea de Chome. Va SIN código: el inventario lo llama KRR-01, que para el
 *     índice único es el mismo código que KRR-001 (otro carro, JC-6212), y la base del Jefe de
 *     Mantención lo llama H-4, que es una grúa horquilla Hyster. Se identifica por patente hasta que el
 *     Jefe confirme el código. Va a Arauco, donde tuvo su último trabajo (21-10), con «ubicación por
 *     confirmar»: Santa Fe cerró el 30-08. Entra como batea, no como carro (decisión del usuario del
 *     2026-11-22): la planilla de disposición de equipos y el programa de salida la describen como
 *     «BATEA MACHILE SRV 203E».
 *   - CA-35 (ZV-6852): camioneta de Asir en Flor del Laja. La flota ya incluye equipos de Asir.
 * WX-6495 (grúa de Asir) no entra: el taller usa ese texto como comodín para otros trabajos.
 *
 * Simulación por defecto, una transacción, rollback de la simulación y bitácora. La faena se fija
 * al crear el equipo (el disparador abre su primera estadía); a un equipo que ya existe nunca se le
 * cambia la faena. Idempotente: un equipo que ya existe por código o patente queda «ya estaba».
 * La empresa propietaria sólo se asigna con `--inventario` y los terceros no se imprimen.
 *
 *   npx tsx scripts/apply-trinorma-equipos-faltantes.ts --actor-email <correo> [--inventario <xlsx>]           # simulación
 *   npx tsx scripts/apply-trinorma-equipos-faltantes.ts --actor-email <correo> [--inventario <xlsx>] --apply   # escribe
 */
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { fleetOwners, fuelEquipmentTypes, fuelVehicleOperationalIntervals, fuelVehicleProducts, fuelVehicles, users, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { matchVehicle, plateKey } from "@/lib/mantencion/equipment-identity"
import { nameKey } from "@/lib/mantencion/normalize"
import { nanoid } from "@/lib/id"
import { classifyFleetOwnerName, createFleetOwnerTx } from "@/lib/services/fleet-owners"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { readInventoryOwners, type InventoryOwnerRow } from "./apply-trinorma-maestros"

const REASON = "Alta de equipos del consolidado de mantención que faltaban en la flota (Trinorma, 2026-11-21)"

export interface MissingEquipment {
  code: string | null
  plate: string
  typeSlug: string
  brand: string | null
  model: string | null
  year: number | null
  worksiteCode: string
  locationPending: boolean
  /** De dónde sale la faena, para el informe y la nota del equipo. */
  source: string
}

export const MISSING_EQUIPMENT: readonly MissingEquipment[] = [
  { code: "CA-85", plate: "PPYR-75", typeSlug: "camioneta", brand: "FOTON", model: "Midi", year: 2021, worksiteCode: "FA-007", locationPending: true, source: "inventario de octubre (Pacífico)" },
  { code: "H-1", plate: "DLSD-56", typeSlug: "grua_horquilla", brand: "HYSTER", model: "3,0 tn", year: 2012, worksiteCode: "SANTA-FE", locationPending: false, source: "base de noviembre (Rodantes = Santa Fe)" },
  { code: "H-2", plate: "DLSD-55", typeSlug: "grua_horquilla", brand: "HYSTER", model: "3,0 tn", year: 2012, worksiteCode: "FLOR-DEL-LAJA", locationPending: false, source: "base de noviembre (Flor del Laja)" },
  { code: "H-13", plate: "LCCY-14", typeSlug: "grua_horquilla", brand: "TCM", model: "3,0 tn", year: 2019, worksiteCode: "FA-007", locationPending: true, source: "inventario de octubre (Pacífico)" },
  { code: "KCB-001", plate: "JG-1255", typeSlug: "batea", brand: "INCONEC", model: "INCONEC", year: 2000, worksiteCode: "BIODIVERSA", locationPending: false, source: "base de noviembre (Biodiversa)" },
  { code: "KCB-002", plate: "JK-3057", typeSlug: "batea", brand: "RANDON", model: "Semiremolque Randon", year: 2009, worksiteCode: "BIODIVERSA", locationPending: false, source: "base de noviembre (Biodiversa)" },
  { code: "KCB-003", plate: "JF-6641", typeSlug: "batea", brand: "MUSSRE", model: "Mussre 2012", year: 2012, worksiteCode: "FLOR-DEL-LAJA", locationPending: true, source: "Calymag terminó sin destino: Flor del Laja por confirmar" },
  { code: "KCB-010", plate: "JWPF-10", typeSlug: "batea", brand: "LIBERATO", model: "Acoplado Liberato", year: 2018, worksiteCode: "BIODIVERSA", locationPending: false, source: "base de noviembre (Biodiversa)" },
  { code: "KRR-002", plate: "JC-5652", typeSlug: "carro", brand: "CABURGA", model: null, year: 1998, worksiteCode: "TENO-ARAUCO", locationPending: false, source: "inventario de octubre (Teno)" },
  { code: null, plate: "SXCV-49", typeSlug: "station_wagon", brand: "MERCEDES BENZ", model: "GLE 400 D AUTOMATIC 4X4", year: 2023, worksiteCode: "OFICINA-CENTRAL", locationPending: false, source: "base de noviembre (Administración), sin código" },
  { code: null, plate: "GRDW-63", typeSlug: "batea", brand: "MACHILE", model: "SRV 203E", year: 2016, worksiteCode: "HORCONES", locationPending: true, source: "remolque batea de Chome; código por confirmar (KRR-01 en el inventario, H-4 en la base de noviembre); Arauco por confirmar" },
  { code: "CA-35", plate: "ZV-6852", typeSlug: "camioneta", brand: "MITSUBISHI", model: "L200 DCAB 2.5", year: 2006, worksiteCode: "FLOR-DEL-LAJA", locationPending: false, source: "inventario de octubre (camioneta de Asir en Flor del Laja)" },
]

export const SKIPPED_EQUIPMENT: readonly { item: string; reason: string }[] = [
  { item: "CA-47, CA-81, CA-82", reason: "dados de baja en el inventario de octubre y sin trabajos de mantención" },
  { item: "ESTRUCTURA DE LIMPIEZA, HIDROLAVADORA", reason: "sin código ni patente; no son equipos con mantención" },
  { item: "LCTC-21", reason: "es la patente del cargador CR-50, que ya está en la flota" },
  { item: "WX-6495", reason: "grúa horquilla de Asir sin código interno; el taller usa ese texto como comodín para otros trabajos de Flor del Laja" },
  { item: "JN-1255", reason: "no es un equipo nuevo: probable error de digitación de JG-1255 (KCB-001); el trabajo se liga a mano cuando el taller lo confirme" },
]

type Result = "dry-run" | "aplicado" | "ya estaba" | "omitido"
export interface Outcome { item: string; action: string; result: Result; detail?: string }
export interface EquiposReport { outcomes: Outcome[]; skipped: typeof SKIPPED_EQUIPMENT }
interface Actor { userId: string; email: string }
class DryRunRollback extends Error {}

const compatibleProductIds = (meterType: string) => (meterType === "none" ? [] : ["fuel-diesel"])

async function ownerFor(tx: Tx, actor: Actor, inventory: readonly InventoryOwnerRow[] | undefined, plate: string): Promise<{ id: string | null; label: string }> {
  if (!inventory) return { id: null, label: "sin informar (falta --inventario)" }
  const companies = [...new Map(inventory.filter((row) => plateKey(row.plate) === plateKey(plate) && row.company).map((row) => [nameKey(row.company), row.company])).values()]
  if (companies.length !== 1) return { id: null, label: companies.length ? "el inventario lo repite con empresas distintas" : "el inventario no informa empresa" }
  const name = companies[0]!
  const kind = classifyFleetOwnerName(name)
  const label = kind === "tercero" ? "un tercero (nombre no se imprime)" : name
  const existing = (await tx.select().from(fleetOwners)).find((owner) => nameKey(owner.name) === nameKey(name))
  if (existing) return existing.isActive ? { id: existing.id, label } : { id: null, label: `${kind === "tercero" ? "la empresa" : name} está inactiva en el catálogo` }
  const created = await createFleetOwnerTx(tx, actor, { name, kind })
  return created.ok ? { id: created.data.id, label } : { id: null, label: kind === "tercero" ? "no se pudo crear la empresa" : created.message }
}

export async function applyTrinormaEquiposFaltantes(options: { actorEmail: string; apply?: boolean; inventory?: readonly InventoryOwnerRow[] }): Promise<EquiposReport> {
  const apply = options.apply ?? false
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor: Actor = { userId: actorRow.id, email: actorRow.email }
  const report: EquiposReport = { outcomes: [], skipped: SKIPPED_EQUIPMENT }
  const { defaultVehicleStatus } = await getFleetAdminSettings()
  try {
    await db.transaction(async (tx) => {
      const sites = new Map((await tx.select({ id: worksites.id, code: worksites.code, name: worksites.name }).from(worksites)).map((site) => [site.code, site]))
      const types = new Map((await tx.select().from(fuelEquipmentTypes)).map((type) => [type.slug, type]))
      for (const item of MISSING_EQUIPMENT) {
        const label = item.code ?? item.plate
        const fleet = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate }).from(fuelVehicles)
        const match = matchVehicle({ code: item.code, plate: item.plate }, fleet)
        if (match.state === "linked") { report.outcomes.push({ item: label, action: "alta en la flota", result: "ya estaba" }); continue }
        if (match.state === "conflict") { report.outcomes.push({ item: label, action: "alta en la flota", result: "omitido", detail: match.reason }); continue }
        const site = sites.get(item.worksiteCode)
        const type = types.get(item.typeSlug)
        if (!site || !type?.isActive) {
          report.outcomes.push({ item: label, action: "alta en la flota", result: "omitido", detail: !site ? `falta la faena ${item.worksiteCode}` : `el tipo ${item.typeSlug} no existe o está inactivo` })
          continue
        }
        const owner = await ownerFor(tx, actor, options.inventory, item.plate)
        const action = `alta en «${site.name}» (${type.name})${item.locationPending ? " · ubicación por confirmar" : ""}`
        const detail = `${item.source}; propietario: ${owner.label}`
        const id = nanoid()
        const values = {
          plate: item.plate,
          code: item.code,
          type: type.slug,
          equipmentTypeId: type.id,
          meterType: type.defaultMeterType,
          performanceUnit: type.defaultPerformanceUnit,
          brand: item.brand,
          model: item.model,
          year: item.year,
          worksiteId: site.id,
          ownerId: owner.id,
          locationPendingConfirmation: item.locationPending,
          operationalStatus: defaultVehicleStatus,
          isActive: true,
          notes: `Alta desde el consolidado de mantención (Trinorma, 2026-11-21). Faena según ${item.source}.`,
        }
        await tx.insert(fuelVehicles).values({ id, ...values })
        await tx.insert(fuelVehicleOperationalIntervals).values({
          id: nanoid(), vehicleId: id, status: defaultVehicleStatus, startedAt: new Date().toISOString(), reason: "Alta inicial del equipo", changedBy: actor.userId,
        })
        const products = compatibleProductIds(values.meterType)
        if (products.length > 0) await tx.insert(fuelVehicleProducts).values(products.map((productId) => ({ vehicleId: id, productId })))
        await recordAudit({
          userId: actor.userId, userEmail: actor.email, action: "create", entityType: "fuel_vehicle", entityId: id, entityCode: item.plate,
          newState: { ...values, ownerId: owner.id, compatibleProductIds: products }, reason: REASON, worksiteId: site.id,
        }, tx)
        report.outcomes.push({ item: label, action, result: apply ? "aplicado" : "dry-run", detail })
      }
      // La simulación corre el mismo código y lo deshace: lo que informa es lo que `--apply` haría.
      if (!apply) throw new DryRunRollback()
    })
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error
  }
  return report
}

export function printEquiposReport(report: EquiposReport, apply: boolean) {
  for (const o of report.outcomes) console.log(`  ${o.item.padEnd(10)} ${o.action.padEnd(62)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  const n = (r: Result) => report.outcomes.filter((o) => o.result === r).length
  console.log(`\n${apply ? `${n("aplicado")} aplicado(s)` : `${n("dry-run")} por aplicar (simulación)`}, ${n("ya estaba")} ya estaban, ${n("omitido")} omitido(s).`)
  console.log("No se crean:")
  for (const skipped of report.skipped) console.log(`  ${skipped.item}: ${skipped.reason}`)
  console.log("Después, vuelve a correr el importador del consolidado para ligar sus trabajos.")
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
  const inventory = inventoryPath ? await readInventoryOwners(readFileSync(inventoryPath)) : undefined
  console.log(`Equipos que faltaban en la flota — ${apply ? "escribiendo" : "simulación (no escribe)"}`)
  printEquiposReport(await applyTrinormaEquiposFaltantes({ actorEmail, apply, inventory }), apply)
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

/**
 * scripts/apply-fleet-copec-decisions-2026-10-29.ts
 *
 * Decisiones de flota tomadas el 2026-10-29 para que la sincronización Copec
 * pueda atribuir lo que ya descarga. La primera corrida del cron (2026-10-29
 * 23:04) dejó octubre con 277 de 308 filas pendientes: 34 patentes de las
 * tarjetas TCT no existían en el padrón y ninguna tarjeta TAE tenía estanque.
 *
 * - **Faenas nuevas.** «Fábrica de Puertas» y «Flor del Laja» no existían como
 *   faenas activas; se crean con `createWorksiteTx` (casillas del programa
 *   preventivo incluidas).
 * - **Vehículos en faenas dadas de baja.** Se trasladan a la faena ACTIVA del
 *   mismo nombre (en producción: los diez de la «Masisa» dada de baja). Un
 *   traslado arrastra el historial de mantención por la FK compuesta
 *   (`ON UPDATE CASCADE`); los consumos y cargas conservan la faena donde
 *   ocurrieron. Sin una única alternativa activa, no se mueve.
 * - **Patentes de la semilla de mantención.** 18 de las patentes pendientes
 *   están en `db/seed/mantencion-seed.json` (validada con la jefatura). Se dan
 *   de alta con su código, tipo, marca, modelo y año, en la faena activa que se
 *   decidió para el nombre de la semilla: «Santa Fe» → Santa Fe - Grúas,
 *   «Arauco» → Cholguan - Arauco, «Fab. Puertas» → Fábrica de Puertas. FZFS-26
 *   (KCH-119, «Pacífico») queda fuera: Pacífico sólo existe dada de baja.
 * - **Estanques TAE.** Una vasija por tarjeta con faena decidida, con la tarjeta
 *   tal como la trae el informe (la conciliación la compara exacta). La tarjeta
 *   de Mininco queda fuera: no tiene faena.
 * - **Segunda tanda, el mismo día.** Las 13 camionetas que no estaban en la
 *   semilla y FZFS-26, con los datos de `INVENTARIO EQUIPOS (ACTUALIZADO
 *   21-08-26).xlsx` y la faena que decidió el usuario. Donde el inventario dice
 *   ADMINISTRACION va a Oficina Central (Administración está dada de baja), igual
 *   que VPTR-69. Pacífico se **reactiva** con `setWorksiteActive` (casillas del
 *   programa preventivo incluidas) en vez de crear una duplicada.
 * - **Correcciones, 2026-10-30.** RWYH-93 va a Oficina Central (se había puesto
 *   en Pacífico) y FBKS-63, minibús en el inventario, pasa al tipo nuevo
 *   «Minibús» (se había dado de alta como camioneta). El plan ya los declara
 *   así; el paso de correcciones arregla lo que dejó la corrida anterior.
 * - **Tercera tanda, 2026-10-30.** Las 16 patentes que cargaron en enero de 2026
 *   y no estaban en el padrón, con los datos del inventario y las mismas reglas
 *   de faena (SANTA FE → Santa Fe - Grúas, PACIFICO → Pacífico). JTBP-17 es una
 *   casa rodante: se crea el tipo «Casa rodante», y queda sin código interno
 *   porque el inventario no le asigna uno.
 *
 * Cada acción comprueba el estado esperado y se salta si no coincide, así que
 * reejecutar es seguro. Todo queda en `audit_log` a nombre de `--actor-email`.
 *
 *   npx tsx scripts/apply-fleet-copec-decisions-2026-10-29.ts --actor-email <correo>            # dry-run
 *   npx tsx scripts/apply-fleet-copec-decisions-2026-10-29.ts --actor-email <correo> --apply    # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelEquipmentTypes, fuelStorageLocations, fuelVehicleOperationalIntervals,
  fuelVehicleProducts, fuelVehicles, users, worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { fuelEquipmentTypeSchema, fuelEquipmentTypeSlug } from "@/lib/combustibles/validation"
import { nanoid } from "@/lib/id"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { getFleetAdminSettings } from "@/lib/services/system-settings"
import { createWorksiteTx } from "@/lib/services/worksite-create"
import { setWorksiteActive } from "@/lib/services/worksite-lifecycle"

const REASON = "Decisiones de flota para la sincronización Copec (2026-10-29)"
const DIESEL = "fuel-diesel"
const BLUEMAX = "fuel-bluemax"

/* ── Plan ─────────────────────────────────────────────────────────────────── */

const NEW_WORKSITES = [
  { name: "Fábrica de Puertas", code: "FABRICA-DE-PUERTAS", aliases: ["Fab. Puertas"] },
  { name: "Flor del Laja", code: "FLOR-DEL-LAJA", aliases: [] },
] as const

/** Faenas dadas de baja que vuelven a operar: se reactivan, no se duplican. */
const REACTIVATED_WORKSITES = [
  { name: "Pacifico", why: "JGZT-92 y FZFS-26 operan en Pacífico" },
] as const

/** Tipos que el catálogo no tenía. Mismos campos y validación que Administración › Tipos de equipo. */
const NEW_EQUIPMENT_TYPES = [
  { name: "Minibús", category: "light", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", sortOrder: 45, description: "Vehículo de pasajeros de hasta 15 asientos (p. ej. Peugeot Expert)." },
  { name: "Casa rodante", category: "truck", defaultMeterType: "odometer", defaultPerformanceUnit: "km_per_liter", sortOrder: 35, description: "Vehículo habitable sobre chasis de camión (p. ej. Mercedes-Benz Vario)." },
] as const

interface VehiclePlan {
  /** Código interno; `null` si el inventario no le asigna uno. */
  code: string | null
  plate: string
  type: "camion" | "tracto" | "camioneta" | "minibus" | "casa-rodante"
  brand: string
  model: string
  year: number | null
  /** Nombre de la faena ACTIVA de destino. */
  worksite: string
  /** Copec registró cargas de BlueMax con su tarjeta. */
  bluemax: boolean
  /** De dónde salen la marca, el modelo y el año. */
  source: "semilla" | "inventario"
}

/** Desde `db/seed/mantencion-seed.json`, con la faena ya traducida. */
const VEHICLES: VehiclePlan[] = [
  { code: "KA-135", plate: "RBYD-98", type: "camion", brand: "Freightliner", model: "M2 106", year: 2021, worksite: "Cholguan - Arauco", bluemax: true, source: "semilla" },
  { code: "KA-137", plate: "RXGR-19", type: "camion", brand: "Sinotruk", model: "T5G-340 MEC", year: 2022, worksite: "Cholguan - Arauco", bluemax: true, source: "semilla" },
  { code: "KA-140", plate: "SGCP-84", type: "camion", brand: "Scania", model: "P 410 B", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KA-141", plate: "SGCP-77", type: "camion", brand: "Scania", model: "P 410 B", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KA-142", plate: "SJFC-34", type: "camion", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KA-143", plate: "SJFC-66", type: "camion", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KCH-133", plate: "SRCJ-47", type: "tracto", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KCH-134", plate: "SRCJ-44", type: "tracto", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: false, source: "semilla" },
  { code: "KCH-135", plate: "SRCJ-42", type: "tracto", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KCH-136", plate: "SRCJ-39", type: "tracto", brand: "MAN", model: "TGS 33.400 BL 6X4", year: 2023, worksite: "Biodiversa", bluemax: true, source: "semilla" },
  { code: "KA-144", plate: "RFJR-63", type: "camion", brand: "Chevrolet", model: "NPR 816 AMT", year: 2021, worksite: "Fábrica de Puertas", bluemax: false, source: "semilla" },
  { code: "KA-85", plate: "WK-5867", type: "camion", brand: "Mercedes", model: "1720 K 36", year: 2007, worksite: "Flor del Laja", bluemax: false, source: "semilla" },
  { code: "KA-134", plate: "PSKL-61", type: "camion", brand: "Freightliner", model: "M2 106", year: 2021, worksite: "Santa Fe - Grúas", bluemax: false, source: "semilla" },
  { code: "KA-136", plate: "RXGR-18", type: "camion", brand: "Sinotruk", model: "T5G-340 MEC", year: 2022, worksite: "Santa Fe - Grúas", bluemax: true, source: "semilla" },
  { code: "KCH-126", plate: "KRJC-75", type: "tracto", brand: "MAN", model: "TGS", year: 2018, worksite: "Santa Fe - Grúas", bluemax: true, source: "semilla" },
  { code: "KCH-129", plate: "KXZD-19", type: "tracto", brand: "Mercedes", model: "Actros 2641", year: 2018, worksite: "Santa Fe - Grúas", bluemax: false, source: "semilla" },
  { code: "KCH-130", plate: "KXZD-20", type: "tracto", brand: "Mercedes", model: "Actros 2018", year: 2018, worksite: "Santa Fe - Grúas", bluemax: false, source: "semilla" },
  { code: "KCH-131", plate: "PFVP-52", type: "tracto", brand: "Mercedes", model: "Actros 2641", year: 2020, worksite: "Santa Fe - Grúas", bluemax: false, source: "semilla" },
  // Segunda tanda: inventario de equipos del 21-08-26 + faena decidida por el usuario.
  { code: "KCH-119", plate: "FZFS-26", type: "tracto", brand: "Freightliner", model: "CL-120", year: 2014, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "CA-19", plate: "JGZT-92", type: "camioneta", brand: "Mahindra", model: "Pick Up", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "CA-96", plate: "RWYH-93", type: "camioneta", brand: "RAM", model: "Van 700 City 1,2", year: 2022, worksite: "Oficina Central", bluemax: false, source: "inventario" },
  { code: "CA-100", plate: "VPTR-69", type: "camioneta", brand: "Maxus", model: "T60 4X2 DX", year: 2025, worksite: "Oficina Central", bluemax: true, source: "inventario" },
  { code: "CA-86", plate: "KLHH-93", type: "camioneta", brand: "Toyota", model: "Hi-Lux", year: 2018, worksite: "Oficina Central", bluemax: false, source: "inventario" },
  { code: "CA-88", plate: "KXWD-95", type: "camioneta", brand: "Mercedes-Benz", model: "X 250D 4x4 2.3", year: 2019, worksite: "Oficina Central", bluemax: false, source: "inventario" },
  { code: "CA-98", plate: "SZGB-72", type: "camioneta", brand: "Maxus", model: "T60 4X2 DX", year: 2025, worksite: "Oficina Central", bluemax: false, source: "inventario" },
  { code: "CA-99", plate: "VHVL-38", type: "camioneta", brand: "Chevrolet", model: "Silverado 3.0 TD 4X4", year: 2025, worksite: "Oficina Central", bluemax: false, source: "inventario" },
  { code: "CA-91", plate: "SBRP-15", type: "camioneta", brand: "Maxus", model: "T60 GL 2.8", year: 2022, worksite: "Biodiversa", bluemax: false, source: "inventario" },
  { code: "CA-92", plate: "STSF-58", type: "camioneta", brand: "Mahindra", model: "Refresh SC 4X2 MT", year: 2023, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-97", plate: "TDSJ-73", type: "camioneta", brand: "Maxus", model: "T60 4X2 DX", year: 2024, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-95", plate: "FBKS-63", type: "minibus", brand: "Peugeot", model: "Expert Confort HDi Full 1.6", year: 2012, worksite: "Fábrica de Puertas", bluemax: false, source: "inventario" },
  { code: "CA-93", plate: "TBZW-37", type: "camioneta", brand: "Mazda", model: "BT-50 4WD 3.0", year: null, worksite: "Fábrica de Puertas", bluemax: false, source: "inventario" },
  { code: "CA-94", plate: "TFJX-48", type: "camioneta", brand: "Toyota", model: "Hilux 4X4 2.8 AUT", year: 2024, worksite: "Flor del Laja", bluemax: false, source: "inventario" },
  // Tercera tanda: patentes de enero 2026 que no estaban en el padrón (inventario 21-08-26).
  { code: "KA-106", plate: "CPSG-36", type: "camion", brand: "Freightliner", model: "M2", year: 2011, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "KA-112", plate: "DPFK-13", type: "camion", brand: "Mercedes-Benz", model: "2726", year: 2012, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-77", plate: "DZJY-31", type: "camioneta", brand: "Mahindra", model: "XL", year: 2012, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-79", plate: "GBTX-84", type: "camioneta", brand: "Mahindra", model: "XL", year: 2012, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "KA-122", plate: "JFDB-87", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "KA-123", plate: "JFDB-90", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-17", plate: "JGZH-30", type: "camioneta", brand: "Kia", model: "Frontier", year: 2017, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "KCH-132", plate: "PGBK-42", type: "tracto", brand: "Mercedes-Benz", model: "Actros New", year: 2020, worksite: "Santa Fe - Grúas", bluemax: true, source: "inventario" },
  { code: "KA-145", plate: "TFYJ-62", type: "camion", brand: "Sinotruk", model: "Howo TX", year: 2024, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "CA-38", plate: "WK-4542", type: "camioneta", brand: "Hyundai", model: "Porter H-100", year: 2005, worksite: "Santa Fe - Grúas", bluemax: false, source: "inventario" },
  { code: "KA-119", plate: "JFDB-88", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "KA-120", plate: "JFDB-89", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "KA-121", plate: "JFDR-84", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "KA-124", plate: "JFDR-86", type: "camion", brand: "Volkswagen", model: "Constellation 31280", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: "CA-16", plate: "JGZH-29", type: "camioneta", brand: "Kia", model: "Frontier", year: 2017, worksite: "Pacifico", bluemax: false, source: "inventario" },
  { code: null, plate: "JTBP-17", type: "casa-rodante", brand: "Mercedes-Benz", model: "Vario 818 4X4", year: 2013, worksite: "Flor del Laja", bluemax: false, source: "inventario" },
]

/** Vehículos que la corrida del 2026-10-29 dejó distinto de lo decidido después. */
const CORRECTIONS: Array<{ plate: string; worksite?: string; type?: VehiclePlan["type"]; why: string }> = [
  { plate: "RWYH-93", worksite: "Oficina Central", why: "corresponde a Administración (Oficina Central), no a Pacífico" },
  { plate: "FBKS-63", type: "minibus", why: "es un minibús; el tipo no existía cuando se dio de alta" },
]

/** Vasijas TAE: la asignación y el N° de vehículo son los del informe Copec. */
const TAE_TANKS = [
  { card: "1-242269-00230-9-1", name: "Vasija TAE Cholguán (Copec N°5, camión)", worksite: "Cholguan - Arauco" },
  { card: "1-242269-00233-9-8", name: "Vasija TAE Planta Masisa (Copec N°9, camioneta)", worksite: "Masisa" },
  { card: "1-242269-00248-9-1", name: "Vasija TAE Flor del Laja (Copec N°8, camión)", worksite: "Flor del Laja" },
] as const

/* ── Ejecución ────────────────────────────────────────────────────────────── */

type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { item: string; action: string; result: Result; detail?: string }
type Report = (outcome: Outcome) => void
interface Actor { userId: string; email: string }

/** Misma comparación que el import de flota: sin tildes, mayúsculas, sin puntuación. */
function worksiteKey(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
}

async function activeWorksiteNamed(tx: Tx, name: string) {
  const rows = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.isActive, true))
  const matches = rows.filter((row) => worksiteKey(row.name) === worksiteKey(name))
  return matches.length === 1 ? matches[0]! : null
}

/** Destino de un vehículo o estanque: la faena por su nombre o, si es una de las nuevas, por cualquiera de sus alias. */
async function targetWorksite(tx: Tx, name: string) {
  const planned = NEW_WORKSITES.find((item) => worksiteKey(item.name) === worksiteKey(name))
  for (const candidate of planned ? [planned.name, ...planned.aliases] : [name]) {
    const found = await activeWorksiteNamed(tx, candidate)
    if (found) return found
  }
  return null
}

async function runNewWorksites(apply: boolean, actor: Actor, report: Report) {
  for (const plan of NEW_WORKSITES) {
    await db.transaction(async (tx) => {
      for (const candidate of [plan.name, ...plan.aliases]) {
        const existing = await activeWorksiteNamed(tx, candidate)
        if (existing) { report({ item: plan.name, action: "crear faena", result: "ya estaba", detail: `activa como «${existing.name}»` }); return }
      }
      const codeTaken = await tx.query.worksites.findFirst({ where: eq(worksites.code, plan.code), columns: { id: true } })
      if (codeTaken) { report({ item: plan.name, action: "crear faena", result: "omitido", detail: `el código ${plan.code} ya existe` }); return }
      if (!apply) { report({ item: plan.name, action: "crear faena", result: "dry-run", detail: plan.code }); return }
      await createWorksiteTx(tx, { name: plan.name, code: plan.code, isActive: true }, { userId: actor.userId, email: actor.email })
      report({ item: plan.name, action: "crear faena", result: "aplicado", detail: plan.code })
    })
  }
}

async function runNewEquipmentTypes(apply: boolean, actor: Actor, report: Report) {
  for (const plan of NEW_EQUIPMENT_TYPES) {
    const action = "crear tipo de equipo"
    const parsed = fuelEquipmentTypeSchema.parse(plan)
    const slug = fuelEquipmentTypeSlug(parsed.name)
    const existing = await db.query.fuelEquipmentTypes.findFirst({ where: eq(fuelEquipmentTypes.slug, slug), columns: { id: true, isActive: true } })
    if (existing) { report({ item: plan.name, action, result: existing.isActive ? "ya estaba" : "omitido", ...(existing.isActive ? {} : { detail: "existe inactivo; reactivarlo desde Tipos de equipo" }) }); continue }
    if (!apply) { report({ item: plan.name, action, result: "dry-run", detail: slug }); continue }
    const id = `fet-${nanoid()}`
    const values = { ...parsed, id, slug }
    await db.transaction(async (tx) => {
      await tx.insert(fuelEquipmentTypes).values(values)
      await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "create", entityType: "fuel_equipment_type", entityId: id, newState: values, reason: REASON }, tx)
    })
    report({ item: plan.name, action, result: "aplicado", detail: slug })
  }
}

async function runReactivations(apply: boolean, actor: Actor, report: Report) {
  for (const plan of REACTIVATED_WORKSITES) {
    const action = `reactivar faena (${plan.why})`
    const all = await db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
    const same = all.filter((row) => worksiteKey(row.name) === worksiteKey(plan.name))
    if (same.some((row) => row.isActive)) { report({ item: plan.name, action, result: "ya estaba" }); continue }
    if (same.length !== 1) { report({ item: plan.name, action, result: "omitido", detail: same.length ? "hay más de una faena dada de baja con ese nombre" : "no existe" }); continue }
    if (!apply) { report({ item: plan.name, action, result: "dry-run" }); continue }
    await setWorksiteActive({ worksiteId: same[0]!.id, activate: true, actorUserId: actor.userId, actorEmail: actor.email, scope: { mode: "all", ids: [] } })
    report({ item: plan.name, action, result: "aplicado" })
  }
}

async function runMovesFromInactiveWorksites(apply: boolean, actor: Actor, report: Report) {
  const all = await db.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive }).from(worksites)
  const inactive = all.filter((row) => !row.isActive)
  for (const from of inactive) {
    const vehicles = await db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate }).from(fuelVehicles).where(eq(fuelVehicles.worksiteId, from.id))
    if (vehicles.length === 0) continue
    const alternatives = all.filter((row) => row.isActive && worksiteKey(row.name) === worksiteKey(from.name))
    if (alternatives.length !== 1) {
      report({ item: from.name, action: `trasladar ${vehicles.length} vehículo(s)`, result: "omitido", detail: alternatives.length ? "hay más de una faena activa con ese nombre" : "no hay una faena activa con ese nombre" })
      continue
    }
    const to = alternatives[0]!
    for (const vehicle of vehicles) {
      const action = `trasladar de «${from.name}» (de baja) a «${to.name}»`
      if (!apply) { report({ item: vehicle.plate, action, result: "dry-run" }); continue }
      const moved = await db.transaction(async (tx) => {
        const updated = await tx.update(fuelVehicles)
          .set({ worksiteId: to.id, updatedAt: new Date().toISOString() })
          .where(and(eq(fuelVehicles.id, vehicle.id), eq(fuelVehicles.worksiteId, from.id)))
          .returning({ id: fuelVehicles.id })
        if (updated.length === 0) return false
        await recordAudit({
          userId: actor.userId,
          userEmail: actor.email,
          action: "update",
          entityType: "fuel_vehicle",
          entityId: vehicle.id,
          entityCode: vehicle.plate,
          oldState: { worksiteId: from.id, worksite: from.name },
          newState: { worksiteId: to.id, worksite: to.name },
          reason: `${REASON}: la faena estaba dada de baja`,
          worksiteId: to.id,
        }, tx)
        return true
      })
      report(moved ? { item: vehicle.plate, action, result: "aplicado" } : { item: vehicle.plate, action, result: "omitido", detail: "el vehículo cambió de faena mientras se aplicaba" })
    }
  }
}

async function runVehicleRegistrations(apply: boolean, actor: Actor, report: Report) {
  const existing = await db.select({ plate: fuelVehicles.plate, worksite: worksites.name })
    .from(fuelVehicles).innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
  const existingByPlate = new Map(existing.map((row) => [plateMatchKey(row.plate), row.worksite]))
  const types = await db.select().from(fuelEquipmentTypes).where(inArray(fuelEquipmentTypes.slug, ["camion", "tracto", "camioneta", "minibus", "casa-rodante"]))
  const { defaultVehicleStatus } = await getFleetAdminSettings()
  for (const plan of VEHICLES) {
    const action = `alta ${plan.code ?? "sin código"} en «${plan.worksite}»`
    // Un vehículo que ya existe no se mueve: su faena pudo decidirla alguien. Si
    // no coincide con el plan se informa, para revisarlo a mano.
    const currentWorksite = existingByPlate.get(plateMatchKey(plan.plate))
    if (currentWorksite !== undefined) {
      const differs = worksiteKey(currentWorksite) !== worksiteKey(plan.worksite)
        && !NEW_WORKSITES.some((item) => worksiteKey(item.name) === worksiteKey(plan.worksite) && item.aliases.some((alias) => worksiteKey(alias) === worksiteKey(currentWorksite)))
      report({ item: plan.plate, action, result: "ya estaba", ...(differs ? { detail: `está en «${currentWorksite}»; no se mueve` } : {}) })
      continue
    }
    const type = types.find((row) => row.slug === plan.type)
    if (!type?.isActive) {
      const pendingType = NEW_EQUIPMENT_TYPES.some((item) => fuelEquipmentTypeSlug(item.name) === plan.type)
      report({ item: plan.plate, action, result: apply || !pendingType ? "omitido" : "dry-run", detail: pendingType ? "el tipo se crea en este mismo plan" : `el tipo ${plan.type} no existe o está inactivo` })
      continue
    }
    await db.transaction(async (tx) => {
      const worksite = await targetWorksite(tx, plan.worksite)
      if (!worksite) {
        const pendingWorksite = NEW_WORKSITES.some((item) => worksiteKey(item.name) === worksiteKey(plan.worksite))
          || REACTIVATED_WORKSITES.some((item) => worksiteKey(item.name) === worksiteKey(plan.worksite))
        report({ item: plan.plate, action, result: apply || !pendingWorksite ? "omitido" : "dry-run", detail: pendingWorksite ? "la faena se crea o reactiva en este mismo plan" : "la faena de destino no existe activa" })
        return
      }
      if (!apply) { report({ item: plan.plate, action, result: "dry-run" }); return }
      const id = nanoid()
      const compatibleProductIds = plan.bluemax ? [DIESEL, BLUEMAX] : [DIESEL]
      const values = {
        plate: plan.plate,
        code: plan.code,
        type: type.slug,
        equipmentTypeId: type.id,
        meterType: type.defaultMeterType,
        performanceUnit: type.defaultPerformanceUnit,
        brand: plan.brand,
        model: plan.model,
        year: plan.year,
        worksiteId: worksite.id,
        operationalStatus: defaultVehicleStatus,
        isActive: true,
        notes: plan.source === "inventario"
          ? "Alta desde el inventario de equipos (21-08-26) con la faena decidida por la jefatura, para atribuir los consumos Copec (2026-10-29)."
          : "Alta desde la semilla de mantención validada, para atribuir los consumos Copec (2026-10-29).",
      }
      await tx.insert(fuelVehicles).values({ id, ...values })
      await tx.insert(fuelVehicleOperationalIntervals).values({
        id: nanoid(),
        vehicleId: id,
        status: defaultVehicleStatus,
        startedAt: new Date().toISOString(),
        reason: "Alta inicial del equipo",
        changedBy: actor.userId,
      })
      await tx.insert(fuelVehicleProducts).values(compatibleProductIds.map((productId) => ({ vehicleId: id, productId })))
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.email,
        action: "create",
        entityType: "fuel_vehicle",
        entityId: id,
        entityCode: plan.plate,
        newState: { ...values, compatibleProductIds },
        reason: REASON,
        worksiteId: worksite.id,
      }, tx)
      report({ item: plan.plate, action, result: "aplicado" })
    })
  }
}

async function runCorrections(apply: boolean, actor: Actor, report: Report) {
  for (const plan of CORRECTIONS) {
    const action = `corregir (${plan.why})`
    await db.transaction(async (tx) => {
      const rows = await tx.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, type: fuelVehicles.type, equipmentTypeId: fuelVehicles.equipmentTypeId })
        .from(fuelVehicles)
      const vehicle = rows.find((row) => plateMatchKey(row.plate) === plateMatchKey(plan.plate))
      if (!vehicle) { report({ item: plan.plate, action, result: "omitido", detail: "el vehículo no existe" }); return }
      const changes: Partial<{ worksiteId: string; type: string; equipmentTypeId: string }> = {}
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      if (plan.worksite) {
        const target = await targetWorksite(tx, plan.worksite)
        if (!target) { report({ item: plan.plate, action, result: "omitido", detail: `la faena «${plan.worksite}» no existe activa` }); return }
        if (vehicle.worksiteId !== target.id) {
          changes.worksiteId = target.id
          before.worksiteId = vehicle.worksiteId
          after.worksiteId = target.id
          after.worksite = target.name
        }
      }
      if (plan.type) {
        const type = await tx.query.fuelEquipmentTypes.findFirst({ where: and(eq(fuelEquipmentTypes.slug, plan.type), eq(fuelEquipmentTypes.isActive, true)), columns: { id: true, slug: true } })
        if (!type) {
          const pendingType = NEW_EQUIPMENT_TYPES.some((item) => fuelEquipmentTypeSlug(item.name) === plan.type)
          report({ item: plan.plate, action, result: apply || !pendingType ? "omitido" : "dry-run", detail: pendingType ? "el tipo se crea en este mismo plan" : `el tipo ${plan.type} no existe activo` })
          return
        }
        if (vehicle.equipmentTypeId !== type.id) {
          changes.type = type.slug
          changes.equipmentTypeId = type.id
          before.type = vehicle.type
          before.equipmentTypeId = vehicle.equipmentTypeId
          after.type = type.slug
          after.equipmentTypeId = type.id
        }
      }
      if (Object.keys(changes).length === 0) { report({ item: plan.plate, action, result: "ya estaba" }); return }
      if (!apply) { report({ item: plan.plate, action, result: "dry-run" }); return }
      await tx.update(fuelVehicles).set({ ...changes, updatedAt: new Date().toISOString() }).where(eq(fuelVehicles.id, vehicle.id))
      await recordAudit({
        userId: actor.userId,
        userEmail: actor.email,
        action: "update",
        entityType: "fuel_vehicle",
        entityId: vehicle.id,
        entityCode: vehicle.plate,
        oldState: before,
        newState: after,
        reason: `${REASON}: ${plan.why}`,
        worksiteId: changes.worksiteId ?? vehicle.worksiteId,
      }, tx)
      report({ item: plan.plate, action, result: "aplicado" })
    })
  }
}

async function runTaeTanks(apply: boolean, actor: Actor, report: Report) {
  for (const plan of TAE_TANKS) {
    const action = `estanque «${plan.name}» en «${plan.worksite}»`
    await db.transaction(async (tx) => {
      const byCard = await tx.query.fuelStorageLocations.findFirst({
        where: and(isNotNull(fuelStorageLocations.taeCardNumber), eq(fuelStorageLocations.taeCardNumber, plan.card), eq(fuelStorageLocations.productId, DIESEL)),
        columns: { id: true, name: true },
      })
      if (byCard) { report({ item: plan.card, action, result: "ya estaba", detail: `asociada a «${byCard.name}»` }); return }
      const worksite = await targetWorksite(tx, plan.worksite)
      if (!worksite) {
        const pendingWorksite = NEW_WORKSITES.some((item) => worksiteKey(item.name) === worksiteKey(plan.worksite))
        report({ item: plan.card, action, result: apply || !pendingWorksite ? "omitido" : "dry-run", detail: pendingWorksite ? "la faena se crea o reactiva en este mismo plan" : "la faena de destino no existe activa" })
        return
      }
      const sameName = await tx.query.fuelStorageLocations.findFirst({ where: and(eq(fuelStorageLocations.worksiteId, worksite.id), eq(fuelStorageLocations.name, plan.name)), columns: { id: true } })
      if (sameName) { report({ item: plan.card, action, result: "omitido", detail: "ya hay un estanque con ese nombre en la faena" }); return }
      if (!apply) { report({ item: plan.card, action, result: "dry-run" }); return }
      const id = `fuel-storage-${nanoid()}`
      const values = { worksiteId: worksite.id, productId: DIESEL, name: plan.name, taeCardNumber: plan.card, notes: "Vasija TAE creada para atribuir las recepciones Copec (2026-10-29)." }
      await tx.insert(fuelStorageLocations).values({ id, ...values })
      await recordAudit({ userId: actor.userId, userEmail: actor.email, action: "create", entityType: "fuel_storage_location", entityId: id, newState: values, reason: REASON, worksiteId: worksite.id }, tx)
      report({ item: plan.card, action, result: "aplicado" })
    })
  }
}

/** Aplica el plan completo (o sólo informa, sin `apply`). Las faenas van primero: las usan los pasos siguientes. */
export async function applyFleetCopecDecisions20261029(options: { actorEmail: string; apply?: boolean }): Promise<Outcome[]> {
  const apply = options.apply ?? false
  const actorRow = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actorRow) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)
  const actor = { userId: actorRow.id, email: actorRow.email }
  const outcomes: Outcome[] = []
  const report: Report = (outcome) => { outcomes.push(outcome) }
  await runNewWorksites(apply, actor, report)
  await runNewEquipmentTypes(apply, actor, report)
  await runReactivations(apply, actor, report)
  await runMovesFromInactiveWorksites(apply, actor, report)
  await runVehicleRegistrations(apply, actor, report)
  await runCorrections(apply, actor, report)
  await runTaeTanks(apply, actor, report)
  return outcomes
}

export function printFleetCopecOutcomes(outcomes: Outcome[], apply: boolean) {
  for (const o of outcomes) console.log(`${o.item.padEnd(20)} ${o.action.padEnd(64)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  const count = (result: Result) => outcomes.filter((o) => o.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, ` +
    `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s).`,
  )
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argv[argv.indexOf("--actor-email") + 1]
  if (!argv.includes("--actor-email") || !actorEmail || actorEmail.startsWith("--")) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Decisiones de flota Copec 2026-10-29 — ${apply ? "escribiendo" : "dry-run"}\n`)
  printFleetCopecOutcomes(await applyFleetCopecDecisions20261029({ actorEmail, apply }), apply)
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

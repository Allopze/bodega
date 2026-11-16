/**
 * scripts/apply-copec-medio-tct-2026-11-16.ts
 *
 * Fusiona el medio de suministro «Copec» (`fsm-copec`, tipo «Estación del
 * proveedor») con «TCT» (`fsm-tct`, «Tarjeta Copec de equipos»).
 *
 * El usuario aclaró el 2026-11-16 que Copec tiene sólo dos flujos: el pago con
 * la tarjeta del equipo en la estación (TCT) y la carga de Copec a una vasija
 * (TAE), que después reparte en faena. Un equipo que en terreno se registra con
 * el medio «Copec» cargó en la estación con su tarjeta: es el flujo TCT con otro
 * nombre. Mientras sean dos medios:
 * - la cuadratura por medio (C-03, `getMediumCross`) no cruza esos litros contra
 *   ningún informe, porque «Copec» no fija proveedor ni canal;
 * - la tabla de litros por faena y medio muestra dos columnas para el mismo canal.
 *
 * Ningún total depende del medio (sólo agrupa, filtra y define C-03): fusionar
 * no cambia los litros, cambia en qué columna aparecen y contra qué informe se
 * cruzan.
 *
 * Qué hace, en una transacción:
 * - pasa a `fsm-tct` las filas con `fsm-copec` en las tres tablas que lo
 *   referencian (`fuel_tae_submissions`, `fuel_equipment_loads`, que es su
 *   proyección, y `fuel_supply_inputs`);
 * - mueve los alias de «Copec» (p. ej. «COPEC» de la planilla) a TCT, para que
 *   las importaciones futuras caigan en TCT;
 * - desactiva «Copec» (no lo borra: el historial y la auditoría lo nombran). El
 *   formulario de terreno sólo ofrece medios activos; un borrador sin conexión
 *   que traiga «Copec» se rechaza con «El medio de suministro elegido ya no está
 *   disponible. Elige otro».
 * Todo queda en `audit_log` a nombre de `--actor-email`.
 *
 *   npx tsx scripts/apply-copec-medio-tct-2026-11-16.ts --actor-email <correo>            # dry-run
 *   npx tsx scripts/apply-copec-medio-tct-2026-11-16.ts --actor-email <correo> --apply    # escribe
 *
 * Idempotente. Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelSupplyInputs, fuelSupplyMedia, fuelTaeSubmissions, users } from "@/db/schema"
import { recordAudit } from "@/lib/audit"

export const FROM_MEDIUM_ID = "fsm-copec"
export const TO_MEDIUM_ID = "fsm-tct"
const REASON = "Copec tiene dos flujos: tarjeta del equipo en estación (TCT) y carga a una vasija (TAE). El medio «Copec» de terreno es el flujo TCT con otro nombre (decisión 2026-11-16)."

export interface TableCount { table: string; rows: number; liters: number }
export interface MergeOutcome {
  result: "dry-run" | "aplicado" | "ya estaba" | "omitido"
  detail?: string
  counts: TableCount[]
  aliasesMoved: string[]
}

const upperUnique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))]

export async function applyCopecMedioTct(options: { actorEmail: string; apply?: boolean }): Promise<MergeOutcome> {
  const apply = options.apply ?? false
  const actor = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actor) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)

  const [from] = await db.select().from(fuelSupplyMedia).where(eq(fuelSupplyMedia.id, FROM_MEDIUM_ID)).limit(1)
  const [to] = await db.select().from(fuelSupplyMedia).where(eq(fuelSupplyMedia.id, TO_MEDIUM_ID)).limit(1)
  // El catálogo se edita desde Ajustes: si alguien cambió el sentido de estos medios, no se adivina.
  if (!from) return { result: "omitido", detail: `No existe el medio ${FROM_MEDIUM_ID}.`, counts: [], aliasesMoved: [] }
  if (!to || to.providerChannel !== "TCT" || to.providerCode !== "copec") {
    return { result: "omitido", detail: `${TO_MEDIUM_ID} ya no es la tarjeta Copec de equipos (canal ${to?.providerChannel ?? "—"}, proveedor ${to?.providerCode ?? "—"}).`, counts: [], aliasesMoved: [] }
  }
  if (from.kind !== "provider_station" || from.providerChannel) {
    return { result: "omitido", detail: `${FROM_MEDIUM_ID} cambió de tipo (${from.kind}, canal ${from.providerChannel ?? "—"}): revisar a mano.`, counts: [], aliasesMoved: [] }
  }

  const counts: TableCount[] = await Promise.all([
    db.select({ rows: sql<number>`count(*)::int`, liters: sql<number>`coalesce(sum(${fuelTaeSubmissions.liters}), 0)::float8` })
      .from(fuelTaeSubmissions).where(eq(fuelTaeSubmissions.supplyMediumId, FROM_MEDIUM_ID)).then(([row]) => ({ table: "fuel_tae_submissions", rows: row?.rows ?? 0, liters: row?.liters ?? 0 })),
    db.select({ rows: sql<number>`count(*)::int`, liters: sql<number>`coalesce(sum(${fuelEquipmentLoads.liters}), 0)::float8` })
      .from(fuelEquipmentLoads).where(eq(fuelEquipmentLoads.supplyMediumId, FROM_MEDIUM_ID)).then(([row]) => ({ table: "fuel_equipment_loads", rows: row?.rows ?? 0, liters: row?.liters ?? 0 })),
    db.select({ rows: sql<number>`count(*)::int`, liters: sql<number>`coalesce(sum(${fuelSupplyInputs.liters}), 0)::float8` })
      .from(fuelSupplyInputs).where(eq(fuelSupplyInputs.supplyMediumId, FROM_MEDIUM_ID)).then(([row]) => ({ table: "fuel_supply_inputs", rows: row?.rows ?? 0, liters: row?.liters ?? 0 })),
  ])
  const aliasesMoved = upperUnique(from.aliases ?? []).filter((alias) => !upperUnique(to.aliases ?? []).includes(alias))
  const pending = counts.some((count) => count.rows > 0) || aliasesMoved.length > 0 || from.isActive || (from.aliases ?? []).length > 0
  if (!pending) return { result: "ya estaba", counts, aliasesMoved }
  if (!apply) return { result: "dry-run", counts, aliasesMoved }

  await db.transaction(async (tx) => {
    const now = new Date().toISOString()
    await tx.update(fuelTaeSubmissions).set({ supplyMediumId: TO_MEDIUM_ID }).where(eq(fuelTaeSubmissions.supplyMediumId, FROM_MEDIUM_ID))
    await tx.update(fuelEquipmentLoads).set({ supplyMediumId: TO_MEDIUM_ID }).where(eq(fuelEquipmentLoads.supplyMediumId, FROM_MEDIUM_ID))
    await tx.update(fuelSupplyInputs).set({ supplyMediumId: TO_MEDIUM_ID }).where(eq(fuelSupplyInputs.supplyMediumId, FROM_MEDIUM_ID))
    await tx.update(fuelSupplyMedia).set({ aliases: upperUnique([...(to.aliases ?? []), ...(from.aliases ?? [])]), updatedAt: now }).where(eq(fuelSupplyMedia.id, TO_MEDIUM_ID))
    await tx.update(fuelSupplyMedia).set({ aliases: [], isActive: false, updatedAt: now }).where(eq(fuelSupplyMedia.id, FROM_MEDIUM_ID))
    await recordAudit({
      userId: actor.id,
      userEmail: actor.email,
      action: "update",
      entityType: "fuel_supply_medium",
      entityId: FROM_MEDIUM_ID,
      entityCode: from.name,
      oldState: { from: { isActive: from.isActive, aliases: from.aliases }, to: { aliases: to.aliases } },
      newState: { mergedInto: TO_MEDIUM_ID, counts, aliasesMoved },
      reason: REASON,
    }, tx)
  })
  return { result: "aplicado", counts, aliasesMoved }
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argv[argv.indexOf("--actor-email") + 1]
  if (!argv.includes("--actor-email") || !actorEmail || actorEmail.startsWith("--")) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Medio «Copec» → «TCT» — ${apply ? "escribiendo" : "dry-run"}\n`)
  const outcome = await applyCopecMedioTct({ actorEmail, apply })
  for (const count of outcome.counts) {
    console.log(`  ${count.table.padEnd(22)} ${String(count.rows).padStart(6)} fila(s)  ${count.liters.toLocaleString("es-CL", { maximumFractionDigits: 0 })} L`)
  }
  if (outcome.aliasesMoved.length > 0) console.log(`  alias que pasan a TCT: ${outcome.aliasesMoved.join(", ")}`)
  console.log(`\n${outcome.result}${outcome.detail ? ` — ${outcome.detail}` : ""}`)
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

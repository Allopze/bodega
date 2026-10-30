/**
 * scripts/apply-copec-dated-mappings-2026-10-30.ts
 *
 * Asignaciones con fecha de Copec desde el 2026-01-01, decididas el 2026-10-30
 * al mover el inicio de la sincronización (`COPEC_SYNC_START_DATE`) a enero
 * de 2026.
 *
 * Para un mes ya cerrado, la sincronización no atribuye una patente a su
 * vehículo por coincidencia: exige una asignación con fecha
 * (`fuel_provider_mappings`) que diga en qué faena estaba ese mes
 * (`createVehicleResolver`). Producción no tenía ninguna, así que cada mes de
 * 2026 quedaba con todas sus filas pendientes y el barrido se detenía en enero.
 *
 * Supuesto aceptado por el usuario: cada vehículo activo estuvo todo 2026 en la
 * faena donde está hoy. Se crea, por vehículo y por cuenta Copec (TCT Diésel y
 * TCT BlueMax), una asignación abierta desde el 2026-01-01, igual a la que
 * crea «vincular patente» en el detalle de una importación. Abierta (sin
 * `effectiveTo`) porque cada mes que se cierra vuelve a necesitarla.
 *
 * Ojo: el resolvedor usa la faena guardada en la asignación, no la del
 * vehículo. Si después un vehículo cambia de faena desde la flota, su
 * asignación no cambia sola: hay que versionarla (vincular la patente de nuevo
 * desde el lote del mes del cambio).
 *
 * Una patente que ya tiene asignación activa no se toca. Todo queda en
 * `audit_log` a nombre de `--actor-email`.
 *
 *   npx tsx scripts/apply-copec-dated-mappings-2026-10-30.ts --actor-email <correo>            # dry-run
 *   npx tsx scripts/apply-copec-dated-mappings-2026-10-30.ts --actor-email <correo> --apply    # escribe
 *
 * Se aplica una vez, a mano; no forma parte del deploy.
 */
import { pathToFileURL } from "node:url"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderMappings, fuelVehicles, users, worksites } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"

const EFFECTIVE_FROM = "2026-01-01"
const SOURCE_ACCOUNTS = ["tct:diesel", "tct:bluemax"] as const
const REASON = "Asignación con fecha desde 2026-01-01 en la faena actual del vehículo, al mover el inicio de la sincronización Copec a enero de 2026 (decisión 2026-10-30)"

type Result = "aplicado" | "dry-run" | "ya estaba" | "omitido"
export interface Outcome { item: string; action: string; result: Result; detail?: string }

export async function applyCopecDatedMappings20261030(options: { actorEmail: string; apply?: boolean }): Promise<Outcome[]> {
  const apply = options.apply ?? false
  const actor = await db.query.users.findFirst({ where: and(eq(users.email, options.actorEmail), eq(users.isActive, true)), columns: { id: true, email: true } })
  if (!actor) throw new Error(`No hay un usuario activo con el correo ${options.actorEmail}: la bitácora necesita un responsable.`)

  const vehicles = await db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, worksiteId: fuelVehicles.worksiteId, worksite: worksites.name })
    .from(fuelVehicles)
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(and(eq(fuelVehicles.isActive, true), eq(worksites.isActive, true)))
  const outcomes: Outcome[] = []
  // Dos vehículos activos con la misma patente normalizada no pueden decidir solos a quién va el consumo.
  const byKey = new Map<string, typeof vehicles>()
  for (const vehicle of vehicles) byKey.set(plateMatchKey(vehicle.plate), [...(byKey.get(plateMatchKey(vehicle.plate)) ?? []), vehicle])

  for (const [key, sameKey] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const vehicle = sameKey[0]!
    for (const sourceAccount of SOURCE_ACCOUNTS) {
      const action = `asignar ${sourceAccount} desde ${EFFECTIVE_FROM} a «${vehicle.worksite}»`
      if (sameKey.length > 1) { outcomes.push({ item: vehicle.plate, action, result: "omitido", detail: "hay más de un vehículo activo con esa patente" }); continue }
      const result = await db.transaction(async (tx) => {
        const active = await tx.query.fuelProviderMappings.findFirst({
          where: and(
            eq(fuelProviderMappings.provider, "copec"),
            eq(fuelProviderMappings.sourceAccount, sourceAccount),
            eq(fuelProviderMappings.externalKey, key),
            eq(fuelProviderMappings.isActive, true),
          ),
          columns: { id: true, vehicleId: true, worksiteId: true, effectiveFrom: true },
        })
        if (active) {
          const same = active.vehicleId === vehicle.id && active.worksiteId === vehicle.worksiteId
          return { result: "ya estaba" as const, detail: same ? `desde ${active.effectiveFrom}` : `ya tiene una asignación activa a otro vehículo o faena (desde ${active.effectiveFrom}); no se toca` }
        }
        if (!apply) return { result: "dry-run" as const }
        const id = nanoid()
        const values = {
          id,
          provider: "copec",
          sourceAccount,
          externalKey: key,
          normalizedValue: key,
          worksiteId: vehicle.worksiteId,
          vehicleId: vehicle.id,
          version: 1,
          isActive: true,
          decidedBy: actor.id,
          reason: REASON,
          effectiveFrom: EFFECTIVE_FROM,
        }
        await tx.insert(fuelProviderMappings).values(values)
        await recordAudit({
          userId: actor.id,
          userEmail: actor.email,
          action: "create",
          entityType: "fuel_provider_mapping",
          entityId: id,
          entityCode: vehicle.plate,
          newState: { ...values, worksite: vehicle.worksite },
          reason: REASON,
          worksiteId: vehicle.worksiteId,
        }, tx)
        return { result: "aplicado" as const }
      })
      outcomes.push({ item: vehicle.plate, action, ...result })
    }
  }
  return outcomes
}

export async function main(argv = process.argv) {
  const apply = argv.includes("--apply")
  const actorEmail = argv[argv.indexOf("--actor-email") + 1]
  if (!argv.includes("--actor-email") || !actorEmail || actorEmail.startsWith("--")) throw new Error("Falta --actor-email <correo>: la bitácora necesita un responsable.")
  console.log(`Asignaciones Copec con fecha desde ${EFFECTIVE_FROM} — ${apply ? "escribiendo" : "dry-run"}\n`)
  const outcomes = await applyCopecDatedMappings20261030({ actorEmail, apply })
  for (const o of outcomes.filter((item) => item.result !== "dry-run" && item.result !== "aplicado")) {
    console.log(`${o.item.padEnd(10)} ${o.action.padEnd(60)} ${o.result}${o.detail ? ` — ${o.detail}` : ""}`)
  }
  const byWorksite = new Map<string, number>()
  for (const o of outcomes.filter((item) => item.result === (apply ? "aplicado" : "dry-run"))) {
    const worksite = o.action.match(/«(.+)»/)?.[1] ?? "?"
    byWorksite.set(worksite, (byWorksite.get(worksite) ?? 0) + 1)
  }
  for (const [worksite, count] of [...byWorksite.entries()].sort()) console.log(`  ${worksite.padEnd(24)} ${count} asignación(es)`)
  const count = (result: Result) => outcomes.filter((o) => o.result === result).length
  console.log(
    `\n${apply ? `${count("aplicado")} aplicada(s)` : `${count("dry-run")} por aplicar (dry-run)`}, ` +
    `${count("ya estaba")} ya estaban, ${count("omitido")} omitida(s).`,
  )
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

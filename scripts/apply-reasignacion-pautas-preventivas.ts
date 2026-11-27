/**
 * Pasa los equipos a las pautas preventivas de los formularios y retira las pautas viejas que
 * queden vacías (decisión del usuario, 2026-11-27). Ver `lib/services/mantencion/pautas-preventivas/reassign.ts`.
 *
 *   npm run db:reasignar-pautas-preventivas                                  # sólo muestra el plan
 *   npm run db:reasignar-pautas-preventivas -- --apply --actor correo@dominio  # aplica con ese usuario
 *
 * Corre después de `db:seed:pautas-preventivas`. Respaldar antes de `--apply`.
 */
import { db } from "@/db"
import { applyReassignment, planReassignment } from "@/lib/services/mantencion/pautas-preventivas/reassign"

function argValue(flag: string): string | null {
  const at = process.argv.indexOf(flag)
  return at >= 0 ? process.argv[at + 1] ?? null : null
}

async function main() {
  const plan = await planReassignment(db)
  for (const target of plan.targets) {
    console.log(`\n${target.schedule}: ${target.equipment.length} equipos`)
    for (const item of target.equipment) console.log(`  ${item.code.padEnd(10)} ${String(item.family ?? "-").padEnd(22)} desde ${item.from ?? "(sin pauta)"}`)
  }
  console.log(`\nSin cambio (km y no camión): ${plan.untouched.length} — ${plan.untouched.map((item) => item.code).join(", ")}`)
  if (plan.withoutBrand.length) console.log(`Sin marca (quedarían fuera): ${plan.withoutBrand.join(", ")}`)
  if (!process.argv.includes("--apply")) return
  const actor = argValue("--actor")
  if (!actor) throw new Error("--apply necesita --actor <correo del usuario que firma el cambio>.")
  console.log("\nAplicando…")
  console.log(JSON.stringify(await applyReassignment(db, actor), null, 2))
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)

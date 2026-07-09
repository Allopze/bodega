/**
 * scripts/sync-rbac.ts — Sincroniza roles/permisos del sistema con la BD.
 *
 * `ensureSystemRbac()` solo corre en el bootstrap del primer usuario, así que
 * los permisos nuevos añadidos a los manifests no llegan a una BD ya poblada.
 * Correr este script tras cada deploy que agregue/cambie permisos:
 *
 *   npm run db:sync-rbac                 # usa .env.local
 *   tsx --env-file=.env.prod scripts/sync-rbac.ts   # otra BD
 *
 * Es idempotente (upserts + reemplazo de grants de roles del sistema).
 */
import { ensureSystemRbac } from "@/lib/auth/bootstrap"

async function main() {
  await ensureSystemRbac()
  console.log("RBAC del sistema sincronizado (roles, permisos y grants).")
  process.exit(0)
}

main().catch((err) => {
  console.error("Error sincronizando RBAC:", err)
  process.exit(1)
})

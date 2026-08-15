/**
 * scripts/seed-prevention-cphs-orientation-course.ts
 *
 * Siembra el curso "Orientación en Prevención de Riesgos" (DS 44, art. 16),
 * requisito Bronce de la certificación CPHS Mutual
 * (`orientation_training` en lib/prevention/cphs-certification.ts). Sin este
 * curso en el catálogo, ese requisito nunca puede cumplirse: no hay curso que
 * declarar como exigible a los integrantes del comité.
 *
 * Este script siembra el CURSO, no el requisito de competencia. Vincularlo a
 * un comité específico (scope `committee`, `scopeValue = <committeeId>`) sigue
 * siendo una acción de Prevención por comité, hecha desde la UI de
 * capacitación: el `committeeId` no se conoce en tiempo de siembra, y cada
 * faena con comité real debe declararlo a propósito.
 *
 * Idempotente por `code` — si ya existe, no crea un duplicado.
 *
 *   npm run db:seed-cphs-orientation-course                  # usa .env.local
 *   tsx --env-file=.env.prod scripts/seed-prevention-cphs-orientation-course.ts
 *   SEED_DRY_RUN=true npm run db:seed-cphs-orientation-course  # validar sin escribir
 *
 * Actor: por defecto el primer usuario con rol `administrador`. Se puede fijar
 * explícitamente con CPHS_ORIENTATION_ACTOR_USER_ID.
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { eq } from "drizzle-orm"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"

loadEnvConfig(process.cwd())

const CODE = "CUR-ORIENT-CPHS"
const DRY_RUN = process.env.SEED_DRY_RUN === "true"

async function resolveActorUserId(db: ReturnType<typeof drizzle>): Promise<string> {
  const fromEnv = process.env.CPHS_ORIENTATION_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(eq(schema.roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa CPHS_ORIENTATION_ACTOR_USER_ID explícitamente.")
  return row.userId
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required (postgres://...)")
    process.exit(1)
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(client, { schema })

  console.log(`Siembra del curso de orientación CPHS (${CODE}) — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)

  const [existing] = await db.select().from(schema.preventionTrainingCourses)
    .where(eq(schema.preventionTrainingCourses.code, CODE)).limit(1)

  if (existing) {
    console.log(`  · "${CODE}" ya existe (id=${existing.id}), omitido. No se reemplaza contenido: usa la UI de capacitación para versionarlo.`)
    await client.end()
    return
  }

  const actorUserId = await resolveActorUserId(db)
  console.log(`  Actor: ${actorUserId}`)

  if (DRY_RUN) {
    console.log(`  [DRY RUN] sembraría el curso ${CODE} · 480 min · vigencia 24 meses · DS 44 art. 16.`)
    await client.end()
    return
  }

  // `createTrainingCourse` corre la validación real (incluido el piso legal de
  // DS 44 art. 16 para `legal_mandatory`), así que se usa el servicio y no un
  // INSERT crudo — mismo criterio que seed-pdtp-checklists-2026.ts.
  const { createTrainingCourse } = await import("../lib/services/prevention-training")
  const created = await createTrainingCourse({
    code: CODE,
    name: "Orientación en Prevención de Riesgos",
    kind: "legal_mandatory",
    description: "Orientación básica en prevención de riesgos para integrantes del Comité Paritario, exigida por el manual de certificación de Mutual de Seguridad CChC (nivel Bronce).",
    minimumDurationMinutes: 480,
    validityMonths: 24,
    requiresAssessment: true,
    passingScore: 70,
    legalBasis: "DS 44, art. 16",
  }, {
    userId: actorUserId,
    scope: { mode: "all", ids: [] },
    permissions: ["prevention:training:manage"],
  })

  console.log(`  ✓ Curso sembrado: ${created.id} (code=${created.code}).`)
  console.log("  Pendiente por comité: declarar el requisito de competencia con scope 'committee'")
  console.log(`  y scopeValue = <committeeId> desde /prevencion/capacitacion, para cada comité real.`)
  await client.end()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })

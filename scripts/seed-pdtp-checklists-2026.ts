/**
 * scripts/seed-pdtp-checklists-2026.ts
 *
 * Siembra las plantillas de ChecklistDefinition del programa preventivo 2026
 * (Fases A + C del PLAN_INTEGRACION_PROGRAMA_2026_FORMULARIOS.md). Cada
 * definición se adjunta como plantilla activa (`pdtpActivityChecklists`) a la
 * actividad PDTP 2026 que le corresponde por su `n`.
 *
 *   n=27 → Inspección Taller (06) · single-sujeto (Fase A)
 *   n=33 → Inspección Equipos Móviles (05) · multi-sujeto (Fase C)
 *   n=34 → Inspección Carros (07) · multi-sujeto
 *   n=29 → Inspección Contenedores (08) · multi-sujeto
 *   n=24 → Inspección Extintores (10) · multi-sujeto
 *   n=64,65 → Inspección EPP (11) · multi-sujeto
 *   n=40 → Observación Ampliroll (12) · multi-sujeto
 *   n=41 → Observación Maquinaria (13) · multi-sujeto (reemplaza la genérica
 *          provisional de Fase A por la real PR-SGC-25)
 *   n=39 → Observación Planeada (14) · single-sujeto (Anexo 7 real)
 *
 * Idempotencia: si ya existe una plantilla activa con el MISMO `code` y
 * `version` (snapshot de `definitionJson`), se omite. Solo si el contenido
 * cambió se reemplaza vía `savePdtpActivityChecklist` (que desactiva la
 * previa y crea una nueva versión). Esto evita inflar el historial de
 * versiones en cada re-siembra sin cambios reales.
 *
 *   npm run db:seed-pdtp-checklists                  # usa .env.local
 *   tsx --env-file=.env.prod scripts/seed-pdtp-checklists-2026.ts  # otra BD
 *   SEED_DRY_RUN=true npm run db:seed-pdtp-checklists  # validar sin escribir
 *
 * Requisito: la migración multi-sujeto (Fase B, 0055_goofy_roulette.sql) debe
 * estar aplicada para que las instancias por sujeto funcionen.
 */
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { and, eq } from "drizzle-orm"
import { loadEnvConfig } from "@next/env"
import * as schema from "../db/schema"
import { INSPECCION_TALLER } from "../lib/sst/definitions/inspeccion-taller"
import { INSPECCION_EXTINTORES } from "../lib/sst/definitions/inspeccion-extintores"
import { INSPECCION_CONTENEDORES } from "../lib/sst/definitions/inspeccion-contenedores"
import { INSPECCION_CARROS } from "../lib/sst/definitions/inspeccion-carros"
import { INSPECCION_EQUIPOS_MOVILES } from "../lib/sst/definitions/inspeccion-equipos-moviles"
import { INSPECCION_EPP } from "../lib/sst/definitions/inspeccion-epp"
import { OBSERVACION_AMPLIROLL } from "../lib/sst/definitions/observacion-ampliroll"
import { OBSERVACION_MAQUINARIA } from "../lib/sst/definitions/observacion-maquinaria"
import { OBSERVACION_PLANEADA } from "../lib/sst/definitions/observacion-planeada"
import { savePdtpActivityChecklist, getActivePdtpActivityChecklist } from "../lib/services/pdtp/checklists"
import type { ChecklistDefinition } from "../lib/sst/types"

loadEnvConfig(process.cwd())

const PROGRAM_YEAR = 2026

interface SeedSpec {
  /** `n` de la actividad en el catálogo 2026 (db/seed/pdtp-catalog-2026.json). */
  n: number
  /** Etiqueta de la plantilla (columna `label`). */
  label: string
  /** Definición a sembrar. */
  definition: ChecklistDefinition
}

const SPECS: SeedSpec[] = [
  // ── Fase A: single-sujeto (patrón B) ──────────────────────────────────
  {
    n: 27,
    label: "Inspección Taller de Mantención y Bodega RESPEL",
    definition: INSPECCION_TALLER,
  },
  // ── Fase C: multi-sujeto (patrón C) ───────────────────────────────────
  // 05 Equipos móviles → act 33; 07 Carros → act 34 (mismo título, distintos responsables).
  {
    n: 33,
    label: "Inspección de Equipos Móviles",
    definition: INSPECCION_EQUIPOS_MOVILES,
  },
  {
    n: 34,
    label: "Inspección de Carros",
    definition: INSPECCION_CARROS,
  },
  // 08 Contenedores → act 29.
  {
    n: 29,
    label: "Inspección de Contenedores",
    definition: INSPECCION_CONTENEDORES,
  },
  // 10 Extintores → act 24.
  {
    n: 24,
    label: "Inspección de Estado de Extintores",
    definition: INSPECCION_EXTINTORES,
  },
  // 11 EPP → act 64 (JT) y 65 (PRF), mismo título.
  {
    n: 64,
    label: "Inspección de Uso y Estado de EPP (JT)",
    definition: INSPECCION_EPP,
  },
  {
    n: 65,
    label: "Inspección de Uso y Estado de EPP (PRF)",
    definition: INSPECCION_EPP,
  },
  // 12 Observación ampliroll → act 40.
  {
    n: 40,
    label: "Observación de Seguridad: Camión Ampliroll",
    definition: OBSERVACION_AMPLIROLL,
  },
  // 13 Observación maquinaria → act 41. Reemplaza la plantilla genérica
  // provisional de Fase A (OBSERVACION_PLANEADA) por la real (PR-SGC-25).
  {
    n: 41,
    label: "Observación de Seguridad: Maquinaria Pesada",
    definition: OBSERVACION_MAQUINARIA,
  },
  // 14 Observación planeada (Anexo 7) → act 39. No es la n=41: esa es la
  // caminata de seguridad. La v01 genérica nunca se sembró en ninguna actividad.
  {
    n: 39,
    label: "Observación Planeada",
    definition: OBSERVACION_PLANEADA,
  },
]

const DRY_RUN = process.env.SEED_DRY_RUN === "true"

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required (postgres://...)")
    process.exit(1)
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(client, { schema })

  console.log(`Siembra de plantillas PDTP ${PROGRAM_YEAR} (Fase A+C) — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)

  // Resolver programa 2026 activo; si no hay activo, usar la versión máxima.
  // Misma heurística intencional de reminders.ts: preferir status='active'
  // para no sombrear el programa real con un draft más nuevo.
  let [program] = await db.select().from(schema.pdtpPrograms)
    .where(and(
      eq(schema.pdtpPrograms.year, PROGRAM_YEAR),
      eq(schema.pdtpPrograms.status, "active"),
    ))
    .limit(1)

  if (!program) {
    console.warn(`  No hay programa ${PROGRAM_YEAR} con status='active'; usando la versión máxima del año.`)
    const candidates = await db.select().from(schema.pdtpPrograms)
      .where(eq(schema.pdtpPrograms.year, PROGRAM_YEAR))
      .orderBy(schema.pdtpPrograms.version)
    program = candidates[candidates.length - 1]
  }

  if (!program) {
    console.error(`  ✗ No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)
    console.error("    Siembra primero el catálogo 2026 (db/seed/pdtp-catalog-2026.json) antes de correr este script.")
    process.exit(1)
  }

  console.log(`  Programa: ${program.id} (year=${program.year}, version=${program.version}, status=${program.status})`)

  let created = 0
  let skipped = 0
  let missing = 0

  for (const spec of SPECS) {
    // Resolver actividad por (programId, n). `n` es único por programa.
    const [activity] = await db.select().from(schema.pdtpActivities)
      .where(and(
        eq(schema.pdtpActivities.programId, program.id),
        eq(schema.pdtpActivities.n, spec.n),
      ))
      .limit(1)

    if (!activity) {
      console.error(`  ✗ n=${spec.n} "${spec.label}": actividad no encontrada en el programa ${program.id}.`)
      missing++
      continue
    }

    // Idempotencia: si la plantilla activa ya tiene el mismo code+version con
    // contenido idéntico, omitir (no crear versión nueva).
    const existing = await getActivePdtpActivityChecklist(activity.id)
    if (existing) {
      const existingDef = existing.definition
      if (
        existingDef.code === spec.definition.code &&
        existingDef.version === spec.definition.version &&
        JSON.stringify(existingDef) === JSON.stringify(spec.definition)
      ) {
        console.log(`  · n=${spec.n} "${spec.label}": sin cambios (code=${spec.definition.code} v${spec.definition.version}), omitido.`)
        skipped++
        continue
      }
      console.log(`  ↻ n=${spec.n} "${spec.label}": reemplazando plantilla existente (code=${existingDef.code} → ${spec.definition.code}).`)
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] sembraría code=${spec.definition.code} v${spec.definition.version} en actividad ${activity.id} (n=${spec.n}).`)
      created++
      continue
    }

    const saved = await savePdtpActivityChecklist({
      activityId: activity.id,
      label: spec.label,
      definition: spec.definition,
      version: spec.definition.version,
    })
    console.log(`  ✓ n=${spec.n} "${spec.label}": plantilla ${saved.id} (code=${spec.definition.code} v${saved.version}) sembrada en actividad ${activity.id}.`)
    created++
  }

  console.log("")
  console.log(`Resumen: ${created} sembradas, ${skipped} sin cambios, ${missing} no encontradas.`)
  if (missing > 0) {
    console.warn("⚠ Hay actividades faltantes: verifica que el catálogo 2026 esté sembrado y los `n` sean correctos.")
  }
  await client.end()
}

main()
  .catch((e) => { console.error(e); process.exit(1) })

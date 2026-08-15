/**
 * scripts/apply-pdtp-2026-mechanisms.ts
 *
 * Persiste en `pdtp_activities.mechanism` la clasificación de los 7 bloques del
 * diseño 2026-08-12 (§5 del documento). Hasta ahora vivía sólo en el markdown y
 * el código no podía consultarla: el submódulo Constancias necesita saber qué
 * actividades le corresponden, y el motor de acreditación qué actividades
 * espera un evento externo.
 *
 * Los números son los del catálogo 2026. Las actividades retiradas (N°2, 5, 12,
 * 13, 14) no aparecen a propósito.
 *
 *   npm run pdtp:apply-mechanisms
 *   PDTP_MECHANISMS_DRY_RUN=true npm run pdtp:apply-mechanisms
 *
 * Idempotente: reejecutar no cambia nada si ya está aplicado.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_MECHANISMS_DRY_RUN === "true"

type Mechanism = "enganche" | "constancia" | "formulario" | "compuesta"

/**
 * 🔗 Enganche — un registro que ya existe en otro módulo cierra la actividad.
 * Incluye las 7 de inspección cuya plantilla ya quedó instalada y cableada
 * (D10), las de capacitación, campañas, emergencia, MIPER, CPHS e incidentes.
 */
const ENGANCHE = [
  1,           // aprobación de Legal y RRHH sobre el propio programa
  7,           // ingreso de indicadores de la faena
  9,           // revisión por la dirección
  11,          // constituir el comité paritario
  19,          // carpeta de requisitos legales → Documentación SST
  21,          // cierre de incidente
  24, 27, 29, 33, 34, 39, 40, 41, 64, 65,  // inspecciones y observaciones
  28,          // revisión y cierre de inspecciones de equipos
  35, 36,      // MIPER: matriz y su difusión
  37, 38,      // charlas de seguridad
  43,          // procedimientos de trabajo seguro → Documentación SST
  44, 45,      // evaluaciones de higiene por mutual
  46, 47, 48, 49,  // protocolos MINSAL (PREXOR, TMERT, PSICOSOCIAL, UV)
  50,          // trabajadores en programa de vigilancia
  51,          // capacitación según detección de necesidades
  53, 54, 55, 56, 57, 58, 59, 60, 63,  // charlas y capacitaciones
  62,          // registro de entrega de EPP
  83, 84,      // plan de emergencia y simulacros
  85, 86, 87, 88, 89,  // campañas
  // Bloque 6: los 13 pasos del flujo de accidentes. El módulo de Incidentes se
  // construyó desde el DO-36 y cada paso tiene su campo exacto —incluido
  // `notification_type = 'diat'` para la N°72 y `one_page_summary` para la
  // N°78—. Falta cablear las 13 llamadas al motor de acreditación.
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
] as const

/** ✍️ Constancia — se hizo o no se hizo, con evidencia u observación. */
const CONSTANCIA = [
  3,           // difusión del plan en faenas
  6,           // reunión de revisión SG-SST
  10,          // condiciones ambientales DS 594 (hasta que exista su checklist)
  20,          // reunión con la empresa mandante
  22,          // control de plataformas de la empresa y del mandante
  30, 31, 32,  // alcotest — no existe módulo
  42,          // control documental de sanitización y plagas
  61,          // certificados de idoneidad de EPP
  79, 80, 81,  // CGRD: constitución, matriz GRD y actas — no existe módulo
  82,          // mapa de riesgo por área
] as const

/** 🧩 Compuesta — se cumple cuando sus componentes están completos. */
const COMPUESTA = [
  15, 16, 17, 18, 23,  // registros de Habilitación del trabajador
  52,                  // la inducción completa: se cierra con sus componentes
] as const

/** 📝 Formulario propio — pendientes de decisión (A7). */
const FORMULARIO = [
  25, 26,  // report de uso diario de equipos y su revisión
] as const

const ASSIGNMENTS: Array<{ mechanism: Mechanism; numbers: readonly number[] }> = [
  { mechanism: "enganche", numbers: ENGANCHE },
  { mechanism: "constancia", numbers: CONSTANCIA },
  { mechanism: "compuesta", numbers: COMPUESTA },
  { mechanism: "formulario", numbers: FORMULARIO },
]

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const program = programs.find((item) => item.status === "active") ?? programs.at(-1)
  if (!program) throw new Error(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  console.log(`Mecanismos PDTP ${PROGRAM_YEAR} — ${DRY_RUN ? "[DRY RUN]" : "escribiendo"}`)
  console.log(`  Programa: ${program.id} (status=${program.status})`)
  console.log("")

  // Un número en dos listas sería un error de clasificación silencioso.
  const seen = new Map<number, Mechanism>()
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    for (const n of numbers) {
      const previo = seen.get(n)
      if (previo) throw new Error(`La actividad N°${n} está clasificada dos veces: ${previo} y ${mechanism}.`)
      seen.set(n, mechanism)
    }
  }

  const activas = await db.select({ n: pdtpActivities.n, mechanism: pdtpActivities.mechanism })
    .from(pdtpActivities)
    .where(and(eq(pdtpActivities.programId, program.id), eq(pdtpActivities.status, "active")))

  let changed = 0
  for (const { mechanism, numbers } of ASSIGNMENTS) {
    const pendientes = activas
      .filter((row) => numbers.includes(row.n) && row.mechanism !== mechanism)
      .map((row) => row.n)
    if (pendientes.length === 0) {
      console.log(`  · ${mechanism}: sin cambios (${numbers.length} declaradas).`)
      continue
    }
    if (!DRY_RUN) {
      await db.update(pdtpActivities).set({ mechanism, updatedAt: new Date().toISOString() })
        .where(and(
          eq(pdtpActivities.programId, program.id),
          eq(pdtpActivities.status, "active"),
          inArray(pdtpActivities.n, pendientes),
        ))
    }
    console.log(`  ✓ ${mechanism}: ${pendientes.length} actividad(es) → ${pendientes.join(", ")}`)
    changed += pendientes.length
  }

  const declaradas = new Set(seen.keys())
  const sinClasificar = activas.filter((row) => !declaradas.has(row.n)).map((row) => row.n)
  const inexistentes = [...declaradas].filter((n) => !activas.some((row) => row.n === n))

  console.log("")
  console.log(`Resumen: ${changed} actividad(es) actualizada(s) sobre ${activas.length} activas.`)
  if (sinClasificar.length > 0) console.warn(`⚠ Sin clasificar: ${sinClasificar.join(", ")}`)
  if (inexistentes.length > 0) console.warn(`⚠ Declaradas pero no están activas en el programa: ${inexistentes.join(", ")}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })

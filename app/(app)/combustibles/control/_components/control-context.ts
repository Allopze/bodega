import "server-only"
import type { Session } from "next-auth"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelMandantes, worksites } from "@/db/schema"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { settle } from "@/lib/async-settle"
import { codeYear } from "@/lib/utils"

export interface ControlContext {
  worksites: Array<{ id: string; name: string }>
  mandantes: Array<{ id: string; name: string }>
  years: number[]
  defaultYear: number
}

/**
 * Lo que toda vista del control necesita para sus filtros: faenas del alcance
 * del usuario, mandantes y años con datos. La navegación entre vistas ya no
 * viaja aquí: la pintan `SectionNav` y `lib/combustibles/section-nav.ts`.
 * Cada consulta cae a un valor seguro si falla (`settle`): un selector vacío
 * no debe tumbar la vista.
 */
export async function loadControlContext(session: Session): Promise<ControlContext> {
  const scope = resolveWorksiteScope(session)
  const current = codeYear()

  const [worksiteRows, mandanteRows, yearRows] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(and(eq(worksites.isActive, true), scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined))
        .orderBy(asc(worksites.name)),
      [] as Array<{ id: string; name: string }>,
      "control-worksites",
    ),
    settle(
      db.select({ id: fuelMandantes.id, name: fuelMandantes.name }).from(fuelMandantes)
        .where(eq(fuelMandantes.isActive, true)).orderBy(asc(fuelMandantes.name)),
      [] as Array<{ id: string; name: string }>,
      "control-mandantes",
    ),
    settle(
      db.selectDistinct({ year: sql<number>`substring(${fuelEquipmentLoads.month}, 1, 4)::int` }).from(fuelEquipmentLoads)
        .where(worksiteScopeSql(session, fuelEquipmentLoads.worksiteId)),
      [] as Array<{ year: number }>,
      "control-years",
    ),
  ])

  const years = [...new Set([current, ...yearRows.map((row) => Number(row.year))])]
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => right - left)

  return { worksites: worksiteRows, mandantes: mandanteRows, years, defaultYear: current }
}

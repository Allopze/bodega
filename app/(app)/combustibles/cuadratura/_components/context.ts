import "server-only"
import type { Session } from "next-auth"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { fuelMandantes, worksites } from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { settle } from "@/lib/async-settle"

export interface CuadraturaContext {
  worksites: Array<{ id: string; name: string }>
  mandantes: Array<{ id: string; name: string }>
}

/**
 * Lo que los filtros de las vistas de cuadratura necesitan: las faenas del
 * alcance de quien mira y los mandantes activos. Cada consulta cae a una lista
 * vacía si falla (`settle`): un selector vacío no debe tumbar la vista.
 */
export async function loadCuadraturaContext(session: Session): Promise<CuadraturaContext> {
  const scope = resolveWorksiteScope(session)
  const [worksiteRows, mandanteRows] = await Promise.all([
    settle(
      scope.mode === "none" ? Promise.resolve([]) : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
        .where(and(eq(worksites.isActive, true), scope.mode === "some" ? inArray(worksites.id, scope.ids) : undefined))
        .orderBy(asc(worksites.name)),
      [] as Array<{ id: string; name: string }>,
      "cuadratura-worksites",
    ),
    settle(
      db.select({ id: fuelMandantes.id, name: fuelMandantes.name }).from(fuelMandantes)
        .where(eq(fuelMandantes.isActive, true)).orderBy(asc(fuelMandantes.name)),
      [] as Array<{ id: string; name: string }>,
      "cuadratura-mandantes",
    ),
  ])
  return { worksites: worksiteRows, mandantes: mandanteRows }
}

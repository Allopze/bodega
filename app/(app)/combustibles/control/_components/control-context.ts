import "server-only"
import type { Session } from "next-auth"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentLoads, fuelMandantes, worksites } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { settle } from "@/lib/async-settle"
import { codeYear } from "@/lib/utils"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_SLUGS } from "@/lib/combustibles/control/contracts"
import type { ControlNavItem } from "./control-nav"

const FAMILY_NAV_LABELS = {
  camiones: "Camiones",
  cargadores_camionetas: "Cargadores y camionetas",
  maquinaria: "Maquinaria",
} as const

export interface ControlContext {
  worksites: Array<{ id: string; name: string }>
  mandantes: Array<{ id: string; name: string }>
  years: number[]
  defaultYear: number
  flaggedCount: number
  navItems: ControlNavItem[]
}

/**
 * Lo que toda vista del control necesita para su cabecera: faenas del alcance
 * del usuario, mandantes, años con datos y la navegación según permisos.
 * Cada consulta cae a un valor seguro si falla (`settle`): un selector vacío
 * no debe tumbar la vista.
 */
export async function loadControlContext(session: Session): Promise<ControlContext> {
  const scope = resolveWorksiteScope(session)
  const current = codeYear()

  const [worksiteRows, mandanteRows, yearRows, flaggedRows] = await Promise.all([
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
    settle(
      db.select({ count: sql<number>`count(*)::int` }).from(fuelEquipmentLoads)
        .where(and(eq(fuelEquipmentLoads.reviewStatus, "flagged"), worksiteScopeSql(session, fuelEquipmentLoads.worksiteId))),
      [{ count: 0 }],
      "control-flagged-count",
    ),
  ])

  const years = [...new Set([current, ...yearRows.map((row) => Number(row.year))])]
    .filter((year) => Number.isInteger(year))
    .sort((left, right) => right - left)
  const flaggedCount = flaggedRows[0]?.count ?? 0

  const navItems: ControlNavItem[] = [{ href: "/combustibles/control", label: "Vista general" }]
  for (const family of PERFORMANCE_FAMILIES) {
    navItems.push({ href: `/combustibles/control/rendimiento/${PERFORMANCE_FAMILY_SLUGS[family]}`, label: FAMILY_NAV_LABELS[family] })
  }
  if (can(session, "combustibles:tae_view")) navItems.push({ href: "/combustibles/control/sellos", label: "Sellos por mandante" })
  navItems.push({ href: "/combustibles/control/ralenti", label: "Ralentí" })
  navItems.push({ href: "/combustibles/control/revision", label: "Revisión", count: flaggedCount })
  if (can(session, "combustibles:register_load")) navItems.push({ href: "/combustibles/control/registrar", label: "Registrar carga" })
  if (can(session, "combustibles:import")) navItems.push({ href: "/combustibles/control/importar", label: "Importar" })
  if (can(session, "combustibles:manage_control")) navItems.push({ href: "/combustibles/control/configuracion", label: "Configuración" })

  return { worksites: worksiteRows, mandantes: mandanteRows, years, defaultYear: current, flaggedCount, navItems }
}

import type { Session } from "next-auth"
import { isGlobalRole } from "@/lib/auth/scope"

/**
 * Qué Panel ve cada persona en `/combustibles`. Son cuatro lecturas distintas
 * del mismo período, no cuatro permisos:
 *
 *   jefatura  «¿En qué va el período y qué falta para cerrarlo?» — la tira de
 *             cinco pasos, lo que vence primero y las tres cifras.
 *   contrato  «Mis cargas, mis archivos y lo que falta vincular» — registra
 *             cargas e importa planillas, pero no decide las marcadas.
 *   terreno   «Mis cargas y lo que me toca corregir» — registra cargas.
 *   consulta  «El combustible de mis faenas, en tres frases» — sólo mira.
 *
 * El criterio se evalúa en este orden y la primera regla que calza decide:
 *
 *   1. `approve_flagged` → jefatura. Quien decide las cargas por decidir es
 *      quien cierra el mes; necesita ver el avance y no una lista de lo suyo.
 *   2. rol global con `view_costs` → jefatura, aunque no decida: ve el mes
 *      completo y lo que falta pagar. Se exige global porque los estados de
 *      cuenta lo son (`assertFuelCostAccess({ global: true })`): un rol de faena
 *      con montos vería un paso de pagos que no puede abrir.
 *   3. `register_load` + `import` → contrato (administración de contrato):
 *      registra y además trae archivos, de modo que le interesa su última
 *      planilla y las patentes sin vincular.
 *   4. `register_load` → terreno.
 *   5. el resto → consulta.
 *
 * Es el mismo corte que usa el período por defecto (semana para quien registra
 * y no decide, mes para los demás; `defaultFuelPeriodFor`), con una diferencia
 * a propósito: ahí sólo importa quién trabaja por semana, acá también quién ve
 * dinero. Una persona global con `view_costs` y `register_load` pero sin
 * `approve_flagged` abre en la semana pero ve el Panel de jefatura.
 *
 * Esto elige qué se dibuja, no qué se puede hacer: cada pantalla y cada acción
 * sigue autorizando en el servidor.
 */
export type PanelVariant = "jefatura" | "contrato" | "terreno" | "consulta"

export interface PanelVariantInput {
  permissions: readonly string[]
  /** Rol sin alcance por faena (`isGlobalRole`). */
  isGlobal: boolean
}

export function resolvePanelVariant({ permissions, isGlobal }: PanelVariantInput): PanelVariant {
  const has = (permission: string) => permissions.includes(permission)
  if (has("combustibles:approve_flagged")) return "jefatura"
  if (isGlobal && has("combustibles:view_costs")) return "jefatura"
  if (has("combustibles:register_load")) return has("combustibles:import") ? "contrato" : "terreno"
  return "consulta"
}

export function panelVariantForSession(session: Session | null): PanelVariant {
  return resolvePanelVariant({
    permissions: session?.user?.permissions ?? [],
    isGlobal: isGlobalRole(session),
  })
}

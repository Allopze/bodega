/**
 * Pestañas de `/ti/accesos`. Viven aparte del componente de cliente porque la
 * página (servidor) necesita los valores en tiempo de ejecución: importarlos
 * de un módulo "use client" entrega una referencia opaca, no el arreglo.
 *
 * `?vista=` es contrato con la navegación y el resumen de TI.
 */
export const ACCESS_VIEWS = [
  { value: "accesos", label: "Accesos" },
  { value: "ingreso-egreso", label: "Ingresos y egresos" },
  { value: "sistemas", label: "Sistemas" },
] as const

export type AccessView = (typeof ACCESS_VIEWS)[number]["value"]

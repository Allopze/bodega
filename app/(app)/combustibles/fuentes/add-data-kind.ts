import type { FuelAddDataOption } from "@/lib/combustibles/section-nav"

/** Importadores que se abren en un diálogo sobre «Fuentes de datos» (`?agregar=`). */
export const ADD_DATA_DIALOG_KINDS = ["facturas", "telemetria", "surtidor"] as const
export type AddDataDialogKind = (typeof ADD_DATA_DIALOG_KINDS)[number]

/**
 * Qué diálogo abre `?agregar=` en «Fuentes de datos». Los enlaces de «Agregar
 * datos» (`fuelAddDataOptions`) apuntan acá para los importadores que no tienen
 * pantalla propia. Un valor desconocido, repetido o sin permiso no abre nada:
 * quien no puede usar un importador no lo recibe por la URL.
 */
export function resolveAddDataKind(
  value: string | string[] | undefined,
  options: readonly Pick<FuelAddDataOption, "kind" | "allowed">[],
): AddDataDialogKind | null {
  if (typeof value !== "string") return null
  const kind = (ADD_DATA_DIALOG_KINDS as readonly string[]).includes(value) ? (value as AddDataDialogKind) : null
  if (!kind) return null
  return options.some((option) => option.kind === kind && option.allowed) ? kind : null
}

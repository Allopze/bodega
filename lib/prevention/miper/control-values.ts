/**
 * Lo que se guarda de una medida, en un solo lugar (D5, Fase C): el guardado de
 * una medida (`saveMiperControl`), las acciones masivas (`bulk.ts`, Fase D) y la
 * vista previa de su efecto en el cliente (`bulk-impact.ts`) pasan por aquí.
 * Puro: no toca la base ni el reloj.
 */
import type { MiperControlSaveInput } from "@/lib/validation/prevention-module/miper"
import { cleanMiperName } from "./names"
import type { ControlHierarchy } from "./snapshot"

export type ControlValues = MiperControlSaveInput["values"]
export type ControlResponsible = { responsibleUserId: string | null; responsibleSnapshot: string | null }
export type ControlColumns = ControlResponsible & {
  hierarchy: ControlHierarchy
  description: string
  isExisting: boolean
  verificationFrequency: string | null
  dueDate: string | null
}

/**
 * D5 (Fase C): una medida EXISTENTE se verifica con una frecuencia y no lleva
 * plazo; una POR IMPLEMENTAR lleva plazo y no frecuencia. Lo que no aplica se
 * guarda vacío, para que un plazo viejo no quede escondido en una existente.
 * Si el pedido no trae `isExisting` o la frecuencia, se conservan los de la
 * medida (una nueva nace por implementar): un llamador anterior a la Fase C no
 * convierte una existente en pendiente al editarla.
 */
export function controlColumns(
  values: ControlValues,
  responsible: ControlResponsible,
  current: { isExisting: boolean; verificationFrequency: string | null } | null,
): ControlColumns {
  const isExisting = values.isExisting ?? current?.isExisting ?? false
  const frequency = values.verificationFrequency === undefined ? current?.verificationFrequency ?? null : cleanMiperName(values.verificationFrequency)
  return {
    hierarchy: values.hierarchy,
    description: values.description,
    ...responsible,
    isExisting,
    verificationFrequency: isExisting ? frequency : null,
    dueDate: isExisting ? null : values.dueDate ?? null,
  }
}

/** Responsable que asigna un cambio en lote: una persona de la plataforma o un nombre o cargo escrito. */
export type ResponsiblePatch = { kind: "user"; userId: string } | { kind: "text"; name: string }

/**
 * «Asignar responsable / plazo» (Fase D): lo que cambia en cada medida. Una clave
 * ausente no se toca; la medida conserva lo suyo.
 */
export type ControlPatch = {
  responsible?: ResponsiblePatch
  isExisting?: boolean
  dueDate?: string | null
  verificationFrequency?: string | null
}

/**
 * Los valores completos de una medida después de un cambio en lote: lo que el
 * pedido no trae sale de la medida. El resultado pasa por `controlColumns`, así
 * que D5 rige igual que en el editor: una existente queda sin plazo y una por
 * implementar sin frecuencia, aunque el lote traiga una fecha o una frecuencia.
 */
export function patchedControlValues(
  current: { hierarchy: ControlHierarchy; description: string; isExisting: boolean; verificationFrequency: string | null; dueDate: string | null },
  patch: ControlPatch,
): ControlValues {
  return {
    hierarchy: current.hierarchy,
    description: current.description,
    isExisting: patch.isExisting ?? current.isExisting,
    verificationFrequency: patch.verificationFrequency === undefined ? current.verificationFrequency : patch.verificationFrequency,
    dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
  }
}

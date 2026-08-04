import type { Permission } from "@/modules/permissions"

/**
 * Central source of truth for request type metadata.
 * Used in request-form, request-list, and approval-panel.
 */

export const REQUEST_TYPE_OPTS = [
  { value: "epp",       label: "EPP" },
  { value: "repuestos", label: "Repuestos" },
  { value: "servicios", label: "Servicios" },
  { value: "otro",      label: "Otros" },
] as const

export type RequestType = (typeof REQUEST_TYPE_OPTS)[number]["value"]
export type RequestTypeAction = "create" | "submit"

const REQUEST_TYPE_PERMISSIONS: Record<RequestType, Record<RequestTypeAction, Permission>> = {
  epp: {
    create: "requests:create",
    submit: "requests:submit",
  },
  otro: {
    create: "requests:create",
    submit: "requests:submit",
  },
  repuestos: {
    create: "repuestos:create",
    submit: "repuestos:submit",
  },
  servicios: {
    create: "servicios:create",
    submit: "servicios:submit",
  },
}

export function isRequestType(value: unknown): value is RequestType {
  return REQUEST_TYPE_OPTS.some((option) => option.value === value)
}

export function permissionForRequestType(
  requestType: RequestType,
  action: RequestTypeAction,
): Permission {
  return REQUEST_TYPE_PERMISSIONS[requestType][action]
}

export function visibleRequestTypeOptions(
  permissions: readonly string[],
  action: RequestTypeAction = "create",
): typeof REQUEST_TYPE_OPTS[number][] {
  return REQUEST_TYPE_OPTS.filter((option) =>
    permissions.includes(permissionForRequestType(option.value, action)),
  )
}

/**
 * Resolve a request type supplied by an entry route such as
 * `/repuestos/nueva`. The route intent is only accepted when the value is
 * known *and* the current user can create that type of request. Keeping this
 * decision here prevents the server page and the client form from quietly
 * choosing different defaults.
 */
export function resolveInitialRequestType(
  candidate: string | string[] | undefined,
  availableOptions: readonly { value: RequestType }[],
): { requestType: RequestType; matchedCandidate: boolean } {
  const requested = typeof candidate === "string" && isRequestType(candidate)
    ? candidate
    : undefined
  const isAvailable = requested !== undefined
    && availableOptions.some((option) => option.value === requested)

  return {
    requestType: isAvailable ? requested : availableOptions[0]!.value,
    matchedCandidate: isAvailable,
  }
}

/** Includes legacy types for display in existing records */
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp:        "EPP",
  repuestos:  "Repuestos",
  servicios:  "Servicios",
  otro:       "Otros",
}

/**
 * El tipo de solicitud es una **categoría**, no una severidad.
 *
 * `repuestos` estaba en `warning`, que en el design system lleva el tratamiento
 * mono-mayúsculas reservado a severidades (ver `badge.tsx`): en la misma columna
 * convivían "REPUESTOS" a gritos con "Servicios" y "Otros" en caja normal
 * (auditoría UI/UX 2026-07-29, A-35). Todas las variantes de acá son neutras.
 */
export const REQUEST_TYPE_VARIANTS: Record<string, "info" | "outline" | "default"> = {
  epp:        "info",
  repuestos:  "outline",
  servicios:  "info",
  otro:       "default",
}

/**
 * Types that use the quotation-based approval flow (PDF cotizaciones).
 * EPP and "otro" use the per-item approval flow.
 */
export const QUOTATION_TYPES = new Set(["repuestos", "servicios"])

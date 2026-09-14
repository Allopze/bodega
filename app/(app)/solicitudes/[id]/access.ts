import type { Session } from "next-auth"
import { can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"

export interface RequestAccessSubject {
  requestType: string
  requesterId: string
  worksiteId: string
}

/**
 * Quién puede abrir el detalle de una solicitud.
 *
 * Son dos ejes independientes y hay que satisfacer los dos:
 *
 *  - **Amplitud dentro del módulo.** Ser el solicitante, o tener la capacidad
 *    `view_all` del espacio de nombres que corresponde al tipo de solicitud
 *    (`repuestos:` y `servicios:` tienen el suyo; `epp` y `otro` usan
 *    `requests:`).
 *  - **Faena.** `canAccessWorksite`, que es global para los roles globales y
 *    la lista de faenas asignadas para el resto.
 *
 * REQ-001 (auditoría 2026-09-14): `view_all` saltaba el segundo eje, de modo
 * que un rol no global con esa capacidad leía por id las solicitudes de
 * cualquier faena —con su solicitante, sus ítems, sus trabajadores, sus
 * equipos, sus cotizaciones y su cadena documental—. El nombre `view_all`
 * significa "todas las del módulo", no "todas las faenas": eso lo decide
 * `isGlobal`, y así lo declara `lib/auth/scope.ts`.
 */
export function canViewRequestDetail(session: Session, request: RequestAccessSubject): boolean {
  const typeViewAll =
    request.requestType === "repuestos" ? can(session, "repuestos:view_all")
    : request.requestType === "servicios" ? can(session, "servicios:view_all")
    : false

  const withinModule = can(session, "requests:view_all")
    || typeViewAll
    || request.requesterId === session.user.id

  return withinModule && canAccessWorksite(session, request.worksiteId)
}

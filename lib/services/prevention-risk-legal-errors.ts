/**
 * Error de dominio con mensaje pensado para el usuario: las acciones de MIPER,
 * requisitos legales y el mapa del CGRD devuelven SU mensaje tal cual y mandan
 * cualquier otro error a `unexpectedActionError`, que loguea y responde
 * genérico para no filtrar detalles de driver o SQL al navegador. Mismo
 * contrato que `EmergencyDomainError` y `SafetyIndicatorDomainError`.
 *
 * La regla para elegir cuál lanzar: si el mensaje le dice al usuario qué hacer
 * (no encontrado, versión desactualizada, estado que no admite la operación,
 * segregación, datos que no cumplen una regla), es de dominio. Si describe algo
 * que no debería poder ocurrir —un INSERT ... RETURNING que no devuelve fila—,
 * es un `Error` común: al usuario no le sirve el detalle y al operador sí el log.
 */
export class RiskLegalDomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RiskLegalDomainError"
  }
}

/**
 * Label and formatter helpers for the SST Acta print document.
 */

export function getStatusColor(status: string | null): string {
  if (!status) return "#6b7280"
  if (["cumple", "entregado", "apto", "si"].includes(status)) return "#059669"
  if (["no_cumple", "no_entregado", "no_apto", "no"].includes(status)) return "#dc2626"
  return "#6b7280"
}

export function getResultLabel(result: string | null, isNuevo: boolean): string {
  if (isNuevo) {
    const labels: Record<string, string> = {
      habilitado_autonomo: "CUMPLE",
      no_habilitado: "NO CUMPLE",
    }
    return result ? (labels[result] ?? result) : "Sin resultado"
  }
  const labels: Record<string, string> = {
    habilitado_autonomo: "HABILITADO PARA OPERAR EN FORMA AUTÓNOMA",
    habilitado_restricciones: "HABILITADO CON RESTRICCIONES",
    no_habilitado: "NO HABILITADO",
    requiere_reforzamiento: "REQUIERE REFORZAMIENTO ADICIONAL",
  }
  return result ? (labels[result] ?? result) : "Sin resultado"
}

export function getMotivoLabel(motivo: string | null): string {
  const labels: Record<string, string> = {
    control_periodico: "Control Periódico",
    post_incidente_persona: "Post-incidente (Persona)",
    post_incidente_material: "Post-incidente (Material)",
    post_incidente_ambiental: "Post-incidente (Ambiental)",
    cuasi_accidente: "Cuasi-accidente",
    incumplimiento_procedimiento: "Incumplimiento de Procedimiento",
    reincidencia: "Reincidencia",
    reincorporacion: "Reincorporación",
    otro: "Otro",
  }
  return motivo ? (labels[motivo] ?? motivo) : "—"
}

export function getInstanciaLabel(instancia: string): string {
  const labels: Record<string, string> = {
    dia_0: "Día 0",
    dia_7: "Día 7",
    dia_15: "Día 15",
    dia_30: "Día 30",
    adicional: "Adicional",
  }
  return labels[instancia] ?? instancia
}

export function getEficaciaLabel(e: string | null): string {
  const labels: Record<string, string> = {
    eficaz: "Eficaz",
    parcialmente_eficaz: "Parcialmente eficaz",
    no_eficaz: "No eficaz",
  }
  return e ? (labels[e] ?? e) : "—"
}

export function formatDate(d: string | null): string {
  if (!d) return "—"
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

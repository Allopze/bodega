const DESTINATION_MODULE_LABELS: Record<string, string> = {
  alcotest: "Alcotest",
  campanas: "Campañas",
  capacitacion: "Capacitación",
  cgrd: "CGRD",
  cphs: "Comité Paritario",
  documentacion: "Documentación SST",
  epp: "EPP preventivo",
  emergencias: "Emergencias",
  faenas: "Faenas",
  higiene: "Higiene ocupacional",
  incidentes: "Incidentes",
  indicadores: "Indicadores",
  inspecciones: "Inspecciones",
  pdtp: "Programa preventivo",
  riesgos: "MIPER",
  sst: "Habilitación SST",
}

const PERMISSION_LABELS: Record<string, string> = {
  "prevention:alcotest:dispatch": "gestionar despachos de alcotest",
  "prevention:alcotest:register": "registrar alcotest",
  "prevention:campaign:manage": "gestionar campañas",
  "prevention:cgrd:committee:manage": "gestionar el comité CGRD",
  "prevention:cgrd:matrix:publish": "publicar la matriz CGRD",
  "prevention:cgrd:meeting:manage": "gestionar reuniones CGRD",
  "prevention:constancias:execute": "registrar constancias",
  "prevention:cphs:manage": "gestionar el CPHS",
  "prevention:docs:distribute": "distribuir documentación SST",
  "prevention:docs:publish": "publicar documentación SST",
  "prevention:emergency:drill_execute": "registrar simulacros de emergencia",
  "prevention:emergency:approve": "aprobar planes de emergencia",
  "prevention:epp:manage": "gestionar entregas de EPP",
  "prevention:governance:review": "cerrar la revisión de gestión",
  "prevention:hygiene:assess": "evaluar higiene ocupacional",
  "prevention:hygiene:measure": "registrar mediciones de higiene",
  "prevention:incidents:close": "cerrar incidentes",
  "prevention:incidents:diffuse": "difundir incidentes",
  "prevention:incidents:investigate": "investigar incidentes",
  "prevention:incidents:notify": "notificar incidentes",
  "prevention:incidents:report": "reportar incidentes",
  "prevention:indicadores:close": "cerrar indicadores",
  "prevention:inspections:execute": "registrar inspecciones",
  "prevention:pdtp:execute": "registrar cumplimiento en PDTP",
  "prevention:risk:publish": "publicar controles de riesgo",
  "prevention:training:execute": "registrar capacitaciones",
  "prevention:training:deliver": "impartir capacitaciones",
  "prevention:training:record": "registrar capacitaciones",
  "sst:close": "cerrar la habilitación SST",
}

export function pdtpDestinationModuleLabel(module: string | undefined): string | undefined {
  if (!module) return undefined
  return DESTINATION_MODULE_LABELS[module] ?? module
}

export function pdtpPermissionLabel(permission: string | undefined): string {
  return permission ? PERMISSION_LABELS[permission] ?? "el permiso operativo del destino" : "el permiso operativo del destino"
}

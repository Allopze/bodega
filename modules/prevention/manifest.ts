import type { ModuleManifest } from "@/modules/manifest-types"

export const preventionModule = {
  id: "prevention",

  permissions: [
    "prevention:pdtp:view",
    "prevention:pdtp:execute",
    "prevention:pdtp:program:manage",
    "prevention:pdtp:override:manage",
    "prevention:pdtp:submit_review",
    "prevention:pdtp:approve",
    "prevention:pdtp:sign_legal",
    "prevention:pdtp:activate",
    "prevention:pdtp:lifecycle:manage",
    "prevention:pdtp:checklist:manage",
    "prevention:pdtp:checklist:fill",
    "prevention:pdtp:action:manage",
    "prevention:pdtp:action:verify",
    "prevention:pdtp:obligation:cancel",
    "prevention:pdtp:close_period",
    "prevention:pdtp:assignee:manage",
    "prevention:constancias:view",
    "prevention:constancias:execute",
    "prevention:alcotest:view",
    "prevention:alcotest:register",
    "prevention:alcotest:dispatch",
    "prevention:cgrd:view",
    "prevention:cgrd:committee:manage",
    "prevention:cgrd:matrix:edit",
    "prevention:cgrd:matrix:publish",
    "prevention:cgrd:meeting:manage",
    "prevention:campaign:view",
    "prevention:campaign:manage",
    "prevention:engagement:view",
    "prevention:engagement:manage",
    "prevention:docs:view",
    "prevention:docs:manage",
    "prevention:docs:submit_review",
    "prevention:docs:review",
    "prevention:docs:approve",
    "prevention:docs:publish",
    "prevention:docs:distribute",
    "prevention:docs:ack",
    "prevention:docs:link",
    "prevention:docs:archive",
    "prevention:docs:manage_sensitive",
    "prevention:docs:manage_restricted",
    "prevention:indicadores:view",
    "prevention:indicadores:manage",
    "prevention:indicadores:close",
    "prevention:health:view_restrictions",
    "prevention:health:view_clinical",
    "prevention:health:manage_surveillance",
    "prevention:health:upload_clinical",
    "prevention:reserved_case:view",
    "prevention:reserved_case:investigate",
    "prevention:privacy:audit",
    "prevention:privacy:manage_requests",
    "prevention:privacy:export_subject",
    "prevention:capa:view",
    "prevention:capa:manage",
    "prevention:capa:complete",
    "prevention:capa:verify",
    "prevention:capa:close",
    "prevention:capa:override_segregation",
    "prevention:capa:reconcile",
    "prevention:incidents:report",
    "prevention:incidents:view",
    "prevention:incidents:triage",
    "prevention:incidents:investigate",
    "prevention:incidents:notify",
    "prevention:incidents:authorize_restart",
    "prevention:incidents:override_segregation",
    "prevention:incidents:close",
    "prevention:incidents:diffuse",
    "prevention:incidents:view_sensitive",
    "prevention:incidents:export",
    "prevention:risk:view",
    "prevention:risk:edit",
    "prevention:risk:review",
    "prevention:risk:approve",
    "prevention:risk:publish",
    "prevention:risk:override_segregation",
    "prevention:legal:view",
    "prevention:legal:assess",
    "prevention:legal:approve_applicability",
    "prevention:legal:export",
    "prevention:training:view",
    "prevention:training:manage",
    "prevention:training:approve",
    "prevention:training:deliver",
    "prevention:training:record",
    "prevention:training:ack",
    "prevention:training:convalidate",
    "prevention:training:revoke",
    "prevention:training:export",
    "prevention:permits:view",
    "prevention:permits:manage",
    "prevention:permits:request",
    "prevention:permits:verify",
    "prevention:permits:approve",
    "prevention:permits:activate",
    "prevention:permits:suspend",
    "prevention:permits:close",
    "prevention:permits:export",
    "prevention:inspections:view",
    "prevention:inspections:manage",
    "prevention:inspections:approve",
    "prevention:inspections:execute",
    "prevention:inspections:review",
    "prevention:inspections:export",
    "prevention:inspections:ingest",
    "prevention:cphs:view",
    "prevention:cphs:manage",
    "prevention:cphs:certify",
    "prevention:governance:review",
    "prevention:hygiene:view",
    "prevention:hygiene:manage",
    "prevention:hygiene:assess",
    "prevention:hygiene:measure",
    "prevention:emergency:view",
    "prevention:emergency:manage",
    "prevention:emergency:approve",
    "prevention:emergency:drill_execute",
    "prevention:change:view",
    "prevention:change:manage",
    "prevention:change:evaluate",
    "prevention:change:approve",
    "prevention:epp:view",
    "prevention:epp:manage",
    "prevention:sign_own_work",
  ] as const,

  permissionMeta: {
    "prevention:pdtp:view":       { id: "p-prev-pdtp-view",       description: "Ver Programa de Trabajo Preventivo SG-SST" },
    "prevention:pdtp:execute":    { id: "p-prev-pdtp-execute",    description: "Registrar ejecuciones y evidencias del Programa de Trabajo Preventivo en faenas autorizadas" },
    "prevention:pdtp:program:manage": { id: "p-prev-pdtp-program-manage", description: "Administrar catálogo, cronograma y metas por faena del Programa de Trabajo Preventivo" },
    "prevention:pdtp:override:manage": { id: "p-prev-pdtp-override-manage", description: "Crear, modificar o eliminar excepciones de meta por faena con motivo auditable" },
    "prevention:pdtp:submit_review": { id: "p-prev-pdtp-submit-review", description: "Congelar una versión del Programa de Trabajo Preventivo y enviarla a revisión" },
    "prevention:pdtp:approve":    { id: "p-prev-pdtp-approve",    description: "Aprobar el Programa de Trabajo Preventivo como jefatura de prevención" },
    "prevention:pdtp:sign_legal": { id: "p-prev-pdtp-sign-legal", description: "Firmar el Programa de Trabajo Preventivo como Gerencia Legal y Recursos Humanos" },
    "prevention:pdtp:activate": { id: "p-prev-pdtp-activate", description: "Activar una versión completamente aprobada del Programa de Trabajo Preventivo" },
    "prevention:pdtp:lifecycle:manage": { id: "p-prev-pdtp-lifecycle-manage", description: "Reabrir o archivar versiones revisadas del Programa de Trabajo Preventivo con motivo auditable" },
    "prevention:pdtp:checklist:manage": { id: "p-prev-pdtp-cl-manage", description: "Crear/editar plantillas de checklist del PDTP" },
    "prevention:pdtp:checklist:fill":   { id: "p-prev-pdtp-cl-fill",   description: "Llenar el checklist de verificación en una ejecución del PDTP" },
    "prevention:pdtp:action:manage":    { id: "p-prev-pdtp-act-manage", description: "Crear/editar acciones correctivas y su seguimiento en el PDTP" },
    "prevention:pdtp:action:verify":    { id: "p-prev-pdtp-act-verify", description: "Verificar el cierre de acciones correctivas del PDTP" },
    "prevention:pdtp:obligation:cancel": { id: "p-prev-pdtp-obl-cancel", description: "Cancelar necesidades y eventos del PDTP" },
    "prevention:pdtp:close_period": { id: "p-prev-pdtp-close-period", description: "Cerrar y reabrir el mes del Programa de Trabajo Preventivo por faena, congelando su foto" },
    // Fase 5: nombrar a la persona no cambia el contenido firmado, pero SÍ
    // cambia quién ve la fila en /pendientes (el asignado la ve; los demás del
    // mismo rol dejan de verla). Por eso es permiso propio y no cuelga de
    // `prevention:pdtp:execute`: quien ejecuta no decide a quién le toca.
    "prevention:pdtp:assignee:manage": { id: "p-prev-pdtp-assignee-manage", description: "Asignar nominalmente actividades del programa a personas de una faena" },
    // Permiso propio (no `prevention:pdtp:execute`): quien sólo deja
    // constancias no debe poder tocar el resto de la planilla, y viceversa.
    "prevention:constancias:view":    { id: "p-prev-constancias-view",    description: "Ver el submódulo de Constancias del Programa de Trabajo Preventivo" },
    "prevention:constancias:execute": { id: "p-prev-constancias-execute", description: "Dejar constancia de una actividad del Programa de Trabajo Preventivo" },
    // `prevention:alcohol_tests:view` está retirado y prohibido de reintroducir
    // (prevention-rbac.test.ts): el módulo nuevo usa el slug `alcotest`.
    "prevention:alcotest:view":     { id: "p-prev-alcotest-view",     description: "Ver los controles de alcotest y sus envíos de registro" },
    "prevention:alcotest:register": { id: "p-prev-alcotest-register", description: "Registrar un control de alcotest (DO-48)" },
    "prevention:alcotest:dispatch": { id: "p-prev-alcotest-dispatch", description: "Registrar el envío mensual de los registros de alcotest" },
    // CGRD del DS 44 (G15): comité propio, distinto del CPHS. La matriz GRD
    // (N°80) es evidencia oponible ante fiscalizador — mismas cuatro firmas
    // segregadas que la MIPER (edit/review/approve/publish).
    "prevention:cgrd:view":             { id: "p-prev-cgrd-view",             description: "Ver el Comité de Gestión de Riesgos de Desastres, su matriz y sus actas" },
    "prevention:cgrd:committee:manage": { id: "p-prev-cgrd-committee-manage", description: "Constituir o disolver el CGRD y gestionar sus integrantes" },
    "prevention:cgrd:matrix:edit":      { id: "p-prev-cgrd-matrix-edit",      description: "Crear versiones de la matriz GRD y gestionar sus amenazas" },
    "prevention:cgrd:matrix:publish":   { id: "p-prev-cgrd-matrix-publish",   description: "Publicar una versión de la matriz GRD" },
    "prevention:cgrd:meeting:manage":   { id: "p-prev-cgrd-meeting-manage",   description: "Registrar el acta de una sesión del CGRD" },
    "prevention:campaign:view":         { id: "p-prev-camp-v",    description: "Ver campañas preventivas" },
    "prevention:campaign:manage":       { id: "p-prev-camp-m",    description: "Crear, registrar asistencia y cerrar campañas preventivas" },
    "prevention:engagement:view":       { id: "p-prev-engage-v", description: "Ver coordinaciones con el mandante, fiscalizaciones y visitas del organismo administrador" },
    "prevention:engagement:manage":     { id: "p-prev-engage-m", description: "Registrar interacciones externas, sus medidas prescritas y cerrarlas" },
    "prevention:docs:view":               { id: "p-prev-docs-v",    description: "Ver la documentación preventiva" },
    "prevention:docs:manage":             { id: "p-prev-docs-m",    description: "Subir archivos, crear carpetas y crear versiones de documentos" },
    "prevention:docs:submit_review":      { id: "p-prev-docs-submit", description: "Enviar versiones documentales a revisión" },
    "prevention:docs:review":             { id: "p-prev-docs-review", description: "Revisar u observar versiones documentales" },
    "prevention:docs:approve":            { id: "p-prev-docs-approve", description: "Aprobar versiones documentales revisadas" },
    "prevention:docs:publish":            { id: "p-prev-docs-publish", description: "Publicar versiones documentales aprobadas" },
    "prevention:docs:distribute":         { id: "p-prev-docs-distribute", description: "Asignar destinatarios y exenciones para documentos" },
    "prevention:docs:ack":                { id: "p-prev-docs-ack", description: "Acusar recibo de una versión documental asignada" },
    "prevention:docs:link":               { id: "p-prev-docs-link", description: "Vincular documentos con entidades operacionales" },
    "prevention:docs:archive":            { id: "p-prev-docs-arch", description: "Archivar (soft delete) documentos" },
    "prevention:docs:manage_sensitive":   { id: "p-prev-docs-sens", description: "Gestionar documentos con confidencialidad 'sensible'" },
    "prevention:docs:manage_restricted":  { id: "p-prev-docs-rest", description: "Gestionar documentos con confidencialidad 'restringido'" },
    "prevention:indicadores:view":   { id: "p-prev-ind-view",   description: "Ver indicadores de seguridad y salud en el trabajo y material ambiental" },
    "prevention:indicadores:manage": { id: "p-prev-ind-manage", description: "Registrar/editar indicadores de seguridad y salud en el trabajo" },
    "prevention:indicadores:close":  { id: "p-prev-ind-close", description: "Cerrar períodos y corregir indicadores cerrados" },
    "prevention:health:view_restrictions": { id: "p-prev-health-restr", description: "Ver únicamente aptitud y restricciones ocupacionales necesarias" },
    "prevention:health:view_clinical": { id: "p-prev-health-clin", description: "Acceder a antecedentes clínicos cifrados por propósito autorizado" },
    "prevention:health:manage_surveillance": { id: "p-prev-health-surv", description: "Administrar programas de vigilancia ocupacional" },
    "prevention:health:upload_clinical": { id: "p-prev-health-upload", description: "Crear expedientes clínicos ocupacionales cifrados" },
    "prevention:reserved_case:view": { id: "p-prev-reserved-view", description: "Ver casos reservados en los que el usuario es miembro autorizado" },
    "prevention:reserved_case:investigate": { id: "p-prev-reserved-invest", description: "Investigar casos reservados asignados" },
    "prevention:privacy:audit": { id: "p-prev-privacy-audit", description: "Auditar accesos a dominios sensibles sin ver contenido clínico" },
    "prevention:privacy:manage_requests": { id: "p-prev-privacy-manage", description: "Gestionar solicitudes de derechos y retenciones de privacidad" },
    "prevention:privacy:export_subject": { id: "p-prev-privacy-export", description: "Preparar exportaciones minimizadas para derechos del titular" },
    "prevention:capa:view": { id: "p-prev-capa-view", description: "Ver acciones correctivas y preventivas dentro de la faena autorizada" },
    "prevention:capa:manage": { id: "p-prev-capa-manage", description: "Crear, asignar y actualizar acciones CAPA" },
    "prevention:capa:complete": { id: "p-prev-capa-complete", description: "Declarar implementación y enviar acciones CAPA a verificación" },
    "prevention:capa:verify": { id: "p-prev-capa-verify", description: "Verificar evidencia y eficacia de acciones CAPA" },
    "prevention:capa:close": { id: "p-prev-capa-close", description: "Cerrar acciones CAPA verificadas" },
    "prevention:capa:override_segregation": { id: "p-prev-capa-override", description: "Autorizar excepción fundamentada a la segregación de verificación CAPA" },
    "prevention:capa:reconcile": { id: "p-prev-capa-reconcile", description: "Conciliar acciones históricas migradas a CAPA" },
    "prevention:incidents:report": { id: "p-prev-inc-report", description: "Reportar incidentes en faenas autorizadas, incluida sincronización offline" },
    "prevention:incidents:view": { id: "p-prev-inc-view", description: "Ver la proyección operacional no sensible de incidentes" },
    "prevention:incidents:triage": { id: "p-prev-inc-triage", description: "Clasificar incidentes, medidas y responsables de notificación" },
    "prevention:incidents:investigate": { id: "p-prev-inc-invest", description: "Investigar incidentes y vincular evidencia y CAPA" },
    "prevention:incidents:notify": { id: "p-prev-inc-notify", description: "Registrar DIAT, DIEP y notificaciones fatal/grave con evidencia" },
    "prevention:incidents:authorize_restart": { id: "p-prev-inc-restart", description: "Autorizar de forma segregada el reinicio de una operación suspendida" },
    "prevention:incidents:override_segregation": { id: "p-prev-inc-override", description: "Autorizar excepción fundamentada a la segregación de reinicio tras accidente" },
    "prevention:incidents:close": { id: "p-prev-inc-close", description: "Aprobar lotes históricos y cerrar incidentes que cumplan todos los gates" },
    // Confirmar que la difusión ocurrió no es cerrar el caso. Compartían
    // permiso, y eso dejaba la n=71 y la n=75 —difundir el incidente en el
    // turno y difundir las medidas— sin nadie de terreno que pudiera
    // registrarlas, pese a que la planilla se las asigna al jefe de terreno.
    "prevention:incidents:diffuse": { id: "p-prev-inc-diffuse", description: "Confirmar que una difusión de incidente o de medidas efectivamente se realizó" },
    "prevention:incidents:view_sensitive": { id: "p-prev-inc-sensitive", description: "Acceder nominativamente a identidad, lesión y evidencia sensible de incidentes por propósito" },
    "prevention:incidents:export": { id: "p-prev-inc-export", description: "Exportar registro y expediente Excel de incidentes dentro del alcance" },
    "prevention:risk:view": { id: "p-prev-risk-view", description: "Ver MIPER, controles críticos, revisiones y cobertura dentro de la faena autorizada" },
    "prevention:risk:edit": { id: "p-prev-risk-edit", description: "Crear versiones MIPER, importar peligros y gestionar disparadores de revisión" },
    "prevention:risk:review": { id: "p-prev-risk-review", description: "Revisar técnicamente versiones MIPER de forma segregada" },
    "prevention:risk:approve": { id: "p-prev-risk-approve", description: "Aprobar versiones y lotes MIPER de forma segregada" },
    "prevention:risk:publish": { id: "p-prev-risk-publish", description: "Publicar una versión MIPER inmutable y activar el reloj PDTP" },
    "prevention:risk:override_segregation": { id: "p-prev-risk-override", description: "Autorizar excepción fundamentada a la segregación de verificación de controles MIPER" },
    "prevention:legal:view": { id: "p-prev-legal-view", description: "Ver el registro legal y la aplicabilidad dentro de la faena autorizada" },
    "prevention:legal:assess": { id: "p-prev-legal-assess", description: "Preparar requisitos, proponer aplicabilidad y evaluar cumplimiento" },
    "prevention:legal:approve_applicability": { id: "p-prev-legal-approve", description: "Aprobar requisitos y aplicabilidad legal de forma segregada" },
    "prevention:legal:export": { id: "p-prev-legal-export", description: "Exportar registro legal, aplicabilidad, evidencia y brechas en Excel" },
    "prevention:training:view": { id: "p-prev-train-view", description: "Ver el catálogo anual, su estado y el expediente formativo dentro de la faena autorizada" },
    "prevention:training:manage": { id: "p-prev-train-manage", description: "Administrar catálogo, contenidos, sesiones y requisitos de competencia" },
    "prevention:training:approve": { id: "p-prev-train-approve", description: "Aprobar y publicar contenidos formativos de forma segregada del autor" },
    "prevention:training:deliver": { id: "p-prev-train-deliver", description: "Registrar asistencia, evaluación y cierre de una sesión de capacitación" },
    "prevention:training:record": { id: "p-prev-train-record", description: "Marcar una ocurrencia anual como hecha o no hecha y adjuntar evidencia" },
    "prevention:training:ack": { id: "p-prev-train-ack", description: "Acusar recibo de la propia capacitación u ODI" },
    "prevention:training:convalidate": { id: "p-prev-train-conval", description: "Convalidar competencias externas con justificación y evidencia" },
    "prevention:training:revoke": { id: "p-prev-train-revoke", description: "Revocar una competencia vigente con motivo auditado" },
    "prevention:training:export": { id: "p-prev-train-export", description: "Exportar el control anual, evidencias y expediente formativo en Excel" },
    "prevention:permits:view": { id: "p-prev-permit-view", description: "Ver permisos de trabajo, AST y aislamientos de la faena autorizada" },
    "prevention:permits:manage": { id: "p-prev-permit-manage", description: "Administrar el catálogo de tipos de permiso de trabajo" },
    "prevention:permits:request": { id: "p-prev-permit-request", description: "Solicitar permisos de trabajo y elaborar su AST/JSA" },
    "prevention:permits:verify": { id: "p-prev-permit-verify", description: "Verificar controles, aplicar aislamientos LOTO y registrar mediciones" },
    "prevention:permits:approve": { id: "p-prev-permit-approve", description: "Aprobar, rechazar o extender un permiso de forma segregada del solicitante" },
    "prevention:permits:activate": { id: "p-prev-permit-activate", description: "Habilitar el inicio del trabajo una vez cumplidos todos los controles" },
    "prevention:permits:suspend": { id: "p-prev-permit-suspend", description: "Suspender un permiso vigente ante desviación o riesgo" },
    "prevention:permits:close": { id: "p-prev-permit-close", description: "Cerrar un permiso con todos los aislamientos retirados" },
    "prevention:permits:export": { id: "p-prev-permit-export", description: "Exportar permisos, AST, aislamientos y mediciones en Excel" },
    "prevention:inspections:view": { id: "p-prev-insp-view", description: "Ver plantillas, programación, inspecciones y hallazgos de la faena autorizada" },
    "prevention:inspections:manage": { id: "p-prev-insp-manage", description: "Incorporar plantillas y programar inspecciones por faena y frecuencia" },
    "prevention:inspections:approve": { id: "p-prev-insp-approve", description: "Aprobar plantillas de inspección de forma segregada de quien las incorpora" },
    "prevention:inspections:execute": { id: "p-prev-insp-execute", description: "Ejecutar inspecciones en terreno, responder ítems y derivar hallazgos a CAPA" },
    "prevention:inspections:ingest": { id: "p-prev-insp-ingest", description: "Subir la foto de una planilla física para digitalizar el reporte del equipo" },
    "prevention:inspections:review": { id: "p-prev-insp-review", description: "Revisar y cerrar una inspección de forma independiente de quien la ejecutó" },
    "prevention:inspections:export": { id: "p-prev-insp-export", description: "Exportar inspecciones, respuestas, hallazgos y tendencias en Excel" },
    "prevention:cphs:view": { id: "p-prev-cphs-view", description: "Ver comités paritarios, integrantes, sesiones y acuerdos de la faena autorizada" },
    "prevention:cphs:manage": { id: "p-prev-cphs-manage", description: "Constituir comités, designar integrantes, convocar sesiones y cerrar actas" },
    "prevention:cphs:certify": { id: "p-prev-cphs-certify", description: "Gestionar el expediente de certificación CPHS de Mutual y registrar su resultado" },
    "prevention:governance:review": { id: "p-prev-gov-review", description: "Registrar y cerrar la revisión por la dirección del SG-SST" },
    "prevention:hygiene:view": { id: "p-prev-hyg-view", description: "Ver agentes, grupos de exposición, mediciones y cobertura de vigilancia" },
    "prevention:hygiene:manage": { id: "p-prev-hyg-manage", description: "Administrar el catálogo normativo de agentes de exposición, que es global y no tiene faena" },
    "prevention:hygiene:assess": { id: "p-prev-hyg-assess", description: "Gestionar grupos de exposición, programas de vigilancia y el pronunciamiento sobre protocolos MINSAL de su faena" },
    "prevention:hygiene:measure": { id: "p-prev-hyg-measure", description: "Registrar mediciones de exposición contra el límite permisible" },
    "prevention:emergency:view": { id: "p-prev-emg-view", description: "Ver planes de emergencia, escenarios, organigrama, recursos y simulacros" },
    "prevention:emergency:manage": { id: "p-prev-emg-manage", description: "Crear planes de emergencia y administrar escenarios, organigrama, recursos y contactos" },
    "prevention:emergency:approve": { id: "p-prev-emg-approve", description: "Aprobar el plan de emergencia de forma segregada de quien lo creó" },
    "prevention:emergency:drill_execute": { id: "p-prev-emg-drill", description: "Programar y completar simulacros del plan de emergencia" },
    "prevention:change:view": { id: "p-prev-chg-view", description: "Ver solicitudes de gestión del cambio y sus dimensiones de impacto" },
    "prevention:change:manage": { id: "p-prev-chg-manage", description: "Crear solicitudes de gestión del cambio" },
    "prevention:change:evaluate": { id: "p-prev-chg-eval", description: "Evaluar el impacto del cambio por dimensión (riesgo, permiso, capacitación, documento, MIPER, emergencia)" },
    "prevention:change:approve": { id: "p-prev-chg-approve", description: "Aprobar o rechazar el cambio de forma segregada de quien lo solicitó" },
    "prevention:epp:view": { id: "p-prev-epp-view", description: "Ver requisitos de EPP obligatorio y brechas de cobertura" },
    "prevention:epp:manage": { id: "p-prev-epp-manage", description: "Crear requisitos de EPP obligatorio y escalar brechas bloqueantes a CAPA" },
    /**
     * La única excepción a la segregación por actor de todo el módulo, y por
     * eso vive sola al final en vez de mezclada con los permisos de su flujo.
     *
     * Los servicios de Prevención impiden firmar el propio trabajo comparando
     * usuarios, no roles: quien creó una versión no la revisa, quien la revisó
     * no la aprueba, quien la aprobó no la publica, y quien completó una
     * investigación no cierra su incidente. Este permiso levanta el último
     * eslabón de esa cadena —el de publicar/cerrar— para la jefatura técnica
     * del área, que es quien responde por el contenido y no puede quedar
     * esperando una firma ajena sobre su propio criterio.
     *
     * No levanta las etapas anteriores: aprobar sigue exigiendo no haber
     * creado ni revisado, para todos. Y **no alcanza al Programa de Trabajo
     * Preventivo**, cuyo paso JDPR tiene su propia regla `not_elaborator` en
     * `lib/services/pdtp/approval-flow.ts`: nadie aprueba el programa que
     * elaboró, sin excepciones.
     */
    "prevention:sign_own_work": { id: "p-prev-sign-own", description: "Aprobar, publicar o cerrar un registro en cuyas etapas previas la persona ya participó. Reservado a la jefatura técnica del área" },
  },

  nav: [
    {
      areaId: "prevencion",
      items: [
        // ── Programa ────────────────────────────────────────────────────────
        {
          // DS 44 art. 8 lo llama "programa de trabajo preventivo" y no define
          // sigla; "PDTP" es vocabulario interno. El encabezado del grupo ya da
          // el contexto, así que la etiqueta no necesita repetir "preventivo".
          label: "Programa de trabajo",
          href: "/prevencion/pdtp",
          iconName: "ClipboardText",
          group: "Programa",
          permissions: ["prevention:pdtp:view"],
          // El item padre ya lleva al dashboard: un hijo "Dashboard" con la misma
          // href duplicaba la fila y dejaba padre e hijo resaltados a la vez.
          children: [
            {
              label: "Actividades",
              href: "/prevencion/pdtp/actividades",
              permissions: ["prevention:pdtp:view"],
            },
            {
              // "Programas" repetía el sustantivo del padre.
              label: "Programas anuales",
              href: "/prevencion/pdtp/programas",
              permissions: ["prevention:pdtp:view"],
            },
            {
              // Las actividades con scheduleMode on_demand/triggered: no tienen
              // cuota anual, se llevan por casos. "Eventos" solo nombraba la
              // mitad triggered, y "obligaciones" (el href) choca con Requisitos
              // legales, que es lo que "obligación" significa en SST.
              label: "A demanda y por evento",
              href: "/prevencion/pdtp/obligaciones",
              permissions: ["prevention:pdtp:view"],
            },
            {
              // "Acciones" se confundía con el módulo Acciones correctivas.
              // DS 44 art. 8: el programa contiene "medidas preventivas y
              // correctivas".
              label: "Medidas",
              href: "/prevencion/pdtp/acciones",
              permissions: ["prevention:pdtp:view"],
            },
            {
              label: "Cobertura",
              href: "/prevencion/pdtp/cobertura",
              permissions: ["prevention:pdtp:view"],
            },
            {
              // Reglas de exclusión, metas y asignados por faena — mismo nivel
              // que Cobertura y Aprobaciones (configuración de faena), sólo que
              // hasta ahora se llegaba únicamente por enlace directo.
              label: "Aplicabilidad",
              href: "/prevencion/pdtp/aplicabilidad",
              permissions: ["prevention:pdtp:view"],
            },
            {
              // El cierre por faena congela la copia del mes que se firma y se
              // distribuye. Ver la lista sólo exige `view`; cerrar y reabrir
              // exigen `prevention:pdtp:close_period`, que la propia pantalla
              // comprueba para mostrar u ocultar sus acciones.
              label: "Cierres mensuales",
              href: "/prevencion/pdtp/cierres",
              permissions: ["prevention:pdtp:view"],
            },
            {
              label: "Aprobaciones",
              href: "/prevencion/pdtp/aprobaciones",
              permissions: ["prevention:pdtp:approve"],
            },
            {
              // Vive fuera de /prevencion/pdtp porque así la enruta ya la cola
              // operacional (D12); moverla ahí bajo /pdtp requeriría cambiar
              // ese href también.
              label: "Constancias",
              href: "/prevencion/constancias",
              permissions: ["prevention:constancias:view"],
            },
            {
              label: "Alcotest",
              href: "/prevencion/alcotest",
              permissions: ["prevention:alcotest:view"],
            },
          ],
        },
        {
          // DS 44 art. 7: "matriz de identificación de peligros y evaluación de
          // riesgos". IPER es la sigla que usan SUSESO, IST y ACHS; "matriz de
          // riesgos" a secas es un término genérico de gestión, no el instrumento.
          label: "Matriz IPER",
          href: "/prevencion/miper",
          iconName: "ShieldWarning",
          group: "Programa",
          permissions: ["prevention:risk:view"],
        },
        {
          // DS 44 art. 62: instrumento distinto de la matriz IPER (art. 7), con
          // exigibilidad, contenido y visibilidad propios. El fiscalizador los
          // pide por separado, así que no puede vivir como pestaña de la MIPER.
          label: "Mapa de riesgos",
          href: "/prevencion/miper/mapa",
          iconName: "MapPin",
          group: "Programa",
          permissions: ["prevention:risk:view"],
        },
        {
          label: "Requisitos legales",
          href: "/prevencion/requisitos-legales",
          iconName: "Scales",
          group: "Programa",
          permissions: ["prevention:legal:view"],
        },

        // ── Cumplimiento del programa ───────────────────────────────────────
        // Los sourceType que reconoce prevention_pdtp_source_links: lo que puede
        // colgar de una actividad del programa y generar su evidencia.
        {
          // Tres pantallas, una por acto: realizar (esta), el catálogo de
          // instrumentos y el calendario que los dispara. Antes plantillas y
          // programación compartían una sola pantalla con pestañas, y las
          // auditorías del SGSST duplicaban el árbol entero en otra sección.
          label: "Inspecciones",
          href: "/prevencion/inspecciones",
          iconName: "MagnifyingGlass",
          group: "Cumplimiento del programa",
          permissions: ["prevention:inspections:view"],
          children: [
            {
              label: "Plantillas",
              href: "/prevencion/inspecciones/plantillas",
              permissions: ["prevention:inspections:view"],
            },
            {
              label: "Programación",
              href: "/prevencion/inspecciones/programacion",
              permissions: ["prevention:inspections:view"],
            },
          ],
        },
        {
          // La página concentra el catálogo anual y sus ocurrencias por faena;
          // las pantallas antiguas se conservan para compatibilidad histórica.
          label: "Capacitación",
          href: "/prevencion/capacitacion",
          iconName: "Certificate",
          group: "Cumplimiento del programa",
          permissions: ["prevention:training:view"],
        },
        {
          label: "Acciones correctivas",
          href: "/prevencion/capa",
          iconName: "CheckSquare",
          group: "Cumplimiento del programa",
          permissions: ["prevention:capa:view"],
        },
        {
          // eventType cubre incidentes peligrosos, accidentes del trabajo y de
          // trayecto, y sospecha de enfermedad profesional: "Incidentes" solo
          // nombraba la primera categoría.
          label: "Incidentes y accidentes",
          href: "/prevencion/incidentes",
          iconName: "Siren",
          group: "Cumplimiento del programa",
          permissions: ["prevention:incidents:view", "prevention:incidents:report"],
          children: [
            {
              label: "Reportar incidente",
              href: "/prevencion/incidentes/reportar",
              permissions: ["prevention:incidents:report"],
            },
          ],
        },
        {
          // El módulo compara requisitos por cargo/faena contra las entregas de
          // Bodega. "Obligatorio"/"preventivo" eran adjetivos de relleno que
          // además diferían entre sidebar y página.
          label: "Requisitos de EPP",
          href: "/prevencion/epp-preventivo",
          iconName: "HardHat",
          group: "Cumplimiento del programa",
          permissions: ["prevention:epp:view"],
        },
        // Las campañas del programa anual se controlan dentro de
        // /prevencion/capacitacion. La ruta histórica /prevencion/campanas
        // conserva acceso directo para registros anteriores, pero no se
        // ofrece como segunda bandeja de alta.
        {
          label: "Emergencias",
          href: "/prevencion/emergencias",
          iconName: "Siren",
          group: "Cumplimiento del programa",
          permissions: ["prevention:emergency:view"],
        },
        {
          label: "Comités paritarios",
          href: "/prevencion/cphs",
          iconName: "UsersThree",
          group: "Cumplimiento del programa",
          permissions: ["prevention:cphs:view"],
        },
        {
          // DS 44: comité propio de riesgo de desastres, distinto del CPHS.
          label: "Gestión de riesgos de desastres",
          href: "/prevencion/cgrd",
          iconName: "Mountains",
          group: "Cumplimiento del programa",
          permissions: ["prevention:cgrd:view"],
        },

        // ── En terreno ──────────────────────────────────────────────────────
        // Evidencia del día a día que no cuelga de una actividad del programa.
        // Evaluaciones SST y PPA entran acá desde sus propios manifests.
        {
          label: "Permisos de trabajo",
          href: "/prevencion/permisos",
          iconName: "ShieldCheck",
          group: "En terreno",
          permissions: ["prevention:permits:view"],
        },
        {
          // DS 44 título V: "vigilancia del ambiente de trabajo y de la salud".
          // Alineado con el título de la página.
          label: "Higiene y vigilancia",
          href: "/prevencion/higiene",
          iconName: "Heartbeat",
          group: "En terreno",
          permissions: ["prevention:hygiene:view"],
        },
        {
          label: "Gestión del cambio",
          href: "/prevencion/gestion-cambio",
          iconName: "GearSix",
          group: "En terreno",
          permissions: ["prevention:change:view"],
        },

        // ── Seguimiento ─────────────────────────────────────────────────────
        {
          // DS 44 art. 20 (coordinación con quien comparte el centro de trabajo)
          // y art. 70 (medidas prescritas por el organismo administrador). Las
          // tres formas comparten tabla porque comparten formulario.
          label: "Visitas y coordinación",
          href: "/prevencion/coordinacion",
          iconName: "UsersThree",
          group: "Seguimiento",
          permissions: ["prevention:engagement:view"],
        },
        {
          label: "Indicadores SST",
          href: "/prevencion/indicadores",
          iconName: "ChartLineUp",
          group: "Seguimiento",
          permissions: ["prevention:indicadores:view"],
        },
        {
          // Cuenta incidentes peligrosos, daño material y derrames: "Indicadores
          // ambientales" dejaba fuera la mitad material.
          label: "Daño material y ambiental",
          href: "/prevencion/indicadores-material-ambiental",
          iconName: "TreeStructure",
          group: "Seguimiento",
          permissions: ["prevention:indicadores:view"],
        },
        {
          // DS 44 art. 72: "Registro documental de la actividad preventiva".
          label: "Registro documental",
          href: "/prevencion/documentacion",
          iconName: "FolderOpen",
          group: "Seguimiento",
          permissions: ["prevention:docs:view"],
        },
        {
          // DS 44 título III / art. 21: "estructura preventiva". La ficha por
          // faena resuelve qué órgano es exigible según dotación.
          label: "Estructura preventiva",
          href: "/prevencion/faenas",
          iconName: "MapPin",
          group: "Seguimiento",
          permissions: ["prevention:cphs:view"],
        },
        {
          // Ley 21.719: el término legal es protección de datos personales.
          label: "Datos personales",
          href: "/prevencion/privacidad",
          iconName: "LockKey",
          group: "Seguimiento",
          permissions: ["prevention:privacy:audit", "prevention:privacy:manage_requests"],
          children: [
            {
              label: "Derechos del titular",
              href: "/prevencion/privacidad/solicitudes",
              permissions: ["prevention:privacy:manage_requests"],
            },
            {
              label: "Auditoría de accesos",
              href: "/prevencion/privacidad/auditoria",
              permissions: ["prevention:privacy:audit"],
            },
          ],
        },
      ],
    },
  ],

  defaultGrants: [
    // PDTP
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:execute" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:program:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:override:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:submit_review" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:approve" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:close_period" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:assignee:manage" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:view" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:approve" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:sign_legal" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:activate" },
    { roleSlug: "jefa_chome",          permission: "prevention:pdtp:lifecycle:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:execute" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:close_period" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:assignee:manage" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:view" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:execute" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:assignee:manage" },
    { roleSlug: "jefe_terreno",        permission: "prevention:pdtp:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:pdtp:execute" },
    { roleSlug: "supervisor_terreno", permission: "prevention:pdtp:view" },
    { roleSlug: "supervisor_terreno", permission: "prevention:pdtp:execute" },
    // Responsables de actividades del PDTP, sin rol en el flujo de aprobación:
    // `sign_legal`/`approve` siguen en jefa_chome hasta que se pida moverlos.
    { roleSlug: "gerente_legal_rrhh",  permission: "prevention:pdtp:view" },
    { roleSlug: "gerente_legal_rrhh",  permission: "prevention:pdtp:execute" },
    { roleSlug: "subgerente_operaciones", permission: "prevention:pdtp:view" },
    { roleSlug: "subgerente_operaciones", permission: "prevention:pdtp:execute" },
    // El jefe de mantención es responsable de tres actividades del programa
    // (plan de emergencia por amenaza, simulacros, y el cierre de inspecciones
    // de equipos) y hasta 2026-08-13 no podía ni abrir el módulo.
    { roleSlug: "jefe_mantencion",     permission: "prevention:pdtp:view" },
    { roleSlug: "jefe_mantencion",     permission: "prevention:pdtp:execute" },
    // El CPHS sólo mira: sus actividades salieron del PDTP al programa propio
    // del comité (D5), así que no le queda nada que ejecutar acá.
    { roleSlug: "cphs",                permission: "prevention:pdtp:view" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:view" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:execute" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:program:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:override:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:submit_review" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:approve" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:sign_legal" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:activate" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:close_period" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:assignee:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:lifecycle:manage" },
    // PDTP — Checklist / Plan de acción / Seguimiento
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:checklist:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:action:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:action:verify" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:checklist:fill" },
    { roleSlug: "prevencionista_faena", permission: "prevention:pdtp:action:manage" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:checklist:fill" },
    { roleSlug: "admin_contrato",      permission: "prevention:pdtp:action:manage" },
    { roleSlug: "jefe_terreno",        permission: "prevention:pdtp:action:manage" },
    { roleSlug: "supervisor_terreno", permission: "prevention:pdtp:action:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:checklist:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:action:manage" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:action:verify" },
    // PDTP — Cancelación de necesidades/eventos. Separado de `execute`: reportar
    // el cumplimiento es trabajo de terreno, anular el compromiso es gestión.
    { roleSlug: "prevencionista",      permission: "prevention:pdtp:obligation:cancel" },
    { roleSlug: "administrador",       permission: "prevention:pdtp:obligation:cancel" },
    // Constancias — mismo reparto que view/execute del PDTP, bajo permiso
    // propio (G17): quien sólo tiene éste no debe poder tocar el resto de la
    // planilla, y viceversa.
    { roleSlug: "prevencionista",      permission: "prevention:constancias:view" },
    { roleSlug: "prevencionista",      permission: "prevention:constancias:execute" },
    { roleSlug: "jefa_chome",          permission: "prevention:constancias:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:constancias:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:constancias:execute" },
    { roleSlug: "admin_contrato",      permission: "prevention:constancias:view" },
    { roleSlug: "admin_contrato",      permission: "prevention:constancias:execute" },
    { roleSlug: "jefe_terreno",        permission: "prevention:constancias:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:constancias:execute" },
    { roleSlug: "supervisor_terreno", permission: "prevention:constancias:view" },
    { roleSlug: "supervisor_terreno", permission: "prevention:constancias:execute" },
    { roleSlug: "gerente_legal_rrhh",  permission: "prevention:constancias:view" },
    { roleSlug: "gerente_legal_rrhh",  permission: "prevention:constancias:execute" },
    { roleSlug: "subgerente_operaciones", permission: "prevention:constancias:view" },
    { roleSlug: "subgerente_operaciones", permission: "prevention:constancias:execute" },
    { roleSlug: "jefe_mantencion",     permission: "prevention:constancias:view" },
    { roleSlug: "jefe_mantencion",     permission: "prevention:constancias:execute" },
    { roleSlug: "administrador",       permission: "prevention:constancias:view" },
    { roleSlug: "administrador",       permission: "prevention:constancias:execute" },
    // Alcotest (G14, DS 44 / DO-48). Registrar (N°30/N°31): PRF y quien
    // controla en terreno — el conector decide cuál de las dos cierra según
    // el rol de quien registra. Envío (N°32): sólo PRF, según el catálogo.
    { roleSlug: "prevencionista",      permission: "prevention:alcotest:view" },
    { roleSlug: "prevencionista",      permission: "prevention:alcotest:register" },
    { roleSlug: "prevencionista",      permission: "prevention:alcotest:dispatch" },
    { roleSlug: "prevencionista_faena", permission: "prevention:alcotest:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:alcotest:register" },
    { roleSlug: "prevencionista_faena", permission: "prevention:alcotest:dispatch" },
    { roleSlug: "supervisor_terreno", permission: "prevention:alcotest:view" },
    { roleSlug: "supervisor_terreno", permission: "prevention:alcotest:register" },
    { roleSlug: "jefe_terreno",        permission: "prevention:alcotest:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:alcotest:register" },
    { roleSlug: "administrador",       permission: "prevention:alcotest:view" },
    { roleSlug: "administrador",       permission: "prevention:alcotest:register" },
    { roleSlug: "administrador",       permission: "prevention:alcotest:dispatch" },
    // CGRD del DS 44 (G15). Comité y actas: mismo reparto que CPHS
    // (`prevention:cphs:manage`). Matriz GRD (simplificada 2026-09-14): quien
    // edita en terreno no publica — la segregación queda en el reparto de
    // permisos (PRF sólo tiene `matrix:edit`), sin un flujo de revisión
    // intermedio.
    { roleSlug: "cphs",                 permission: "prevention:cgrd:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cgrd:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cgrd:committee:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cgrd:meeting:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cgrd:matrix:edit" },
    { roleSlug: "prevencionista",       permission: "prevention:cgrd:view" },
    { roleSlug: "prevencionista",       permission: "prevention:cgrd:committee:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:cgrd:meeting:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:cgrd:matrix:edit" },
    { roleSlug: "prevencionista",       permission: "prevention:cgrd:matrix:publish" },
    { roleSlug: "jefe_terreno",         permission: "prevention:cgrd:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:cgrd:view" },
    /* Corresponsable de la n=80: crea la versión de la matriz GRD y sus
     * amenazas. La publicación sigue siendo de otros. */
    { roleSlug: "admin_contrato",       permission: "prevention:cgrd:matrix:edit" },
    { roleSlug: "jefa_chome",           permission: "prevention:cgrd:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:cgrd:committee:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:cgrd:meeting:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:cgrd:matrix:publish" },
    { roleSlug: "administrador",        permission: "prevention:cgrd:view" },
    { roleSlug: "administrador",        permission: "prevention:cgrd:committee:manage" },
    { roleSlug: "administrador",        permission: "prevention:cgrd:meeting:manage" },
    { roleSlug: "administrador",        permission: "prevention:cgrd:matrix:edit" },
    { roleSlug: "administrador",        permission: "prevention:cgrd:matrix:publish" },
    // Campañas preventivas — antes reusaban `prevention:pdtp:program:manage`,
    // que es el permiso para editar el programa anual, no para correr campañas.
    { roleSlug: "prevencionista",      permission: "prevention:campaign:view" },
    { roleSlug: "prevencionista",      permission: "prevention:campaign:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:campaign:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:campaign:manage" },
    { roleSlug: "administrador",       permission: "prevention:campaign:view" },
    { roleSlug: "administrador",       permission: "prevention:campaign:manage" },
    // Interacciones con externos (DS 44 arts. 20 y 70). La faena registra y
    // consulta; cerrar exige que toda medida prescrita esté verificada, así que
    // el permiso de gestión no se acota a jefatura.
    { roleSlug: "prevencionista",      permission: "prevention:engagement:view" },
    { roleSlug: "prevencionista",      permission: "prevention:engagement:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:engagement:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:engagement:manage" },
    { roleSlug: "jefa_chome",          permission: "prevention:engagement:view" },
    { roleSlug: "administrador",       permission: "prevention:engagement:view" },
    { roleSlug: "administrador",       permission: "prevention:engagement:manage" },
    // Documentación
    { roleSlug: "prevencionista",      permission: "prevention:docs:view" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:submit_review" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:review" },
    // Misma razón en el flujo documental: los procedimientos de trabajo seguro
    // son suyos, y hasta ahora no podía aprobarlos ni publicarlos.
    { roleSlug: "prevencionista",      permission: "prevention:docs:approve" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:publish" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:distribute" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:ack" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:link" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:archive" },
    { roleSlug: "prevencionista",      permission: "prevention:docs:manage_restricted" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:submit_review" },
    /* La n=36 —difundir la matriz MIPER— acredita al asignar destinatarios, no
     * al publicar: distribuir es un acto del prevencionista de faena sobre un
     * documento que otro ya publicó, así que no rompe la segregación
     * autoría/publicación que sí protege `docs:publish`. */
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:distribute" },
    { roleSlug: "prevencionista_faena", permission: "prevention:docs:ack" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:view" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:review" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:approve" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:publish" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:distribute" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:ack" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:manage_sensitive" },
    { roleSlug: "jefa_chome",          permission: "prevention:docs:manage_restricted" },
    { roleSlug: "jefe_terreno",        permission: "prevention:docs:view" },
    { roleSlug: "jefe_terreno",        permission: "prevention:docs:ack" },
    { roleSlug: "administrador",       permission: "prevention:docs:view" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage" },
    { roleSlug: "administrador",       permission: "prevention:docs:submit_review" },
    { roleSlug: "administrador",       permission: "prevention:docs:review" },
    { roleSlug: "administrador",       permission: "prevention:docs:approve" },
    { roleSlug: "administrador",       permission: "prevention:docs:publish" },
    { roleSlug: "administrador",       permission: "prevention:docs:distribute" },
    { roleSlug: "administrador",       permission: "prevention:docs:ack" },
    { roleSlug: "administrador",       permission: "prevention:docs:link" },
    { roleSlug: "administrador",       permission: "prevention:docs:archive" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage_sensitive" },
    { roleSlug: "administrador",       permission: "prevention:docs:manage_restricted" },
    // Indicadores de seguridad y salud en el trabajo / material ambiental
    { roleSlug: "prevencionista",      permission: "prevention:indicadores:view" },
    { roleSlug: "prevencionista",      permission: "prevention:indicadores:manage" },
    { roleSlug: "prevencionista",      permission: "prevention:indicadores:close" },
    { roleSlug: "prevencionista_faena", permission: "prevention:indicadores:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:indicadores:manage" },
    /* La n=7 —"envío de estadística de cada faena"— es del prevencionista de
     * faena, y acredita al CERRAR el período, no al cargar los datos. Sin este
     * grant cargaba los indicadores y su propia actividad no se cumplía nunca.
     * El permiso también habilita corregir un período ya cerrado: queda acotado
     * a su faena por `resolveWorksiteScope` y registrado en la bitácora. */
    { roleSlug: "prevencionista_faena", permission: "prevention:indicadores:close" },
    { roleSlug: "admin_contrato",       permission: "prevention:indicadores:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:indicadores:manage" },
    { roleSlug: "jefa_chome",          permission: "prevention:indicadores:view" },
    { roleSlug: "cphs",                permission: "prevention:indicadores:view" },
    { roleSlug: "administrador",       permission: "prevention:indicadores:view" },
    { roleSlug: "administrador",       permission: "prevention:indicadores:manage" },
    { roleSlug: "administrador",       permission: "prevention:indicadores:close" },
    // MIPER y registro legal
    { roleSlug: "prevencionista", permission: "prevention:risk:view" },
    { roleSlug: "prevencionista", permission: "prevention:risk:edit" },
    { roleSlug: "prevencionista", permission: "prevention:risk:review" },
    /* La jefatura del Departamento de Prevención firma la MIPER: es quien
     * responde por el inventario de riesgos ante el fiscalizador, y dejar la
     * última firma sólo en Jefatura la volvía un cuello de botella de dos
     * personas. Aprobar sigue exigiendo no haber creado ni revisado; publicar,
     * no haber aprobado — salvo por `prevention:sign_own_work`, su excepción
     * declarada. */
    { roleSlug: "prevencionista", permission: "prevention:risk:approve" },
    { roleSlug: "prevencionista", permission: "prevention:risk:publish" },
    { roleSlug: "prevencionista_faena", permission: "prevention:risk:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:risk:edit" },
    { roleSlug: "jefa_chome", permission: "prevention:risk:view" },
    { roleSlug: "jefa_chome", permission: "prevention:risk:review" },
    { roleSlug: "jefa_chome", permission: "prevention:risk:approve" },
    { roleSlug: "jefa_chome", permission: "prevention:risk:publish" },
    { roleSlug: "cphs", permission: "prevention:risk:view" },
    { roleSlug: "jefe_terreno", permission: "prevention:risk:view" },
    { roleSlug: "administrador", permission: "prevention:risk:view" },
    { roleSlug: "administrador", permission: "prevention:risk:edit" },
    { roleSlug: "administrador", permission: "prevention:risk:review" },
    { roleSlug: "administrador", permission: "prevention:risk:approve" },
    { roleSlug: "administrador", permission: "prevention:risk:publish" },
    { roleSlug: "administrador", permission: "prevention:risk:override_segregation" },
    { roleSlug: "prevencionista", permission: "prevention:legal:view" },
    { roleSlug: "prevencionista", permission: "prevention:legal:assess" },
    { roleSlug: "prevencionista", permission: "prevention:legal:export" },
    { roleSlug: "prevencionista_faena", permission: "prevention:legal:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:legal:assess" },
    { roleSlug: "jefa_chome", permission: "prevention:legal:view" },
    { roleSlug: "jefa_chome", permission: "prevention:legal:assess" },
    { roleSlug: "jefa_chome", permission: "prevention:legal:approve_applicability" },
    { roleSlug: "jefa_chome", permission: "prevention:legal:export" },
    { roleSlug: "cphs", permission: "prevention:legal:view" },
    { roleSlug: "administrador", permission: "prevention:legal:view" },
    { roleSlug: "administrador", permission: "prevention:legal:assess" },
    { roleSlug: "administrador", permission: "prevention:legal:approve_applicability" },
    { roleSlug: "administrador", permission: "prevention:legal:export" },
    // Privacidad: no se otorgan por defecto permisos clínicos, de vigilancia
    // o casos reservados. Esos requieren grants nominativos y propósito formal.
    { roleSlug: "jefa_chome",          permission: "prevention:health:view_restrictions" },
    { roleSlug: "administrador",       permission: "prevention:health:view_restrictions" },
    { roleSlug: "jefa_chome",          permission: "prevention:privacy:audit" },
    { roleSlug: "jefa_chome",          permission: "prevention:privacy:manage_requests" },
    { roleSlug: "administrador",       permission: "prevention:privacy:audit" },
    { roleSlug: "administrador",       permission: "prevention:privacy:manage_requests" },
    { roleSlug: "administrador",       permission: "prevention:privacy:export_subject" },
    // CAPA común. La segregación de acciones altas/críticas se valida
    // además por actor en el servicio, no sólo mediante RBAC.
    { roleSlug: "prevencionista_faena", permission: "prevention:capa:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:capa:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:capa:complete" },
    { roleSlug: "prevencionista",       permission: "prevention:capa:view" },
    { roleSlug: "prevencionista",       permission: "prevention:capa:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:capa:complete" },
    { roleSlug: "prevencionista",       permission: "prevention:capa:verify" },
    { roleSlug: "jefa_chome",           permission: "prevention:capa:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:capa:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:capa:complete" },
    { roleSlug: "jefa_chome",           permission: "prevention:capa:verify" },
    { roleSlug: "jefa_chome",           permission: "prevention:capa:close" },
    { roleSlug: "administrador",        permission: "prevention:capa:view" },
    { roleSlug: "administrador",        permission: "prevention:capa:manage" },
    { roleSlug: "administrador",        permission: "prevention:capa:complete" },
    { roleSlug: "administrador",        permission: "prevention:capa:verify" },
    { roleSlug: "administrador",        permission: "prevention:capa:close" },
    { roleSlug: "administrador",        permission: "prevention:capa:override_segregation" },
    { roleSlug: "administrador",        permission: "prevention:capa:reconcile" },
    // Lectura para el taller: ve la acción correctiva que originó la orden que
    // va a ejecutar. No la avanza — eso es de Prevención.
    { roleSlug: "jefe_mantencion",      permission: "prevention:capa:view" },
    // Incidentes: la proyección operacional se concede por rol y faena. El
    // permiso view_sensitive no tiene grants por defecto: requiere nominación.
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:report" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:triage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:investigate" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:notify" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:export" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:report" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:view" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:triage" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:investigate" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:notify" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:export" },
    /* Responsable de la n=42 y la n=43 (procedimientos de trabajo seguro) y sin
     * acceso al módulo donde viven: publicar sigue segregado, pero no poder
     * siquiera abrir Documentación no es segregación, es un olvido. */
    { roleSlug: "admin_contrato",       permission: "prevention:docs:view" },
    /* La planilla lo declara corresponsable de la n=43 —redactar y revisar los
     * procedimientos de trabajo seguro— y sólo podía mirarlos. Ahora los
     * redacta y los envía a revisión; publicar sigue segregado para él. */
    { roleSlug: "admin_contrato",       permission: "prevention:docs:manage" },
    { roleSlug: "admin_contrato",       permission: "prevention:docs:submit_review" },
    { roleSlug: "admin_contrato",       permission: "prevention:incidents:report" },
    { roleSlug: "admin_contrato",       permission: "prevention:incidents:view" },
    { roleSlug: "jefe_terreno",         permission: "prevention:incidents:report" },
    { roleSlug: "jefe_terreno",         permission: "prevention:incidents:view" },
    /* Los pasos del RE-20 que la planilla le asigna al jefe de terreno no son
     * sólo avisar: la n=68 es el informe preliminar y la n=69 la declaración de
     * la persona accidentada, y las dos entran por `getInvestigableIncident`.
     * El supervisor de terreno acompaña en la n=69, la n=73 y la n=76. Los
     * antecedentes sensibles siguen aparte (`incidents:view_sensitive`). */
    { roleSlug: "jefe_terreno",         permission: "prevention:incidents:investigate" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:incidents:report" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:incidents:view" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:incidents:investigate" },
    /* La n=72 —emitir la DIAT— es del administrador de contrato. */
    { roleSlug: "admin_contrato",       permission: "prevention:incidents:notify" },
    { roleSlug: "cphs",                 permission: "prevention:incidents:view" },
    { roleSlug: "cphs",                 permission: "prevention:incidents:investigate" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:triage" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:investigate" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:notify" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:authorize_restart" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:close" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:diffuse" },
    /* Confirmar la difusión: quien la marcó no puede confirmarla —el servicio
     * lo verifica por actor, no sólo por permiso—, así que darlo a terreno no
     * afloja la regla de las dos personas. */
    { roleSlug: "jefe_terreno",         permission: "prevention:incidents:diffuse" },
    { roleSlug: "prevencionista_faena", permission: "prevention:incidents:diffuse" },
    { roleSlug: "prevencionista",       permission: "prevention:incidents:diffuse" },
    /* Cerrar el expediente RE-20. Trae además el escalamiento de los carriles
     * DT/SEREMI vencidos y de los eventos fatales
     * (`prevention-incident-reminders.ts`), que es donde la jefatura de
     * Prevención tiene que estar. Quien completó la investigación sigue sin
     * poder cerrarla, salvo por su exención. */
    { roleSlug: "prevencionista",       permission: "prevention:incidents:close" },
    { roleSlug: "jefa_chome",           permission: "prevention:incidents:export" },
    { roleSlug: "administrador",        permission: "prevention:incidents:report" },
    { roleSlug: "administrador",        permission: "prevention:incidents:view" },
    { roleSlug: "administrador",        permission: "prevention:incidents:triage" },
    { roleSlug: "administrador",        permission: "prevention:incidents:investigate" },
    { roleSlug: "administrador",        permission: "prevention:incidents:notify" },
    { roleSlug: "administrador",        permission: "prevention:incidents:authorize_restart" },
    { roleSlug: "administrador",        permission: "prevention:incidents:override_segregation" },
    { roleSlug: "administrador",        permission: "prevention:incidents:close" },
    { roleSlug: "administrador",        permission: "prevention:incidents:diffuse" },
    { roleSlug: "administrador",        permission: "prevention:incidents:export" },
    // Capacitación, ODI y competencias. `convalidate` y `revoke` alteran la
    // habilitación de una persona sin que exista sesión ni evaluación: se
    // conceden sólo a jefatura/administración, nunca a roles de terreno.
    // `approve` sí llega a prevencionista (JDPR) desde 2026-09-06: es la
    // responsable declarada de los contenidos formativos del programa y sin el permiso
    // dependía de jefatura para publicar cualquiera de ellos. La segregación
    // se sostiene por actor en el servicio, no por rol aquí: aprobar sigue
    // exigiéndole no haber redactado la versión; sólo publicar una versión ya
    // aprobada admite la excepción de `prevention:sign_own_work` (ver el grant
    // más abajo y lib/services/prevention-signing.ts).
    { roleSlug: "prevencionista",       permission: "prevention:training:view" },
    { roleSlug: "prevencionista",       permission: "prevention:training:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:training:approve" },
    { roleSlug: "prevencionista",       permission: "prevention:training:deliver" },
    { roleSlug: "prevencionista",       permission: "prevention:training:record" },
    { roleSlug: "prevencionista",       permission: "prevention:training:ack" },
    { roleSlug: "prevencionista",       permission: "prevention:training:export" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:deliver" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:record" },
    { roleSlug: "prevencionista_faena", permission: "prevention:training:ack" },
    { roleSlug: "admin_contrato",       permission: "prevention:training:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:training:ack" },
    { roleSlug: "jefe_terreno",         permission: "prevention:training:view" },
    /* La charla diaria (n=53) y las charlas de refuerzo (n=38) las dicta la
     * línea de mando en terreno, no Prevención: son las dos actividades que la
     * planilla asigna al Sup y al JT, y sin `deliver` no podían registrar la
     * sesión que las acredita. Dictar sigue sin ser aprobar contenido:
     * `training:approve`, `convalidate` y `revoke` no se tocan. */
    { roleSlug: "jefe_terreno",         permission: "prevention:training:deliver" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:training:view" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:training:deliver" },
    { roleSlug: "jefe_terreno",         permission: "prevention:training:ack" },
    { roleSlug: "cphs",                 permission: "prevention:training:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:approve" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:convalidate" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:revoke" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:record" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:ack" },
    { roleSlug: "jefa_chome",           permission: "prevention:training:export" },
    { roleSlug: "administrador",        permission: "prevention:training:view" },
    { roleSlug: "administrador",        permission: "prevention:training:manage" },
    { roleSlug: "administrador",        permission: "prevention:training:approve" },
    { roleSlug: "administrador",        permission: "prevention:training:deliver" },
    { roleSlug: "administrador",        permission: "prevention:training:record" },
    { roleSlug: "administrador",        permission: "prevention:training:ack" },
    { roleSlug: "administrador",        permission: "prevention:training:convalidate" },
    { roleSlug: "administrador",        permission: "prevention:training:revoke" },
    { roleSlug: "administrador",        permission: "prevention:training:export" },
    // Contratistas DS 76. `accredit` y `authorize_access` deciden quién entra a
    // la faena: se separan de `submit` (quien presenta la evidencia) y no se
    // conceden juntos a un mismo rol de terreno.
    // Permisos de trabajo. La cadena solicitar → verificar → aprobar →
    // habilitar se reparte entre roles distintos: el servicio además impide
    // que el solicitante apruebe su propio permiso.
    { roleSlug: "jefe_terreno",         permission: "prevention:permits:view" },
    { roleSlug: "jefe_terreno",         permission: "prevention:permits:request" },
    { roleSlug: "jefe_terreno",         permission: "prevention:permits:verify" },
    { roleSlug: "jefe_terreno",         permission: "prevention:permits:suspend" },
    { roleSlug: "admin_contrato",       permission: "prevention:permits:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:permits:request" },
    { roleSlug: "admin_contrato",       permission: "prevention:permits:suspend" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:request" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:verify" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:approve" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:activate" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:suspend" },
    { roleSlug: "prevencionista_faena", permission: "prevention:permits:close" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:view" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:request" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:verify" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:approve" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:activate" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:suspend" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:close" },
    { roleSlug: "prevencionista",       permission: "prevention:permits:export" },
    { roleSlug: "cphs",                 permission: "prevention:permits:view" },
    { roleSlug: "cphs",                 permission: "prevention:permits:suspend" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:approve" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:suspend" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:close" },
    { roleSlug: "jefa_chome",           permission: "prevention:permits:export" },
    { roleSlug: "administrador",        permission: "prevention:permits:view" },
    { roleSlug: "administrador",        permission: "prevention:permits:manage" },
    { roleSlug: "administrador",        permission: "prevention:permits:request" },
    { roleSlug: "administrador",        permission: "prevention:permits:verify" },
    { roleSlug: "administrador",        permission: "prevention:permits:approve" },
    { roleSlug: "administrador",        permission: "prevention:permits:activate" },
    { roleSlug: "administrador",        permission: "prevention:permits:suspend" },
    { roleSlug: "administrador",        permission: "prevention:permits:close" },
    { roleSlug: "administrador",        permission: "prevention:permits:export" },
    // Inspecciones. Ejecutar y revisar se separan: el servicio además impide
    // que quien ejecutó cierre su propia inspección.
    { roleSlug: "jefe_terreno",         permission: "prevention:inspections:view" },
    { roleSlug: "jefe_terreno",         permission: "prevention:inspections:execute" },
    /* El supervisor de terreno ejecuta junto al jefe de terreno: la planilla lo
     * declara responsable de la n=24 (extintores), la n=29 (contenedores), la
     * n=34 (carros), la n=39 (observación planeada) y la n=40 (inspección de
     * área), y hasta ahora no tenía ni `view` — el módulo no le aparecía en el
     * menú. `review` sigue fuera, igual que para el jefe de terreno: quien
     * ejecuta en terreno no cierra. */
    { roleSlug: "supervisor_terreno",   permission: "prevention:inspections:view" },
    { roleSlug: "supervisor_terreno",   permission: "prevention:inspections:execute" },
    // El "jefe de faena" del vocabulario de terreno es este rol —
    // `lib/prevention/admin-contrato-label.ts` lo deja dicho: el equivalente
    // RBAC de `jefe_faena` es `jefe_terreno`, y no `admin_contrato`, cuyo
    // título alternativo "Supervisor de faena" es otro cargo. Es además el
    // responsable que la planilla PDTP asigna a la actividad n=26 ("Revisión
    // y firma del report de uso diario de equipos"): ya firma el papel.
    { roleSlug: "jefe_terreno",         permission: "prevention:inspections:ingest" },
    { roleSlug: "admin_contrato",       permission: "prevention:inspections:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:inspections:execute" },
    /* Sube la foto de la planilla física igual que el jefe de terreno: el
     * reporte de uso diario lo llena el operador en papel —los conductores no
     * tienen cuenta— y lo transcribe el administrador de contrato o el
     * supervisor de faena, bajo el nombre de quien lo hizo. Sin `ingest` no
     * podía adjuntar el papel que respalda lo que digita. */
    { roleSlug: "admin_contrato",       permission: "prevention:inspections:ingest" },
    { roleSlug: "prevencionista_faena", permission: "prevention:inspections:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:inspections:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:inspections:execute" },
    { roleSlug: "prevencionista_faena", permission: "prevention:inspections:review" },
    { roleSlug: "prevencionista",       permission: "prevention:inspections:view" },
    { roleSlug: "prevencionista",       permission: "prevention:inspections:manage" },
    // Habilitar un instrumento es del Jefe del Departamento de Prevención y del
    // administrador, nadie más. Se le quitó a `jefa_chome` (Jefatura), que es
    // otro cargo.
    { roleSlug: "prevencionista",       permission: "prevention:inspections:approve" },
    { roleSlug: "prevencionista",       permission: "prevention:inspections:execute" },
    { roleSlug: "prevencionista",       permission: "prevention:inspections:review" },
    { roleSlug: "prevencionista",       permission: "prevention:inspections:export" },
    { roleSlug: "cphs",                 permission: "prevention:inspections:view" },
    // Taller. Nadie del taller tiene cuenta: el reporte llega por foto y las
    // acciones correctivas de equipos las gestiona Prevención, que ya tiene
    // `capa:complete`. El jefe de mantención sólo mira lo que su taller va a
    // recibir — cerrar la mantención, que es lo que acredita la evidencia de
    // la CAPA, ya lo habilita `mantenciones:edit`.
    { roleSlug: "jefe_mantencion",      permission: "prevention:inspections:view" },
    /* Responsable declarado de la n=83 (plan de emergencia) y la n=84
     * (simulacros) y sin `emergency:view`: Emergencias no le aparecía en el
     * menú. Aprobar el plan sigue siendo de otro por segregación. */
    { roleSlug: "jefe_mantencion",      permission: "prevention:emergency:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:inspections:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:inspections:review" },
    { roleSlug: "jefa_chome",           permission: "prevention:inspections:export" },
    { roleSlug: "administrador",        permission: "prevention:inspections:view" },
    { roleSlug: "administrador",        permission: "prevention:inspections:manage" },
    { roleSlug: "administrador",        permission: "prevention:inspections:approve" },
    { roleSlug: "administrador",        permission: "prevention:inspections:execute" },
    { roleSlug: "administrador",        permission: "prevention:inspections:review" },
    { roleSlug: "administrador",        permission: "prevention:inspections:export" },
    // CPHS. El comité es un órgano propio: sus integrantes lo ven y lo
    // gestionan. La revisión por la dirección sigue siendo de jefatura, no de
    // terreno ni del comité — con una excepción deliberada: la Jefa del
    // Depto. de Prevención (rol `prevencionista`) también la cierra, porque es
    // la responsable declarada de la N°9 del PDTP (decisión E05, 2026-09-06).
    // Sin este permiso la actividad sólo podía marcarse a mano en la planilla
    // del programa; `closeManagementReview` es el acto real que la acredita.
    { roleSlug: "cphs",                 permission: "prevention:cphs:view" },
    { roleSlug: "cphs",                 permission: "prevention:cphs:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cphs:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:cphs:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:cphs:view" },
    { roleSlug: "prevencionista",       permission: "prevention:cphs:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:governance:review" },
    { roleSlug: "jefe_terreno",         permission: "prevention:cphs:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:cphs:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:cphs:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:cphs:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:governance:review" },
    { roleSlug: "administrador",        permission: "prevention:cphs:view" },
    { roleSlug: "administrador",        permission: "prevention:cphs:manage" },
    { roleSlug: "administrador",        permission: "prevention:governance:review" },
    // La certificación Mutual es un trámite externo que dirige la jefatura de
    // Prevención, no cada prevencionista de faena ni el propio comité.
    { roleSlug: "prevencionista",       permission: "prevention:cphs:certify" },
    { roleSlug: "jefa_chome",           permission: "prevention:cphs:certify" },
    { roleSlug: "administrador",        permission: "prevention:cphs:certify" },
    // Higiene industrial. La vista es agregada y anonimizada, por eso puede
    // concederse ampliamente; el resultado clínico individual sigue viviendo
    // en el dominio sensible con sus propios permisos nominativos.
    { roleSlug: "prevencionista",       permission: "prevention:hygiene:view" },
    { roleSlug: "prevencionista",       permission: "prevention:hygiene:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:hygiene:assess" },
    { roleSlug: "prevencionista",       permission: "prevention:hygiene:measure" },
    { roleSlug: "prevencionista_faena", permission: "prevention:hygiene:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:hygiene:measure" },
    // El `PRF` del catálogo 2026 es el responsable declarado de las N°44 a N°50,
    // y con sólo `measure` podía registrar mediciones (N°45) pero no pronunciarse
    // sobre un protocolo MINSAL (N°46-49) ni registrar un control de vigilancia
    // (N°50).
    //
    // Se le dio `assess` y no `manage` (D19): `manage` habilita además el catálogo
    // de agentes, que es normativo y **global** —no tiene faena— así que un PRF de
    // una faena podía editar el catálogo de todas. `assess` cubre exactamente lo
    // que sus actividades exigen, y nada más.
    { roleSlug: "prevencionista_faena", permission: "prevention:hygiene:assess" },
    { roleSlug: "cphs",                 permission: "prevention:hygiene:view" },
    { roleSlug: "jefe_terreno",         permission: "prevention:hygiene:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:hygiene:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:hygiene:manage" },
    { roleSlug: "jefa_chome",           permission: "prevention:hygiene:assess" },
    { roleSlug: "administrador",        permission: "prevention:hygiene:view" },
    { roleSlug: "administrador",        permission: "prevention:hygiene:manage" },
    { roleSlug: "administrador",        permission: "prevention:hygiene:assess" },
    { roleSlug: "administrador",        permission: "prevention:hygiene:measure" },
    // Emergencias. Aprobar queda reservado a jefatura: la segregación real
    // (quien crea el plan no puede aprobarlo) se valida en el servicio, no
    // restringiendo el permiso a un rol distinto de quien lo administra.
    { roleSlug: "jefe_terreno",         permission: "prevention:emergency:view" },
    { roleSlug: "jefe_terreno",         permission: "prevention:emergency:drill_execute" },
    { roleSlug: "admin_contrato",       permission: "prevention:emergency:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:emergency:drill_execute" },
    { roleSlug: "prevencionista_faena", permission: "prevention:emergency:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:emergency:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:emergency:drill_execute" },
    { roleSlug: "prevencionista",       permission: "prevention:emergency:view" },
    { roleSlug: "prevencionista",       permission: "prevention:emergency:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:emergency:approve" },
    { roleSlug: "prevencionista",       permission: "prevention:emergency:drill_execute" },
    { roleSlug: "cphs",                 permission: "prevention:emergency:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:emergency:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:emergency:approve" },
    { roleSlug: "administrador",        permission: "prevention:emergency:view" },
    { roleSlug: "administrador",        permission: "prevention:emergency:manage" },
    { roleSlug: "administrador",        permission: "prevention:emergency:approve" },
    { roleSlug: "administrador",        permission: "prevention:emergency:drill_execute" },
    // Gestión del cambio. Igual criterio que emergencias: aprobar queda
    // reservado a jefatura y la segregación real (quien solicita no aprueba)
    // se valida en el servicio.
    { roleSlug: "jefe_terreno",         permission: "prevention:change:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:change:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:change:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:change:manage" },
    { roleSlug: "prevencionista_faena", permission: "prevention:change:evaluate" },
    { roleSlug: "prevencionista",       permission: "prevention:change:view" },
    { roleSlug: "prevencionista",       permission: "prevention:change:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:change:evaluate" },
    { roleSlug: "prevencionista",       permission: "prevention:change:approve" },
    { roleSlug: "cphs",                 permission: "prevention:change:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:change:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:change:approve" },
    { roleSlug: "administrador",        permission: "prevention:change:view" },
    { roleSlug: "administrador",        permission: "prevention:change:manage" },
    { roleSlug: "administrador",        permission: "prevention:change:evaluate" },
    { roleSlug: "administrador",        permission: "prevention:change:approve" },
    // EPP preventivo. Dashboard de cobertura: view es de lectura amplia,
    // manage crea requisitos y escala brechas bloqueantes a CAPA.
    { roleSlug: "jefe_terreno",         permission: "prevention:epp:view" },
    { roleSlug: "admin_contrato",       permission: "prevention:epp:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:epp:view" },
    { roleSlug: "prevencionista_faena", permission: "prevention:epp:manage" },
    { roleSlug: "prevencionista",       permission: "prevention:epp:view" },
    { roleSlug: "prevencionista",       permission: "prevention:epp:manage" },
    { roleSlug: "cphs",                 permission: "prevention:epp:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:epp:view" },
    { roleSlug: "jefa_chome",           permission: "prevention:epp:manage" },
    { roleSlug: "administrador",        permission: "prevention:epp:view" },
    { roleSlug: "administrador",        permission: "prevention:epp:manage" },
    /* La excepción a la segregación por actor, y la única. Va sola al final
     * porque no pertenece a ningún flujo: los levanta todos. Sólo el JDPR — el
     * `administrador` lo recibe por ser quien recibe todos. Ensancharla es una
     * decisión de gobernanza, no un grant más; `prevention-rbac.test.ts` la
     * fija con una lista cerrada para que tenga que ser deliberada. */
    { roleSlug: "prevencionista",       permission: "prevention:sign_own_work" },
  ],
} as const satisfies ModuleManifest

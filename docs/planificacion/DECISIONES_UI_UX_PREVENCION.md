# Decisiones resueltas — UI/UX de Prevención

Este registro traduce las respuestas del cuestionario a contratos implementables. Las decisiones incompletas siguen abiertas; no deben convertirse en datos, permisos o métricas oficiales hasta contar con una respuesta explícita.

## D1. Evaluaciones de personas versus inspecciones

- **Decisión:** Opción A.
- **Contrato:** `/prevencion/evaluaciones` y sus formularios solo operan las definiciones `trabajador_nuevo` y `trabajador_antiguo`.
- **Ruta de inspecciones:** se inician y administran desde PDTP.
- **Aplicación:** el selector y la Server Action rechazan definiciones de inspección. Los registros históricos no se eliminan.
- **Estado:** aplicada.

## D2. Roles evaluadores y visita

- **Nombre visible:** el rol técnico `admin_contrato` se presenta como **Supervisor de faena**. No se crea un cuarto rol.
- **Agrupación:** las participaciones de Prevencionista de faena, Supervisor de faena y Conductor líder forman una visita/caso único.
- **Identidad:** cada visita requiere un identificador persistente. Una persona puede tener dos visitas el mismo día cuando cambia de faena o motivo.
- **Aplicación:** `sst_evaluation_visits` persiste la visita y cada evaluación conserva `visitId`. La creación permite seleccionar una visita en borrador o abrir una nueva; los históricos sin identificador no se agrupan de forma especulativa.
- **Estado y cierre:** pendientes de definición funcional. No se inventa una máquina de estados del caso.
- **Estado:** parcialmente aplicada.

## D3. Programa preventivo activo

- **Modelo operativo:** programa anual base, con adaptación y ejecución por faena. Es un modelo híbrido, no un porcentaje agregado de faenas sin contexto.
- **Período:** año calendario.
- **Selección:** sin programas se muestra vacío guiado; con uno se abre como contexto predeterminado; con varios se exige selección explícita. La faena se conserva como contexto compatible.
- **Cumplimiento:** se almacena como fracción `0–1` y se muestra como porcentaje `0–100 %`. Los pesos existentes de programa siguen siendo fuente del cálculo; no se agregan faenas sin regla explícita.
- **Trabajo semanal prioritario:** actividades de la semana, ejecuciones pendientes, checklists por enviar, aprobaciones pendientes y acciones vencidas.
- **Aplicación:** PDTP filtra por año calendario; cero programas muestra un vacío guiado, uno abre su contexto y varios obligan a seleccionarlo. Con más de una faena tampoco se elige una sin una selección explícita.
- **Estado:** aplicada en la entrada del Programa; quedan pendientes el cockpit completo y la cola de Inicio.

## D4. Indicadores

- **Registro:** Prevencionista de faena, Supervisor de faena y Jefa del Departamento de Prevención pueden registrar/editar; Administración de plataforma conserva administración total.
- **Cierre y corrección de período cerrado:** solo Jefa del Departamento de Prevención, además de Administración de plataforma.
- **Pendiente:** catálogo oficial por indicador, fuente, fórmula, unidad, población y regla de tendencia.
- **Aplicación:** `admin_contrato` recibió `prevention:indicadores:manage`; el rol técnico visible es Supervisor de faena. El rol `prevencionista` ya conserva la gestión como Jefa del Departamento y Administración de plataforma mantiene la gestión total.
- **Aplicación adicional:** `safety_indicator_periods` registra el cierre por faena/año/mes. El permiso `prevention:indicadores:close` queda solo para Jefa del Departamento (`prevencionista`) y Administración. Un período cerrado bloquea edición a otros roles; los autorizados pueden corregirlo sin reabrirlo, tal como se respondió.
- **Estado:** parcialmente aplicada; no se agregaron motivo/versionado de corrección ni catálogo/fórmulas porque no fueron definidos.

## D5. Acciones correctivas

- **Estrategia:** evolución incremental. Cada dominio mantiene su escritura; la lectura transversal solo consume acciones con contrato mínimo.
- **Contrato mínimo propuesto:** origen/enlace, descripción, faena, responsable, prioridad/criticidad, plazo, estado, evidencia, seguimiento y verificación/cierre.
- **Permisos operativos:** Prevencionista de faena, Supervisor de faena y Jefa del Departamento pueden crear/editar. Solo Jefa del Departamento revisa, cierra o edita una acción cerrada, además de Administración de plataforma. PDTP concede ahora `action:manage` y `action:verify` a la Jefa del Departamento (`prevencionista`).
- **PPA:** solo un PPA detenido y autorizado crea una acción estructurada. El revisor debe asignar responsable y plazo antes del cierre; un PPA rechazado no crea acción.
- **Aplicación:** `ppa_corrective_actions` persiste origen PPA, faena, descripción, responsable, rol, prioridad, plazo y estado. La revisión autoriza solo al completar esos datos y crea la acción en la misma transacción; rechazo no crea acción.
- **Estado:** parcialmente aplicada; faltan seguimiento, evidencia, verificación y lectura transversal.

## D6. Vínculos documentales

- **Versión:** un vínculo debe resolver la versión vigente.
- **Archivo:** un documento archivado se identifica como tal y queda disponible solo para auditoría.
- **Retiro:** exige motivo, usuario y fecha.
- **Aplicación:** `sst_document_links` acepta actividad, ejecución, checklist PDTP, evaluación SST, acción y PPA. Conserva creador; retirar es un borrado lógico con motivo, usuario y fecha, además de auditoría documental. Las consultas resuelven la versión vigente mediante el documento y omiten vínculos retirados.
- **Estado:** aplicada en modelo y servicios; falta exponer el selector de documentos desde cada objeto de origen.

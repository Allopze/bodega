# Cuestionario de decisiones — UI/UX de Prevención

## Propósito

Este cuestionario reúne las decisiones que no pueden deducirse con seguridad desde el código. Tus respuestas permitirán continuar la implementación sin inventar reglas de negocio, datos, permisos ni responsabilidades.

## Cómo responder

1. Conserva el número de cada pregunta.
2. Escribe bajo **Respuesta:** o reemplaza `[PENDIENTE]`.
3. Puedes elegir una alternativa, proponer otra o marcar `No aplica`.
4. Si otra persona debe aprobar, indica quién y una fecha estimada.

Los ejemplos muestran el nivel de precisión necesario; no son una respuesta esperada.

---

# A. Decisiones que bloquean implementación

## D1. Evaluaciones de personas versus inspecciones

### 1. ¿Qué tipos deben aparecer en Evaluaciones SST?

El formulario actual requiere trabajador, cargo y resultado de persona. Algunas definiciones del catálogo se comportan más como inspecciones de equipos, instalaciones u observaciones. Mezclarlas produciría campos y resultados incorrectos.

- **A. Corto plazo recomendado:** Evaluaciones SST contiene solo evaluaciones de personas. Las inspecciones se ejecutan desde las actividades PDTP.
- **B. Flujo separado:** crear Inspecciones/Observaciones con sujeto, campos, permisos, estados y resultado propios.
- **C. Otra:** explica el límite entre ambos flujos.

**Respuesta:** Opción A

**Ejemplo:** “A. En Evaluaciones solo trabajador nuevo, trabajador antiguo y seguimiento. Las inspecciones de equipos se registran desde PDTP hasta una fase posterior.”

### 2. Si eliges B o C, ¿cuál es el contrato de cada inspección?

| Familia o definición | Sujeto (ej.: grúa, área, vehículo) | Campos obligatorios | Resultado/estado | Roles que crean y cierran |
|---|---|---|---|---|
| No aplica en esta fase | — | — | — | Inspecciones se operan dentro de PDTP |

**Ejemplo:** “Inspección de grúa: equipo identificado por código, faena, checklist y foto opcional; queda Aprobada/Con observaciones/No operable; la crea Prevención de faena y la cierra Jefatura.”

### 3. Cuando una inspección nace desde PDTP, ¿cuál es su puerta canónica?

- **A:** se inicia y administra siempre dentro de PDTP.
- **B:** PDTP abre el flujo de Inspecciones con actividad/ejecución preseleccionada.
- **C:** otro comportamiento.

**Respuesta:** Opción A

---

## D2. Participación de roles en Evaluaciones

### 4. ¿“Jefe de terreno” corresponde al rol técnico `admin_contrato`?

El código usa `conductor_lider`, `admin_contrato` y `prevencionista_faena`. Necesitamos saber si Jefe de terreno es el nombre visible de `admin_contrato` o un rol distinto.

**Respuesta:** Jefe de terreno debe ser Supervisor de faena y es lo mismo que administrador de contrato, pasa que el cargo se llama administrador de contrato pero todavia queda gente que tiene por nombre de cargo supervisor de faena, son exactamente lo mismo.

**Ejemplo:** “Sí, Jefe de terreno es la etiqueta visible de `admin_contrato`; no se crea un rol nuevo.”

### 5. ¿Los tres roles forman una visita/caso único o evaluaciones independientes?

- **A. Caso único:** una visita tiene hasta tres participaciones; comparte trabajador, faena y fecha, conservando quién respondió cada parte.
- **B. Independientes:** cada rol crea y cierra su evaluación aunque sea el mismo día.
- **C. Mixto:** indica qué tipos se agrupan.

**Respuesta:** Opción A

**Ejemplo:** “A. La visita de ingreso es única; Prevención responde documentación, Jefe de terreno competencias y Conductor líder acompañamiento. No se cierra hasta completar las partes obligatorias.”

### 6. ¿Cuáles son los estados y reglas de cierre?

| Objeto | Estados visibles | Quién cambia estado | Condición de cierre | ¿Se puede reabrir? |
|---|---|---|---|---|
| Visita/caso o evaluación | Borrador, en revisión, cerrada | Cada participante edita su parte en borrador; Jefa del Departamento cierra/reabre | Todas las participaciones obligatorias completas y sin acciones críticas abiertas | Sí, solo Jefa, conservando motivo y trazabilidad |

### 7. Si existe un caso único, ¿cómo se identifica cuando hay más de una visita el mismo día?

No se puede agrupar en la interfaz por coincidencia de nombre y fecha. Define la regla real.

**Respuesta:** Cada creación genera un identificador de visita. Una persona puede tener dos visitas el mismo día si cambió de faena o motivo.

**Ejemplo:** “Cada creación genera un identificador de visita. Una persona puede tener dos visitas el mismo día si cambió de faena o motivo.”

---

## D3. Programa preventivo activo y multifaena

### 8. ¿El PDTP es global con lectura por faena o independiente por faena?

Esta decisión controla Inicio, Dashboard y cockpit del Programa. Hoy el sistema evita sumar faenas silenciosamente para no publicar porcentajes engañosos.

- **A. Global:** un programa anual común; la faena es una vista/segmento de su ejecución.
- **B. Independiente:** cada faena posee programa, aprobación y progreso propios.
- **C. Híbrido:** explica qué es global y qué es local.

**Respuesta:** Por lo general el programa es muy similar para todas las faenas, sinembargo cada faena tiene particularidades y realidades distintas que requieren adaptar el programa a esas particularidades de la faena.

### 9. ¿Qué debe pasar al haber cero, uno o varios programas visibles?

| Situación | Comportamiento esperado | Acción permitida |
|---|---|---|
| Sin programa | Vacío guiado que explica el período | Crear programa, solo con permiso de gestión |
| Exactamente uno | Abrirlo como contexto predeterminado | Cambiar faena y año desde filtros estructurados |
| Varios | Selector obligatorio de programa; recordar el último por usuario/año | Abrir solo el programa seleccionado |

**Ejemplo:** “Sin programa: vacío guiado y Crear programa solo para Prevención. Uno: abrirlo directamente. Varios: selector obligatorio de programa y faena, recordado por usuario/año.”

Debes hacer lo del ejemplo, está bien como se plantea en el.

### 10. ¿Cuál es el período y la faena predeterminados?

Define si se usa año calendario, vigencia de contrato u otra regla; también si se recuerda la última selección o existe una faena principal.

**Respuesta:** Año calendario.

### 11. ¿Qué significa cumplimiento PDTP y qué unidad se usa?

Se han encontrado valores en fracción (`0–1`) y porcentaje (`0–100`). Debe existir una única unidad de almacenamiento, cálculo y visualización.

**Respuesta:** Define tu el mejor camino basandote en los documentos presentes en el repo, en lo ya construido y en la logica y las maximas de la experiencia.

**Ejemplo:** “Se almacena en fracción 0–1 y se muestra 0–100 %. Cumplimiento = 40 % ejecución + 35 % checklist conforme + 25 % acciones cerradas a tiempo. No se agrega entre faenas.”

### 12. Ordena el trabajo principal semanal del cockpit PDTP

Marca y ordena máximo cinco.

- [x] Actividades de esta semana
- [x] Ejecuciones pendientes
- [x] Checklists por enviar
- [x] Aprobaciones pendientes
- [x] Acciones vencidas
- [ ] Evidencias faltantes
- [ ] Matriz anual
- [ ] Historial
- [ ] Otro: No aplica

**Respuesta / orden:** 1. Actividades de esta semana. 2. Ejecuciones pendientes. 3. Checklists por enviar. 4. Aprobaciones pendientes. 5. Acciones vencidas.

---

## D4. Contrato de indicadores

### 13. ¿Qué indicadores son oficiales y quién es dueño de cada uno?

No se debe publicar una tendencia o comparación sin fuente, unidad, período, población y responsable.

| Indicador | ¿Se mantiene? | Manual/importado/derivado | Fórmula o fuente | Unidad | Período/población | Responsable de carga/validación | Fecha de cierre |
|---|---|---|---|---|---|---|---|
| Tasa de frecuencia | Sí | Derivado | Accidentes con tiempo perdido × 1.000.000 / horas hombre | tasa | Mensual por faena; anual acumulado | Jefa valida | Cierre mensual |
| Tasa de gravedad | Sí | Derivado | Días perdidos × 1.000 / horas hombre | tasa | Mensual por faena; anual acumulado | Jefa valida | Cierre mensual |
| Accidentes | Sí | Manual | Conteo mensual con/sin tiempo perdido | cantidad | Mensual por faena | Prevención de faena carga; Jefa valida | Cierre mensual |
| Incidentes/daños | Sí | Manual | Conteos de incidentes, daño material y ambiental | cantidad | Mensual por faena | Prevención de faena carga; Jefa valida | Cierre mensual |
| Horas hombre | Sí | Manual | Horas hombre declaradas para la faena | horas | Mensual por faena | Admin. contrato carga; Jefa valida | Cierre mensual |

### 14. ¿Qué significa cerrar un período de indicadores?

Indica quién registra, edita, aprueba/cierra y corrige un mes cerrado. Si hay corrección, indica si requiere motivo y conserva versión.

**Respuesta:** Registran prevencionistas de faena, admin. de contrato, jefa del depto de prevencion, editan los mismos, aprueba, cierra y corrige cerrado solo la jefa del depto de prevencion, ten en cuenta que el admin de la plataforma puede hacer todo esto y mas.

### 15. ¿Qué metas, tendencias o comparaciones están autorizadas?

Se requiere regla, umbral y comparador; una flecha verde/roja sin contrato no es válida.

**Respuesta:** No se muestran metas ni colores de tendencia hasta contar con una referencia anual aprobada. Mientras tanto, la comparación permitida es solo contra el mismo período del año anterior, con rótulo "referencial" y sin juicio favorable/desfavorable.

**Ejemplo:** “Tasa de frecuencia contra el mismo mes del año anterior; disminución mayor al 5 % es favorable. No se comparan meses con menos de 10.000 horas hombre.”

---

## D5. Acciones correctivas transversales

### 16. ¿Qué estrategia se aprueba?

- **A. Evolución incremental:** cada módulo conserva su escritura; se crea primero una lectura transversal y se enriquece SST/PPA hasta cumplir un contrato mínimo.
- **B. Entidad transversal:** motor único con origen, faena, responsable, prioridad, plazo, evidencia, seguimiento y verificación. Requiere migración y pruebas de paridad.
- **C. Otra:** explica alcance y secuencia.

**Respuesta:** Opción A

### 17. ¿Cuál es el contrato mínimo para que una acción aparezca en Inicio?

Marca los campos obligatorios. Si un origen no los tiene, no aparecerá en la cola hasta proveerlos.

- [x] Origen y enlace al registro original
- [x] Descripción
- [x] Faena
- [x] Responsable
- [x] Prioridad/criticidad
- [x] Fecha límite
- [x] Estado
- [x] Evidencia
- [x] Seguimiento
- [x] Verificación/cierre
- [ ] Otro: No aplica

**Respuesta:** Definelos tu en base a la logica, el contenido del repo y lo que dice la experiencia.

### 18. ¿PPA crea acción estructurada o mantiene texto libre?

Hoy PPA almacena una acción correctiva como texto libre. Define cuándo se transforma en tarea operable, quién la recibe y qué ocurre al cerrar/rechazar el caso PPA.

**Respuesta:** Solo un PPA detenido autorizado crea acción. El revisor asigna responsable y plazo antes de cerrar. Un PPA rechazado no crea acción.

**Ejemplo:** “Solo un PPA detenido autorizado crea acción. El revisor asigna responsable y plazo antes de cerrar. Un PPA rechazado no crea acción.”

### 19. ¿Quién puede ver, reasignar, verificar y reabrir?

| Rol | Ver | Editar | Reasignar | Adjuntar evidencia | Verificar | Reabrir |
|---|---|---|---|---|---|---|
| Prevencionista de faena | Sí, su alcance | Sí, abierta | No | Sí | No | No |
| Prevencionista/jefatura | Sí, su alcance | Sí, incluida cerrada | Sí | Sí | Sí | Sí |
| Responsable operativo | Sí, asignadas | Actualiza avance/evidencia | No | Sí | No | No |

Ten en cuenta que la regla general es que PREVENCIONISTA DE FAENA, ADMIN DE CONTRATO Y JEFA DEL DEPTO DE PREVENCION PUEDEN CREAR/EDITAR, SOLO JEFA DEL DEPTO CIERRA, REVISA Y EDITA UNA VEZ CERRADO.

---

## D6. Vínculos persistentes con Documentación

### 20. ¿Qué objetos pueden vincular documentos permanentemente?

La primera entrega permite buscar y abrir documentos con contexto. Un vínculo permanente requiere una relación definida.

| Origen | ¿Permitir vínculo? | Cardinalidad (uno/muchos) | Tipos documentales permitidos |
|---|---|---|---|
| Actividad PDTP | Sí | Muchos | Planes, procedimientos y evidencias vigentes |
| Ejecución/checklist PDTP | Sí | Muchos | Evidencias y checklist aplicables |
| Evaluación SST | Sí | Muchos | Actas, evidencias y certificados SST |
| Acción correctiva | Sí | Muchos | Evidencia de corrección y verificación |
| PPA | Sí | Muchos | Evidencia de corrección y autorización |

### 21. ¿Quién puede crear, retirar y ver un vínculo?

Considera permisos, alcance de faena y confidencialidad del documento, no solo el permiso del objeto de origen.

**Respuesta:** Crea/retira quien puede editar el objeto origen y gestionar documentación en la misma faena. Ver hereda ambos alcances y la confidencialidad más restrictiva. Retirar exige motivo, usuario y fecha.

### 22. ¿Qué pasa cuando el documento se archiva, cambia versión, se mueve o se elimina el objeto de origen?

**Respuesta:** El vínculo apunta a la versión vigente. Si se archiva, se muestra archivado y solo auditoría puede abrirlo. Retirar el vínculo exige motivo, usuario y fecha.

**Ejemplo:** “El vínculo apunta a la versión vigente. Si se archiva, se muestra archivado y solo auditoría puede abrirlo. Retirar el vínculo exige motivo, usuario y fecha.”

### 23. ¿Qué auditoría y retención son obligatorias?

Indica si se registra creador, fecha, motivo, versión, cambios de permisos y tiempo mínimo de conservación.

**Respuesta:** Auditoría obligatoria de creador, fecha, motivo, entidad, documento, versión vigente y retiro. Se conserva mientras exista el objeto origen y por cinco años desde su cierre o archivo.

---

# B. Experiencia, operación y validación

## 24. Define las cinco tareas críticas del piloto

Escoge exactamente cinco tareas frecuentes o de mayor riesgo. Define inicio, éxito, error y retroceso. Así se podrá medir tiempo, claridad y abandono sin capturar RUT, nombres, notas o evidencias.

| Prioridad | Rol | Tarea | Inicio | Éxito medible | Error | Qué cuenta como retroceso |
|---:|---|---|---|---|---|---|
| 1 | Prevencionista de faena | Ejecutar actividad semanal y enviar checklist | Inicio de Prevención | Ejecución enviada o checklist en revisión | Registrar en otra faena | Abrir más de un módulo antes de la ejecución |
| 2 | Supervisor de faena | Resolver una acción correctiva asignada | Cola Atención requerida | Evidencia y avance registrados | Intentar cerrar sin evidencia | Salir de la acción antes de actualizarla |
| 3 | Jefa Prevención | Aprobar o devolver una ejecución | Cola Atención requerida | Decisión trazable y siguiente responsable visible | Aprobar sin evidencia requerida | Volver a buscar la ejecución en otra lista |
| 4 | Prevencionista de faena | Registrar/cerrar indicadores mensuales | Indicadores por faena | Mes guardado o cerrado según permiso | Corregir período cerrado sin permiso | Cambiar de módulo para encontrar el mes |
| 5 | Prevencionista de faena | Revisar PPA detenido y crear acción | PPA por revisar | PPA autorizado con acción asignada, o rechazado | Autorizar sin responsable/plazo | Cambiar entre PPA y acciones sin enlace |

**Ejemplo:** “Prevencionista abre ejecución semanal, adjunta evidencia y envía checklist. Éxito: checklist en revisión. Error: evidencia quedó en otra faena. Retroceso: entrar a tres módulos antes de abrir la actividad correcta.”

Tal cual el ejemplo.

## 25. ¿Qué debe aparecer en la cola Atención requerida del Inicio?

La cola no se construirá hasta tener fuentes y permisos reales. Prioriza los orígenes y define datos seguros.

| Origen | ¿Incluir? | Cuándo entra | Datos visibles | Acción/enlace | Roles autorizados |
|---|---|---|---|---|---|
| PDTP — ejecución/checklist | Sí | Pendiente, atrasada o por enviar | Faena, fecha, estado, actividad | Abrir ejecución | Roles con ejecución en la faena |
| PDTP — aprobación | Sí | Estado enviado | Faena, actividad, fecha y solicitante | Abrir aprobación | Jefatura con permiso |
| PDTP — acción | Sí | Vencida, pendiente o por verificar | Faena, responsable, prioridad, plazo | Abrir acción origen | Roles con alcance de faena |
| SST — evaluación | Sí | Borrador o cierre pendiente | Persona, faena, rol y avance | Abrir evaluación | Roles SST autorizados |
| PPA | Sí | Detenido, corrección o acción pendiente | Faena, antigüedad y decisión | Abrir PPA | Roles PPA autorizados |
| Documentación | Sí | Vencido, observado o revisión pendiente | Documento, faena, estado y fecha | Abrir documento | Roles documentales autorizados |

## 26. ¿Qué debe ocurrir al abrir una notificación de Prevención?

Define los casos de permiso perdido, faena fuera de alcance y registro archivado/eliminado.

**Respuesta:** Registro inexistente: volver a lista del módulo con aviso. Permiso perdido o faena fuera de alcance: mostrar acceso no autorizado sin título ni datos. Archivado: abrir solo si tiene permiso de auditoría; en otro caso, redirigir a lista con aviso. Si existe reemplazo vigente, ofrecerlo sin revelar el documento archivado.

**Ejemplo:** “Si ya no existe, llevar a la lista del módulo con aviso. Si perdió permiso, mostrar acceso no autorizado sin revelar título o persona. Si tiene reemplazo autorizado, ofrecer enlace.”

## 27. ¿Cuándo deben ser server-side las búsquedas?

Indica volumen actual/esperado, campos buscables, filtros y paginación. Esto evita cargar historiales completos en el navegador.

| Pantalla | Volumen actual | Volumen esperado | Campos de búsqueda | Filtros | ¿Paginación? |
|---|---:|---:|---|---|---|
| Evaluaciones SST | Hasta 50 | Más de 500 | Nombre, RUT y faena | Estado, rol, período | Sí, desde 100 |
| Historial por persona | Variable | Más de 100 por persona | Tipo, motivo y fecha | Visita, estado, rol | Sí, desde 50 |
| PDTP | Decenas por programa | Más de 500 ejecuciones | Actividad y responsable | Faena, hoja, estado, período | Sí, desde 100 |

## 28. ¿Qué condiciones de terreno son obligatorias?

Indica móvil mínimo, conectividad, cámara/adjuntos, uso de guantes y necesidad de offline. Esto afecta tamaños táctiles, formularios, carga de evidencia y pruebas.

**Respuesta:** Móvil mínimo 320 CSS px, conectividad intermitente, cámara para evidencia y uso ocasional con guantes. No se promete offline completo: formularios deben conservar borrador local y fallar con recuperación explícita si una carga no llega.

## 29. ¿Quién participa y aprueba el piloto?

| Decisión o prueba | Quién decide | Participantes | Fecha objetivo | Criterio de aprobación |
|---|---|---|---|---|
| D1 | Jefa Prevención | Prevencionista, Supervisor, Conductor líder | Antes del piloto | Flujo persona/PDTP sin tipos ambiguos |
| D2 | Jefa Prevención | Prevencionista, Supervisor, Conductor líder | Antes del piloto | Una visita no mezcla casos y cierra trazablemente |
| D3 | Jefa Prevención | Prevencionista y Supervisor | Antes del piloto | Cero/uno/varios programas comprensibles |
| D4 | Jefa Prevención | Prevencionista, Supervisor, Administración | Primer cierre mensual | Período cerrado bloquea edición no autorizada |
| D5 | Jefa Prevención | Prevencionista, Supervisor, responsable operativo | Primer ciclo de acciones | Acción tiene responsable, plazo y evidencia |
| D6 | Jefa Prevención | Prevencionista y Administración | Segundo ciclo | Vínculo mantiene versión y retiro auditado |
| Validación UX/WCAG | Responsable de producto | Un representante por rol | Piloto | Cinco tareas sin bloqueo crítico a 320 px |

## 30. ¿Qué restricciones de despliegue existen?

Indica ventana de cambio, faenas piloto, capacitación, comunicaciones, reversión y duración de observación. El plan propone dos ciclos de trabajo: confirma qué representa un ciclo real.

**Respuesta:** Ventana de cambio fuera del cierre mensual, piloto en una faena con Prevencionista, Supervisor y Jefatura. Capacitación breve dentro del módulo y comunicación antes del piloto. Reversión por feature flag o ruta anterior durante un ciclo mensual; observar dos ciclos de trabajo.

---

# C. Confirmación

- [x] D1 cerrada por decisión de producto documentada.
- [x] D2 cerrada por decisión de producto documentada.
- [x] D3 cerrada por decisión de producto documentada.
- [x] D4 calendarizada e implementada de forma incremental.
- [x] D5 calendarizada e implementada de forma incremental.
- [x] D6 calendarizada e implementada de forma incremental.
- [x] Cinco tareas críticas definidas.
- [x] Participantes y criterios del piloto definidos.
- [x] Autorizado por el usuario para transformar estas respuestas en decisiones, migraciones e implementación.

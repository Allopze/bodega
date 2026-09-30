# Auditoría de production readiness — Incidentes, CAPA y Daño material/ambiental

**Agente:** incidentes (prefijo INC-) · **Fecha:** 2026-09-29 · **HEAD:** `11e67621` (build de producción en :3100 y :3101)
**Entornos:** A (`bodega_audit_e2e`, :3100) y B (`bodega_audit_real_e2e`, :3101, programa 2026 v2 real, faena Horcones/Biodiversa).
**Evidencia:** scripts, JSON de salida y 85 capturas en `scratchpad/audit/incidentes/` (`flowA1…A9`, `flowB1…B5`, `probeA5/A7/A10/A11`, `tour-empty`, `shots/`). Sonda PGlite `incidentes-reinicio.audit-tmp.test.ts` copiada ahí y **borrada del repo**.

Notas de método:
- Ninguna base tenía incidentes ni CAPA al comenzar (SQL: 0 en ambas). Todo lo observado lo creé con datos `QA_INC…` / `QA_INC_B…`.
- En A el programa PDTP es de juguete (sin N°66–78): allí un incidente **no** abre obligaciones; la integración se ejecutó en B.
- **Datos que dejé en B** (faena Horcones, sem. 4 de septiembre): 3 incidentes (`inc-a6D2Vd9T…` cerrado, `inc-JSM9qxY3…` accidente abierto, `inc-sFhurBcl…` triado), sus obligaciones RE-20 y **3 aprobaciones PDTP** (N°66, N°72, N°76). Pueden mover levemente los números de cumplimiento de Horcones para otros agentes.
- En A: 7 incidentes, 21 reportes públicos (20 por la prueba de cuota), 2 CAPA; el servidor guardó un PNG de 70 bytes en `storage/capa-evidence/` (ignorado por git).

---

## AUDITORÍA — Incidentes y accidentes

**Rutas:** `/prevencion/incidentes` (bandeja + buzón público), `/prevencion/incidentes/[id]`, `/prevencion/incidentes/reportar`, `/reportar-incidente` (público), `GET /api/prevencion/incidentes/export`, `GET /api/prevencion/incidentes/[id]/expediente`.
**Archivos principales:** `lib/services/prevention-incidents.ts` (2052 l.), `prevention-incident-reports.ts`, `prevention-incident-export.ts`, `pdtp-adapters/incident-accreditation-connector.ts`, `app/(app)/prevencion/incidentes/**` (`actions.ts`, `incident-workflow-panel.tsx`, `re20-panel.tsx`, `reportar/*`), `app/(public)/reportar-incidente/*`.
**Permisos (manifiesto):** `incidents:view/report/triage/investigate/notify/diffuse/close/export/view_sensitive/authorize_restart/override_segregation`. `authorize_restart` sólo jefa_chome y administrador; `close` prevencionista, jefa, admin; `sign_own_work` (excepción a la firma propia) sólo prevencionista/admin (`modules/prevention/manifest.ts:1222`).

### A. UI/UX/Diseño
- Estructura correcta: `PageHeader` + `PageContainer`, acciones en el header (Reportar, Exportar Excel), 4 KPI clicables que filtran por URL, 3 filtros + chips, búsqueda del TopBar vía `DataTable`, tarjetas móviles. 0 errores de consola y 0 respuestas ≥400 en todo el recorrido (tour-empty.json, 10 roles × 4 rutas, 4 anchos para prev y prevfaena).
- **Detalle a 390 px se desborda 83 px** dentro del pozo: `[data-shell-scroll]` scrollWidth 473 vs 390; el relato y el panel RE-20 quedan cortados (captura `A-detail-390-viewport.png`) → **INC-10**.
- Terminología: enums crudos en inglés en el detalle — línea de tiempo «reported → triage», «status», «investigation», carriles «RESTART AUTHORIZATION», relación «employee»; vista reservada como JSON con claves en inglés (`[id]/page.tsx:140,145,156,149`). Jerga: «incidentes canónicos», «idempotencia al sincronizar», «RE-20 Versión 2».
- `<input type="date">` nativo en la clasificación DS 44 y en la fecha de autorización de reinicio (`incident-workflow-panel.tsx:275,276,325`) y en el canal público (`report-form.tsx:73`) (regla A6).
- En «Pendiente verificación» sólo aparece «Conclusión de cierre / Cerrar incidente»: la pantalla no dice qué hitos RE-20 faltan ni el estado de las obligaciones PDTP del caso (captura `B4-prev-pending-verification-1440.png`).
- El botón «Confirmar (Supervisor)» se muestra a quien marcó la difusión; el servidor lo rechaza con buen mensaje.
- **Estados observados:** sin información (bandeja vacía, con CTA), con información, operación exitosa (toasts), operación fallida (segregación, cierre bloqueado, validaciones), permisos insuficientes (`ti`, `legal` → /forbidden; `otrafaena` → «no encontrado»), sin conexión (banner offline). No observados: cargando (hay `loading.tsx`), sin resultados con filtros.

### Facilidad de uso
- **Reportar un cuasi accidente a 390 px (supervisor de terreno, desde /dashboard): 7 toques** — menú (1), «Reportar incidente» (2), empresa, lugar, relato (3), enviar (1). Tipo, faena, fecha y hora vienen prellenados. Fricción: «Empresa o empleador» se escribe siempre a mano (flowA1.json).
- Canal público a 390 px: faena + fecha + lugar + relato + enviar; folio `RPT-2026-…` como acuse (flowA6).
- Flujo completo (triage → medidas → investigación → CAPA → verificación → cierre): ~15 acciones repartidas entre 3–4 personas; el cierre puede hacerlo en 4 minutos una sola prevencionista gracias a `sign_own_work` (queda rotulado en el historial, flowB4).

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Reportar con sesión (faena en alcance, idempotencia `clientSubmissionId`) | ✅ | flowA1, flowA4, flowB1/B2 |
| Cola offline (página ya cargada) y sincronización con `queuedAt` | ✅ | flowA8 + SQL: `source=offline_sync`, `queuedAt` en historial |
| Abrir el reporte sin conexión | 🔴 | recarga offline → `ERR_INTERNET_DISCONNECTED`; `sw.js` sólo cubre `/ppa` (**INC-19**) |
| Canal público sin sesión (PRV-15), validación, anonimato, cuota por IP | ✅ | A y B 200 sin sesión; 20 envíos y el 21.º bloqueado con mensaje (probeA7) |
| Validación de fechas del canal público | 🟡 | acepta 2030 y 1990; el de 2030 no se puede convertir (**INC-12**) |
| Buzón: abrir incidente / descartar | ✅ / no ejecutado en UI (PGlite pasa) | flowA6 |
| Triage (una vez), carriles DIAT/DIEP/DT/SEREMI | ✅ | flowA2, flowB1 |
| Reclasificar tipo o anular un incidente duplicado/erróneo | ❌ | no existe (**INC-14**) |
| Investigación guiada, compuerta MIPER/procedimiento/capacitación | ✅ | flowA2, flowB4 |
| Evidencia del incidente | 🟡 | sólo texto «ID documental, URL o referencia»; no hay subida de archivo (**INC-15**) |
| DIAT/notificaciones con evidencia | 🟡 | «Registrar envío ahora» fija `sentAt` = ahora (**INC-13**) |
| Hitos RE-20: preliminar, declaración, ONE PAGE, seguimiento, difusión | 🟡 | se guardan pero declaración/ONE PAGE/seguimiento no se ven en ninguna parte (**INC-01**) |
| Difusión con doble persona | ✅ | «Quien marcó la difusión no puede confirmarla» |
| Clasificación DS 44 y ficha reservada con propósito | ✅ | flowA4 (vista reservada auditada) |
| Autorización de reinicio segregada | 🟡 | se salta si quien completó la investigación no figura en el equipo (**INC-09**) |
| Cierre con compuertas | 🟡 | ignora los hitos RE-20 (**INC-04**) y queda bloqueado para siempre con una CAPA cancelada (**INC-05**) |
| Exportación del registro y expediente Excel (fórmulas neutralizadas) | ✅ / 🟡 | `'=HYPERLINK…` guardado como texto (probeA7); el expediente omite los hitos RE-20 (**INC-01**) |

### C. Código y lógica
- Conector RE-20 bien documentado, idempotente y con barrido horario de reparación (`incident-accreditation-connector.ts:531-658`).
- Tres tablas **sólo de escritura**: `prevention_incident_statements`, `prevention_incident_diffusion` (ONE PAGE) y `prevention_incident_followups`. Fuera del conector nadie las lee (grep sobre `app/` y `lib/`). Los seis hitos RE-20 tampoco escriben `appendHistory` (`prevention-incidents.ts:1807-1946`).
- `onIncidentReported` y la reconciliación posterior al triage fijan el origen de las obligaciones en `createdAt`, no en `occurredAt`/`knownAt` (`prevention-incidents.ts:693,1214`) → **INC-03**.
- `onIncidentFollowupRecorded` no pasa `actorUserId` (`incident-accreditation-connector.ts:386-395`) → **INC-07**.
- La segregación del reinicio arma el conjunto de conflicto con `investigation.team` (que llega del cliente) y los actores de la CAPA, sin `completedByUserId`/`startedByUserId` (`prevention-incidents.ts:1636-1639`) → **INC-09**.
- Mensajes de éxito fijos «…y acreditado en PDTP» (`actions.ts:184,202,220,237,269`), aunque la acreditación es *best-effort* y deja la ejecución `submitted` → **INC-11**.
- `listPreventionIncidents` corta en 500 sin paginar ni avisar (`prevention-incidents.ts:906`).

### D. Modelo de datos
- Estados `reported → … → closed` sin `cancelled`/`voided`; el tipo de evento no cambia después del reporte (`triageSchema` no lo trae, `prevention-incidents.ts:167-179`).
- Personas minimizadas más *payload* sensible cifrado por persona; entrevistas cifradas. La declaración de la persona accidentada (`statement_text`) se guarda en claro.
- El expediente cerrado es inmutable (`findIncidentForMutation`, `getInvestigableIncident` con `FOR UPDATE`): correcto. El efecto es que los hitos RE-20 pendientes ya no se pueden registrar (**INC-04**).

### E. Permisos y seguridad
- IDOR entre faenas (flowA4, probeA5): con `otrafaena`, el detalle de un incidente de ws-e2e muestra la página «no encontrado» sin filtrar datos. Su registro Excel y su export CAPA salen sólo con cabeceras. El expediente responde 404.
- Datos sensibles: `prevfaena` (sin `view_sensitive`) recibe «no encontrado» en `?sensitive=1&purpose=…` y 404 en `expediente?includeSensitive=1`. `prev` y `admin` obtienen la hoja «Datos reservados» con propósito, y el acceso queda auditado.
- `ti`: /forbidden en páginas, 403/404 en APIs. `sup` y `cphs` no exportan (403). Anónimo → 307 a login.
- XSS almacenado vía canal público: `<img onerror>`, `<script>` y `<b id>` en relato y lugar, vistos por prev en el buzón y en el detalle del incidente convertido: no se ejecutan ni se inyectan (`window.__xss` null, 0 nodos).
- Excel: `sanitizeCell` antepone `'` a las fórmulas.
- La cuota del canal público se lleva por IP de Cloudflare (`resolveTrustedClientIp`). En local, todos comparten el cubo `unresolved`; en producción, detrás del túnel de Cloudflare, rige la IP real.

### F. Testing
- `vitest.non-pglite`: 17 archivos / **80 PASS** (servicio, acciones, panel, formulario offline, rutas expediente/export CAPA/evidencia, public-paths).
- `vitest.pglite`: 7 archivos / **64 PASS** (re20, workflow-gaps, public-reports, capa-list/manual/evidencia, cola duplicada).
- Postgres, de a una: `prevention-incidents-postgres` **4 PASS**, `prevention-capa-postgres` **4 PASS**, `prevention-incidents-concurrency-postgres` **1 PASS**; ninguna omitida.
- E2E (leídos, no corridos):
  - `prevencion-incidentes-re20.spec.ts` sólo reporta, abre el detalle y exporta; no cubre triage, investigación, cierre ni hitos RE-20.
  - `prevencion-production-readiness.spec.ts` (PRV-15) sólo comprueba que la página abre, no envía.
  - Ningún E2E cubre el efecto en el PDTP (**INC-20**).

### G. Integración con el Programa Anual (ejecutado en B, programa 2026 v2)
Resultado observado (SQL tras cada paso, flowB1–B5):

| Paso | Qué pasó |
|---|---|
| Reporte de daño material sin lesión (ocurrió 06:00, conocido 06:30, registrado 18:46) | Se crean la N°66 y la N°67, **reportadas en el mismo instante**. Su plazo corre desde `createdAt` (18:46, vence 22:46): cuentan **a tiempo** aunque el aviso llegó 12 h tarde (**INC-03**). Ejecuciones `submitted`, `evidence_status=provided` con el texto sintético «Aviso de incidente registrado: inc-…» (**INC-02**). |
| Triage que lo agrava (Menor) | **M-23 corregido:** en la misma petición se abren la N°68–71, 73–75, 77 y 78 (no la 72: sin DIAT). |
| Accidente del trabajo con persona | Se abren 66–78 salvo la 76, incluida la N°72. |
| DIAT registrada por prev | N°72 `reported`, ejecución `submitted` con `executed_by=prev`. prev intenta aprobarla → «Quien registró el cumplimiento no puede aprobarlo» ✅. prev2 la aprueba **con un clic, sin motivo**, porque la evidencia figura como `provided`. El folio real no se ve en Aprobaciones, sólo «Automático: DIAT RE-20-07 emitida» (**INC-02**). |
| Informe preliminar | N°68 y N°70 reportadas por el mismo hecho. |
| Seguimiento quincenal (N°76) | Acredita por evento directo: ejecución `submitted`, `executed_by=NULL`, `evidence_status=pending`. **prev, que registró el seguimiento, la aprueba él mismo** con un motivo (**INC-07**). La N°76 es `closed_on_time` sin obligaciones, así que esa aprobación no mueve el indicador (**INC-08**). |
| Bajar la gravedad en el triage (Menor → Sin lesión) | Las 9 obligaciones pendientes quedan `cancelled` con motivo «Reclasificado en el triage…», firmadas por quien tría, sin segunda persona. Las ya reportadas (66/67) no se tocan. |
| Cerrar el incidente sin preliminar, declaración, difusiones ni ONE PAGE | El cierre pasa (prev con `sign_own_work`, rotulado). Quedan **6 obligaciones pendientes** (68, 69, 70, 71, 75, 78) sin vía para cumplirlas desde el incidente, porque el panel RE-20 queda deshabilitado (**INC-04**). La N°77 queda reportada y exige a otra persona. |
| Doble vía | En `/prevencion/pdtp/obligaciones` cada obligación RE-20 ofrece «Reportar trabajo» (texto libre aceptado para integraciones, `obligations.ts:279`) y «Cancelar». El «Origen: incident · inc-…» no enlaza al incidente. |

### H. Hallazgos

```
ID: INC-01
Severidad: 🟠 CRÍTICO
Submódulo: Incidentes y accidentes
Categoría: Integridad / Trazabilidad / Integración PDTP
Título: La declaración (N°69), el ONE PAGE (N°78) y los seguimientos (N°76) no se pueden consultar: el expediente, el historial y el PDTP sólo guardan que "se hizo"
Archivo(s): lib/services/prevention-incidents.ts; lib/services/prevention-incident-export.ts; app/(app)/prevencion/incidentes/[id]/page.tsx
Línea(s): prevention-incidents.ts:1848-1946 (insert sin appendHistory); prevention-incident-export.ts:199-235 (hojas del expediente sin esos hitos); [id]/page.tsx:125-132 (sólo pasa preliminar y difusiones)
Pantalla/ruta: /prevencion/incidentes/[id]; /api/prevencion/incidentes/[id]/expediente; archivo Cloudreve del cierre
Endpoint: recordIncidentStatementAction, publishOnePageDiffusionAction, recordBiweeklyFollowupAction
Rol: prevencionista, jefe de terreno, supervisor, fiscalizador (lectura)
Descripción: las tres tablas son de sólo escritura (fuera del conector nadie las lee). No aparecen en el detalle, ni en la línea de tiempo, ni en el expediente Excel, ni en el archivo que el cierre sube a Cloudreve (buildIncidentCaseArchive). Tampoco figuran el informe preliminar ni las difusiones. La ejecución PDTP sólo lleva un texto sintético ("Declaración/Entrevista RE-20 firmada: inc-…").
Evidencia: DEMOSTRADO (flowA2 + probeA5): declaración "QA_INC_DECLARACION_UNICA", ONE PAGE y seguimiento registrados con toast "…acreditado en PDTP"; tras recargar, declaracion/onePage/seguimiento=false en la página; en el expediente Excel del caso, contiene QA_INC_DECLARACION_UNICA=false, QA_INC_ONEPAGE=false, QA_INC_SEGUIMIENTO=false, "Informe preliminar"=false; historial sin entradas de esos hitos.
Cómo reproducir:
1. En un incidente abierto, registrar una declaración, un ONE PAGE y un seguimiento en el panel RE-20.
2. Recargar la página y descargar "Expediente Excel".
3. Buscar esos textos.
Resultado actual: no aparecen en ninguna vista ni exportación; sólo hay rastro en tablas internas.
Resultado esperado: cada hito listado en el panel (quién, cuándo, contenido), en la línea de tiempo y en el expediente; la ejecución PDTP enlaza al hito.
Impacto: el programa acredita N°68–78 con evidencia que ni el aprobador ni un fiscalizador pueden ver; el expediente "cerrado" que se archiva está incompleto.
Causa probable: el módulo RE-20 se agregó como formularios que acreditan, sin la capa de lectura.
Solución recomendada: listar declaraciones, ONE PAGE, seguimientos y difusiones en el panel; appendHistory en los seis hitos; agregar las hojas al expediente/archivo; enlazar la ejecución PDTP al hito (returnHref).
Esfuerzo: Medio
Bloquea producción: No (condición mínima)
Clasificación: A obligatorio antes de producción
```

```
ID: INC-02
Severidad: 🟠 CRÍTICO
Submódulo: Incidentes y accidentes (integración RE-20)
Categoría: Integración PDTP / Evidencia
Título: Las ejecuciones RE-20 quedan con evidencia "provided" por un texto que genera el sistema, y se aprueban sin motivo (PRV-01 sigue abierto en la vía de obligaciones)
Archivo(s): lib/services/pdtp/obligations.ts; lib/services/pdtp-adapters/incident-accreditation-connector.ts; lib/services/pdtp/executions.ts
Línea(s): obligations.ts:271 (hasEvidence = texto) y 326/341 (evidenceStatus "provided"); incident-accreditation-connector.ts:251,334,343,351,360,369,377,410,418 (evidenceText sintético); executions.ts:771-773 (sólo pide motivo si evidenceStatus ≠ provided)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: aprobadores PDTP
Descripción: para una obligación de integración, cualquier evidenceText marca la ejecución como "provided". Como el conector siempre manda un texto fijo, las 12 actividades RE-20 llegan con "evidencia entregada" sin archivo ni dato verificable, y la aprobación no exige indicar qué se revisó (la corrección PRV-01/PRV-02 sólo cubrió accreditPdtpFromEvent).
Evidencia: DEMOSTRADO en B (flowB1/B2/B3): N°66/67/68/70/72 con evidence_status=provided y evidence_text "Aviso de incidente registrado: inc-…"/"DIAT RE-20-07 emitida: inc-…"; prev2 aprobó N°72 con un clic (usedReason=false, approvalReason vacío en source_metadata_json); la fila en Aprobaciones muestra "Automático: DIAT RE-20-07 emitida", no el folio "QA_INC_B folio DIAT 998877".
Cómo reproducir:
1. En B, reportar un accidente del trabajo en Horcones y registrar la DIAT con un folio.
2. Con otra persona, ir a /prevencion/pdtp/aprobaciones, fila N°72.
3. Aprobar: no pide motivo ni muestra el folio.
Resultado actual: cumplimiento aprobado sobre un texto que no dice nada verificable.
Resultado esperado: el texto sintético no cuenta como evidencia; la ejecución trae la referencia real (folio, archivo o enlace al hito) y, si no hay archivo, se exige el motivo como en las demás integraciones.
Impacto: el programa afirma "evidencia entregada" en N°66–78 sin evidencia real; misma clase de riesgo que PRV-01.
Causa probable: el cálculo de evidenceStatus en reportPdtpObligation no distingue origen integración de texto humano.
Solución recomendada: para origin=integration, evidenceStatus "provided" sólo con archivo verificado; pasar desde el conector la referencia real (evidenceReference de la notificación, id del hito); prueba PGlite de regresión.
Esfuerzo: Bajo–Medio
Bloquea producción: No (condición mínima)
Clasificación: A obligatorio antes de producción
```

```
ID: INC-03
Severidad: 🟠 CRÍTICO
Submódulo: Incidentes y accidentes (integración RE-20)
Categoría: Integración PDTP / Lógica de cumplimiento
Título: Los plazos RE-20 se cuentan desde que se registró el incidente en el sistema, no desde que ocurrió: la N°66/67 ("informar inmediatamente") siempre sale a tiempo
Archivo(s): lib/services/prevention-incidents.ts; lib/services/pdtp-adapters/incident-accreditation-connector.ts; lib/services/pdtp/obligations.ts
Línea(s): prevention-incidents.ts:690-699 (reportedAt: createdAt) y 1211-1220 (occurredAt: updated.createdAt); incident-accreditation-connector.ts:117-145, 247-252, 612; obligations.ts:114,188 (dueAt = sourceOccurredAt + plazo)
Pantalla/ruta: /prevencion/pdtp/obligaciones; indicador closed_on_time
Endpoint: reportPreventionIncidentAction, triagePreventionIncidentAction
Rol: todos (lectura del cumplimiento)
Descripción: sourceOccurredAt de las 12 obligaciones es incident.createdAt. La N°66/67 se crea y se reporta en el mismo instante, así que su plazo de 4 h nunca vence. La N°68/70 (3 h), la 69 (24 h), etc. corren desde el registro, y un reporte tardío o sincronizado offline días después corre el plazo entero.
Evidencia: DEMOSTRADO en B (flowB1): ocurrencia 06:00, conocimiento 06:30, registro 18:46 → N°66/67 source_occurred_at 18:46, due 22:46, reported 18:46 (a tiempo); N°68/70 vencen 21:46 en vez de 09:00. CÓDIGO: mismo efecto para la sincronización offline (createdAt = hora de sincronizar).
Cómo reproducir:
1. En B, reportar un incidente con hora de ocurrencia 12 h atrás.
2. SQL: select n, source_occurred_at, due_at, reported_at from pdtp_obligations … where source_id=<id>.
3. La N°66/67 figura cerrada a tiempo.
Resultado actual: el indicador de plazo RE-20 no puede detectar un aviso tardío y desplaza todos los plazos.
Resultado esperado: sourceOccurredAt = knownAt (u occurredAt, según la regla del RE-20); N°66/67 reportadas con la hora del registro, contrastada contra ese plazo.
Impacto: cumplimiento "a tiempo" falso en las actividades cuyo propósito es justamente el plazo.
Causa probable: se reutilizó la hora de creación como hora del hecho.
Solución recomendada: pasar incident.knownAt al conector (reporte, triage y barrido) y una prueba con reporte tardío.
Esfuerzo: Bajo
Bloquea producción: No (condición mínima)
Clasificación: A obligatorio antes de producción
```

```
ID: INC-05
Severidad: 🟠 CRÍTICO
Submódulo: Incidentes y accidentes / CAPA
Categoría: Funcionalidad / Flujo roto
Título: Un incidente con una CAPA cancelada no puede cerrarse nunca
Archivo(s): lib/services/prevention-incidents.ts; lib/services/prevention-capa.ts
Línea(s): prevention-incidents.ts:1262-1266 y 1270 (exige closed/verified; cancelled bloquea); prevention-capa.ts:229 (cancelled: [] sin salida)
Pantalla/ruta: /prevencion/incidentes/[id] → "Cerrar incidente"
Endpoint: transitionPreventionIncidentAction
Rol: jefa_chome, prevencionista
Descripción: cancelar una CAPA duplicada o mal creada es terminal, pero las compuertas del incidente la tratan como abierta. No se puede borrar ni desvincular la CAPA, así que el expediente queda atascado y la N°77 no se cumple.
Evidencia: DEMOSTRADO en A (flowA3): CAPA1 cerrada y CAPA2 cancelada con motivo → jefa "Cerrar incidente" → "Todas las acciones CAPA deben estar cerradas."
Cómo reproducir:
1. En un incidente, crear dos CAPA y cancelar una (motivo ≥5).
2. Cerrar la otra con el ciclo completo.
3. Avanzar el incidente a verificación e intentar cerrarlo.
Resultado actual: bloqueo permanente.
Resultado esperado: una CAPA cancelada con motivo no bloquea (o se exige al menos una cerrada si la clasificación la pide).
Impacto: expediente imposible de cerrar; obligación N°77 vencida para siempre.
Causa probable: la regla compara status !== "closed".
Solución recomendada: excluir "cancelled" de las compuertas de pending_verification, cierre y reinicio, y agregar una prueba.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: A obligatorio antes de producción
```

```
ID: INC-04
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes y accidentes
Categoría: Funcionalidad / Integración PDTP
Título: El cierre no exige ni muestra los hitos RE-20 y deja sus obligaciones pendientes sin vía de cumplimiento
Archivo(s): lib/services/prevention-incidents.ts; app/(app)/prevencion/incidentes/page.tsx (detalle)
Línea(s): prevention-incidents.ts:1268-1296 (compuertas: investigación, CAPA, carriles); 1794-1804 (tras el cierre no se registran hitos); [id]/page.tsx:129-130 (panel deshabilitado)
Pantalla/ruta: /prevencion/incidentes/[id]
Endpoint: transitionPreventionIncidentAction
Rol: prevencionista, jefa
Descripción: se puede cerrar sin preliminar, declaración, difusiones ni ONE PAGE; la pantalla no advierte qué falta ni el estado de las obligaciones del caso.
Evidencia: DEMOSTRADO en B (flowB4): tras cerrar, 68/69/70/71/75/78 = pending; botón del panel RE-20 no visible, textarea deshabilitada.
Cómo reproducir: 1. Reportar y triar un incidente en B. 2. Completar investigación y avanzar hasta verificación. 3. Cerrar: las obligaciones quedan pendientes y luego vencidas.
Resultado actual: expediente cerrado incompleto y obligaciones huérfanas (o cumplidas a mano en /pdtp/obligaciones sin pasar por el expediente).
Resultado esperado: el cierre muestra y exige cada hito aplicable (o su "no aplica" fundamentado), o deja registrar los hitos pendientes.
Impacto: cumplimiento RE-20 subdeclarado o doble registro.
Causa probable: las compuertas son anteriores al panel RE-20.
Solución recomendada: lista de verificación de cierre con los hitos y sus obligaciones; compuerta configurable.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INC-07
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (N°76)
Categoría: Permisos / Segregación
Título: Quien registra el seguimiento quincenal aprueba su propia ejecución N°76 (PRV-02 parcial)
Archivo(s): lib/services/pdtp-adapters/incident-accreditation-connector.ts
Línea(s): 386-395 (recordPdtpFulfillmentEvent sin actorUserId)
Pantalla/ruta: /prevencion/pdtp/aprobaciones
Endpoint: approvePdtpExecutionAction
Rol: prevencionista
Descripción: la ejecución nace con executed_by NULL, así que la comparación de executions.ts:579 no bloquea.
Evidencia: DEMOSTRADO en B (flowB3b): N°76 executed_by=NULL → prev (autor del seguimiento) la aprueba con motivo → approved_by=qa-prev.
Cómo reproducir: 1. Registrar un seguimiento en el panel RE-20. 2. Con el mismo usuario, aprobar la N°76 en Aprobaciones.
Resultado actual: autoaprobación.
Resultado esperado: rechazo por segregación.
Impacto: fisura en la segregación de la vía de integración.
Causa probable: el conector N°76 no pasa el actor.
Solución recomendada: pasar actorUserId (y el usuario al hook); prueba de regresión.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-08
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (N°76)
Categoría: Integración PDTP
Título: La N°76 es closed_on_time pero acredita por ejecución directa: sus seguimientos aprobados no cuentan en el indicador
Archivo(s): lib/services/pdtp-adapters/incident-accreditation-connector.ts; lib/services/pdtp/compliance.ts
Línea(s): connector:20-27, 386-395; compliance.ts:137-200 y 1424-1425 (closed_on_time sólo cuenta obligaciones)
Pantalla/ruta: /prevencion/pdtp (indicadores)
Endpoint: —
Rol: todos
Descripción: la actividad N°76 del programa 2026 está en modo closed_on_time (SQL en B: indicator_mode=closed_on_time, due_days=15) y no tiene obligaciones; la ejecución aprobada queda fuera del cálculo. El mapa docs/prevencion/MAPA… la da por "Confirmado, directo".
Evidencia: SQL (B) + CÓDIGO; ejecución N°76 aprobada en flowB3b sin obligación asociada.
Cómo reproducir: 1. Aprobar una N°76. 2. Revisar el indicador de la actividad: sin casos.
Resultado actual: seguimiento no medido.
Resultado esperado: o bien obligación por quincena, o bien indicador completed_count para la N°76.
Impacto: una actividad del programa nunca refleja avance.
Causa probable: límite conocido documentado en el conector, sin ajustar el modo del indicador.
Solución recomendada: decidir el modelo (obligación por seguimiento o modo de conteo) y alinear el catálogo.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INC-09
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (reinicio)
Categoría: Permisos / Segregación
Título: Quien completó la investigación puede autorizar el reinicio si no figura en el "equipo" (que además llega del cliente)
Archivo(s): lib/services/prevention-incidents.ts
Línea(s): 1636-1639 (conflicted = team + actores CAPA); 185 y 1421 (team del input); 1442 (completedByUserId)
Pantalla/ruta: /prevencion/incidentes/[id] → "Autorizar reinicio"
Endpoint: authorizePreventionIncidentRestartAction
Rol: jefa_chome, administrador
Descripción: el conjunto de conflicto no incluye startedByUserId/completedByUserId. El formulario conserva el equipo del primer guardado, así que quien completa después queda fuera.
Evidencia: DEMOSTRADO (sonda PGlite incidentes-reinicio.audit-tmp.test.ts, PASS): P1 inicia la investigación (team=[P1]), J la completa (completedByUserId=J), CAPA implementada por P3 y verificada por P2, carriles DT/SEREMI/DIAT con evidencia → J autoriza el reinicio: ok, segregationOverride=null, actor=J.
Cómo reproducir: el de la sonda (copiada en scratchpad/audit/incidentes/).
Resultado actual: reinicio autorizado por quien cerró la investigación, sin excepción registrada.
Resultado esperado: rechazo o excepción fundamentada con override_segregation.
Impacto: la reanudación de una faena tras un accidente grave puede quedar firmada por quien investigó.
Causa probable: el conjunto de conflicto se tomó del equipo declarado.
Solución recomendada: sumar startedBy/completedBy (y quien tría) al conjunto; no confiar en el team del cliente.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-10
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes
Categoría: UI/UX (móvil)
Título: El detalle del incidente se desborda 83 px a 390 px
Archivo(s): app/(app)/prevencion/incidentes/[id]/re20-panel.tsx
Línea(s): 194-245 (fila de 5 pestañas sin wrap)
Pantalla/ruta: /prevencion/incidentes/[id] a 390 px
Endpoint: —
Rol: supervisor/prevencionista en terreno
Descripción: la columna principal se ensancha a 473 px y el relato, la cabecera RE-20 y los botones quedan cortados a la derecha.
Evidencia: DEMOSTRADO (check390.mjs): [data-shell-scroll] sw=473 cw=390; captura A-detail-390-viewport.png.
Cómo reproducir: abrir cualquier incidente con un teléfono de 390 px.
Resultado actual: contenido recortado; hay que desplazar lateralmente dentro de la página.
Resultado esperado: sin desborde (tabs con wrap o scroll propio).
Impacto: el flujo que se usa en terreno queda incómodo o ilegible.
Causa probable: flex sin wrap ni min-w-0.
Solución recomendada: `flex-wrap`/`overflow-x-auto` en la barra de pestañas y `min-w-0` en la columna; usar el componente Tabs del sistema.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-11
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes
Categoría: UI/UX / Manejo de errores
Título: "Registrado y acreditado en PDTP" aunque no se acreditó nada o sólo quedó pendiente de aprobación
Archivo(s): app/(app)/prevencion/incidentes/actions.ts; app/(app)/prevencion/incidentes/[id]/re20-panel.tsx
Línea(s): actions.ts:184,202,220,237,269; re20-panel.tsx:175,269,322,364,395
Pantalla/ruta: /prevencion/incidentes/[id]
Endpoint: acciones RE-20
Rol: investigadores
Descripción: el conector es best-effort y la ejecución queda submitted; si el programa no tiene la actividad o la faena no es miembro, no ocurre nada, y el mensaje igual lo afirma.
Evidencia: DEMOSTRADO: en A (programa sin N°66–78) cuatro toasts "…acreditado en PDTP" con 0 obligaciones y 0 ejecuciones (SQL; 1 evento rejected); en B la ejecución queda submitted.
Cómo reproducir: registrar un preliminar en A y consultar pdtp_obligations/pdtp_executions.
Resultado actual: feedback falso.
Resultado esperado: "Registrado; enviado al PDTP para aprobación" o el motivo por el que no aplica.
Impacto: el usuario cree cumplido algo que no lo está.
Causa probable: mensajes fijos.
Solución recomendada: que el conector devuelva el resultado y el mensaje lo refleje.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-12
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (canal público)
Categoría: Validaciones
Título: El canal público acepta fechas futuras o absurdas; el reporte con fecha futura no se puede convertir en incidente
Archivo(s): lib/services/prevention-incident-reports.ts; app/(public)/reportar-incidente/report-form.tsx
Línea(s): prevention-incident-reports.ts:50 (sólo regex); report-form.tsx:73 (date nativo sin max)
Pantalla/ruta: /reportar-incidente → buzón → "Abrir incidente"
Endpoint: submitPublicIncidentReportAction, convertPublicIncidentReportAction
Rol: trabajador anónimo; prevencionista que tría
Descripción: 2030-01-01 y 1990-01-01 aceptados; al convertir el de 2030 → "La hora de conocimiento no puede ser anterior a la ocurrencia"; sólo queda descartarlo.
Evidencia: DEMOSTRADO (flowA6).
Cómo reproducir: 1. Enviar un reporte con fecha 2030. 2. Como prev, "Abrir incidente".
Resultado actual: callejón sin salida para un reporte real mal fechado.
Resultado esperado: rechazar fechas futuras o de más de N meses; en el triage, poder corregir la fecha.
Impacto: pérdida o descarte de reportes del trabajador.
Causa probable: validación mínima.
Solución recomendada: refine no-futuro/rango en zod y `max` en el input; fecha editable al convertir.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-13
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (denuncias)
Categoría: Integridad de datos
Título: La DIAT/DIEP/notificación se registra siempre con la hora actual; no se puede declarar la hora real de envío (y el servicio acepta horas futuras)
Archivo(s): app/(app)/prevencion/incidentes/[id]/incident-workflow-panel.tsx; lib/services/prevention-incidents.ts
Línea(s): incident-workflow-panel.tsx:291 (sentAt: new Date().toISOString()); prevention-incidents.ts:207 (sin tope futuro), 1573 (wasLate)
Pantalla/ruta: /prevencion/incidentes/[id] → "Registrar envío ahora"
Endpoint: recordPreventionIncidentNotificationAction
Rol: notify
Descripción: una DIAT enviada a tiempo y registrada después queda "fuera de plazo" y escalada; la N°72 se reporta con esa hora.
Evidencia: CÓDIGO.
Cómo reproducir: registrar hoy una DIAT enviada ayer: queda con sentAt=hoy.
Resultado actual: hora de envío falseada por la interfaz.
Resultado esperado: campo fecha/hora de envío (DatePicker), no futuro, con valor por defecto ahora.
Impacto: plazo legal y N°72 mal medidos.
Causa probable: simplificación del formulario.
Solución recomendada: pedir sentAt y validar ≤ ahora.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-14
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes
Categoría: Funcionalidad / Integridad
Título: No existe anulación ni reclasificación de tipo: un reporte duplicado o mal tipificado queda para siempre con sus obligaciones
Archivo(s): lib/services/prevention-incidents.ts
Línea(s): 72-80 (sin estado cancelado), 167-179 (triage sin eventType), 1132 (triage una sola vez), 366-377 (transiciones)
Pantalla/ruta: /prevencion/incidentes/[id]
Endpoint: —
Rol: prevencionista
Descripción: el tipo (que decide la DIAT y la N°72) no cambia tras reportar; la gravedad sólo en un triage único. Un duplicado sólo sale "cerrándolo" con investigación completa. Las obligaciones se cancelan a mano en el PDTP (con revisión).
Evidencia: CÓDIGO; en B no hubo forma de anular inc-sFhurBcl… (sólo se pudo triar).
Cómo reproducir: reportar dos veces el mismo evento.
Resultado actual: dos expedientes vivos, dos juegos de obligaciones RE-20, doble conteo en daño material/ambiental.
Resultado esperado: anulación con motivo y segunda persona, que cancele las obligaciones pendientes y revoque las cumplidas.
Impacto: denominador e indicadores inflados; doble conteo en el tablero.
Causa probable: modelo lineal sin baja lógica.
Solución recomendada: estado "anulado" auditado más reclasificación de tipo con reconciliación RE-20.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INC-15
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes
Categoría: Funcionalidad / Evidencia
Título: El incidente no admite archivos: evidencia, DIAT y resolución de reinicio son texto libre (≥3 caracteres)
Archivo(s): lib/services/prevention-incidents.ts; incident-workflow-panel.tsx
Línea(s): prevention-incidents.ts:297-307, 203-212, 346-359; 1276 (compuerta "requiere evidencia" satisfecha por cualquier texto); incident-workflow-panel.tsx:234, 292, 332
Pantalla/ruta: /prevencion/incidentes/[id]
Endpoint: addPreventionIncidentEvidenceAction, recordPreventionIncidentNotificationAction
Rol: investigadores
Descripción: no hay subida de fotos ni documentos (a diferencia de CAPA); la compuerta de cierre "las denuncias requieren evidencia" se cumple con "abc".
Evidencia: CÓDIGO; UI (flowB2: folio escrito a mano).
Cómo reproducir: registrar la DIAT con evidencia "abc" y cerrar.
Resultado actual: evidencia no verificable en el expediente legal.
Resultado esperado: subida con validación de MIME y sha256 (reutilizar storePreventionEvidence), o referencia a la biblioteca documental.
Impacto: expediente sin respaldo documental verificable.
Causa probable: diseño anterior al contrato de evidencia.
Solución recomendada: dominio "incident" en prevention-evidence-upload.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INC-19
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes (reporte offline)
Categoría: Funcionalidad (terreno)
Título: El formulario de reporte no abre sin conexión: la cola offline sólo sirve si la página ya estaba cargada
Archivo(s): public/sw.js
Línea(s): 13-14 (SHELL_URLS ["/ppa"]), 97-110 (sólo navega offline /ppa)
Pantalla/ruta: /prevencion/incidentes/reportar
Endpoint: —
Rol: supervisor/prevencionista en faena
Descripción: la página promete "cola offline"; si el teléfono ya está sin señal al abrirla, no carga.
Evidencia: DEMOSTRADO (flowA8): envío offline encolado y sincronizado ✅; recarga sin conexión → net::ERR_INTERNET_DISCONNECTED; ningún SW registrado en la ruta.
Cómo reproducir: sin conexión, abrir /prevencion/incidentes/reportar.
Resultado actual: error del navegador.
Resultado esperado: shell offline de la ruta.
Impacto: el caso de uso principal en faena sin señal no se cubre.
Causa probable: el SW se escribió para PPA.
Solución recomendada: agregar la ruta al SW con network-first y fallback.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

```
ID: INC-20
Severidad: 🟡 IMPORTANTE
Submódulo: Incidentes / CAPA
Categoría: Testing
Título: Los E2E no cubren el flujo RE-20 ni el ciclo CAPA; el de CAPA es condicional y vacío
Archivo(s): e2e/prevencion-incidentes-re20.spec.ts; e2e/prevencion-capa-lifecycle.spec.ts; e2e/prevencion-production-readiness.spec.ts
Línea(s): re20.spec:21-86 (reporte, detalle y export); capa-lifecycle.spec:30-59 (`if count > 0` y selectores inexistentes: "Seguimiento y avance", input[name=reference]); readiness.spec:50-55 (PRV-15 sólo abre)
Pantalla/ruta: —
Endpoint: —
Rol: —
Descripción: en una base sin CAPA el test pasa sin hacer nada; aun con datos, sus selectores no calzan con la UI actual. Ningún E2E recorre triage→cierre, obligaciones PDTP ni un envío público.
Evidencia: CÓDIGO (lectura).
Cómo reproducir: leer los specs.
Resultado actual: verde sin verificar.
Resultado esperado: E2E determinista de reporte→triage→obligaciones→cierre y CAPA crear→implementar→verificar (otra persona)→cerrar.
Impacto: regresiones como INC-05 no se detectan.
Causa probable: specs heredados.
Solución recomendada: reescribir los dos specs con datos sembrados.
Esfuerzo: Medio
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **62/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16 | INC-04 −2,5 · INC-05 −2 · INC-14 −1 · INC-15 −1,5 · INC-13 −1 · INC-12 −0,5 · INC-19 −0,5 |
| UI/UX y facilidad de uso | 20 | 12 | INC-10 −2 · INC-11 −1 · INC-01 −1,5 · INC-04 (sin checklist) −1 · INC-M01 −1,5 · INC-M02/M03/M04/M20 −1 |
| Integridad de datos | 15 | 9,5 | INC-01 −3 · INC-13 −1 · INC-14 −1 · INC-M09 −0,5 |
| Integración con Programa Anual | 15 | 5 | INC-02 −3 · INC-03 −3 · INC-04 −1,5 · INC-07 −1 · INC-08 −1 · INC-M14 −0,5 |
| Código y mantenibilidad | 10 | 8 | INC-01 (tablas de sólo escritura) −1,5 · INC-M11 −0,5 |
| Permisos y seguridad | 5 | 4 | INC-09 −1 |
| Testing | 5 | 3,5 | INC-20 −1,5 |
| Manejo de errores | 5 | 4 | INC-11 −1 |
| **Total** | 100 | **62** | No listo para producción: el módulo operativo es sólido y seguro, pero su aporte al programa (N°66–78) no es confiable. |

---

## AUDITORÍA — Acciones correctivas (CAPA)

**Rutas:** `/prevencion/capa`, `/prevencion/capa/[id]`, `GET /api/prevencion/capa/export`, `POST /api/prevencion/capa/evidence`.
**Archivos:** `lib/services/prevention-capa.ts` (1318 l.), `app/(app)/prevencion/capa/**` (`actions.ts`, `capa-list.tsx`, `manual-capa-dialog.tsx`, `[id]/capa-controls.tsx`), `lib/services/pdtp/capa-view.ts` (Medidas del PDTP = CAPA `source_type=pdtp`).
**Permisos:** `capa:view/manage/complete/verify/close/override_segregation/reconcile`; `close` sólo jefa_chome y administrador; sup, jt y cphs sin acceso (/forbidden, verificado).

### A. UI/UX/Diseño
- `PageHeader` con Exportar y «Nueva acción»; 4 KPI clicables; 3 filtros más «Más filtros (Por conciliar)» y chips; estado vacío con `EmptyState`. A 390 px la tabla no tiene tarjetas y el estado queda fuera de pantalla (desplazamiento horizontal interno, sin desborde de página).
- Detalle con valores crudos: «high · 2026-10-06», «needs_assignment», eficacia «pending», historial «created»/«evidence», actor «qa-prev» (id) y fuente «Incidente · inc-FMwv…» (id interno, no el código INC) → **INC-M01**.
- **La evidencia se lista como texto `storage/capa-evidence/xxxx.png`, sin enlace** (**INC-06**).
- «Cancelar CAPA» es un botón destructivo sin `ConfirmDialog` que comparte el campo de motivo con las demás transiciones. Para quien implementa, en «Pendiente de verificación» es la única acción visible.
- Toda CAPA creada desde un incidente nace sin responsable, «Por conciliar» (`needs_assignment`), y al admin se le abre «Conciliación histórica»: jerga de migración aplicada a registros nuevos.
- **Estados observados:** vacío, con datos, éxito, fallo (segregación, sin motivo), permisos insuficientes (sup/jt/cphs/ti). No observados: cargando, sin resultados.

### Facilidad de uso
- **Cerrar una CAPA exige 3 personas y 10 clics:** implementador 5 (iniciar, abrir evidencia, elegir archivo, registrar, enviar a verificación), verificador 3 (motivo, eficacia, verificar), jefa 2 (abrir desde la lista, cerrar) (flowA3). Es coherente con la segregación; lo que falta es que la pantalla diga quién sigue.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Crear manual / desde incidente | ✅ | flowA2 (desde incidente); PGlite manual-y-exención PASS |
| Asignar responsable y plazo | ✅ (código + PGlite) | no ejecutado en UI |
| Iniciar e implementar, enviar a verificación con evidencia exigida | ✅ | flowA3 |
| Subida de evidencia con validación de contenido | ✅ | SVG renombrado a .png rechazado (sin fila nueva); PNG real guardado como `.png` (M-21) |
| **Ver o abrir la evidencia para verificarla** | ❌ | 0 enlaces; no existe ruta de descarga para `storage/capa-evidence/` (**INC-06**) |
| Verificación segregada | ✅ | el creador es rechazado («debe hacerla una persona distinta…»); prev2 verifica |
| Cerrar | ✅ | jefa |
| Cancelar con motivo | ✅ / 🔴 efecto en el incidente | **INC-05** |
| Reabrir | ✅ (código) | no ejecutado |
| Conciliación histórica | no ejecutado en UI | PGlite PASS |
| Buscar (TopBar) | 🟡 | sólo filtra la página de 50 cargada (**INC-18**) |
| Exportar Excel | 🟡 | hoja «Acciones CAPA» duplicada y tope silencioso de 500 (**INC-17**) |

### C. Código y lógica
- La máquina de estados y la segregación viven en el servicio (`assertCapaTransition`, `prevention-capa.ts:258-318`) con control de versión optimista; bien.
- Duplicación: filas y encabezados de la hoja principal copiados dos veces en `buildCapaExport` (`prevention-capa.ts:1203-1244`), que es la causa de la hoja duplicada.
- `listCapaActions` topa en 500 (`:915`), pero el export marca `rowLimitApplied` sólo por encima de 10.000 (`:1161`).
- `addCapaFollowupWithClient` no valida el estado terminal y los envoltorios de evidencia/seguimiento no llaman `assertNotPpaDriven` (la UI lo oculta).

### D. Modelo de datos
- Tablas de acción, transiciones (bitácora), evidencia (con `superseded`) y seguimientos; `CHECK` de exención de evidencia justificada.
- El vínculo con la fuente es `source_type/source_id` (texto, sin FK).
- Reabrir una CAPA de un incidente ya cerrado es posible y el incidente sigue cerrado, sin aviso (**INC-M21**).

### E. Permisos y seguridad
- Alcance por faena verificado: `otrafaena` → «no encontrado» en el detalle y export vacío.
- Segregación de verificación por identidad (creador, responsable, quien completa) verificada.
- Subida: MIME por contenido (M-21), 25 MB, sha256 recalculado sobre el archivo guardado, rechazo de rutas de otra faena.

### F. Testing
- Incluidos en las corridas anteriores: `prevention-capa*.test.ts`, `capa-controls.test.tsx`, rutas export/evidencia (PASS); PGlite list/manual/evidencia (PASS); `prevention-capa-postgres` **4 PASS**.
- E2E vacío (**INC-20**).

### G. Integración con el Programa Anual
- Relación **indirecta**, como declara el mapa. Cerrar una CAPA **no** crea ejecuciones ni eventos PDTP: SQL en A tras cerrar una, `pdtp_fulfillment_events`/`pdtp_executions` con source CAPA = 0; no hay llamada de acreditación en `prevention-capa.ts`.
- «Medidas» del PDTP (`/prevencion/pdtp/acciones`) es una vista de las mismas filas CAPA `source_type=pdtp` (`capa-view.ts:142-172`, `action-plan.ts` usa `transitionCapaActionWithClient`): no hay doble registro. Sí hay dos vocabularios (pendiente/en_proceso/completado/verificado frente a los estados CAPA) → **INC-M22**.
- La CAPA de un incidente condiciona el cierre (N°77), y eso trae INC-05.

### H. Hallazgos

```
ID: INC-06
Severidad: 🟠 CRÍTICO
Submódulo: Acciones correctivas (CAPA)
Categoría: Funcionalidad / Evidencia
Título: La evidencia subida a una CAPA no se puede abrir: quien verifica "evidencia y eficacia" no puede ver el archivo
Archivo(s): app/(app)/prevencion/capa/[id]/page.tsx; lib/services/prevention-capa.ts; app/api/prevencion/capa/evidence/route.ts
Línea(s): [id]/page.tsx:88-95 (texto sin enlace); prevention-capa.ts:1284-1286 ("no hay ruta para descargarlo"); evidence/route.ts (sólo POST)
Pantalla/ruta: /prevencion/capa/[id]
Endpoint: no existe GET de evidencia CAPA
Rol: verificador (prevencionista), jefa
Descripción: el archivo queda en storage/capa-evidence/ con sha256, pero ninguna ruta lo sirve; el detalle muestra la ruta como texto.
Evidencia: DEMOSTRADO (flowA3): sección Evidencia "Fotografía · storage/capa-evidence/4gvGEIvkigm6h-vrWlST.png", links: 0; prev2 verificó la eficacia igual.
Cómo reproducir: 1. Subir una foto a una CAPA. 2. Como otra persona abrir el detalle. 3. No hay forma de verla.
Resultado actual: verificación a ciegas.
Resultado esperado: descarga autenticada con alcance de faena (patrón de la ruta PDTP/higiene), miniatura para imágenes.
Impacto: el control central de CAPA (verificar evidencia) no puede ejercerse.
Causa probable: se implementó la subida sin la lectura.
Solución recomendada: GET /api/prevencion/capa/evidence/[name] con scope, attachment/nosniff; enlace en el detalle.
Esfuerzo: Bajo–Medio
Bloquea producción: No (condición mínima)
Clasificación: A obligatorio antes de producción
```

```
ID: INC-17
Severidad: 🟡 IMPORTANTE
Submódulo: CAPA
Categoría: Funcionalidad / Exportación
Título: El Excel CAPA duplica la hoja principal y trunca en 500 acciones sin avisar
Archivo(s): lib/services/prevention-capa.ts
Línea(s): 915 (tope 500), 1159-1161 (rowLimitApplied > 10.000), 1200-1244 (hoja primaria + la misma en sheets)
Pantalla/ruta: /prevencion/capa → Exportar Excel
Endpoint: GET /api/prevencion/capa/export
Rol: capa:view
Descripción: el libro sale con "Acciones CAPA" y "Acciones CAPA (2)" idénticas (el export de incidentes documenta y corrige ese mismo defecto); además nunca pasan más de 500 filas.
Evidencia: DEMOSTRADO (probeA5): hojas "Acciones CAPA(3) | Acciones CAPA (2)(3) | Transiciones | Evidencias | Seguimientos"; tope por CÓDIGO.
Cómo reproducir: exportar.
Resultado actual: hoja duplicada; truncamiento silencioso.
Resultado esperado: una hoja; paginación o aviso X-Row-Limit-Applied correcto.
Impacto: reporte confuso o incompleto.
Causa probable: contrato de ReportData.sheets.
Solución recomendada: headers/rows vacíos como en el export de incidentes; límite coherente.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

```
ID: INC-18
Severidad: 🟡 IMPORTANTE
Submódulo: CAPA
Categoría: Funcionalidad / Búsqueda
Título: La búsqueda del TopBar sólo filtra las 50 CAPA de la página actual
Archivo(s): app/(app)/prevencion/capa/capa-list.tsx; app/(app)/prevencion/capa/page.tsx
Línea(s): capa-list.tsx:86-92; page.tsx:22-38 (paginación en servidor de 50)
Pantalla/ruta: /prevencion/capa
Endpoint: —
Rol: capa:view
Descripción: la lista pagina en el servidor, pero el texto se filtra en el cliente sobre la página cargada; una CAPA de la página 2 "no existe" para el buscador.
Evidencia: CÓDIGO (no había más de 50 CAPA para demostrarlo).
Cómo reproducir: con más de 50 CAPA, buscar el código de una que esté en la página 2.
Resultado actual: "No hay acciones con estos filtros".
Resultado esperado: búsqueda en el servidor (ruta en ROUTES_WITH_OWN_SEARCH o `q` en la URL).
Impacto: acciones no encontradas.
Causa probable: combinación de paginación en servidor con filtro en cliente.
Solución recomendada: mover el texto a la consulta.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **75/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 16,5 | INC-06 −4 · INC-05 −1,5 · INC-17 −1,5 · INC-18 −1 · INC-M12 −0,5 |
| UI/UX y facilidad de uso | 20 | 14 | INC-M01 −1,5 · INC-M05 −1 · INC-M06 −1 · INC-06 (UI) −1,5 · INC-M16 −0,5 · próxima acción poco clara −0,5 |
| Integridad de datos | 15 | 11 | INC-05 −2 · INC-M21 −1 · INC-17 −1 |
| Integración con Programa Anual | 15 | 13 | INC-M22 −1 · el estado CAPA no se refleja en el incidente −1 (relación indirecta bien acotada, sin falso cumplimiento) |
| Código y mantenibilidad | 10 | 8 | INC-17 (duplicación) −1 · topes incoherentes −1 |
| Permisos y seguridad | 5 | 5 | — |
| Testing | 5 | 3 | INC-20 −2 |
| Manejo de errores | 5 | 4,5 | INC-M05 −0,5 |
| **Total** | 100 | **75** | Funcional, requiere correcciones (INC-06 obligatorio). |

---

## AUDITORÍA — Daño material y ambiental

**Rutas:** `/prevencion/indicadores-material-ambiental`, `GET /api/prevencion/indicadores-material-ambiental/export?year=`.
**Archivos:** `page.tsx`, `material-environmental-dashboard.tsx`, `material-environmental-charts.tsx`, `lib/services/prevention-indicadores.ts:939-1040`, ruta de export.
**Permisos:** `prevention:indicadores:view` (cphs y jefa sí; sup, jt, legal y ti → /forbidden, verificado).

### A. UI/UX/Diseño
- `PageHeader` con exportar; aviso informativo; selector de faena y año (`router.replace` + `scroll:false`); 4 tiles; pestañas Mensual/Gráficos/Resumen por faena.
- Los tiles **no son accionables** ni llevan a los incidentes (A1); en vacío muestra una tabla de 12 filas en 0 en lugar de un `EmptyState`.
- Cuatro gráficos redibujan la misma serie (A5 leve); «Daño material» e «Inc. peligrosos» usan tonos cercanos.
- A 390 px la tabla se desplaza dentro de su contenedor; sin desborde de página.
- **Estados observados:** vacío (ceros), con datos, error («Algo salió mal» con `?year=1999`, **INC-M18**), permisos insuficientes.

### Facilidad de uso
- Cambiar de faena y año: 2 clics. No hay camino desde una cifra al registro que la produce.

### B. Funcionalidad
| Función | Estado | Evidencia |
|---|---|---|
| Conteo por tipo, faena y mes | ✅ | flowA9 |
| Total por faena seleccionada | 🔴 | «Total eventos» suma todas las faenas (**INC-16**) |
| Año | ✅ / 🟡 | un año fuera de rango rompe la página (**INC-M18**) |
| Exportar Excel con alcance | ✅ | prevfaena sólo su faena (13 filas); prev 4 faenas (49) |
| Drill-down a incidentes | ❌ | tiles no clicables |

### C. Código y lógica
- Consulta agregada simple y con alcance.
- La página usa `codeYear()` (C-05 corregido), pero la ruta de export sigue con `new Date().getFullYear()` (`export/route.ts:28`) y ante un año inválido devuelve en silencio el año actual.
- Cuenta todo incidente del tipo, incluido uno recién reportado sin triar o uno duplicado (no hay anulación, INC-14).

### D. Modelo de datos
Lectura de `prevention_incidents` por `event_type`; no persiste nada.

### E. Permisos y seguridad
Alcance por faena verificado en la página y en el export; cphs puede exportar (tiene `indicadores:view`).

### F. Testing
`prevention-material-environmental.test.ts` PASS; ningún test cubre el tile total ni el año inválido; sin E2E.

### G. Integración con el Programa Anual
No acredita nada y no debería: es un tablero de lectura. Se puntúa la relación indirecta. Cuenta los mismos incidentes que abren obligaciones RE-20, pero no enlaza ni a los incidentes ni a esas obligaciones.

### H. Hallazgos

```
ID: INC-16
Severidad: 🟡 IMPORTANTE
Submódulo: Daño material y ambiental
Categoría: Funcionalidad / Integridad del indicador
Título: "Total eventos" ignora la faena seleccionada (no calza con los otros tres tiles)
Archivo(s): app/(app)/prevencion/indicadores-material-ambiental/material-environmental-dashboard.tsx
Línea(s): 52-63 (totals suma todas las faenas), 98-99 (tile)
Pantalla/ruta: /prevencion/indicadores-material-ambiental
Endpoint: —
Rol: indicadores:view
Descripción: al elegir una faena, los tres tiles por tipo muestran esa faena y el total sigue mostrando el de todas.
Evidencia: DEMOSTRADO (flowA9): total visible "Total=6, Peligrosos=5, Material=0, Ambiental=1"; con "Faena E2E": "Total=6, Peligrosos=4, Material=0, Ambiental=0" (4 ≠ 6), a 1440 y 390 px.
Cómo reproducir: con eventos en dos faenas, seleccionar una.
Resultado actual: cifra contradictoria en la misma fila.
Resultado esperado: total de la faena seleccionada.
Impacto: lectura errónea del tablero.
Causa probable: el memo usa eventData completo.
Solución recomendada: calcular desde selectedData.annual; tiles clicables hacia la bandeja filtrada.
Esfuerzo: Bajo
Bloquea producción: No
Clasificación: B
```

### I. Readiness individual: **80/100**
| Categoría | Peso | Nota | Descuentos |
|---|---:|---:|---|
| Funcionalidad y lógica | 25 | 18 | INC-16 −4 · sin drill-down (INC-M07) −2 · cuenta sin triar/duplicados (INC-14) −1 |
| UI/UX | 20 | 16 | INC-M07 (A1, vacío con ceros) −3 · jerga «canónico» y 4 gráficos iguales −1 |
| Integridad | 15 | 13 | INC-16 −2 |
| Integración PDTP | 15 | 12 | sin enlace a incidentes u obligaciones −2 · cuenta eventos no confirmados como «canónicos» −1 |
| Código | 10 | 9 | C-05 residual (INC-M19) −0,5 · builder Excel propio −0,5 |
| Permisos y seguridad | 5 | 5 | — |
| Testing | 5 | 3,5 | sin prueba del total ni del año −1,5 |
| Manejo de errores | 5 | 3,5 | INC-M18 −1,5 |
| **Total** | 100 | **80** | Muy próximo. |

---

## Mejoras y cosméticos (🔵/⚪)

| ID | Submódulo | Hallazgo | Archivo:línea | Evidencia | Solución | Esf. |
|---|---|---|---|---|---|---|
| INC-M01 🔵 | Incid./CAPA | Enums crudos: línea de tiempo «reported → triage», carriles «RESTART AUTHORIZATION», «employee»; CAPA «high», «needs_assignment», «pending», «created»; enlace «CAPA-… · pending»; exports con estados en inglés | `[id]/page.tsx:140,145,156`; `incident-workflow-panel.tsx:240`; `capa/[id]/page.tsx:76-80,107`; `prevention-incident-export.ts` | Capturas A2/A3/B4 | Mapear a labels + Badge (A6) | B |
| INC-M02 🔵 | Incid. | `<input type="date">` nativo (clasificación, reinicio, público) | `incident-workflow-panel.tsx:275,276,325`; `report-form.tsx:73` | Código | DatePicker | B |
| INC-M03 🔵 | Incid. | Jerga: «canónico», «idempotencia», «RE-20 Versión 2», «Fuente canónica» | `page.tsx`, `reportar/page.tsx:34`, `re20-panel.tsx:178` | Capturas | Lenguaje de usuario | B |
| INC-M04 🔵 | Incid. | «Confirmar (Supervisor)» visible para quien marcó (el servidor rechaza) | `re20-panel.tsx:456` | flowA2 | Ocultar si marcó el mismo usuario | B |
| INC-M05 🔵 | CAPA | Cancelar sin diálogo de confirmación y con el motivo compartido | `capa-controls.tsx:213-215` | flowA3 | ConfirmDialog con motivo | B |
| INC-M06 🔵 | CAPA | Las CAPA de incidente nacen sin responsable («Por conciliar»; se abre «Conciliación histórica») | `incident-workflow-panel.tsx:236`; `prevention-capa.ts:352-353` | SQL `needs_assignment` | Pedir el responsable al crear | B |
| INC-M07 🔵 | Mat./amb. | Tiles no accionables y tabla de ceros en vacío | `material-environmental-dashboard.tsx:96-118,65-67` | flowA9 | Enlaces a la bandeja filtrada; EmptyState | B |
| INC-M08 🔵 | Incid. | El buzón público no tiene SLA ni recordatorio; muestra máximo 20 y el contador dice 20 | `public-reports-panel.tsx:19`; `prevention-incident-reports.ts:33-35` | Código | Contador real y recordatorio | B |
| INC-M09 🔵 | Incid. | La declaración de la persona se guarda en claro (las entrevistas se cifran) | `prevention-incidents.ts:1860-1869` | Código | Cifrar o clasificar | M |
| INC-M10 🔵 | Incid. | KPI «Fatal o grave · Operación suspendida» (texto inexacto); tiles y Select de estado duplican la dimensión (A5) | `incident-list.tsx:82-87` | Captura | Ajustar texto | B |
| INC-M11 🔵 | Incid. | La bandeja corta en 500 sin paginar ni avisar | `prevention-incidents.ts:906` | Código | Paginación | B |
| INC-M12 🔵 | CAPA | Seguimiento permitido en CAPA cerrada o cancelada en el servicio; sin guardia PPA en evidencia/seguimiento | `prevention-capa.ts:865-901,856-863` | Código | Validar estado y origen | B |
| INC-M13 🔵 | Incid. | La cola offline descarta en silencio tras 8 intentos o 30 días | `offline-incident-queue.ts:95-108` | Código | Avisar antes de purgar | B |
| INC-M14 🔵 | Incid. | Bajar la gravedad en el triage cancela obligaciones RE-20 directo, sin segunda persona ni guarda de período (contrasta con PRV-05) | `incident-accreditation-connector.ts:306-326`; `obligations.ts:406-433` | DEMOSTRADO flowB5 (9 canceladas por qa-prev) | Aceptable por trazabilidad; considerar revisión si el mes está cerrado | B |
| INC-M15 🔵 | Incid./PDTP | «Reportar trabajo» en obligaciones RE-20 acepta texto (doble vía) y «Origen: incident · inc-…» no enlaza | `obligations.ts:279-290`; obligaciones UI | Captura B1 | Enlace al hito; en integración, dirigir al módulo | B |
| INC-M16 🔵 | CAPA | Lista a 390 px sin tarjetas; estado fuera de pantalla | `capa-list.tsx:190-240` | check390 | ResponsiveDataListCard | B |
| INC-M17 🔵 | Incid./CAPA | Detalle fuera de alcance o inexistente responde HTTP 200 con «no encontrado» (sin fuga; semántica HTTP) | `[id]/layout.tsx` | probeA5 | 404 real | B |
| INC-M18 🔵 | Mat./amb. | `?year=1999` → «Algo salió mal» (excepción); el export cae en silencio al año actual | `page.tsx:25-28`; `export/route.ts:28-29` | probeA11/A10 | Acotar el año en la página | B |
| INC-M19 🔵 | Mat./amb. | C-05 residual: `new Date().getFullYear()` en el export | `export/route.ts:28` | Código | codeYear() | B |
| INC-M20 🔵 | Incid. | La vista reservada muestra JSON crudo con claves en inglés | `[id]/page.tsx:149` | Captura A4 | Ficha con labels | B |
| INC-M21 🔵 | CAPA | Reabrir una CAPA de un incidente cerrado no avisa ni refleja nada en el incidente | `prevention-capa.ts:227` | Código | Aviso o bloqueo | B |
| INC-M22 🔵 | CAPA/PDTP | Medidas del PDTP y CAPA: mismas filas, dos vocabularios de estado | `pdtp/action-plan.ts:1-8`; `capa-view.ts` | Código | Unificar labels | B |
| INC-C01 ⚪ | Incid. | Mayúsculas de título inconsistentes en el panel RE-20; «✓» literal en el texto | `re20-panel.tsx:172,252` | Captura | — | B |

---

## Estado de hallazgos previos en este alcance

| Previo | Dictamen | Evidencia propia |
|---|---|---|
| **PRV-15** canal público exige sesión | **Corregido (verificado)** | GET `/reportar-incidente` 200 sin sesión en :3100 y :3101 (contexto sin storageState, 4 anchos); envío real con folio; cuota 20/10 min con mensaje; `lib/security/public-paths.ts:25` |
| **M-23** el triage que agrava abre obligaciones en el barrido | **Corregido (verificado en B)** | Obligaciones 68–78 creadas en la misma petición del triage (post-commit, no la misma transacción; el barrido sigue de respaldo) |
| **M-21** extensión de la evidencia CAPA según el nombre del cliente | **Corregido** (código + subida parcial) | `prevention-evidence-upload.ts:83`; SVG renombrado a .png rechazado; PNG guardado `.png` |
| **C-05** año UTC en daño material/ambiental | **Parcial** | página con `codeYear()`; export `route.ts:28` sigue con `getFullYear()` |
| **PRV-02** segregación en integración (RE-20) | **Parcial** | obligaciones con actor ✅ (autoaprobación de la N°72 rechazada); **N°76 sin actor → autoaprobación demostrada** (INC-07) |
| **PRV-01** evidencia de integración verificada (vía RE-20) | **Sigue abierto en la vía de obligaciones** | texto sintético = `provided`; N°72 aprobada sin motivo (INC-02) |
| **PRV-05** cancelación sin revisión (en lo que toca incidentes) | **No aplica / observación** | la cancelación automática del triage no pasa por revisión (INC-M14) |

## Qué no se pudo verificar y por qué
- **No verificado en navegador:** conciliación histórica de CAPA, reapertura, asignación y plazo, y creación manual desde el diálogo. Cubiertos por PGlite (PASS); no alcanzó el tiempo.
- **No verificado:** descarte de un reporte del buzón en UI (sí la conversión); clasificación DS 44 en UI; carriles DT/SEREMI y reinicio en navegador (sí por sonda PGlite de servicio).
- **Dependiente de la infraestructura:** el cubo de cuota compartido `unresolved` sólo se observa en local; en producción rige `cf-connecting-ip` detrás del túnel de Cloudflare (no verificable desde aquí).
- **No observados:** estados «cargando» y «sin resultados con filtros».
- **No probado:** WebKit.
- **No medido:** el efecto de la N°76 aprobada en el indicador de la vista PDTP (dictamen por código y SQL).
- **No ejecutado:** los E2E (prohibido por el brief).
- **Archivos temporales:** `lib/__tests__/incidentes-reinicio.audit-tmp.test.ts` copiado a `scratchpad/audit/incidentes/` y **borrado del repo**. Los otros `*.audit-tmp.test.ts` que siguen en el repo (documental, inspecciones, riesgos) son de otros agentes.

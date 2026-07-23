# Plan de implementación: respuestas del cuestionario + módulo de investigación RE-20

**Fecha:** 22 de julio de 2026 · **Estado:** en ejecución

> **Nota de gobierno (2026-07-22):** Prevención confirmó que **el programa enviado no está vigente** y que lo que se implemente **será la fuente de verdad**. Por lo tanto las modificaciones al programa (quita de actividades, cambios de regla) **no requieren re-aprobación de Legal previa** para avanzar; se aplican directamente y el circuito de firma se ejerce sobre el resultado antes de la puesta en marcha real (H2 2026). Esto habilita ejecutar la Fase 0 sin gates de negocio.

**Fuentes de este plan:**
- `Preguntas Programa.docx` — respuestas de Prevención al cuestionario de decisiones (bloques 1 a 11).
- `RE-20 FORMATO INVESTIGACIÓN DE ACCIDENTES E INCIDENTES DS 44 Chome.xlsx` — flujo oficial de investigación (13 hojas, código RE-20, versión 2, 2025-02-03).

**Documentos relacionados:** `PLAN_AJUSTE_INTEGRAL_PREVENCION_PDTP_SGSST_2026.md` (plan maestro; este documento cierra o reabre varios de sus ítems), `PREGUNTAS_PENDIENTES_PDTP_2026.md` (el cuestionario respondido).

**Fecha de puesta en marcha declarada por Prevención:** segundo semestre 2026 (~agosto). **Sin migración: se parte de cero.** El Excel queda deprecado al operar la plataforma.

---

## 1. Cómo leer este plan

El cuestionario no solo respondió preguntas: **cambió el alcance**. Varias piezas grandes del plan maestro se descartan y aparece una nueva (el módulo de investigación). Este documento tiene tres partes:

- **Parte A — Decisiones cerradas y su impacto.** Qué se descarta, qué se desbloquea, qué regla nueva entra.
- **Parte B — Módulo de investigación RE-20.** El grueso del trabajo nuevo. Es la implementación concreta de las actividades 66-78 y del motor de auto-acreditación.
- **Parte C — Fases de implementación.** Orden ejecutable.

Principio rector heredado del plan maestro: **una captura operacional, múltiples usos**. Un evento real (checklist aprobado, sesión cerrada, paso de investigación completado) acredita la actividad PDTP por enlace trazable, nunca por doble digitación.

---

## Parte A — Decisiones cerradas y su impacto

### A.1 Lo que se DESCARTA (reduce alcance del plan maestro)

| Decisión (bloque) | Qué se descarta | Ítems del plan maestro afectados |
|---|---|---|
| **Sin migración, se parte de cero en H2 2026** (6.1, 7.1, 7.3) | Toda la migración de datos productivos, inventario del sistema anterior y reconciliación por hoja. | **Fase 7.1 completa** (inventario, mapeo, staging, reconciliación), **DAT-01/OPS-01** en su parte de migración. |
| **Los 6 registros E históricos se obvian** (6.1) | Importar las seis ejecuciones históricas del Excel. | **DAT-01** (parte de datos históricos), §2.2 del maestro, criterio §12 "seis E migradas". Se cierra como "exceptuadas formalmente". |
| **Sin marcha paralela; solo digital** (7.1) | El ciclo mensual de convivencia Excel/plataforma. | **Fase 7.3 completa** (marcha paralela). |
| **El export NO debe replicar el RE-36** (3.1) | El adaptador de compatibilidad RE-36 (8 hojas/48 semanas idénticas). | **§6.6 completa** (adaptador RE-36), **EXP-02** se simplifica a "reporte de gestión + expediente", **§9.2 round-trip 2026**. |
| **Excel quedará deprecado** (11.2) | Mantener el flujo de importación XLSX como camino permanente. | El importador queda solo como bootstrap inicial, no como operación recurrente. |

> **Impacto neto:** la Fase 7 se reduce de "migración + marcha paralela + cutover" a solo **puesta en marcha limpia + aceptación formal**. El §6.6 desaparece.

### A.2 Reglas de negocio NUEVAS (deben implementarse)

| # | Regla (bloque) | Dónde impacta |
|---|---|---|
| R1 | **Inspecciones todo-o-nada** (2.1): si la faena tiene 10 extintores y se revisan 5, la actividad cuenta **0**, no 5/10. Aplica a todo tipo de inspección con sujetos. | Motor de acreditación (Fase 5). Cambia el cálculo de cumplimiento por actividad de "suma de sujetos" a "1 solo si se cubrió el 100 % de los sujetos esperados de la faena". |
| R2 | **Cobertura como % de personas** (2.3): actividades tipo "al 90 % de los conductores/trabajadores" (54, 56, y las de campaña) se miden por **personas alcanzadas / dotación aplicable**, no por número de sesiones. | Nuevo `indicatorMode` de cobertura por padrón de personas. |
| R3 | **Techo de sobrecumplimiento** (2.4): el reporte aplica **tope máximo**; no se muestra sobrecumplimiento. | `getPdtpComplianceIndicators`: `min(ejecutado, planificado)` en el numerador. |
| R4 | **Aplicabilidad por faena** (4.1): no todas las actividades aplican a todas las faenas (ej. CPHS solo en faenas con ≥25 trabajadores). | Ya existe `pdtpActivityWorksiteExclusions`; falta la **regla automática por dotación** y la UI para gestionarla. |
| R5 | **Legal aprueba = activa** (5.3): el flujo es Jefatura redacta+aprueba (JDPR) → **Legal aprueba y esa aprobación activa**. No hay paso de activación separado. | `lib/services/pdtp/lifecycle.ts`: fusionar `signPdtpProgramLegal` + `activatePdtpProgram` en un solo acto (la firma Legal transiciona a `active`). |
| R6 | **Segregación estricta** (5.4): una persona por rol; sin sobrepaso ni en emergencia. | Cierra **GOV-05/§1.3** en contra: **no** se implementa el permiso de sobrepaso. Se marca el ítem como "descartado por decisión". |
| R7 | **Cuentas temporales de reemplazo** (8.1): ante ausencia, Jefatura de Prevención crea y configura una **cuenta temporal** con vigencia acotada y ampliable. | Nuevo: gestión de suplencia por cuenta temporal (no reasignación de notificaciones a otra cuenta existente). |
| R8 | **Avisos por rol, sin preferencias** (8.2): cada usuario recibe todos los avisos de su rol; sin configuración individual por ahora. | Cierra **§6.3** (preferencias de notificación): se descarta la parte de preferencias; se mantiene faena+rol. |
| R9 | **Campañas con registro propio** (9.1): las actividades 85-89 necesitan registro con fecha, **personas alcanzadas** y evidencia de difusión. | Nueva entidad/registro de campaña (o checklist de campaña con padrón de asistentes), no un simple "documento entregado". |
| R10 | **Quita de 4 y 8: nuevo doc = fuente de verdad, requiere aprobación posterior de Legal** (10.1-10.3): sin entrada de control de cambios; Jefatura autoriza con justificación de campo abierto; Legal debe re-aprobar. | El programa cargado desde la fuente de 87 debe pasar por el circuito de firma Legal antes de activarse (coherente con R5). |
| R11 | **El archivo oficial se genera desde el sistema** (11.2): Excel deprecado. | Confirma que la fixture/exportación del sistema es la fuente futura; el bootstrap XLSX es de un solo uso. |

### A.3 Las 22 actividades sin plan numérico — clasificación aprobada

Las respuestas confirman la clasificación y fijan SLAs. Queda **cerrado el ítem 4.3 del plan maestro** (clasificación de las 22) con estos valores:

- **Disparadas por accidente/incidente (13):** 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78. La **21 se ELIMINÓ** (respuesta 1.A: "es lo mismo que 76") → el programa pasó de 87 a **86 actividades**. **[HECHO 2026-07-22]** aplicado al seed, al contrato (`PDTP_2026_REMOVED_ACTIVITIES=[4,8,21]`, `activityCount:86`, `noNumericPlanCount:21`) y a la fuente física canónica `…(86 actividades).xlsx` (SHA `54c6695e…`), reproducible vía `generate-pdtp-catalog.ts`. Contract/catalog tests verdes.
- **Disparadas por ingreso de trabajador (4):** 15, 16, 18, 52.
- **Hitos CPHS "cuando corresponde" (3):** 11, 12, 14 — plazo máximo **30 días** desde que se gatilla.
- **Capacitación sin fecha (1):** 57 — meta **1 al año, en octubre**, con mes asignable por faena.
- **Regla de denominador (1.E):** un mes sin caso = **"no aplica"** (ni cumplido ni pendiente; no altera el indicador).

**SLAs confirmados** (los marcados *doc* venían del programa; el resto los aprobó Prevención):

| Act | SLA | Evidencia |
|---:|---|---|
| 66, 67 | Inmediato, mismo turno | Registro del aviso |
| 68, 70 | **3 horas** | Informe preliminar (RE-20-02) |
| 69 | 24 horas | Declaración/encuesta DO-36 firmada |
| 71 | Inmediato en cada turno | Registro de asistencia |
| 72 (DIAT) | **Máx. 24 horas** | DIAT emitida (RE-20-07) |
| 73 | **72 horas** | Investigación definitiva (RE-20-04) |
| 74 | 72 horas | Informe definitivo enviado |
| 75 | 48 horas tras el informe | Registro de asistencia (difusión) |
| 76 | Según plan de acción (seguimiento quincenal hasta cierre) | Plan de acción con cierres |
| 77 | Al cierre del caso | Expediente completo |
| 78 | 24 horas tras el preliminar | ONE PAGE (RE-20-06) difundido |

> **Nota (resuelta 2026-07-22):** como el programa no está vigente y lo implementado es la fuente de verdad, la quita de la 21 se aplicó directamente (junto con las de 4 y 8). La re-aprobación de Legal (R10) se ejercerá sobre el programa resultante antes de la puesta en marcha real, no como gate previo.

### A.4 Matriz de acreditación automática — aprobada con una corrección

La agrupación del bloque 2 quedó aprobada, con **dos ajustes**:

1. **Todo es automatizable** (2.2): se elimina la categoría "manual para siempre". Las 27 que propuse manuales pasan a "manual **por ahora**, automatizable después" — no se cierran como excepción permanente.
2. **Regla R1 (todo-o-nada)** aplica a inspecciones con sujetos.

Esto **reabre y amplía INT-01/Fase 5**: hay que construir el motor de auto-acreditación para los grupos aprobados (inspecciones, reporte de equipos, observaciones, capacitaciones, EPP, CPHS, emergencias, alcotest, campañas, incidentes).

---

## Parte B — Módulo de investigación de accidentes/incidentes (RE-20)

Esta es la pieza nueva más grande. **No se construye de cero:** el módulo `prevencion/incidentes` ya existe y cubre buena parte. Este plan lo **extiende** hasta cubrir el flujo RE-20 completo y lo **cablea** a las actividades PDTP 66-78.

### B.1 Lo que YA existe (reutilizar, no reimplementar)

| Capacidad existente | Dónde | Cubre de la RE-20 |
|---|---|---|
| Incidente con estados `reported→triage→immediate_measures→under_investigation→pending_capa→pending_verification→closed`, severidad real/potencial, medidas inmediatas | `preventionIncidents` (`db/schema/prevention/incidents.ts`) | El caso y su ciclo de vida |
| Personas involucradas + clasificación para indicadores (IG/días perdidos) + payloads sensibles con privacidad | `preventionIncidentPeople`, `…SensitivePayloads` | Identificación del accidentado (INV.PRE.ACC, INVDEF.ACC) |
| Notificaciones legales con **deadline/SLA** (`diat`, `diep`, `fatal_dt`, `fatal_seremi`, `restart_authorization`) | `preventionIncidentNotifications` | DIAT (paso 5, 24 h) y avisos legales |
| Investigación con estado, **causas inmediatas** y versión | `preventionIncidentInvestigations` | Núcleo de INVDEF.ACC |
| Evidencia, historial auditable, recordatorios, export, formulario offline | `preventionIncidentEvidence/History`, `prevention-incident-reminders.ts`, `…-export.ts`, `offline-incident-queue.ts` | Fotos, trazabilidad, alertas, reporte |
| Enlace tipado a actividad PDTP con `sourceType='incident'` e idempotencia | `preventionPdtpSourceLinks` + `pdtp_executions.idempotency_key` | La acreditación de las actividades 66-78 |

### B.2 Los huecos vs. la RE-20 (lo nuevo a construir)

1. **Informe preliminar como artefacto propio con SLA de 3 h** (RE-20-02 / actividades 68, 70). Hoy el flujo salta de `reported` a investigación; falta el paso preliminar formal con su plazo y su evidencia.
2. **Taxonomías controladas de clasificación** (hoja *Clasificación*, 181 filas): tipo de accidente (~30 valores), situación, agente/fuente causante, fuente (Equipos/Materiales/Ambiente/Higiénico), zona corporal, estatus mutual (Abierto/Cerrado/En Investigación/Rechazado/Revisar). Hoy solo hay `immediateCauses` como texto libre.
3. **Análisis causal estructurado** (hoja *ANALISIS DE CAUSA* / INVDEF.ACC §análisis): `requisito del sistema → causas básicas → causas inmediatas → incidente → daño`. Hoy solo `immediateCauses`.
4. **Evaluación de riesgo del caso**: probabilidad/exposición × consecuencia/severidad = nivel de riesgo (INVDEF.ACC §evaluación).
5. **Declaración del involucrado y entrevistas** (Declaración Involucrado, Entrevista Testigo, Entrevista CPHyS): captura de testimonios con firma. Actividad 69, SLA 24 h.
6. **ONE PAGE de difusión** (INF.DIFUSIÓN / RE-20-06): salida de una página con resumen, causa raíz, plan de acción. Actividad 78, SLA 24 h.
7. **Reporte de cuasi-accidente** (RE-20-11): variante liviana sin lesión/daño; hoy el módulo asume incidente con potencial.
8. **Seguimiento quincenal hasta implementación** (Seguimiento Acc. CTP/STP, RE-20-08): iteraciones de seguimiento de mejoras. Actividad 76.
9. **Auto-acreditación PDTP**: cada paso del caso que cumple su SLA debe emitir/actualizar la ejecución de su actividad 66-78 vía `preventionPdtpSourceLinks`, idempotente por caso.
10. **Firmas del caso** (INVDEF.ACC §firmas): Adm. contrato / CPHS / Prevención / Subgerente — firma de contenido del informe definitivo.

### B.3 Diseño de datos (extensión aditiva, sin romper lo existente)

Migraciones **generadas por Drizzle** (regla de `AGENTS.md`), aditivas:

- **`preventionIncidentInvestigations`** — agregar columnas estructuradas: `basicCauses jsonb`, `systemRequirementCauses jsonb`, `classificationJson jsonb` (tipo/situación/agente/fuente/zona), `riskProbability`, `riskConsequence`, `riskLevel`, `preliminaryReportAt`, `definitiveReportSentAt`.
- **`preventionIncidentStatements`** (nueva) — declaraciones y entrevistas: `incidentId`, `kind` (`involved`/`witness`/`cphs`), `deponentName`, `content`, `signedAt`, `evidenceRef`.
- **`preventionIncidentDiffusion`** (nueva) — ONE PAGE: `incidentId`, `summary`, `rootCause`, `riskLevel`, `actionPlanRef`, `diffusedAt`, `attendanceRef`.
- **`preventionIncidentClassificationCatalog`** (nueva, seed) — las taxonomías de la hoja *Clasificación* como catálogo versionado (no enums hardcodeados: son ~150 valores que evolucionan).
- **`preventionIncidentFollowups`** (nueva) — seguimiento quincenal: `incidentId`, `dueAt`, `note`, `status`, `evidenceRef`.
- Extender el CHECK de `notification_type` si se requieren hitos SLA adicionales, o modelar los SLA de paso (3h/24h/72h) como filas de `preventionIncidentNotifications` con `deadlineAt` (reutiliza el motor de recordatorios existente).
- **`kind`** en `preventionIncidents`: distinguir `accident` / `incident` / `near_miss` (cuasi-accidente) para elegir el formulario liviano vs. completo.

### B.4 El puente con el PDTP (la razón de todo esto)

Cada transición del caso emite una ejecución PDTP idempotente:

| Paso RE-20 / hito | Actividad(es) PDTP acreditada(s) | Clave idempotente |
|---|---|---|
| Aviso registrado | 66, 67 | `incident:{casoId}:aviso` |
| Informe preliminar enviado (≤3 h) | 68, 70 | `incident:{casoId}:preliminar` |
| Declaración del involucrado (≤24 h) | 69 | `incident:{casoId}:declaracion` |
| Difusión en turnos | 71 | `incident:{casoId}:difusion-turno` |
| DIAT emitida (≤24 h) | 72 | `incident:{casoId}:diat` |
| Investigación definitiva (≤72 h) | 73 | `incident:{casoId}:investigacion` |
| Informe definitivo enviado | 74 | `incident:{casoId}:informe-def` |
| Difusión de medidas (≤48 h) | 75 | `incident:{casoId}:difusion-medidas` |
| Seguimiento de medidas | 76 | `incident:{casoId}:seguimiento:{iter}` |
| Expediente archivado | 77 | `incident:{casoId}:archivo` |
| ONE PAGE difundido (≤24 h) | 78 | `incident:{casoId}:one-page` |

Regla: la ejecución PDTP se emite **al alcanzar el estado que acredita trabajo real**, no al crear el borrador (principio 5.2 del maestro). Si el caso se reabre/anula, las ejecuciones vinculadas se revierten o pasan a revisión (INT-01, regla de reversión).

---

## Parte C — Fases de implementación

Orden por dependencia y valor. Cada fase deja tests corriendo (pglite para servicios, contract para invariantes) y typecheck/lint limpios.

### Fase 0 — Gobierno y reglas de conteo (fundación, barata)
- **G1. [HECHO 2026-07-22]** Quita de la actividad 21 aplicada (86 actividades; ver §A.3).
- **G2a. [HECHO 2026-07-22]** **R3 (techo)** en `compliance.ts`/`getPdtpComplianceIndicators`: la ejecución que aporta al indicador se capa en `min(ejecutado, planificado)` **por actividad-mes** (no por celda semanal, para tolerar correr una actividad otra semana del mismo mes; no por total mensual, para no compensar entre actividades). El crudo permanece en `pdtpExecutions`. Test reescrito (`caps overcompliance at the planned quantity per cell…`) + ajuste del test de scope. Reemplaza la decisión previa "mostrar sobrecumplimiento completo".
- **G2b. R1 (todo-o-nada)** — **NO accionable aún:** requiere una fuente para "cantidad de sujetos esperados por faena" (p. ej. 10 extintores) que hoy no existe. Ver faltantes.
- **G3. R5+R10** (firma Legal activa) — **pendiente:** es un refactor de la máquina de estados de aprobación (hoy activación separada con guard de digest + segregación, con tests que lo fijan). Ver faltantes.
- **G4. [HECHO 2026-07-22]** Reconciliación del plan maestro: descartes (A.1) y reaperturas (A.4) reflejados; **§1.3/GOV-05 (sobrepaso de segregación) descartado** por R6 (respuesta 5.4: "una persona por rol").

### Fase 1 — Aplicabilidad por faena y cobertura (R4, R2)
- **1.1** Regla automática de aplicabilidad por dotación (CPHS ≥25) sobre `pdtpActivityWorksiteExclusions`, con UI de gestión para Jefatura.
- **1.2** `indicatorMode` de **cobertura por padrón** (R2): denominador = personas aplicables de la faena; numerador = personas alcanzadas. Aplica a 54, 56 y campañas.

### Fase 2 — Motor de auto-acreditación (INT-01, la matriz aprobada)
- **2.1** Servicio genérico `accreditPdtpFromEvent(sourceType, sourceId, worksiteId, activityRefs, quantityRule)` idempotente sobre `pdtp_executions.idempotency_key`, con reversión ante anulación.
- **2.2** Conectar los grupos **inequívocos primero**: inspecciones/checklists (aplicando R1 todo-o-nada), capacitaciones (sesión cerrada), EPP (acta), CPHS (acta), alcotest, emergencias. Cada conexión con sus pruebas (evento válido → una ejecución; borrador no acredita; reintento no duplica; sin alcance no vincula; anulación revierte).
- **2.3** Enlace bidireccional en UI (desde PDTP a la fuente y viceversa), reutilizando `getPdtpCoverage`/`LinkSourceDialog`.

### Fase 3 — Campañas con registro propio (R9)
- Registro de campaña (85-89) con fecha, **padrón de personas alcanzadas** y evidencia de difusión; acredita por cobertura (R2).

### Fase 4 — Módulo de investigación RE-20 (Parte B)
- **4.1** Taxonomías: seed del catálogo de clasificación (B.3) desde la hoja *Clasificación*.
- **4.2** Extender investigación: análisis causal estructurado + evaluación de riesgo + informe preliminar con SLA 3 h + informe definitivo con firmas.
- **4.3** Declaraciones/entrevistas (69) y ONE PAGE de difusión (78) con sus SLAs.
- **4.4** Cuasi-accidente (`kind='near_miss'`, formulario liviano RE-20-11).
- **4.5** Seguimiento quincenal (76) sobre el motor de recordatorios existente.
- **4.6** Auto-acreditación de las 66-78 según la tabla B.4.
- **4.7** Salida del expediente del caso (77) integrada al expediente auditor PDTP.

### Fase 5 — Suplencias y avisos (R7, R8)
- **5.1** Cuentas temporales de reemplazo creadas/configuradas por Jefatura, con vigencia acotada y ampliable (R7).
- **5.2** Confirmar que los avisos siguen resolviéndose por faena+rol sin preferencias individuales (R8); cerrar §6.3 en consecuencia.

### Fase 6 — Puesta en marcha limpia (reemplaza la Fase 7 del maestro)
- **6.1** Bootstrap del programa 2026 (fuente de 87/86 congelada) en producción, con firma Legal que activa (R5/R10). **Sin migración ni marcha paralela.**
- **6.2** Pruebas de humo por rol × faena (prevencionista, JDPR, Legal, responsable de faena, usuario sin acceso).
- **6.3** Acta de aceptación de Jefatura de Prevención y Legal; matriz negativa rol × faena × endpoint.

---

## 2. Estrategia de pruebas

- **Reglas de conteo (G2):** test directo — numerador topado por planificado (R3); inspección con 5/10 sujetos = 0 (R1); cobertura = alcanzados/aplicables (R2).
- **Ciclo de firma (G3):** firma Legal transiciona a `active`; segregación estricta rechaza doble rol (R6).
- **Auto-acreditación (Fase 2):** por cada grupo — evento válido acredita una vez; borrador/cancelación no acredita; reintento idempotente; sin alcance no vincula; anulación revierte.
- **Investigación RE-20 (Fase 4):** cada paso emite la ejecución PDTP correcta y solo una; SLAs generan recordatorios; reapertura del caso revierte las ejecuciones; taxonomías validan contra el catálogo.
- **Suite existente verde:** contract (adaptador), catalog (parser), integración pglite. Typecheck y lint limpios.

---

## 3. Decisiones que aún faltan (no bloquean el arranque)

1. **Quita de la actividad 21** — requiere autorización de Jefatura + re-aprobación Legal (G1). Es la única que bloquea tocar el seed.
2. **4.2** — la lista exacta de qué actividades no aplican en qué faenas más allá del CPHS (la regla ≥25 está clara; el resto es config que Jefatura carga en la UI de la Fase 1).
3. **3.2** — quedó sin responder porque 3.1 fue "no"; si nunca se necesita el RE-36, el ítem muere.

**Camino crítico:** Fase 0 (G2/G3) desbloquea las reglas de conteo y firma sin depender de nadie. La Fase 4 (RE-20) es el bloque más grande y el de mayor valor operacional, pero se apoya en el motor de la Fase 2.

---

## 4. Lo que falta (estado al 2026-07-22)

**Hecho y verificado (verde):** G1 (quita de 21 → 86), G2a/R3 (techo mensual), R6 (descartado el sobrepaso de segregación), G4 (reconciliación documental). Suite PDTP verde, typecheck y lint limpios.

**Faltante — accionable con una decisión menor o un dato:**

| Ítem | Qué falta | Bloqueo | Sketch de implementación |
|---|---|---|---|
| **R1 — inspecciones todo-o-nada** | Que una inspección de 10 extintores con 5 hechos cuente 0. | **Falta la fuente de "sujetos esperados por faena"** (cuántos extintores/contenedores/equipos tiene la faena). Hoy no existe ese padrón por actividad. | Añadir `expectedSubjectCount` por `(actividad, faena)` (columna en `pdtp_activity_schedule_overrides` o tabla nueva) + en `compliance.ts`: si la actividad es de tipo inspección-con-sujetos y `sujetosCubiertos < esperados`, aportar 0. Decidir de dónde sale el número (registro de flota para equipos; entrada manual para extintores). |
| **R5 — firma Legal activa el programa** | **[HECHO 2026-07-22]** | — | Resuelto en la **capa de acción** (no en el motor, para no romper los 43 llamadores de `activatePdtpProgram`): `decidePdtpApprovalStepAction` y `signPdtpProgramLegalAction` llaman `activatePdtpIfAllStepsApproved` — si tras la aprobación no quedan pasos requeridos pendientes, activan con el mismo actor. Tests de acción 44/44. El servicio mantiene la activación explícita/idempotente para N pasos. |
| **Fase 1 — aplicabilidad por faena (R4)** | **[HECHO 2026-07-22]** núcleo. Falta solo la UI para dispararlo/ver overrides. | — | (1) **Foundational:** `loadProgramScheduleAndExecutions` ahora **respeta** las exclusiones por faena (antes se firmaban pero no se aplicaban al cómputo) → una actividad excluida no aporta al denominador ni al ejecutado de esa faena. (2) `syncPdtpCphsHeadcountExclusion(programId, worksiteId, userId)` cuenta trabajadores activos y excluye/incluye las actividades CPHS (`PDTP_CPHS_ACTIVITY_NUMBERS=[11,12,13,14]`, `PDTP_CPHS_MIN_HEADCOUNT=25`). Corre en autoría (draft). Test end-to-end verde. |
| **Fase 1 — cobertura por padrón (R2)** | Indicador tipo "% de personas alcanzadas" para 54, 56 y campañas. | Necesita el padrón de personas aplicables por actividad/faena. | Nuevo `indicatorMode='coverage'` (ya hay enum extensible en `pdtp_activities`); denominador = personas aplicables, numerador = alcanzadas (desde asistencia de sesión/campaña). |
| **Fase 2 — motor de auto-acreditación (R1/R9, INT-01)** | Convertir eventos reales (checklist aprobado, sesión cerrada, acta) en ejecuciones PDTP idempotentes. | La clave idempotente y `preventionPdtpSourceLinks` ya existen; falta el emisor y los conectores por dominio. | `accreditPdtpFromEvent(sourceType, sourceId, worksiteId, activityRefs, quantityRule)` sobre `pdtp_executions.idempotency_key`, con reversión ante anulación; conectar primero inspecciones/capacitaciones/EPP/CPHS/alcotest. |
| **Fase 3 — campañas con registro propio (R9)** | Registro de campaña (85-89) con fecha, padrón y evidencia. | Depende de Fase 1 cobertura. | Entidad/checklist de campaña con asistentes; acredita por cobertura. |
| **Fase 4 — módulo RE-20** | Extender `prevencion/incidentes` al flujo completo (informe preliminar 3h, taxonomías de clasificación, análisis causal estructurado, declaraciones, ONE PAGE, cuasi-accidente, seguimiento quincenal) y cablear las 66-78. | El bloque más grande; se apoya en Fase 2. Ver Parte B. | Migraciones aditivas de Parte B.3 + auto-acreditación de la tabla B.4. |
| **Fase 5 — cuentas temporales de reemplazo (R7)** | Cuenta temporal creada/configurada por Jefatura con vigencia acotada. | Feature de auth/usuarios; ninguna dependencia de datos. | Cuenta con `validUntil` y rol heredado, gestionada por Jefatura; los recordatorios ya resuelven por faena+rol. |
| **Fase 6 — puesta en marcha** | Bootstrap productivo + actas de aceptación. | **Producción y personas** (no accionable por código). | `bootstrap-pdtp-2026.ts` ya listo; requiere ejecución en prod y firmas. |

**Descartado por las respuestas (no se implementa):** migración de datos, marcha paralela, adaptador de compatibilidad RE-36 (§6.6), importación de las 6 E históricas, preferencias individuales de notificación (§6.3), permiso de sobrepaso de segregación (§1.3/R6).

# Auditoría: ¿cada actividad del programa preventivo se ejecuta y acredita desde un submódulo?

**Fecha:** 6 de septiembre de 2026

**Alcance:** las **81 actividades activas** de `pdtp-2026-v1` (68 `enganche`, 9 `constancia`, 4 `compuesta`) y los
submódulos de Prevención que deberían ejecutarlas y acreditarlas: Inspecciones, Capacitación, Habilitación del
trabajador (actas SST), Documentación, MIPER, Alcotest, Higiene y Vigilancia, EPP/Entregas, Incidentes, CGRD,
Emergencias, Campañas, CPHS, Indicadores y Constancias.

**Continúa** [AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md](AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md)
y [AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md](AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md). No repite lo
que esas dos ya cerraron; registra lo que sigue abierto y lo que apareció nuevo.

**Método:** por cada actividad se contestaron tres preguntas. *¿Hay dónde ejecutarla?* (un submódulo con el
instrumento vigente y un usuario que pueda usarlo). *¿El hecho llega al PDTP?* (el conector tiene llamador real desde
una acción de UI y el evento sobrevive). *¿Cuenta?* (la ejecución entra al indicador con el calendario y la fecha de
activación que la jefatura decidió). Se verificó contra el árbol de trabajo actual y contra `bodega_dev` en modo
lectura. Los 45 conectores exportados se trazaron hasta su acción de servidor.

**Verificación ejecutada:** `npm run db:preflight-pdtp-wiring` sobre `bodega_dev`; 84 tests focalizados en verde
(`pdtp-fulfillment`, `pdtp-accreditation`, `responsible-execution`, `operational-work-queue-pdtp-activity-source`,
`navigation-targets-exist`, `prevention-rbac`). No se ejecutó la suite completa ni E2E.

---

## 1. Respuesta corta

**Hoy ninguna de las 81 puede generar cumplimiento**: el programa sigue en `draft`, con cero ejecuciones, cero
obligaciones y cero eventos de cumplimiento. Eso no cambió desde el 3 de septiembre.

**Suponiendo que se active hoy** (septiembre, decisión D01 "desde el mes en curso"), el estado por actividad es:

| Situación tras activar | Actividades | N° |
|---|---:|---|
| Submódulo listo, conector cableado y con celdas exigibles en 2026 | **27** | 6, 7, 11, 15, 16, 17, 18, 19, 20, 22, 23, 28, 30, 31, 32, 35, 36, 42, 43, 52, 61, 66–78 (13), 84¹ |
| Submódulo listo pero **sin instrumento vigente** (plantilla o curso sin publicar) | **26** | Inspecciones 10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65 · Capacitación 37, 38, 51, 53, 54, 56, 57, 63 y también 16, 55, 58, 59, 60² |
| Conector **sin llamador real**: nunca acredita | **1** | 62 |
| Acredita por un acto cuyo permiso **ningún responsable tiene y la compuerta no lo ve** | **1** | 9 |
| **Todo su calendario 2026 es anterior a septiembre**: bajo D01 no tienen nada que cumplir ni cuentan | **22** | 1, 3, 44, 45, 46, 47, 48, 49, 50, 55, 58, 59, 60, 79, 80, 81, 82, 83, 85, 86, 87, 88 |

¹ La N°84 exige plan aprobado y los 7 planes están en `draft`; el submódulo existe.
² La N°16, 55, 58, 59 y 60 aparecen en dos filas: sin curso publicable y, además, cuatro de ellas con calendario
anterior a septiembre.

Los conjuntos se traslapan; sumados sin repetir cubren las 81. Lo que mueve el número no es código nuevo sino cuatro
decisiones/configuraciones: activar, aprobar 13 plantillas, publicar 13 versiones de curso y aprobar 7 planes. Los
defectos de código de la §3 son pocos pero dos de ellos dejan cumplimientos fantasma o invisibles.

---

## 2. Matriz por familia (las 81)

| Familia | N° | Submódulo | Acto que acredita | Ejecutable hoy | Acredita al activar | Obstáculo |
|---|---|---|---|---|---|---|
| Programa | 1 | PDTP · aprobaciones | firma Legal/RRHH | sí (in_review) | **no** | evento cae en `error` porque el programa aún no está activo al firmar; su única celda es enero (§3.3, §5) |
| Indicadores | 7 | Indicadores SST | cerrar período mensual | sí | sí | — |
| Gobernanza | 9 | CPHS · revisión por la dirección | cerrar revisión | **no por sus responsables** | sí | `prevention:governance:review` sólo `administrador`/`jefa_chome`; el contrato la declara "sin destino" y la compuerta no lo verifica (§3.4) |
| Gobernanza | 11 | CPHS | constituir comité / designar delegado | sí | sí | obligación la abre el barrido diario; 0 comités hoy |
| Inspecciones | 10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65 | Inspecciones | ejecutar run | **no** | **no** | 13 plantillas con número en `draft`; 6 vigentes sin número (24, 25/26, 29, 33, 34) acreditan nada en silencio; 7 sin ningún instrumento vigente; `inspeccion_taller` con dos borradores duplicados (§4.1) |
| Capacitación | 16, 37, 38, 51, 53, 54, 55, 56, 57, 58, 59, 60, 63 | Capacitación | cerrar sesión con asistencia válida | **no** | **no** | los 13 cursos tienen **cero versiones**; `createTrainingSession` exige versión `published`; publicar exige `prevention:training:approve` que sólo tienen `administrador` y `jefa_chome` (§4.2) |
| Habilitación | 15, 18, 19, 23, 52 | Evaluaciones SST · acta `trabajador_nuevo` | cerrar acta | sí (`sst:close`: JDPR, PRF, admin) | sí | 0 actas en dev; N°19 acredita sólo si hay ingreso ese mes (§6.1) |
| Habilitación | 17 | Evaluaciones SST · acta `identificacion_sensibles` (RE-28) | cerrar acta | sí | sí | cobertura 95 % de la dotación **por mes**, 9 meses (§6.2) |
| Documentación | 36 | Documentación SST | acuse de difusión MIPER-DIF | sí | sí | 0 documentos de tipo MIPER-DIF |
| Documentación | 43 | Documentación SST | publicar PTS | sí (segregado) | sí | 0 documentos de tipo PTS; 58 PROC en borrador sin tipificar como PTS |
| MIPER | 35 | MIPER | publicar revisión | sí (segregado) | sí | 0 matrices |
| Alcotest | 30, 31, 32 | Alcotest | registrar control / envío DO-48 | sí | sí | — |
| Higiene | 45, 46, 47, 48, 49, 50 | Higiene y Vigilancia | medición / pronunciamiento / control asistido | sí | sí | **las 6 tienen todo su calendario antes de septiembre** (§5); padrón GES vacío |
| EPP | 62 | Entregas | registrar entrega de EPP | sí (la entrega) | **no, nunca** | el conector cuelga de `registerWorkerEppDelivery`, que no tiene llamador; `/entregas` usa `registerWorkerStockDelivery` sin cableado PDTP (§3.1) |
| Incidentes | 66–78 | Incidentes (RE-20) | cada hito del expediente | sí | sí | obligaciones por incidente; 0 incidentes en dev |
| CGRD | 79, 80, 81 | CGRD | constituir / publicar matriz / cerrar acta | sí (80 segregada) | sí | calendario ene–may, anterior a septiembre (§5); 0 comités/matrices |
| Emergencias | 83 | Emergencias | aprobar plan | sí (segregado) | sí | 7 planes en `draft`; única celda: marzo (§5) |
| Emergencias | 84 | Emergencias | completar simulacro | **no** hasta aprobar plan | sí | 7 planes en `draft`; celda de septiembre vigente |
| Campañas | 85, 86, 87, 88, 89 | Campañas | cerrar campaña | sí | sí | 35 campañas en `draft` (correcto); 85–88 con calendario anterior a septiembre (§5) |
| Constancias | 3, 6, 20, 22, 28, 42, 44, 61, 82 | Constancias | constancia enviada | sí | sí | 3, 44 y 82 con calendario anterior a septiembre; evidencia mínima declarada pero no exigida (§3.6) |

---

## 3. Defectos de código

### 3.1 · N°62 nunca acredita: el conector está cableado a un servicio sin llamador

`onEppDeliveryCompleted` se llama desde
[deliveries-worker-epp.ts:241](lib/services/deliveries-worker-epp.ts#L241) dentro de `registerWorkerEppDelivery`.
Esa función **no tiene ningún llamador de producción**: sólo la re-exporta
[deliveries.ts:12](lib/services/deliveries.ts#L12) y la usan tests. El flujo real de `/entregas`
([entregas/actions.ts:60](app/(app)/entregas/actions.ts#L60)) llama a `registerWorkerStockDelivery`, y
`lib/services/deliveries-worker-stock.ts` no tiene una sola referencia al PDTP. Tampoco `prevention-epp.ts`.

El comentario del propio archivo dice que el conector "nunca tuvo llamador" y que ahora lo tiene: la corrección se
hizo un nivel más abajo del que se usa. La compuerta no lo detecta porque la N°62 está en
`STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` (número fijo en el conector), que verifica que el número exista en código, no
que el código corra.

**Arreglo:** mover la llamada a `registerWorkerStockDelivery` filtrando productos de familia EPP, y anular al anular
la entrega (`voidWorkerStockDelivery` tampoco revierte). O borrar el servicio huérfano para que el código no prometa
lo que no hace.

### 3.2 · `/pendientes` y Constancias muestran deudas anteriores a la activación que nadie puede pagar

La cola operacional toma `MIN(month)` con `month <= mes actual` desde enero
([operational-work-queue.ts:812-828](lib/services/operational-work-queue.ts#L812-L828)) y
`listPdtpConstanciaActivities` hace lo mismo ([constancias.ts:92-101](lib/services/pdtp/constancias.ts#L92-L101)).
Ninguna de las dos aplica `filterPdtpRowsFromActivation`. La planilla, el reporte de gestión, el indicador y los
recordatorios sí lo aplican.

Al activar en septiembre bajo D01, `markPdtpExecution` rechaza cualquier período anterior a la semana de activación
(*"El programa aún no estaba activo en el período seleccionado"*) y el formulario recorta los meses ofrecidos. La
tarjeta de `/pendientes` dirá "Vencida · enero" y el formulario no ofrecerá enero: la deuda no se puede saldar y no
desaparece nunca. Con 542 de las 797 celdas planificadas antes de septiembre, la mayoría de las tarjetas serían
fantasma el día uno.

**Arreglo:** filtrar por `activatedAt` en las dos consultas, con la misma regla de `period.ts`.

### 3.3 · La N°1 se acredita antes de que exista programa activo, y nadie reconcilia

`onPdtpProgramLegallyApproved` se dispara al aprobar el paso `legal`
([approval-flow.ts:319](lib/services/pdtp/approval-flow.ts#L319)), cuando el programa está `in_review`. El motor
lanza `PdtpNoActiveProgramError` y `recordPdtpFulfillmentEvent` deja el evento en `error`. Es recuperable, pero:

- `reconcilePdtpFulfillmentEvents` tiene **un solo llamador**: el script manual
  `scripts/reconcile-pdtp-fulfillment-events.ts`. No lo invoca `activatePdtpProgram`, no hay cron, no hay workflow.
- Ninguna pantalla ni alerta lee `pdtp_fulfillment_events`. Un evento `pending` o `error` es invisible hasta que
  alguien corre el script (Fase 6 del plan del 2 de septiembre, "alertas operacionales", sigue sin hacer).
- Aun reconciliada, la ejecución queda en la semana de la firma; si la activación cae en una semana posterior, el
  filtro de activación la excluye del indicador. Y la única celda planificada de la N°1 es enero/semana 4, que bajo
  D01 desaparece.

**Arreglo:** llamar al reconciliador al final de `activatePdtpProgram` (fuera de la transacción) y desde el cron
semanal; exponer conteo de `pending`/`error` en el tablero del programa o en el preflight.

### 3.4 · La N°9 tiene destino real y el contrato la declara "sin destino"

`fulfillment-contract-2026.ts` marca la N°9 con `sinDestino(...)` y `permission: null`, así que la compuerta no
verifica permiso. Pero el acto que la acredita es `closeManagementReview`
([prevention-cphs.ts:885](lib/services/prevention-cphs.ts#L885)), que exige `prevention:governance:review`, y ese
permiso lo tienen sólo `administrador` y `jefa_chome`. Los responsables declarados son `gerente_legal_rrhh`, `jdpr` y
`prf`: ninguno puede cerrarla. El preflight reporta 76/5/0 porque esta actividad está exenta por contrato.

Es el mismo patrón que la N°36/43/84 tuvieron en la lista blanca: una exención escrita para un caso ("es gobernanza")
que oculta una verificación que sí correspondía. **Arreglo:** declarar `module: "cphs"`,
`permission: "prevention:governance:review"`, y decidir si el permiso se otorga a la JDPR o si la actividad queda
segregada con motivo escrito.

### 3.5 · Reversiones que faltan

El subagente de trazado confirmó que el hecho se revierte correctamente en Inspecciones, Capacitación, Vigilancia e
Indicadores. **No** se revierte, aunque el servicio tiene la operación inversa:

| N° | Acredita | Operación inversa que no revoca |
|---|---|---|
| 11 | `onCphsCommitteeConstituted` | `dissolveCommittee`, `expireLapsedCommittees` |
| 79 | `onGrdStructureEstablished` | `dissolveGrdCommittee` |
| 81 | `onGrdMeetingClosed` | `cancelGrdMeeting` |
| 84 | `onEmergencyDrillCompleted` | `cancelEmergencyDrill` |
| 57 | `onCompetencyObtained` | `revokeCompetency` (la obligación se reabre sólo en el barrido siguiente) |
| 15, 17, 18, 19, 23, 52, 63 | conectores de acta | `deleteEvaluation` existe, contradiciendo la premisa "acta inmutable por DS 44" con que se justificó no tener reversión |

Además: `invalidateClosedIndicatorPeriod` ([prevention-indicadores.ts:845](lib/services/prevention-indicadores.ts#L845))
y `resolveWorkerEntryActor` ([worker-lifecycle-connector.ts:133](lib/services/pdtp-adapters/worker-lifecycle-connector.ts#L133))
están exportados y no tienen ningún llamador.

### 3.6 · Una constancia se puede enviar sin la evidencia mínima que declara

`pdtpExecutionSchema` deja `evidenceText`, `evidenceUrl` y `evidencePhotos` opcionales
([pdtp.ts:22-32](lib/validation/prevention-module/pdtp.ts#L22-L32)) y `markPdtpExecution` no consulta
`evidenceRequirement`. Las 9 constancias declaran evidencia mínima y la compuerta lo exige para enviar el programa a
revisión, pero al ejecutar la constancia esa exigencia es sólo un texto en la tarjeta. La única red es el aprobador.
El CTA de `/pendientes` tampoco preselecciona actividad ni período en Constancias (sólo `faena`), aunque el plan lo
pedía.

### 3.7 · Menores

- `onTrainingSessionClosed` acredita `Math.max(1, attendedCount)`: una sesión cerrada con cero personas que
  obtuvieron la competencia acredita 1. Inofensivo para `planned_vs_completed`, infla en 1 las de cobertura (16, 54, 56).
- N°11 acredita por dos caminos (ejecución directa + obligación). Como se mide por `closed_on_time`, la ejecución se
  ignora: redundante, no doble.
- La N°35 y la N°80 conservan la acreditación de una matriz que quedó `superseded`. Probablemente correcto, pero no
  está razonado por escrito como sí lo están el acta inmutable y los protocolos.

---

## 4. Configuración que corta la ejecución (verificado en `bodega_dev`)

La compuerta `assertPdtpFulfillmentCoverage` reporta **0 bloqueadores** y el preflight dice `ok: false` sólo por
las plantillas. Ninguno de los dos bloquea por lo que sigue:

### 4.1 · Inspecciones: 13 plantillas en borrador (sin cambios desde el 3 de septiembre)

| Caso | Actividades | Efecto |
|---|---|---|
| Vigente anterior sin número + borrador con número | 24, 25/26, 29, 33, 34 | la inspección se ejecuta y **el PDTP no se entera** |
| Sin ninguna versión aprobada | 10, 27, 39, 40, 41, 64, 65 | no hay instrumento: no se puede ejecutar |
| Dos borradores del mismo código | `inspeccion_taller` 001 y 02, ambos `[27]` | aprobar uno deja al otro colgando |
| Ejecutante equivocado en la vigente | `reporte_equipos` v01 `platform_user` (D04 pide `declared_in_form`) | el JT no puede firmar el report de uso diario |

Aprobar exige `prevention:inspections:approve` (`administrador`, `prevencionista`). La UI existe
(`inspection-catalog.tsx`). **Orden obligatorio:** activar el programa antes de aprobar (D2 del informe anterior ya
lo protege para el camino transaccional, pero sigue siendo el orden correcto).

### 4.2 · Capacitación: 13 cursos sin ninguna versión (nuevo como bloqueo declarado)

Los 13 cursos que declaran número (`PDTP-16`, `PDTP-37`, `PDTP-38`, `PDTP-51`, `PDTP-53` a `PDTP-60`, `PDTP-63`,
`B-01`) tienen **cero filas** en `prevention_training_course_versions`. `createTrainingSession` rechaza
(*"Sólo puede dictarse una versión publicada del curso"*). Para dictar una sesión hay que crear la versión
(`prevention:training:manage`: JDPR, PRF, jefa_chome, admin), enviarla a revisión y publicarla con
`prevention:training:approve`, que tienen **sólo `administrador` y `jefa_chome`** y exige autor ≠ aprobador. La JDPR
no puede publicar un curso.

El preflight lista `coursesWithoutPublishedVersion` pero **no lo incluye en `ok`**
([preflight-pdtp-accreditation-wiring.ts:172-175](scripts/preflight-pdtp-accreditation-wiring.ts#L172-L175)).
Con las plantillas aprobadas, el diagnóstico diría "todo bien" con 13 actividades de capacitación imposibles de ejecutar.

Detalle para la N°16: si la versión de `PDTP-16` se crea con `assessmentType: "none"`, todos los asistentes cuentan
aunque la actividad sea "prueba de evaluación". Debe crearse con evaluación y nota de corte.

### 4.3 · Emergencias: 7 planes en `draft`

N°83 acredita al aprobar (cantidad = escenarios; hay 35, 5 por plan; 7 roles cargados, así que `assessPlanReadiness`
debería permitirlo). N°84 exige plan aprobado para programar un simulacro. Aprueban `prevencionista`, `jefa_chome`,
`administrador`. El preflight verifica **ausencia** de plan por faena, no su estado: con los 7 en borrador reporta
`worksitesWithoutEmergencyPlan: []`.

### 4.4 · Documentación: tipos configurados, cero documentos

`sst_document_types` tiene PTS `[43]` y MIPER-DIF ack `[36]`. Hay 99 documentos, todos en borrador y ninguno de
esos dos tipos (58 PROC, 32 FORMATO, 7 PROG, 1 INSTR, 1 POL). Hasta que un PTS se publique y una MIPER-DIF se
distribuya y acuse, las N°36 y N°43 no tienen hecho que acreditar.

### 4.5 · Padrones y datos maestros vacíos

`prevention_emergency_resources` (extintores) 0, `fuel_vehicles` 0, `prevention_exposure_group_members` 0,
`prevention_epp_requirements` 0, `prevention_legal_requirements` 0. Las actividades de cobertura (24, 50, 54, 56) caen
a la cantidad planificada: comportamiento correcto (H11), pero significa que "100 % de extintores" hoy equivale a
"1 inspección al mes". La N°56 sigue `decision_required` (sin fuente de padrón admisible).

### 4.6 · Sin membresía de faenas ni exclusiones

`pdtp_program_worksites` está vacío y `pdtp_activity_worksite_exclusions` también: las 81 actividades son exigibles
en las 7 faenas, incluida **Oficina Central (8 personas), Teno (3) y Horcones (4)**. Extintores, contenedores,
maquinaria, report de uso diario, campañas de conducción, CGRD y simulacros quedan planificados en la oficina. Es
la fuente más probable de incumplimiento estructural desde el primer mes. Es una decisión de Prevención (R4), no código.

### 4.7 · Personas detrás de los roles (sólo `bodega_dev`, no extrapolable)

`supervisor_terreno` 0 usuarios (responsable de 15 actividades), `gerente_legal_rrhh` 0 (firma del paso `legal`;
lo suplen `administrador`/`jefa_chome` con `prevention:pdtp:sign_legal`), `subgerente_operaciones` 0. El rol legado
`supervisor_faena` sigue en base con 1 usuario y 8 faenas, y no existe en `system-rbac.ts`.

---

## 5. El calendario y la decisión D01

D01 dice: *"desde el mes en curso; no se arrastra lo vencido de enero a agosto"*. El código lo implementa filtrando
por la semana de activación. Aplicado en septiembre a `pdtp-2026-v1`:

- **542 de 797 celdas planificadas (68 %) quedan fuera**; quedan 255 celdas, 319 unidades planificadas.
- **22 actividades scheduled tienen todo su calendario antes de septiembre** y bajo D01 no tienen nada que cumplir
  en 2026: no aparecen en pendientes, no entran al indicador y `markPdtpExecution` no acepta sus períodos.

| Familia | Actividades sin celdas exigibles tras septiembre | Último mes planificado |
|---|---|---|
| Programa | 1 | enero |
| Constancias | 3, 44, 82 | feb, feb, mar |
| Higiene y Vigilancia | 45, 46, 47, 48, 49, 50 | feb–abr |
| Capacitación | 55, 58, 59, 60 | mar–jun |
| CGRD | 79, 80, 81 | feb, feb, may |
| Emergencias | 83 | marzo |
| Campañas | 85, 86, 87, 88 | feb–ago |

Esto convierte en inertes seis conectores completos (Higiene, CGRD, plan de emergencia, campañas 85–88) para todo
2026 aunque el submódulo funcione perfecto. Hay que decidir: **reprogramar celdas** hacia sep–dic (edición de
calendario o `pdtp_activity_schedule_overrides`, hoy con 0 filas) o **aceptar** que esas 22 no se miden este año y
dejarlo escrito. Ninguna herramienta actual avisa de esto antes de activar.

---

## 6. Semántica que conviene confirmar con la jefatura

### 6.1 · N°19 se acredita con el acta de trabajador nuevo

El texto dice *"Mantener actualizada la carpeta de requisitos legales de las empresas, entrega EPP, IRL, RIOHS con
cartas de SEREMI e inspección"*. El contrato la manda al acta SST y acredita sólo cuando en un mes cierra un acta con
15+18+23 conformes. Es mensual (12 celdas): un mes sin ingresos sólo se cumple marcando a mano. La decisión D12
("definir la lista de documentos por faena") apuntaba a Requisitos Legales/Documentación. Una de las dos lecturas
está mal.

### 6.2 · N°17 exige 95 % de la dotación cada mes

Modo `coverage` sobre `dotacion` con meta 95 % y 9 celdas (feb–oct). El numerador son actas RE-28 cerradas **en ese
mes**: para cumplir hay que barrer el 95 % de la dotación todos los meses. Si el RE-28 es un barrido anual con
actualización por ingreso, el calendario o el modo están mal. Bajo D01 quedan sólo septiembre y octubre.

### 6.3 · N°25 con ejecutante `conductores_operadores_choferes`

Resuelto por D21 (`operated_by_role_name = jefe_terreno`), pero la plantilla vigente `reporte_equipos` v01 sigue
con `executor_of_record = platform_user`. La v02 corrige y está en borrador (§4.1).

---

## 7. Lo que sí está verificado y funciona

- **40 de 45 conectores** llegan a una acción de servidor y a una pantalla: Inspecciones (completar/revertir),
  Capacitación (cerrar/cancelar), CPHS (constituir, delegado, revisión), Emergencias (aprobar plan, simulacro),
  MIPER (publicar), Documentación (publicar, acuse), Indicadores (cerrar, reabrir por dos vías), CGRD (3), Higiene
  (4), Incidentes (10 hitos), actas SST (trabajador nuevo y RE-28), alta de trabajador (abre 15/52), barridos de
  organización preventiva (11) y brecha de competencia (57) vía cron.
- **No queda ningún `try { acreditar } catch { log }`**: todo pasa por el libro durable de eventos.
- `/pendientes` resuelve el destino con el contrato (D5 del 5 de septiembre está cerrado); ninguna ruta del contrato
  es 404.
- Constancias existe como submódulo con permisos propios, navegación y compuerta de mecanismo en el server action.
- La compuerta ya verifica cableado y destino para `compuesta`; N°36/43/84 salieron de la lista blanca.
- Responsables: 76 `ok`, 5 segregadas con motivo, 0 sólo-manual.
- 84 tests focalizados en verde; el árbol tiene cambios sin commitear en UI del PDTP (refactor de `MONTH_LABELS`)
  que no afectan a estos hallazgos.

---

## 8. Qué hacer, en orden

| # | Acción | Cierra | Código |
|---|---|---|---|
| 1 | Decidir el calendario post-D01: reprogramar las 22 actividades de la §5 o aceptar que no se miden en 2026 | 22 | edición de datos |
| 2 | Definir exclusiones por faena (Oficina Central, faenas de 3–4 personas) antes de activar | riesgo estructural | datos |
| 3 | Cablear N°62 en `registerWorkerStockDelivery` (+ reversión en anulación) | 1 | sí |
| 4 | Filtrar por activación en la cola de pendientes y en Constancias | fantasma día 1 | sí, menor |
| 5 | Reconciliar eventos al activar y desde el cron semanal; exponer `pending`/`error` | N°1 y todo evento previo | sí, menor |
| 6 | N°9: declarar destino `cphs` / `governance:review` en el contrato y decidir grant o segregación | 1 | sí, menor + decisión |
| 7 | Preflight: incluir cursos sin versión publicada y planes en `draft` en `ok`; compuerta de activación idem | evita activar con 28 inejecutables | sí, menor |
| 8 | Activar `pdtp-2026-v1`; **después** aprobar las 13 plantillas y resolver el duplicado de `inspeccion_taller` | 13 | no |
| 9 | Crear y publicar las 13 versiones de curso (PDTP-16 con evaluación); decidir si la JDPR recibe `training:approve` | 13 | datos + RBAC |
| 10 | Aprobar los 7 planes de emergencia | 2 | no |
| 11 | Exigir evidencia en constancias cuando `evidenceRequirement` no está vacío; preseleccionar actividad/período desde `/pendientes` | 9 | sí |
| 12 | Cablear reversiones de 11, 79, 81, 84 y `deleteEvaluation`; borrar `resolveWorkerEntryActor` e `invalidateClosedIndicatorPeriod` o darles llamador | integridad | sí |
| 13 | Confirmar N°19 y N°17 con la jefatura (§6) | 2 | depende |

Los pasos 1, 2, 8, 9 y 10 son los que mueven el número; 3, 4 y 5 evitan cumplimientos fantasma o invisibles; 6 y 7
evitan que la próxima brecha vuelva a pasar en verde.

---

## 9. Alcance de la verificación

Todo se comprobó contra el código del árbol de trabajo y contra `bodega_dev` (7 faenas, 112 trabajadores, cero
actas, cero incidentes, cero matrices, cero sesiones). Los hallazgos de las §3, §5 y §6 son de código y de calendario
firmado, y aplican a cualquier entorno. Los de la §4 son de configuración: los scripts de despliegue siembran
plantillas, cursos, tipos y campañas, pero **no aprueban plantillas, no crean versiones de curso ni aprueban planes**
a propósito; producción debe contrastarse con `npm run db:preflight-pdtp-wiring`. No se corrió la suite completa ni
Playwright.

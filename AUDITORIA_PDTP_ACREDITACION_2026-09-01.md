# Auditoría de mecanismos de acreditación del PDTP 2026

**Fecha:** 1 de septiembre de 2026

**Alcance:** las 87 actividades activas del programa `pdtp-2026-v1` ("Programa de Trabajo Preventivo SG-SST 2026"), contrastadas una a una contra el motor de acreditación, sus conectores, las plantillas y catálogos que los alimentan, y el camino manual de la planilla.

**Pregunta que responde:** ¿se puede marcar cumplimiento de las 87 desde la plataforma?

**Resultado:** **sí, las 87 admiten marca manual**, pero el programa está en `draft` y ninguna ejecución entra hasta activarlo. Sólo **17 se acreditan solas**; otras **30 tienen el conector cableado y les falta un dato**; las **40 restantes** dependen de que alguien las marque a mano, 15 por decisión de diseño y 25 porque el enganche prometido no está construido.

## 1. Resumen ejecutivo

El formulario de registro (`PdtpExecutionForm`) se dibuja en **todas** las filas de la planilla sin mirar el mecanismo de la actividad: sólo exige el permiso `prevention:pdtp:execute` y una faena seleccionada ([pdtp-sheet-table.tsx:285](<app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L285>) y [:447](<app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx#L447>)). No existe ninguna actividad que la plataforma impida marcar, ni por mecanismo ni por modo de programación: las 22 `on_demand` aparecen en la planilla igual que las 65 `scheduled`, y además tienen su propia vía por obligaciones.

La pregunta útil, entonces, no es si se puede marcar sino **cuántas se cierran sin intervención manual**. Ese es el eje de esta auditoría.

### Distribución de las 87

| Estado | Cant. | Criterio |
|---|---:|---|
| Automática hoy | 17 | Conector cableado con el número fijo en el código. Nadie toca el PDTP. |
| Automática por configurar | 30 | Conector cableado, pero el número se lee de un registro (plantilla, curso, campaña, plan) que hoy no lo declara. |
| Sólo manual por diseño | 15 | No hay módulo y el diseño decidió no construirlo. Se marca en la planilla con evidencia. |
| Brecha de código | 14 | Clasificadas `enganche`, pero ningún servicio llama al motor. |
| Submódulo inexistente | 6 | Dependen de "Habilitación del trabajador", que no tiene ruta, servicio ni tabla. |
| Baja sin aplicar | 5 | El diseño las retiró o las trasladó al CPHS; siguen `active` en la base. |

**Recomendación:** no empezar por los conectores nuevos. Las 30 "por configurar" se resuelven con datos y un comando, y suben la acreditación automática de 17 a 47 de 87 sin escribir una línea. Recién después conviene abrir los cinco `sourceType` que faltan.

## 2. Método

Se recorrió el catálogo desde tres fuentes independientes y se cruzaron:

1. **La base** (`bodega_dev`): `pdtp_activities`, `pdtp_activity_schedule`, `pdtp_activity_checklists`, `prevention_inspection_templates`, `prevention_training_courses`, `prevention_campaigns`, `prevention_emergency_plans`.
2. **El código**: el motor [lib/services/pdtp/accreditation.ts](lib/services/pdtp/accreditation.ts), los conectores de [lib/services/pdtp-adapters/](lib/services/pdtp-adapters/) y, sobre todo, **qué servicios de dominio los llaman de verdad**.
3. **La clasificación de diseño**: [scripts/apply-pdtp-2026-mechanisms.ts](scripts/apply-pdtp-2026-mechanisms.ts) y el documento [2026-08-12-pdtp-actividades-accionables-design.md](docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md).

El criterio decisivo fue el tercero cruzado con el segundo: **una actividad clasificada `enganche` cuyo módulo no importa el motor no tiene mecanismo**, por más que el diseño lo dé por resuelto.

### Servicios que acreditan hoy

Lista completa, obtenida de los importadores del motor:

| Servicio | Actividades | Origen del número |
|---|---|---|
| [pdtp/approval-flow.ts](lib/services/pdtp/approval-flow.ts) | N°1 | fijo en el conector |
| [prevention-cphs.ts](lib/services/prevention-cphs.ts) | N°9, N°11 | fijo en el conector |
| [prevention-incidents.ts](lib/services/prevention-incidents.ts) | N°66–78 | fijo en el conector |
| [deliveries-worker-epp.ts](lib/services/deliveries-worker-epp.ts) | N°62 | fijo en el conector |
| [prevention-inspections.ts](lib/services/prevention-inspections.ts) | 12 posibles | `prevention_inspection_templates.pdtp_activity_numbers` |
| [prevention-training.ts](lib/services/prevention-training.ts) | 12 posibles | `prevention_training_courses.pdtp_activity_numbers` |
| [prevention-campaigns.ts](lib/services/prevention-campaigns.ts) | 5 posibles | `prevention_campaigns.pdtp_activity_numbers` |
| [prevention-emergency.ts](lib/services/prevention-emergency.ts) | N°84 | `prevention_emergency_plans.pdtp_activity_numbers` |

Ningún otro servicio llama al motor. En particular **no acreditan** MIPER, Higiene, Vigilancia, Documentación SST, Indicadores, PPA ni Evaluaciones SST.

## 3. Bloqueos transversales

### 3.1 El programa está en borrador — bloquea las 87

`markPdtpExecution` rechaza toda ejecución mientras `pdtp_programs.status` no sea `active` ([executions.ts:34](<lib/services/pdtp/executions.ts#L34>)), y `pdtp-2026-v1` sigue en `draft`. Hoy no se puede registrar cumplimiento de ninguna actividad, automática o manual. La base lo confirma: `pdtp_executions` y `pdtp_obligations` están en cero filas.

Al activarlo hay un efecto conocido y documentado: cada responsable recibe de golpe todo lo vencido del año. Medido en Cholguán con el programa actual, son 46 actividades vencidas para el PRF, 13 para el administrador de contrato, 11 para el jefe de terreno, 10 para el supervisor y 3 para el jefe de mantención. **Hay que decidir si se arranca desde enero o desde el mes en curso** antes de activar.

### 3.2 El campo `mechanism` está vacío en las 87

Las 87 tienen `mechanism = 'sin_definir'`. La clasificación de los siete bloques existe en `apply-pdtp-2026-mechanisms.ts` y nunca se corrió contra esta base. Cualquier vista que filtre por mecanismo se ve vacía, y el submódulo Constancias —cuando se construya— no tendría de dónde sacar su lista.

## 4. Hallazgos

### H1 — El bloque de incidentes ya está terminado (corrige el diseño)

El documento de diseño marca las N°66–78 como "PROPUESTO" y dice que "falta construir el conector: son 13 llamadas". **Ya están.** [prevention-incidents.ts:28-38](lib/services/prevention-incidents.ts#L28-L38) importa las diez funciones de [incident-accreditation-connector.ts](lib/services/pdtp-adapters/incident-accreditation-connector.ts) y las llama en los diez puntos de cierre. Las trece actividades del flujo de accidentes se acreditan solas.

### H2 — La UI de campañas fija el número en `[85]`

[campanas-client.tsx:100](<app/(app)/prevencion/campanas/campanas-client.tsx#L100>) envía `pdtpActivityNumbers: [85]` literal al crear una campaña, y no existe ningún editor posterior del campo. **Las N°86 a N°89 no se pueden declarar desde la aplicación**: toda campaña creada por la UI acredita la N°85 y sólo la N°85. El servicio y la acción sí aceptan el arreglo completo; el que no lo ofrece es el diálogo de creación.

### H3 — El script de mecanismos quedó desfasado en dos actividades

`apply-pdtp-2026-mechanisms.ts` clasifica:

- **N°25 y N°26** como `formulario` ("pendientes de decisión A7"). Ya no lo son: la decisión del 2026-08-23 las enganchó a la plantilla `reporte_equipos`, que las declara juntas en [inspection-templates-2026.ts:89](lib/services/pdtp-adapters/inspection-templates-2026.ts#L89).
- **N°28** como `enganche`. Jefatura la dejó **manual** el 2026-08-21, y `PDTP_2026_INSPECTION_SPECS` la excluye con un comentario explícito.

Correr el script tal como está congelaría dos clasificaciones equivocadas.

### H4 — La N°83 tiene número pero no tiene disparador

`apply-pdtp-2026-mechanisms.ts` clasifica la N°83 ("Plan emergencia por cada amenaza") como `enganche` junto con la N°84. Pero el único punto que acredita en el módulo es `completeEmergencyDrill` → `onEmergencyDrillCompleted` ([prevention-emergency.ts:699](<lib/services/prevention-emergency.ts#L699>)), que lee los números **del plan** y se dispara **al completar un simulacro**. Publicar el plan de emergencia no acredita nada. Si se declara la N°83 en el plan, se acreditará recién cuando alguien corra un simulacro, que es otra cosa —y es justamente la N°84—.

### H5 — El cálculo de cobertura está implementado y ninguna actividad lo usa

El diseño lo lista como trabajo pendiente ("construir el cálculo de cobertura"). En realidad [compliance.ts:120-200](lib/services/pdtp/compliance.ts#L120-L200) ya resuelve el modo `coverage` completo, con padrón por faena desde `pdtp_activity_worksite_params` y caída a la dotación activa de `workers` cuando no hay parámetro cargado. Lo que falta es **dato**: las 87 están en `planned_vs_completed` (65) o `closed_on_time` (22), ninguna en `coverage`. Y hay UI para cambiarlo ([guided-activity-form.tsx](<app/(app)/prevencion/pdtp/[programId]/editar/guided-activity-form.tsx>), [worksite-adjustments-panel.tsx](<app/(app)/prevencion/pdtp/aplicabilidad/pdtp-aplicabilidad-client.tsx>)).

### H6 — Las plantillas de inspección están instaladas a medias

De las doce actividades que dependen del motor de inspecciones, **sólo `inspeccion_taller` (N°27) declara su número** en `prevention_inspection_templates.pdtp_activity_numbers`. Las otras once dejan `onInspectionCompleted` en no-op: la inspección se completa y el PDTP no se entera. Las definiciones de checklist sí existen todas en [lib/sst/definitions/](lib/sst/definitions/), incluidas las nuevas `inspeccion_area` y `caminata_seguridad`. Falta correr el instalador.

### H7 — Ningún curso de capacitación declara su actividad

`prevention_training_courses` tiene el campo y la UI lo expone ([training-catalog.tsx:327](<app/(app)/prevencion/capacitacion/catalogo/training-catalog.tsx#L327>), con placeholder `"54, 56"`), pero el único curso cargado —B-01, Manejo a la defensiva— trae `[]`. Doce actividades del programa dependen de este dato.

### H8 — Cinco `sourceType` faltantes sostienen 14 enganches prometidos

El union `PdtpAccreditationSourceType` admite ocho fuentes: `inspeccion`, `capacitacion`, `epp`, `cphs`, `emergencia`, `campana`, `incident` y `aprobacion_programa`. Faltan `documento`, `indicadores`, `miper`, `higiene` y `vigilancia`, que son las que necesitarían las N°7, 19, 35, 36, 43, 44, 45, 46, 47, 48, 49, 50 y 83. Los módulos existen; lo que no existe es el puente. (Los conteos de filas por módulo del diseño de agosto no se sostienen en `bodega_dev`: las siete tablas de higiene y vigilancia están en **cero filas**, así que el enganche de G6 no es verificable con datos reales en este entorno.)

### H9 — Cinco actividades siguen activas después de su baja

Las N°2 y N°5 fueron dadas de baja por el diseño; las N°12, 13 y 14 se trasladaron al programa propio del CPHS (D5). Las cinco siguen `status = 'active'` en `pdtp_activities` y sin clasificar en el script de mecanismos, así que inflan el denominador del programa. El camino correcto es `retirePdtpActivity` con motivo y fecha efectiva, no un `DELETE`: conservar el número mantiene válido el mapeo de plantillas.

### H10 — La N°21 mide lo mismo que las N°66–78

"Informes, cierres y seguimiento de accidentes e incidentes" es exactamente la suma del bloque de trece pasos, que ahora sí está cableado (H1). Mantenerla cuenta dos veces el mismo trabajo e infla el denominador del PRF y del administrador de contrato. Es una decisión de la jefa de prevención, no técnica.

### H11 — El padrón de cobertura se inferría de la dotación de la faena

*Detectado el 2026-09-02, al intentar cargar el padrón de la N°50.*

`compliance.ts` resolvía el padrón de una actividad de cobertura en tres pasos: parámetro cargado a mano →
**dotación activa de la faena** → cantidad planificada del mes. El paso del medio era una decisión deliberada,
no un descuido: la respuesta 1 del cuestionario 2026-07 dice "meta de cobertura = trabajadores esperados de la
faena", y `prevention-pdtp.test.ts` la cubría, incluido el detalle de que un trabajador inactivo no cuenta.

El problema es que sólo es correcta cuando el sujeto de la actividad **es** la dotación. Lo es para las N°17,
18 y 23 (identificación de sensibles, entrega de RIOHS, EPP inicial). No lo es para las otras dos que están en
cobertura: el sujeto de la **N°24** son los extintores y el de la **N°50** los trabajadores expuestos, que son
un subconjunto. Ahí la inferencia fabricaba un denominador sin relación con la actividad, y como el modo es
todo-o-nada el resultado era un **0 % permanente sin que nada fallara**: seis expuestos controlados de seis se
reportaban como 0 de 41.

**Resuelto.** La inferencia se retiró: sin padrón declarado la actividad se mide por la cantidad planificada,
como cualquier otra. No se la excluye del cálculo —eso encogería el denominador e inflaría el promedio de la
faena, premiando el no configurar—. La pantalla de aplicabilidad ahora marca **"Sin padrón"** en las
actividades de cobertura sin configurar, que antes se veían igual que una que no necesita padrón.

**Costo del cambio:** las N°17, 18 y 23 pierden el default que tenían y necesitan su padrón cargado para volver
a medirse por cobertura. Es el camino documentado de todos modos, y ahora la interfaz avisa cuando falta.

## 5. Inventario por estado

**Automáticas hoy (17):** N°1, 9, 11, 62, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78.

**Automáticas por configurar (30):**
- Inspecciones (12): N°24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65 — sólo la 27 está declarada.
- Capacitación (12): N°37, 38, 51, 53, 54, 55, 56, 57, 58, 59, 60, 63.
- Campañas (5): N°85, 86, 87, 88, 89 — bloqueadas por H2 salvo la 85.
- Emergencias (1): N°84.

**Sólo manual por diseño (15):** N°3, 6, 10, 20, 22, 28, 30, 31, 32, 42, 61, 79, 80, 81, 82.

Tres subgrupos merecen mirada aparte: el **alcotest** (N°30, 31, 32) y el **CGRD del DS 44** (N°79, 80, 81) no tienen módulo *ni decisión* —es el mismo patrón que llevó al CPHS a tener el suyo—, y la **N°10** (condiciones ambientales DS 594) es constancia sólo porque falta escribir su definición de checklist.

**Brecha de código (14):** N°7, 19, 21, 35, 36, 43, 44, 45, 46, 47, 48, 49, 50, 83.

**Submódulo inexistente (6):** N°15, 16, 17, 18, 23, 52.

**Baja sin aplicar (5):** N°2, 5, 12, 13, 14.

## 6. Plan de remediación

El detalle operativo, dividido en grupos con checklist para avanzar de a poco, está en
[tasks/TODO_PDTP_ACREDITACION_2026-09-01.md](tasks/TODO_PDTP_ACREDITACION_2026-09-01.md).

Resumen de la secuencia:

| Grupo | Actividades | Requiere código |
|---|---:|---|
| G0 Desbloqueo del programa | las 87 | no |
| G1 Plantillas de inspección | 11 | no |
| G2 Cursos de capacitación | 12 | no |
| G3 Plan de emergencia (N°84) | 1 | no |
| G4 Campañas | 5 | sí, menor (H2) |
| G5 Modo cobertura | 7 | no |
| G6 Higiene y vigilancia ✅ | 6 | sí |
| G7 Documentación SST | 3 | sí |
| G8 MIPER | 1 | sí |
| G9 Indicadores de faena | 1 | sí |
| G10 Plan de emergencia (N°83) | 1 | sí |
| G11 Habilitación del trabajador | 6 | sí, submódulo nuevo |
| G12 Limpieza del catálogo | 6 | no, decisiones |

### H12 — El padrón se firmaba junto al programa, de arrastre

*Detectado el 2026-09-02.*

`pdtp_activity_worksite_params` guarda en una misma fila tres cosas de naturaleza distinta, y el digest tomaba
la fila completa:

| Columna | Qué es | ¿Compromiso del programa? |
|---|---|---|
| `responsible_slugs` / `_display` / `_reason` | A quién se le exige la actividad en esta faena, y por qué | Sí |
| `target_coverage_percent` | La meta acordada (90 %) | Sí |
| `expected_subject_count` | Cuántos sujetos existen hoy | **No** |

El padrón no se firmó por decisión: entró porque vive en la misma fila que dos campos que sí son compromisos.
La consecuencia es que corregir un conteo —gente que entra o sale de un grupo de exposición— exigía abrir una
revisión nueva del programa, o desincronizaba la huella firmada.

Y el único motivo que justificaría firmarlo, la reproducibilidad para un auditor, no se sostiene: **los
indicadores no se persisten**. `getPdtpComplianceIndicators` los recalcula en vivo, así que el porcentaje ya se
mueve con cada aprobación, revocación o exclusión. Congelar sólo el padrón daba una reproducibilidad aparente.

Había además una señal en el propio código: dos escritores de la misma tabla con reglas distintas
—`setPdtpActivityWorksiteAdjustment` pasaba por el guard de editabilidad y `setPdtpActivityWorksiteParams` no—,
que es lo que aparece cuando un dato está guardado en el lugar equivocado.

**Resuelto.** `expected_subject_count` salió del snapshot (`schemaVersion` 8 → 9), y las filas que quedan sin
contenido firmado se descartan, porque si no cargar un padrón por primera vez seguiría moviendo la huella por
la simple aparición de la fila. El guard dejó de ser incondicional: ahora compara contra el estado actual y
sólo exige un programa editable cuando el ajuste cambia un compromiso. El padrón se corrige en cualquier
momento, incluso con el programa firmado. De paso la editabilidad se evalúa antes que la validación de
contenido, para que un programa firmado responda "ya entró a revisión" en vez de un error sobre el valor.

Ninguna firma se invalida: no hay programas firmados. Queda pendiente el paso siguiente, que es dejar de
guardar el padrón y derivarlo del registro de sujetos —los miembros del GES para la N°50, `fuel_vehicles` para
las N°33/34—; un número guardado sigue siendo un caché que envejece. Hoy está bloqueado porque esos registros
están vacíos.

### Estado de la remediación

**G6 implementado el 2026-09-01.** Las N°45 a N°50 se acreditan desde su módulo: la medición cuantitativa, el
pronunciamiento sobre cada protocolo MINSAL y cada control de vigilancia realizado. Con eso el hallazgo H8 baja
de 14 actividades a 8 (N°7, 19, 21, 35, 36, 43, 83 y la propia N°21 pendiente de decisión).

La **N°44 se reclasificó como constancia** y sale del inventario de brechas: se verificó que
`prevention_exposure_measurements.value` es numérico obligatorio en el esquema, en Zod y en el formulario, así
que no existe evento cualitativo que enganchar y registrarla como medición obligaría a inventar un número. Es
la resolución de la duda que el diseño ya había anticipado ("si no, la N°44 baja a Constancia").

**Decisiones de catálogo aplicadas el 2026-09-01.** El hallazgo H9 queda cerrado: las N°2 y N°5 se retiraron y
las N°12, 13 y 14 pasaron al programa del CPHS, con motivo y fecha efectiva en el change log. El programa bajó
de 87 a **82 actividades activas** y `pdtp:apply-mechanisms` ya no reporta ninguna sin clasificar. En el mismo
paso quedaron las N°17, 18, 23, 24 y 50 midiéndose por cobertura, y salió el CPHS como corresponsable de las
N°15, 73 y 76.

Estas decisiones estaban escritas en `scripts/apply-pdtp-2026-catalog-decisions.ts` desde el 2026-08-12 y nunca
habían corrido contra la base —el documento de diseño las daba por aplicadas—. Para que no vuelva a pasar,
**el script ahora corre en cada deploy de producción** como el paso `apply-pdtp-catalog-decisions` de
[deploy-prod.sh](scripts/deploy-prod.sh), con `PDTP_DECISIONS_DEPLOY_MODE=true` para no abortar el despliegue
cuando el programa del año todavía no existe o ya está firmado.

De la N°21 sigue pendiente la decisión de la jefa: es la única de ese grupo que el script no toma por su
cuenta, porque no está en sus listas justamente por eso.

Queda pendiente para que rinda en producción: `npm run db:sync-rbac` por el grant nuevo del PRF, y cargar el
padrón de la N°50 **antes** de firmar el programa, porque `indicator_mode` y `pdtp_activity_worksite_params`
entran en el digest.

## 7. Referencias

- Documento navegable con las 87 fichas: <https://claude.ai/code/artifact/0a1bce2d-c1ad-4691-9c08-24034131c26e>
- Motor: [lib/services/pdtp/accreditation.ts](lib/services/pdtp/accreditation.ts)
- Conectores: [lib/services/pdtp-adapters/](lib/services/pdtp-adapters/)
- Clasificación: [scripts/apply-pdtp-2026-mechanisms.ts](scripts/apply-pdtp-2026-mechanisms.ts)
- Diseño previo: [docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md](docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md)
- Catálogo notariado del XLSX: [db/seed/pdtp-catalog-2026.json](db/seed/pdtp-catalog-2026.json)

Los conteos de filas por módulo salen de `bodega_dev` y no representan producción.

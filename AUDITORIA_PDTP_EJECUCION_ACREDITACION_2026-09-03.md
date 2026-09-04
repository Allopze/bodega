# Verificación: ¿cada actividad del programa se puede ejecutar y acreditar?

**Fecha:** 3 de septiembre de 2026

**Alcance:** las **81 actividades activas** de `pdtp-2026-v1`, verificadas contra el código y contra
`bodega_dev`. Continúa [AUDITORIA_PDTP_ACREDITACION_2026-09-01.md](AUDITORIA_PDTP_ACREDITACION_2026-09-01.md)
y las decisiones del [2026-09-02](PDTP_DECISIONES_TOMADAS_2026-09-02.md).

**Método:** dos preguntas por actividad, no una. *Ejecutar* = existe el acto en la plataforma (una plantilla
vigente, un curso, un plan, un formulario). *Acreditar* = ese acto llega a `pdtp_executions` **y cuenta** en
el indicador. Las dos se separan porque el caso más caro no es el que falla, sino el que se ejecuta y no
acredita: nadie se entera.

**Resultado:** la compuerta de cumplimiento devuelve **0 bloqueadores** y eso es correcto —el programa se
puede enviar a revisión—, pero no es la respuesta a la pregunta. Hoy **ninguna de las 81 puede registrar
cumplimiento** porque el programa sigue en `draft`; y aun activándolo, **21 actividades tienen la vía
automática cortada por dato o configuración** y **7 no tienen vía real** pese a estar clasificadas como si la
tuvieran. La compuerta no las ve porque tres están en una lista blanca que no les corresponde y dos quedan
exentas por su mecanismo.

## 1. El bloqueo que sigue en pie

`pdtp-2026-v1` está en `draft`. `markPdtpExecution` rechaza toda ejecución
([executions.ts:33](lib/services/pdtp/executions.ts#L33)) y `createPdtpObligation` exige programa activo. La
base lo confirma: `pdtp_executions`, `pdtp_obligations` y `pdtp_fulfillment_events` en cero filas.

Esto ya no pierde hechos —`recordPdtpFulfillmentEvent` los deja `pending` y `reconcilePdtpFulfillmentEvents`
los reprocesa—, pero sigue siendo el techo de todo lo demás. Es T05 y es una decisión operativa, no código.

## 2. Actividades que se ejecutan y no acreditan

### A — Inspecciones: 13 actividades (N°10, 24, 25, 26, 27, 29, 33, 34, 39, 40, 41, 64, 65)

Las plantillas que declaran el número de actividad están **todas en `draft`**, y sólo una plantilla `approved`
puede programarse ([prevention-inspections.ts:650](lib/services/prevention-inspections.ts#L650)) o ejecutarse
([:1066](lib/services/prevention-inspections.ts#L1066)). Es T09, el único paso que G1 dejó abierto, y parte en
dos el bloque:

| Caso | Actividades | Qué pasa hoy |
|---|---|---|
| Existe una versión `approved` **anterior, sin números** | N°24, 25, 26, 29, 33, 34 | La inspección se ejecuta, se cierra y **el PDTP no se entera**. Falla en silencio. |
| No hay ninguna versión `approved` | N°10, 27, 39, 40, 41, 64, 65 | No hay instrumento vigente: la actividad no se puede ejecutar por su módulo. |

Ejemplo del primer caso: `inspeccion_extintores` v01 `approved` sin números convive con v02 `draft` con `[24]`.
El mecanismo de reemplazo está bien construido —aprobar la nueva marca la anterior `superseded`
([:483](lib/services/prevention-inspections.ts#L483))—; lo que falta es que alguien apruebe.

De arrastre: `reporte_equipos` vigente es la v01 con `executor_of_record = 'platform_user'`. La corrección de
la D04 viaja en la v02, que está en borrador, así que **el candado de independencia sigue impidiendo que el JT
firme** el report de uso diario.

### B — Emergencias: N°83 y N°84

`prevention_emergency_plans` está en **cero filas**. La N°83 acredita al aprobar el plan con número fijo en el
conector; la N°84 acredita al completar un simulacro y toma los números **del plan**
([prevention-emergency.ts:700](lib/services/prevention-emergency.ts#L700)). Sin un plan cargado no hay ni acto
ni número. Redactar el plan es trabajo de Prevención, no de la plataforma.

### C — Documentación SST: N°36 y N°43

`sst_document_types` está en **cero filas**. `onDocumentVersionPublished` y `onDocumentAcknowledged` reciben
los números que declara el **tipo** del documento
([pdtp-accreditation-connectors.ts:396](lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts#L396)), y
con el arreglo vacío son no-op explícito. Publicar un procedimiento o registrar un acuse hoy no acredita nada,
y el catálogo que habría que llenar todavía no tiene ni una fila.

## 3. Actividades sin vía real

### D — Las dos `compuesta` huérfanas: N°16 y N°17

Ningún conector, ningún curso, ninguna plantilla y ningún tipo de documento las declara. Se buscó en
`PDTP_2026_INSPECTION_SPECS`, en `prevention_training_courses`, en los cinco conectores y en la lista blanca
de la compuerta: no aparecen en ninguno.

- **N°16** (prueba de evaluación IRL). El comentario del conector de trabajador nuevo dice que su fuente es
  `prevention_training_attendance.assessment_score`
  ([worker-onboarding-connector.ts:32](lib/services/pdtp-adapters/worker-onboarding-connector.ts#L32)), pero
  ese cable **no se escribió**: el módulo de capacitación calcula la nota y no llama al motor por ella.
- **N°17** (RE-28, personas especialmente sensibles). La D06 decidió expresamente que **no** se acredita desde
  el acta de trabajador nuevo, y el formulario propio que la reemplazaría no existe.

Las dos se pueden marcar a mano desde la planilla, así que no están bloqueadas. El problema es la N°17: se
mide por `coverage` con `subject_source = 'dotacion'` —la dotación activa de la faena, entre 3 y 41 personas en dev— y **sin
`target_coverage_percent` cargado**, así que exige el padrón completo cada uno de los 9 meses que tiene
planificados. Con marca manual como única vía, es un **0 % permanente que además arrastra el promedio de la
faena** — exactamente el patrón que el hallazgo H11 corrigió para la N°24 y la N°50, reaparecido en la N°17.

### E — Las `on_demand` que nadie obliga: N°11, 15, 16, 52, 57

`closed_on_time` mide **obligaciones**: cuántas vencieron el mes y cuántas se cerraron a tiempo
([compliance.ts:63](lib/services/pdtp/compliance.ts#L63)). Sin obligación, `casesDue = 0` y la actividad se
salta con el comentario *"no es un 0 %, es nada que medir"*
([compliance.ts:298](lib/services/pdtp/compliance.ts#L298)).

El único generador automático de obligaciones es el conector de incidentes, que cubre las N°66–78. Las otras
cinco `on_demand` dependen de que alguien las cree a mano en `/prevencion/pdtp/obligaciones`. La consecuencia
importa más de lo que parece: **cerrar un acta de trabajador nuevo acredita la N°15 y la N°52 y el porcentaje
de cumplimiento no se mueve**, porque no había obligación contra la cual contarlo. La ejecución queda
registrada; el indicador la ignora.

Le falta un disparador a cada una: la N°11 y la N°57 lo tendrían en su propio módulo (constitución de CPHS,
cierre de sesión de curso); las N°15, 16 y 52 lo tendrían en el ingreso del trabajador, que es el hecho que
las hace exigibles.

## 4. Dos defectos de la compuerta

La compuerta ([fulfillment.ts:337](lib/services/pdtp/fulfillment.ts#L337) en adelante) es la que debería
haber detectado los grupos B, C y D. No lo hace por dos razones distintas:

1. **Tres números están en la lista blanca equivocada.** `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` es, por su
   propia documentación, para actividades cuyo número está *fijo en el código*. La **N°36**, la **N°43** y la
   **N°84** no lo están: sus números vienen de `sst_document_types.pdtp_activity_numbers` y de
   `prevention_emergency_plans.pdtp_activity_numbers`. Estar en la lista las exime de la verificación
   `declaredInConfig` que es justamente la que les corresponde, así que la compuerta las da por listas con las
   dos tablas vacías. La N°83 sí pertenece a la lista (número fijo en el conector).
2. **`compuesta` está exenta de la verificación de enganche.** El chequeo de "su número está declarado en
   alguna plantilla, curso, campaña, plan o tipo de documento" corre sólo si `mechanism === 'enganche'`
   ([fulfillment.ts:302](lib/services/pdtp/fulfillment.ts#L302)). La exención está razonada para el permiso
   —*"nadie la ejecuta"*—, pero se arrastró al cableado, y es lo que deja pasar a la N°16 y la N°17: una
   `compuesta` sin ningún componente que la acredite no se cumple sola, no se cumple nunca.

## 5. Lo demás que quedó verificado

- **La única advertencia que la compuerta sí emite** es la N°56: `coverage` sin `subject_source` declarable
  —mide "conductores y operadores", un subconjunto que el CHECK no admite—, así que cae a la cantidad
  planificada. Ya estaba documentada.
- **N°7 acredita y no revierte.** `onSafetyIndicatorPeriodClosed` está cableado; su par
  `onSafetyIndicatorPeriodReopened` está escrito y **no tiene un solo llamador**. Reabrir un período cerrado
  deja la acreditación en pie. Es T54, sigue abierto.
- **Cursos, campañas, alcotest, CGRD, incidentes, EPP, higiene y vigilancia, MIPER, acta de trabajador
  nuevo:** con su número declarado o fijo en el conector, y con el módulo construido. Los 12 cursos declaran
  su actividad y las 35 campañas (5 × 7 faenas) declaran las N°85–89 correctamente.
- **Las 9 constancias** declaran evidencia mínima y su responsable tiene `prevention:constancias:execute`.
- **Calendario completo:** las 62 `scheduled` tienen celdas con cantidad planificada; sólo las 19 `on_demand`
  no las tienen, que es lo correcto.
- **Padrón de cobertura:** `pdtp_activity_worksite_params` sólo tiene filas para la N°54 y la N°56 (meta 90 %,
  sin conteo). Los registros de sujetos —`prevention_emergency_resources`, `prevention_exposure_group_members`,
  `sst_evaluations`, `fuel_vehicles`— están **todos en cero filas**, así que las N°18, 23, 24 y 50 caen hoy a
  la cantidad planificada. Es el comportamiento correcto (H11), no un defecto.

## 6. Qué hacer, en orden

| # | Acción | Cierra | Código |
|---|---|---|---|
| 1 | Activar `pdtp-2026-v1` desde el mes en curso (T05, D01) | las 81 | no |
| 2 | Aprobar las 13 plantillas de inspección en borrador (T09) | 13 | no |
| 3 | Cargar `sst_document_types` con los números de la N°36 y la N°43 | 2 | no |
| 4 | Redactar y aprobar un plan de emergencia por faena, declarando `[84]` | 2 | no |
| 5 | Sacar la N°36, N°43 y N°84 de `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` | — | sí, menor |
| 6 | Extender la verificación de cableado a `compuesta` | — | sí, menor |
| 7 | Decidir la N°16 y la N°17: cablearlas o bajarlas a constancia con meta | 2 | depende |
| 8 | Generador de obligaciones para las N°11, 15, 16, 52, 57 | mide 5 | sí |
| 9 | Cablear `onSafetyIndicatorPeriodReopened` (T54) | — | sí |

Los pasos 1 a 4 son dato y decisión, y son los que mueven el número. Los pasos 5 y 6 valen aunque no cierren
ninguna actividad: son los que evitan que la próxima brecha vuelva a pasar en verde.

## 7. Alcance de la verificación

Todo se comprobó contra el código y contra `bodega_dev`, que está prácticamente vacío: cero planes de
emergencia, cero tipos de documento, cero matrices MIPER, cero comités, cero sesiones de capacitación, cero
alcotests. Los hallazgos de este informe son de **ruta y configuración**, no de volumen: dicen si existe el
camino, no si alguien lo recorrió. En producción los scripts `apply-pdtp-catalog-decisions`,
`apply-pdtp-mechanisms`, `apply-pdtp-program-data` y `seed-inspection-templates` corren en cada despliegue,
así que el estado de catálogo debería coincidir; **la aprobación de plantillas (paso 2) no se automatiza a
propósito** y hay que hacerla en cada entorno.

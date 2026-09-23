# Auditoría: ¿qué tan cerca está cada submódulo de Prevención de "se hizo / no se hizo / no aplica"?

**Fecha:** 22 de septiembre de 2026
**Alcance:** los 24 submódulos de `app/(app)/prevencion/`, el núcleo del PDTP
(`lib/services/pdtp/**`, `lib/services/pdtp-adapters/**`) y las 81 actividades vigentes del
Programa 2026.
**Método:** lectura de código por siete revisiones en paralelo con una misma rúbrica, más
consultas **solo de lectura** (`SELECT` en transacción `READ ONLY`) sobre `bodega_dev`
(127.0.0.1:5433) el 2026-09-22 entre las 19:06 y las 19:10 UTC. Los hallazgos de mayor peso
se volvieron a verificar directamente en el código y se marcan con ✔.
**Lo que no se hizo:** no se abrió el navegador, no se ejecutaron pruebas y no se consultó
producción. Los pasos de interfaz salen del código de la UI y no de un recorrido real.

---

## 1. Veredicto

El patrón ya existe: la **casilla del programa**. Capacitación, alcotest, simulacros y actas
del CGRD la implementan con bastante rigor: fila creada antes del hecho, cuatro estados,
"no aplica" con motivo, evidencia obligatoria y vínculo con el hecho nativo. **Pero la cadena
que convierte esa casilla en cumplimiento está cortada en tres puntos**, y por eso hoy
**ninguna** de las 81 actividades cumple de punta a punta el ciclo "se hizo / no se hizo /
no aplica → % de cumplimiento":

1. **El "no aplica" y el "no se hizo" de una casilla no llegan al PDTP.** ✔
   `pdtp_execution_deviations` solo se escribe desde la planilla del PDTP
   (`app/(app)/prevencion/pdtp/actions/deviations.ts:93`), y `lib/services/pdtp/**` no lee
   ninguna tabla de casillas. Al PDTP solo llegan hechos positivos (y sus revocaciones). Una
   casilla declarada "no aplica" deja la celda del programa planificada y en cero, es decir,
   **cuenta como incumplimiento**. La UI promete lo contrario: *"La actividad saldrá del
   programa de esta faena"* (`components/prevention/program-slot-list.tsx:229`). Para
   reflejarlo hay que declarar el "no aplica" dos veces: en el submódulo y en la planilla.
2. **"Se hizo" no basta: casi siempre falta además una aprobación manual en el PDTP.** ✔
   Solo las inspecciones y las ocurrencias de capacitación se aprueban solas
   (`lib/services/pdtp/accreditation.ts:406`). El cumplimiento formal cuenta únicamente las
   ejecuciones `approved` (`lib/services/pdtp/compliance.ts:262`). Alcotest, simulacros, CGRD,
   campañas, EPP, higiene, incidentes, SST, indicadores, MIPER y documentación quedan en
   `submitted` hasta que alguien los aprueba en `/prevencion/pdtp/aprobaciones`. Esto
   contradice la decisión D4 del diseño ("nadie marca nada en PDTP"). En desarrollo las 19
   ejecuciones del programa v1 siguen todas en `submitted`: nunca se aprobó ninguna.
3. **El hecho se abona en la celda equivocada.** Simulacros, CGRD, alcotest e indicadores
   acreditan según la fecha del hecho y no según la casilla: no envían `plannedPeriod`. Solo
   capacitación lo envía, pero **su catálogo no coincide con la grilla del PDTP** ✔. La N°54
   tiene casillas en mar/abr y el PDTP la planifica en sep/oct. La N°56 tiene casilla en ene y
   se planifica de feb a nov. La N°85 tiene casillas en ene, mar, abr y oct y se planifica en
   feb. Así, la casilla en verde paga un mes que no estaba planificado y la celda real queda
   en cero.

Mientras estos tres puntos sigan abiertos, convertir más módulos en casillas solo multiplica
el problema. Arreglarlos es la **condición previa** del resto de la hoja de ruta (§6).

---

## 2. Rúbrica

| # | Rasgo del modelo objetivo |
|---|---|
| R1 | **Pre-materialización**: lo esperado existe como fila antes de ocurrir, para que "no se hizo" ≠ "nadie lo cargó" |
| R2 | **Estados** `pending / completed / not_completed / not_applicable` o equivalentes |
| R3 | **No aplica con motivo** (≥10 caracteres), actor y fecha, con CHECK de rama negativa |
| R4 | **Evidencia como compuerta dura** para "hecha": archivo real, no texto sintético |
| R5 | **Casilla ≠ hecho**: FK al registro nativo, en la misma transacción; deshacer el hecho revierte la casilla |
| R6 | **Genera cumplimiento**: acredita la actividad, el NA sale del denominador y "no hecha" cuenta como incumplimiento |
| R7 | **Baja fricción**: sin ciclos de vida pesados salvo exigencia normativa real |
| R8 | **Trazabilidad**: el cambio de estado queda en bitácora |

**Escala.** 5 = cumple R1–R8 · 4 = modelo presente con 1–2 brechas · 3 = estado binario que
acredita, pero sin pre-materialización o sin NA · 2 = ciclo pesado que acredita solo al final ·
1 = sin conexión automática con el cumplimiento · 0 = no hay cómo registrar el cumplimiento.

Por el punto 1 del veredicto, **ningún submódulo cumple hoy R6 completo**. Los puntajes
siguientes miden la cercanía del submódulo en sí.

---

## 3. Puntaje por submódulo

| Submódulo | Puntaje | ¿Debe converger a casilla? | Principal brecha |
|---|:-:|---|---|
| Capacitación | **4** | Ya es la referencia | Cronograma distinto de la grilla PDTP; NA no llega al PDTP |
| CGRD: actas (N°81) | **4** | Ya es la referencia | Evidencia admite cualquier URL; sesiones extraordinarias también acreditan |
| Higiene: protocolos MINSAL (N°46–49) | **4** | Sí (ya casi) | Un pronunciamiento paga una sola de las 4/2/2/2 celdas planificadas |
| Alcotest (N°30–32) | **3** en diseño, **roto** en uso | Sí | ✔ Ninguna casilla puede quedar "hecha" desde la app (ver §5) |
| Emergencias: simulacros (N°84) | **3** | Sí | No se puede anular un simulacro completado; sin plan, las casillas no se ven |
| Campañas (N°85–89) | **3** | Absorber en Capacitación | Duplica las casillas CAM-* (doble conteo); solo `pending/done` |
| Inspecciones: inspección programada | **3** | Sí | Sin `not_completed` ni NA; los ciclos perdidos se colapsan en uno |
| Constancias (9 actividades) | **3** | Sí, es la casilla nativa | La pantalla solo permite "Registrar"; acepta texto como evidencia |
| Higiene: mediciones (N°45) y vigilancia (N°50) | **3** | Sí | Sin casilla; `exempt` sin motivo y sin descuento del padrón |
| Incidentes (RE-20, N°66–78) | **3** | No (es un evento); sí debe cerrar binario y solo | ✔ Crea las 12 obligaciones para cualquier tipo de evento |
| CGRD: estructura y matriz (N°79–80) | **3** | No (hito de gestión) | — |
| Estructura preventiva (N°11) | **3** | No (condición, no fecha) | Evidencia en texto; el caso del delegado se descarta |
| CPHS: constitución (N°11) y revisión (N°9) | **3** | No | La revisión corporativa no acredita a ninguna faena |
| Evaluaciones SST: ítem del checklist | **3** | Sí, cuesta poco | `na` sin motivo; sin validar por escala; sin historial |
| Evaluaciones SST: acta como unidad | **2** | Sí en la unidad, no en el instrumento | ✔ El RE-28 se puede cerrar vacío y acredita la N°17 |
| Emergencias: plan (N°83) | **2** | No (gestión legítima) | Evidencia sintética; `executedQuantity = scenarioCount` |
| Indicadores SST (N°7) | **2** | Parcial | Cierre pesado, sin NA para meses sin horas; abona el mes del cierre |
| Registro documental (N°36, N°43) | **2** | La revisión mensual sí; el control documental no | Acuse solo con cuenta propia; `requiresApproval` no se lee |
| MIPER (N°35) | **2** | La casilla mensual sí; la matriz no | 12/12 exige 12 publicaciones formales con 4 firmas |
| Acciones correctivas (CAPA) | **2** | Parcial | 4 transiciones y verificador distinto incluso en prioridad baja |
| CPHS: sesiones mensuales | **1** | Sí (12 sesiones por reglamento) | Sin casillas; `meeting_closed` es un evento que nadie emite |
| EPP preventivo | **1** (cadena entrega→N°62: 2–3) | No como casilla | "Iniciar" lleva a una pantalla que no registra entregas |
| Requisitos legales | **1** | Parcial (pre-materializar requisito × faena) | Nadie ve un requisito que no se evaluó; no acredita nada |
| Visitas y coordinación | **1** | Solo la reunión con el mandante (N°20) | Hoy la N°20 se carga aparte como constancia: doble registro |
| Gestión del cambio | **1** | Solo el NA de dimensión | `implemented`/`closed` no los escribe ningún código |
| Permisos de trabajo | **1** | No (compuertas de seguridad) | NA de control con 1 carácter, sin actor, fecha ni historial |
| PPA | **1** | No (control operacional) | Sin conector ni actividad del programa |
| Datos personales | n/a | No | — |
| Daño material y ambiental | n/a | No (es una vista) | Hereda el defecto de las obligaciones RE-20 |

---

## 4. Las 81 actividades según cómo se cumplen

| Mecanismo | Actividades | N.º |
|---|---|:-:|
| **A. Casilla pre-materializada** en el submódulo | 30, 31, 32, 54, 55, 56, 58, 63, 81, 84, 85, 86, 87, 89 | **14** |
| **B. Hecho nativo que acredita, sin casilla** ("no se hizo" = ausencia) | 1, 7, 9, 10, 19, 25–27, 29, 33–36, 39–41, 43, 45–49, 62, 64, 65, 79, 80, 83, 88 | **29** |
| **C. Constancia manual en el PDTP** | 3, 6, 20, 22, 28, 42, 44, 61, 82 | **9** |
| **D. A demanda o por evento** (obligación) | 11, 15, 52, 66–78 | **16** |
| **E. Cobertura contra un padrón** | 17, 18, 23, 24, 50 | **5** |
| **F. Sin instrumento que funcione** | 16, 37, 38, 51, 53, 57, 59, 60 | **8** |

Sobre la categoría F ✔: su único vínculo apunta a cursos `trc-*` de
`prevention_training_courses`, tabla que eliminó la migración `0310`.
`onTrainingSessionClosed` no tiene llamadores. Ningún ítem del catálogo anual declara la N°57,
así que el barrido de brechas de la N°57 no abre nada con el catálogo real. Por eso el "81 de
81 actividades listas" de `ESTADO_PROGRAMA_PREVENTIVO_2026-09-10.md` **ya no es cierto**: es
anterior al retiro del modelo por persona del 2026-09-19.

**En resumen:** 14 de 81 actividades (17 %) tienen casilla. Solo 22 se aprueban sin un paso
manual: las 13 de inspecciones (incluida la N°24, que se mide por cobertura) y las 9 de
capacitación, y estas últimas con el desfase de cronograma. Ninguna refleja el "no aplica"
en el %.

### Estado de la base de desarrollo (2026-09-22, 19:06–19:10 UTC)

- Programa `pdtp-2026-v2` activo desde el 2026-09-17: **0** ejecuciones, **0** instancias,
  **0** desvíos, **0** obligaciones y **0** eventos disparadores.
- Programa `pdtp-2026-v1` (cerrado): 19 ejecuciones, **todas `submitted`**. Son la N°1 ×7, la
  N°62 ×6 y la N°83 ×6.
- Casillas, **todas en `pending`**: 168 de capacitación (7 × 24; solo 14 por faena llevan
  número del PDTP), 14 de simulacro, 28 de CGRD, 84 de control y 77 de envío de alcotest,
  35 campañas y 56 aplicabilidades de protocolo (todas en `pending_assessment`).
- Oficina Central **no pertenece al programa** pero tiene casillas: 7 faenas con casillas
  frente a 6 del programa.
- 13 vínculos de acreditación de tipo `capacitacion` apuntan a cursos que ya no existen.

---

## 5. Defectos concretos encontrados

Están ordenados por impacto. ✔ indica verificado directamente en esta revisión. Los demás se
citan desde la lectura de código de los revisores y no se reprodujeron en ejecución.

| # | Defecto | Dónde |
|---|---|---|
| 1 ✔ | **Alcotest: ninguna casilla puede quedar "hecha".** `slotId` no está en `alcoholTestRegisterSchema` ni en `alcoholTestDispatchSchema`, así que zod lo descarta. La pantalla tampoco lo envía, y ninguna UI llama a `POST /api/prevencion/alcotest/evidence`. Solo se puede declarar "no hecha" o "no aplica". | `lib/validation/prevention-module/alcotest.ts:3-31`, `app/(app)/prevencion/alcotest/actions.ts:49,56` |
| 2 ✔ | **Incidentes: las 12 obligaciones RE-20 se crean para cualquier tipo de evento.** Un daño material o un derrame deja vencidas para siempre la DIAT (N°72) y otras, que cuentan como incumplidas salvo que alguien las cancele a mano en `/prevencion/pdtp/obligaciones`. El propio módulo sabe que la DIAT solo aplica a accidentes del trabajo y de trayecto. | `lib/services/pdtp-adapters/incident-accreditation-connector.ts:138-175` frente a `lib/services/prevention-incidents.ts:409-415` |
| 3 ✔ | **El NA de una casilla no sale del denominador**, y la UI afirma que sí. | `components/prevention/program-slot-list.tsx:229` |
| 4 ✔ | **8 actividades sin instrumento** (categoría F). | §4 |
| 5 ✔ | **El cronograma de capacitación no coincide con la grilla del PDTP** en las N°54, 56, 85 y 86, y solo en parte en las 58, 63 y 89. No hay un test que lo ate, como sí lo hay para `program-slots-2026`. | `lib/prevention/training-occurrences-catalog.ts` frente a `db/seed/pdtp-catalog-2026.json` |
| 6 ✔ | **El RE-28 se puede cerrar sin ninguna respuesta y acredita la N°17.** La compuerta "sin ítems pendientes" solo mira las secciones puntuables, y las dos del RE-28 no lo son (a propósito). | `lib/sst/checklist.ts:44`, `lib/services/sst-module/evaluations.ts:231-232` |
| 7 | La participación del **conductor líder** puede reportar la N°52 sin las secciones bloqueantes 1.1 y 1.2. | `lib/services/sst-module/evaluations.ts:279`, `worker-onboarding-connector.ts:141` |
| 8 | **Simulacro completado no anulable**: `cancelEmergencyDrill` solo acepta `scheduled`, y la reversión de casilla al cancelar es código muerto. Una faena sin plan de emergencia no ve sus casillas de la N°84. La N°84 solo acredita si alguien la configuró a mano en el plan. | `lib/services/prevention-emergency.ts:797,961,1008-1031` |
| 9 | **Campañas duplica las casillas CAM-*** del catálogo de capacitación para las N°85, 86, 87 y 89: riesgo de doble conteo. La N°88 solo se alcanza desde `/prevencion/campanas`, que no está en la navegación. | `lib/services/prevention-campaigns.ts`, `modules/prevention/manifest.ts:466` |
| 10 | **Extraordinarios que acreditan**: sesiones CGRD y controles de alcotest sin casilla suman en el PDTP, aunque el submódulo dice que no cuentan. | `prevention-cgrd.ts:675`, `prevention-alcotest.ts:188` |
| 11 | **Revocar no deshace una aprobación manual**: un acta anulada que ya se aprobó en el PDTP sigue contando. | `lib/services/pdtp/accreditation.ts:826` |
| 12 | **EPP: "Iniciar" lleva a un callejón sin salida.** El conector apunta a `/prevencion/epp-preventivo`, que ignora `?faena`/`?programa` y no registra entregas; las entregas viven en `/entregas`. | `lib/services/pdtp/connectors.ts:167` |
| 13 | **Inspecciones**: el servidor permite reescribir las respuestas de una inspección `completed` sin recalcular conteos ni hallazgos. La UI lo impide y el servidor no. | `lib/services/prevention-inspections.ts:1264` |
| 14 | **Higiene**: el "no aplica" de un protocolo paga una sola celda de las 4/2/2/2 planificadas. En vigilancia, `exempt` no pide motivo ni se descuenta del padrón. | `hygiene-accreditation-connector.ts:141-177`, `subject-registry.ts:141-151` |
| 15 | **Indicadores**: la N°7 se acredita con `occurredAt = closedAt`. Cerrar el mes M en M+1 abona M+1, y diciembre cerrado en enero cae en el programa siguiente. Un mes sin horas no se puede cerrar ni declarar NA. | `pdtp-accreditation-connectors.ts:650-678` |
| 16 | **Plan de emergencia**: acredita con cantidad = número de escenarios frente a 1 planificado, y con evidencia sintética. | `pdtp-accreditation-connectors.ts:605-628` |
| 17 | **CPHS**: `meeting_closed` está declarado en el conector y nadie lo emite. La revisión corporativa (N°9) no acredita a ninguna faena. | `lib/services/pdtp/connectors.ts:181`, `prevention-cphs.ts:950-952` |
| 18 | **Doble conteo posible** cuando una ejecución aprobada está enlazada a una instancia `completed`. Hoy es teórico: hay 0 instancias. | `lib/services/pdtp/compliance.ts:398-413` |
| 19 | Menores: el aviso de capacitación dice "marcada como no hecha" al declarar NA (`capacitacion/actions.ts:34`); `new Date().getFullYear()` en daño material (`indicadores-material-ambiental/page.tsx:24`); comentarios que aún nombran el modelo por persona. | — |

---

## 6. Hoja de ruta recomendada

### Fase 0: cerrar la cadena (condición previa)

1. **Propagar el NA y el "no hecha" de la casilla al PDTP.** Una sola función compartida, en
   la misma transacción del cambio de casilla: "no aplica" escribe un desvío
   `not_applicable` en la celda de la casilla, "no hecha" escribe `not_performed` para dejar
   la traza, y revertir retira el desvío. La llaman alcotest, simulacros, CGRD y capacitación.
   Hasta que exista, hay que corregir el texto de `program-slot-list.tsx:229`.
2. **Acreditar en la celda de la casilla y solo cuando hay casilla.** `plannedPeriod` desde la
   casilla en simulacros, CGRD y alcotest; los extraordinarios quedan fuera del conteo.
3. **Alinear el catálogo de capacitación con la grilla** y agregar el test equivalente a
   `program-slots-2026.test.ts`.
4. **Decidir la aprobación automática** (decisión del titular, ver §7): si un hecho con casilla
   y evidencia real debe contar sin un segundo paso en el PDTP, basta ampliar la lista de
   `accreditation.ts:406`. Con eso la revocación también funcionaría.

### Fase 1: defectos

Corregir los defectos 1, 2, 4, 6–9, 12 y 13 de §5. En el 4 (las 8 actividades sin
instrumento) conviene agregarlas como ítems del catálogo anual con casillas alineadas a la
grilla (37, 51, 59, 60), y decidir con Prevención si 38 y 53 (diálogos y charlas diarias, hasta
5 por semana) se miden por conteo y no por casilla. Luego actualizar
`ESTADO_PROGRAMA_PREVENTIVO_2026-09-10.md`.

### Fase 2: convertir los candidatos naturales

| Qué | Cambio mínimo | Actividades |
|---|---|---|
| Constancias | Botones "No se hizo" y "No aplica" en la misma fila, reutilizando `recordPdtpDeviation`; exigir archivo cuando hay `evidenceRequirement` | 3, 6, 20, 22, 28, 42, 44, 61, 82 |
| Inspecciones programadas | La inspección programada como casilla con `not_completed`/NA; el run es el hecho que la llena (FK y misma transacción) | 10, 27, 29, 33, 34, 39, 40, 64, 65 |
| Coordinación → N°20 | Conector para `coordinacion` con el mandante; retirar la N°20 de las constancias | 20 |
| MIPER, Documentación | Casilla mensual "revisada sin cambios" (acta adjunta) o "actualizada" (vinculada a la publicación); acuse asistido por un supervisor | 35, 36, 43 |
| CPHS | 12 casillas de sesión por comité y año, llenadas por el cierre del acta | (programa del comité) |
| Higiene | Casillas para la N°45; renovar la matrícula de vigilancia al registrar asistencia | 45, 50 |
| Campañas | Ítem CAM para la N°88 en el catálogo y `/campanas` en solo lectura | 85–89 |
| Un solo componente | `program-slot-list.tsx` con las tres salidas (hoy no sabe marcar "hecha"), y que capacitación lo use | — |

### No deben converger a casilla

Son registros legítimos: incidentes, permisos de trabajo, PPA, datos personales, planes de
emergencia, estructura y matriz del CGRD, y el ciclo de publicación de la MIPER y del control
documental. En estos lo que corresponde es que su hecho **llene solo y de forma binaria** la
actividad del programa. Para CAPA se sugiere un cierre de un paso ("hecha con evidencia") en
prioridad baja y media. Para requisitos legales, pre-materializar cada requisito × faena en
`pending` y fusionar `partial` con `noncompliant`.

---

## 7. Decisiones que no se resuelven desde el código

1. **Aprobación automática.** ¿La segregación del PDTP (otra persona aprueba) es una exigencia
   para los hechos de submódulo con casilla y evidencia real, o solo para las constancias
   manuales? La decisión D4 del diseño apunta a lo segundo, y el código hace lo primero.
2. **N°30 y N°31**: comparten una serie de 12 casillas y el rol de quien registra decide cuál
   acredita, así que la otra queda con 12 celdas sin cubrir.
3. **N°17**: 9 celdas mensuales frente al barrido semestral que pide el DO-47.
4. **Protocolos N°46–49**: ¿un "no aplica" debe cubrir todas las celdas del año?
5. **N°11 con delegado** en faenas de 10 a 25 personas.
6. **Oficina Central**: está fuera del programa y tiene casillas y datos.
7. **2027**: todo el aparato de casillas está fijado en 2026 (`PROGRAM_SLOT_YEAR`, año del
   catálogo) y no hay camino para el año siguiente.

---

## 8. Inconsistencias transversales

**Vocabulario.** Coexisten al menos seis vocabularios para el mismo concepto:

| Modelo | Estados |
|---|---|
| Casillas | `pending/completed/not_completed/not_applicable` |
| Instancias del PDTP | `pending/in_progress/submitted/completed/not_applicable/cancelled` |
| Obligaciones | `pending/overdue/reported/completed/cancelled` |
| Campañas | `pending/done` |
| Checklist SST | `cumple/no_cumple/na` |
| Inspecciones | `conforming/partial/non_conforming/not_applicable/not_present/recorded` |

A eso se suman tres traductores distintos de la misma máquina de estados de la CAPA. En dos de
ellos, "completado" significa *en verificación*, y el PDTP lo cuenta como cerrado.

**Motivo del "no aplica".** El mínimo cambia según el modelo:

| Mínimo | Dónde |
|---|---|
| 10 caracteres | Casillas, desvíos, obligaciones |
| 5 caracteres | Cancelación de CAPA y de PPA, ausencia en vigilancia |
| 3 caracteres | Instancias del PDTP, ítems de inspección, exención de acuse |
| 1 carácter | Controles de permisos |
| Sin motivo | Ítems SST, `exempt` de vigilancia, dimensiones de gestión del cambio |

**Dos checklists en la misma pantalla.** 14 pantallas montan el panel "Actividades
programadas" del PDTP (`PdtpScheduledActivityPanelServer`) junto a las casillas del propio
módulo, y los dos no están enlazados. Con el programa v2 hay 0 instancias, así que ese panel
hoy aparece vacío.

**Siete formas de registrar un hecho en el PDTP**: grilla histórica, ejecuciones, desvíos,
metas por faena, exclusiones, instancias fechadas y obligaciones. Además hay cuatro fórmulas
de %, una de ellas sin consumidores (`scheduled-compliance.ts`). Buena parte de esa complejidad
existe para compensar que "no se hizo" es una ausencia de fila y que se permite el doble
registro. Con casillas explícitas sobraría, pero **no se puede borrar**, porque sostiene los
programas 2026 ya firmados.

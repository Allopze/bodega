# TODO activo — Mecanismos de acreditación del PDTP 2026

Estado global: **G2, G3, G4, G7, G8, G10, G11, G12, G18 y G19 implementados**; **G6 implementado**; **G5 con
el modo cobertura puesto** en cinco de sus siete. Las **22 decisiones abiertas quedaron resueltas** (ver
[PDTP_DECISIONES_TOMADAS_2026-09-02.md](../PDTP_DECISIONES_TOMADAS_2026-09-02.md)). El resto sin iniciar.

El programa quedó en **81 actividades activas**: 87 del catálogo menos las 5 retiradas por G12 y la N°21, que
la D02 mandó retirar y que se aplicó el 2026-09-02. Las decisiones de catálogo y el dato de cursos, planes y
campañas se aplican **solos en cada deploy de producción** (`apply-pdtp-catalog-decisions` y
`apply-pdtp-program-data` en `scripts/deploy-prod.sh`), así que no vuelven a quedar esperando que alguien
corra un script a mano.

Deriva de [AUDITORIA_PDTP_ACREDITACION_2026-09-01.md](../AUDITORIA_PDTP_ACREDITACION_2026-09-01.md) y de las
decisiones del 2026-09-02.

Quedan **ocho constancias manuales** —N°3, 6, 20, 22, 28, 42, 61 y 82—, no las quince originales: la D11 se
lleva la N°10 a inspecciones, la D08 las N°30–32 a su módulo y la D09 las N°79–81 al suyo. Las ocho ya se
pueden marcar hoy desde la planilla; G17 sólo las reúne en un lugar.

## Orden recomendado

**G0 primero, sola.** Sin el programa activo no se puede registrar nada y ningún otro grupo es verificable.

Después los grupos que sólo esperan datos —G1, G2, G3, G5— que suben la acreditación automática sin código
nuevo. Los grupos de código son independientes entre sí y se pueden repartir. Los módulos nuevos (G14, G15) son
el trabajo grande; G17 conviene al final, cuando se sepa cuántas constancias quedan de verdad.

| Grupo | Cierra | Código | Depende de | Estado |
|---|---|---|---|---|
| G0 Desbloqueo del programa | las 81 | no | — | falta activar |
| G1 Plantillas de inspección | 11 | ✅ hecho | G0 | falta habilitarlas (T09) |
| G2 Cursos de capacitación | 12 | no | G0 | |
| G3 Plan de emergencia (N°84) | 1 | no | G0 | |
| G4 Campañas | 5 | sí, menor | G0 | |
| G5 Modo cobertura | mide 7 | no | G1, G2, G19 | 5 de 7 puestas |
| ~~G6 Higiene y vigilancia~~ | 6 | sí | G0 | ✅ hecho |
| G7 Documentación SST | 3 | sí | G0 | |
| G8 MIPER | 1 | sí | G0 | |
| G9 Indicadores de faena | 1 | sí | G0 | |
| G10 Plan de emergencia (N°83) | 1 | sí | G3 | |
| G11 Cablear el acta de trabajador nuevo | 5 | sí | G19 | reescrito por D22 |
| ~~G12 Limpieza del catálogo~~ | 6 | no | G0 | ✅ hecho, N°21 incluida |
| ~~G13 Decisiones sin módulo~~ | — | — | — | ✅ resuelto, ver G14–G17 |
| G14 Módulo de alcotest | 3 | ✅ hecho | G0 | ver detalle abajo |
| G15 Módulo de CGRD (DS 44) | 3 | ✅ hecho | G0 | ver detalle abajo |
| G16 Checklist DS 594 | 1 | sí, menor | G1 | |
| G17 Submódulo Constancias | 9 | ✅ hecho | G14, G15, G16 | ruta y permiso propios, ver detalle abajo |
| G18 Correcciones de las decisiones | — | sí | G0 | |
| G19 Padrón derivado | mide 3 | sí | G0 | reemplaza T36/T37 |

---

## G0 — Desbloqueo del programa

**Objetivo:** que se pueda registrar cumplimiento. Bloquea las 87 y la verificación de todo lo demás.

- [x] T01 **Decidido (D01): desde el mes en curso.** No se arrastra lo vencido de enero a agosto.
      Activarlo desde enero deja 46 actividades vencidas para el PRF de Cholguán, 13 para el administrador de
      contrato, 11 para el jefe de terreno, 10 para el supervisor y 3 para el jefe de mantención.
- [x] T02 Corregir `scripts/apply-pdtp-2026-mechanisms.ts` **antes** de correrlo (hallazgo H3):
      N°25 y N°26 de `FORMULARIO` a `ENGANCHE`, N°28 de `ENGANCHE` a `CONSTANCIA`, y N°44 a `CONSTANCIA`
      por lo verificado en T40. `FORMULARIO` quedó vacía.
- [x] T03 Correr `PDTP_MECHANISMS_DRY_RUN=true npm run pdtp:apply-mechanisms` y revisar la salida.
- [x] T04 Correr `npm run pdtp:apply-mechanisms` en firme. Aplicado en `bodega_dev`: 59 enganche,
      16 constancia, 6 compuesta, 0 formulario sobre las 81 activas, sin ninguna sin clasificar.
      **Desde el 2026-09-02 también corre solo en el deploy** (`apply-pdtp-mechanisms`), después de los
      retiros: se aplicaba a mano y en producción no había corrido nunca.
- [ ] T05 Activar el programa `pdtp-2026-v1` según lo decidido en T01.
- [x] T06 **Decidido (D21):** el responsable de la N°25 sigue siendo conductores y operadores — es documental,
      no de cuenta. No se crea el rol. Queda por resolver la cola de `/pendientes`, ver G18.
      Antes decía: `conductores_operadores_choferes` no existe como rol
      RBAC y es responsable de la N°25. Resolver con `npm run db:sync-rbac` o reasignando el responsable.

**Verificación:** `select mechanism, count(*) from pdtp_activities group by 1;` no debe devolver `sin_definir`
salvo las cinco de G12; `select status from pdtp_programs where id='pdtp-2026-v1';` debe decir `active`.
Marcar una actividad cualquiera desde la planilla y ver la fila en `pdtp_executions`.

---

## G1 — Plantillas de inspección

**Objetivo:** que completar una inspección acredite su actividad. Hoy sólo `inspeccion_taller` (N°27) declara
su número; las otras once dejan `onInspectionCompleted` en no-op (hallazgo H6).

**Cierra:** N°24, 25, 26, 29, 33, 34, 39, 40, 41, 64, 65.

- [x] T07 Revisado el plan con `SEED_DRY_RUN=true`: 14 a instalar, 1 sin cambios.
- [x] T08 Corrido en firme en dev el 2026-09-02: 14 plantillas instaladas, doce con su actividad declarada.
      **En producción no hace falta correrlo a mano**: `seed-inspection-templates` ya es un paso del deploy
      ([deploy-prod.sh:437](../scripts/deploy-prod.sh)).
- [ ] T09 Habilitar cada plantilla desde el catálogo de inspecciones: el instalador las deja **como borrador**
      a propósito —un instrumento lo pone vigente una persona y queda constancia de quién y cuándo—, así que
      esto no se automatiza. Es el único paso de G1 que queda, y hasta que ocurra ninguna acredita.
- [x] T10 **Decidido (D03): se confirman** los mapeos de N°40 (`inspeccion_area`) y N°41
      (`caminata_seguridad`). Venían cableados al ampliroll y a maquinaria pesada, que son observaciones
      conductuales por operador; el código ya los soltó pero la decisión no está escrita.
- [x] T11 **Decidido (D04) e implementado** (ver T89): `executor_of_record = 'declared_in_form'` declarado en
      `reporte_equipos` dentro de `PDTP_2026_INSPECTION_SPECS`, así que el candado de independencia deja
      firmar al JT. **Llega a la base recién con T08** —el instalador es quien lo escribe—: hoy en dev la
      plantilla sigue en `platform_user`. Antes decía: el candado de independencia impide que quien ejecuta
      revise lo suyo. Subir la foto con `prevention:inspections:ingest` no convierte en ejecutante, así que el
      JT sube, otra persona teclea y la firma queda para el JT.
- [ ] T12 Limpiar la plantilla `INSP-DEMO`: 48 runs sin respuestas y sin actividades declaradas.

**Verificación:** hecha en dev el 2026-09-02 — doce plantillas traen su arreglo de actividades y
`reporte_equipos v02` trae `executor_of_record = 'declared_in_form'`. Falta completar una inspección con una
plantilla vigente y ver la ejecución `origin='integration'` en `pdtp_executions`, que depende de T09.

---

## G2 — Cursos de capacitación

**Objetivo:** que cerrar una sesión acredite su actividad. El conector `onTrainingSessionClosed` está cableado
y lee `prevention_training_courses.pdtp_activity_numbers`; ningún curso lo declara (hallazgo H7).

**Cierra:** N°37, 38, 51, 53, 54, 55, 56, 57, 58, 59, 60, 63.

Se hace desde `/prevencion/capacitacion/catalogo`, en el campo *actividades PDTP* del formulario del curso.
No requiere código. Un curso por actividad, salvo que Prevención decida agrupar:

- [x] T13 N°37 — Charlas de seguridad (PRF)
- [x] T14 N°38 — Charlas de seguridad por turno (SUP/JT), volumen alto
- [x] T15 N°51 — Capacitación según detección de necesidades
- [x] T16 N°53 — Charla diaria de seguridad y salud en el trabajo
- [x] T17 N°54 — Capacitación Extintores *(meta 90 %, ver G5)*
- [x] T18 N°55 — Capacitación Primeros auxilios
- [x] T19 N°56 — Manejo a la defensiva *(meta 90 % de conductores, ver G5)* — el curso `B-01` ya existe con `[]`
- [x] T20 N°57 — Comunicación Efectiva
- [x] T21 N°58 — Capacitación Coordinador GRD
- [x] T22 N°59 — Investigación de accidente, árbol causal
- [x] T23 N°60 — Liderazgo para Línea de Mando
- [x] T24 N°63 — Uso correcto de EPP, reposición y eliminación

**Verificación:** `select code, name, pdtp_activity_numbers from prevention_training_courses;` — ningún curso
del programa debe quedar en `[]`. Cerrar una sesión y ver la ejecución acreditada.

---

## G3 — Plan de emergencia (simulacros)

**Objetivo:** que completar un simulacro acredite la N°84. El conector está cableado y lee los números
**del plan**, no del simulacro.

**Cierra:** N°84.

- [x] T25 Declarar la N°84 en el plan de emergencia de cada faena, desde el diálogo *Actividades PDTP* del
      detalle del plan (`/prevencion/emergencias/[planId]`).
- [x] T26 No declarar la N°83 aquí: el plan no la acreditaría al publicarse sino al correr un simulacro, que
      es la N°84. Cumplido: `apply-pdtp-2026-program-data.ts` declara sólo la N°84, y la N°83 quedó en su
      propio conector al aprobar el plan (G10).

**Verificación:** `select title, pdtp_activity_numbers from prevention_emergency_plans;`. Completar un
simulacro y ver la ejecución.

---

## G4 — Campañas

**Objetivo:** poder declarar cuál de las cinco campañas acredita cada una. Hoy la UI fija `[85]` literal y no
hay editor posterior, así que las N°86 a N°89 son inalcanzables desde la aplicación (hallazgo H2).

**Cierra:** N°85, 86, 87, 88, 89.

- [x] T27 Agregar el selector de actividad PDTP al diálogo de creación de campañas
      ([campanas-client.tsx:100](<../app/(app)/prevencion/campanas/campanas-client.tsx#L100>)). El servicio y la
      acción ya aceptan el arreglo completo; el que no lo ofrece es el formulario.
- [x] T28 Permitir editar el campo en una campaña ya creada, o dejar constancia de que no es editable.
- [x] T29 N°85 — Módulos vida saludable, alimentación saludable, actividad física
- [x] T30 N°86 — Manejo del estrés
- [x] T31 N°87 — Alcohol y Drogas No Van Al Volante
- [x] T32 N°88 — Seguridad Vial
- [x] T33 N°89 — Puntos ciegos en la conducción y operación

**Verificación:** crear una campaña de la N°87 desde la UI y confirmar que `prevention_campaigns` guarda `[87]`
y no `[85]`.

---

## G5 — Modo cobertura

**Objetivo:** que las actividades que se miden por padrón dejen de medirse por cantidad planificada. El cálculo
ya está implementado en [compliance.ts](../lib/services/pdtp/compliance.ts) y ninguna actividad lo usa
(hallazgo H5): falta el dato, no el código.

**Cierra la medición de:** N°17, 18, 23, 24, 50, 54, 56.

- [x] T34 `indicator_mode = 'coverage'` puesto en **las siete**: N°17, 18, 23, 24, 50 desde antes, y **N°54 y
      N°56 el 2026-09-02** (G2 ya aplicado, así que el padrón de cursos existe).
- [x] T35 `target_coverage_percent = 90` cargado en `pdtp_activity_worksite_params` para N°54 y N°56, en las 7
      faenas del programa (`pdtp_program_worksites` vacía → todas las activas). Corrección al enunciado
      original: la columna no está en `pdtp_activities`, es **por faena**; `COVERAGE_TARGETS` en
      `apply-pdtp-2026-catalog-decisions.ts` itera faenas y llama `setPdtpActivityWorksiteAdjustment`,
      preservando la exclusión existente si la hubiera. La N°54 usa `subjectSource: 'dotacion'`; **la N°56
      queda sin fuente declarada** — mide "conductores, operadores y quienes conducen vehículos livianos", un
      subconjunto que el CHECK de `subject_source` no admite (`equipos` cuenta vehículos, no personas). Cae al
      comportamiento de siempre (cantidad planificada). Hueco de diseño anterior a T35, no creado por él.
- [ ] ~~T36~~ **Superada por G19:** el padrón se deriva en vez de cargarse. Antes decía: cargar el padrón por faena donde la dotación activa no sirva
      de denominador. Para N°33/34 y N°25/26 el padrón existe: `fuel_vehicles` — que también está en cero filas.
- [ ] ~~T37~~ **Superada por G19 y D16:** el inventario ya existe (`prevention_emergency_resources`). Antes decía: requiere inventario de extintores como sujeto; existe el
      archivo `INVENTARIO DE EXTINTORES FAENA BIODIVERSA 2026.xlsx` en la raíz, sin cargar.

**Verificación:** `select n, indicator_mode from pdtp_activities where indicator_mode='coverage';` debe traer
las siete. Revisar el % de cumplimiento de una faena antes y después.

---

## G6 — Higiene y vigilancia

**Objetivo:** construir el enganche de los protocolos MINSAL y las evaluaciones de mutual. Los módulos existen
completos y ningún servicio llamaba al motor. **Están en cero filas** —ni un grupo de exposición ni una
medición cargada— así que el enganche quedó cubierto por tests y no por datos reales.

**Cierra:** N°45, 46, 47, 48, 49, 50. Implementado el 2026-09-01.

- [x] T38 Sumar `higiene` y `vigilancia` al union `PdtpAccreditationSourceType`
      ([accreditation.ts:37](<../lib/services/pdtp/accreditation.ts#L37>)). Sin migración: la columna
      `pdtp_executions.source_type` es `text` sin CHECK.
- [x] T39 Conector desde la medición de exposición para la N°45, cableado en `recordExposureMeasurement`.
- [x] T40 Verificado: el módulo **no** admite evaluación cualitativa —`value` es numérico obligatorio en
      schema, Zod y formulario—, así que la **N°44 baja a constancia**. Registrarla como medición obligaría a
      inventar un número que la evaluación no tiene.
- [x] T41 Conector para las N°46–49 desde `setProtocolApplicability`, no desde `createSurveillanceProgram`:
      el programa de vigilancia se crea una vez y ninguna función cambia su estado, así que sólo podría
      acreditar 1 de las 4 ocurrencias de PREXOR. La aplicabilidad se reevalúa y sube `version`, que calza
      con la cadencia 4/2/2/2 y sirve de discriminador en el `sourceId`.
- [x] T42 Conector para la N°50 desde `recordSurveillanceOutcome`, con reversión cuando el control deja de
      estar asistido. `COVERAGE_ACTIVITIES` ya incluye la 50 en el script de decisiones de catálogo.
- [x] T43 Tests: 15 casos PGlite en `lib/__tests__/prevention-hygiene-pdtp-accreditation.test.ts`
      (registrado en `tests/pglite-files.ts`) y 5 unitarios del mapeo de protocolos.

**Archivos:** `lib/services/pdtp-adapters/hygiene-accreditation-connector.ts` (nuevo),
`lib/services/prevention-hygiene.ts` (tres puntos de cableado), `lib/services/pdtp/accreditation.ts`,
`modules/prevention/manifest.ts`, `scripts/apply-pdtp-2026-mechanisms.ts`,
`scripts/apply-pdtp-2026-catalog-decisions.ts`.

**Pendiente antes de que rinda en producción:** correr `npm run db:sync-rbac` para el grant nuevo del PRF,
y los pasos de datos de G5/Fase 5 (padrón de la N°50) **en la ventana de borrador del programa** —
`indicator_mode` y `pdtp_activity_worksite_params` entran en el digest firmado.

**Verificación:** registrar una medición y pronunciarse sobre cada protocolo, y ver las ejecuciones con
`origin='integration'`. Ojo: nacen `submitted`, así que el % de cumplimiento no se mueve hasta aprobarlas.

---

## G7 — Documentación SST

**Objetivo:** que publicar o distribuir un documento acredite. El módulo tiene distribución por trabajador con
`due_at`, exención con motivo, recordatorios y acuse con firma e IP — y **cero filas**.

**Cierra:** N°19, 36, 43.

- [x] T44 Sumar `documento` al union `PdtpAccreditationSourceType`.
- [x] T45 N°43 — acreditar al publicar una versión nueva del procedimiento de trabajo seguro.
- [x] T46 N°36 — acreditar la difusión de la matriz MIPER por acuse de recibo, en modo cobertura por cargo.
- [x] T47 **Reinterpretada, no D9.** El catálogo dice algo más concreto que "requisitos legales genéricos":
      *"Mantener actualizada la carpeta de… entrega EPP, IRL, RIOHS"* — son las carpetas de trabajador, el
      mismo hecho que ya cierra G11 (N°15, 18, 23). `onboardingActivityNumbers` en
      `worker-onboarding-connector.ts` agrega la N°19 cuando esas tres ya cerraron: la carpeta queda al día
      con los mismos tres componentes, archivados. Sin migración, sin `subject_source` — es
      `planned_vs_completed`, no `coverage` (ya lo declaraba así el catálogo). Las cartas del SEREMI quedan
      como evidencia de respaldo del expediente, sin ítem propio en el acta que las registre. La lista de
      documentos por faena de D12 (la N°19 original del diseño de agosto, que SÍ mapeaba a "carpeta de
      requisitos legales" en `prevention_legal_requirements`) sigue sin resolver — ver T48.
- [ ] T48 **Dos brechas de dato distintas**, ninguna resuelta: (a) Documentación SST (`sst_documents`) sigue en
      cero filas, así que N°36/43 no son verificables con datos reales; (b) la lista de documentos exigidos
      por faena de la D12 —si se quiere ese registro además de la carpeta de trabajador— sigue sin definir.

**Verificación:** publicar una versión y confirmar la ejecución. Para la N°36, registrar acuses hasta pasar el
umbral de cobertura.

---

## G8 — MIPER

**Objetivo:** que publicar una revisión de la matriz acredite. El módulo tiene scoring inherente/residual y
publicación con hash, y nada acreditaba. **Está en cero filas**: ninguna matriz cargada, así que el conector
queda verificado por tests y no por datos reales.

**Cierra:** N°35.

- [x] T49 Sumar `miper` al union `PdtpAccreditationSourceType`.
- [x] T50 Conector al publicar una revisión de la matriz de la faena.
- [x] T51 **Verificado, sin cambio (2026-09-02):** `createRiskReviewTriggerWithClient` sólo inserta en
      `prevention_risk_review_triggers` e historial — cero llamadas al motor. `onRiskMatrixPublished` tiene un
      único punto de invocación, dentro de `transitionRiskMatrix(toStatus: 'published')`. Un disparador abierto
      desde un incidente no puede acreditar la N°35 por ningún camino.

**Verificación:** publicar una revisión y ver la ejecución.

---

## G9 — Indicadores de faena

**Objetivo:** que el ingreso mensual de indicadores acredite la N°7 ("Envío de estadística de cada faena").

**Cierra:** N°7.

- [x] T52 Sumado `indicadores` al union `PdtpAccreditationSourceType`. Sin migración: `source_type` es `text`
      sin CHECK.
- [x] T53 El evento es `closeSafetyIndicatorPeriod`, no los upserts: `upsertSafetyIndicatorMonth` es un teclado
      sin estado (`manual_legacy`) y `upsertSafetyIndicatorDenominator` deja el mes en `draft`/`pending_review`.
      `closeSafetyIndicatorPeriod` aborta si el período no está conciliado.
- [x] T54 Conector `onSafetyIndicatorPeriodClosed` en `pdtp-accreditation-connectors.ts`, llamado después del
      commit de `closeSafetyIndicatorPeriod`. `sourceId` lleva el snapshot (un re-cierre genera snapshot nuevo
      y por tanto otra fila). `occurredAt` es `closedAt`, no el mes que se cierra.
      **Revocación cableada el 2026-09-03.** `reopenClosedPeriod` devuelve qué revocar en vez de
      revocarlo, y las dos entradas reales —`upsertSafetyIndicatorDenominator` y
      `classifyIncidentPersonForIndicators`— disparan después del commit con el patrón acumulador, que
      es lo que evita el deadlock de conexión única. La tercera entrada,
      `invalidateClosedIndicatorPeriod`, no tenía llamadores: se conservó como el envoltorio correcto.
      De paso salió un defecto mayor que la desconexión: el conector sellaba la revocación con
      `indicadores:${worksiteId}` mientras el cierre usa `indicadores:${snapshotId}`, así que cableado
      tal cual habría revocado cero ejecuciones y dejado un evento `revoked` mintiendo.

**Verificación:** ingresar los indicadores de un mes y ver la ejecución en ese período. Verificado el conector
en aislamiento contra `bodega_dev`: cierra genera 1 ejecución `submitted`, reintentar el mismo snapshot no
duplica.

---

## G10 — Plan de emergencia por amenaza (N°83)

**Objetivo:** cerrar el hallazgo H4. La N°83 se cumple al **publicar el plan por cada amenaza**, no al correr
un simulacro; hoy el único disparador del módulo es `completeEmergencyDrill`.

**Cierra:** N°83.

- [x] T55 Acreditar la N°83 al publicar el plan de emergencia con sus escenarios, con su propio conector
      separado de `onEmergencyDrillCompleted`.
- [x] T56 Definir la cantidad: el programa la planifica por amenaza, así que el denominador son los escenarios
      del plan, no los planes.

**Verificación:** publicar un plan sin correr simulacros y confirmar que la N°83 queda acreditada y la N°84 no.

---

## G11 — Cablear el acta de trabajador nuevo (D22)

**Objetivo:** que el acta de trabajador nuevo acredite las actividades de habilitación. **Su premisa anterior
era falsa:** decía que Habilitación del trabajador "no existe ruta, servicio ni tabla". Existe —`TRABAJADOR_NUEVO`
en `lib/sst/definitions/`, revisión 01 del 2026-02-25, con rutas, servicio, respuestas por ítem y acta de
cierre inmutable por DS 44— y lo que falta es el cable: el módulo SST no tiene una sola referencia al motor
de acreditación.

**Cierra:** N°15, 18, 23, 52 y 63. La N°16 va por capacitación y la N°17 no (ver D06).

- [x] T57 Sumar `evaluacion_sst` al union `PdtpAccreditationSourceType`.
- [x] T58 Conector nuevo con el mapa ítem-del-acta → actividad, en el estilo del mapa de protocolos MINSAL:
      `induccion_irl` → N°15, `riohs` → N°18, sección `epp` completa → N°23, acta cerrada como
      `habilitado_autonomo` → N°52, `capacitacion_epp` → N°63 (confirmado en D05).
- [x] T59 Cablearlo en `closeEvaluation` con el patrón acumulador. `applicableResponses` ya está en scope, así
      que el conector sabe qué ítems quedaron `cumple`. No necesita reversión: el acta cerrada es inmutable.
- [x] T60 **No** acreditar la N°17 desde el acta: el RE-28 es un formulario propio (D06). Sigue midiéndose por
      cobertura contra la dotación, con padrón derivado (ver G19).
- [x] T61 N°16 — nota y resultado desde `prevention_training_attendance.assessment_score`, que es otro módulo.
- [x] T62 Tests: cerrar un acta con `induccion_irl` y `riohs` en `cumple` genera las ejecuciones; en
      `no_cumple` no; cerrar dos veces no duplica; sin programa activo el cierre no falla.

**Verificación:** crear y cerrar un acta en `/prevencion/nueva` y ver las ejecuciones en la planilla.

## G19 — Padrón derivado (D15, D16)

**Objetivo:** que el padrón de cobertura se derive del registro de sujetos en vez de que alguien lo teclee.
Reemplaza a T36 y T37 de G5. Plan completo en `~/.claude/plans/crea-un-plan-de-greedy-dove.md`, fases 1 y 2.

**Cierra la medición de:** N°17 (dotación), N°24 (extintores, D16), N°50 (expuestos del GES). Deja lista la
fuente de las N°33/34 (`fuel_vehicles`) si alguna vez pasan a cobertura.

- [x] T94 Migración: `subject_source` en `pdtp_activities` con CHECK, hermana de `indicator_mode`. Entra al
      digest (el método es compromiso del programa, el conteo no). `schemaVersion` 9 → 10.
- [x] T95 `lib/services/pdtp/subject-registry.ts`: una consulta por fuente, todas con la misma firma.
      Extintores desde `prevention_emergency_resources` con `resource_class = 'extinguisher'` — la tabla **ya
      es el inventario por faena**, no hace falta una nueva.
- [x] T96 En `compliance.ts`: override manual → padrón derivado (si > 0) → cantidad planificada. Un registro
      vacío **no** es padrón cero: cae a lo planificado, o la actividad desaparecería del denominador.
- [x] T97 Sembrar las tres fuentes desde `apply-pdtp-2026-catalog-decisions.ts`, y corregir su comentario de
      las líneas 98-101, que todavía describe el fallback de dotación que H11 eliminó.
- [x] T98 Tests con el molde de `pdtp-coverage-r2.test.ts`, incluida la anti-regresión del registro vacío.

---

## G12 — Limpieza del catálogo

**Objetivo:** sacar del denominador lo que ya no es del programa (hallazgos H9 y H10). Son decisiones más
edición de datos, no código.

**Cierra:** N°2, 5, 12, 13, 14, 21.

Va como edición del **programa**, nunca del catálogo: `db/seed/pdtp-catalog-2026.json` es una copia notariada
del XLSX del cliente y su test de contrato le fija el SHA256. Usar `retirePdtpActivity` con motivo y fecha
efectiva, no `DELETE`: conservar el número mantiene válido el mapeo de plantillas.

Aplicado el 2026-09-01 con `npm run pdtp:apply-catalog-decisions`. Las decisiones estaban escritas en el
script desde el 2026-08-12 y nunca habían corrido contra la base; ahora además corren solas en cada deploy.

- [x] T65 N°2 — retirada (difundir el plan a gerencias y subgerencia).
- [x] T66 N°5 — retirada (control de cumplimiento de la línea de mando).
- [x] T67 N°12 — trasladada al programa propio del CPHS (cursos de los integrantes).
- [x] T68 N°13 — trasladada al programa del CPHS (reunión mensual).
- [x] T69 N°14 — trasladada al programa del CPHS (plan de trabajo del comité).
- [x] T70 **Decidido (D02) y aplicado el 2026-09-02:** la N°21 mide lo mismo que las N°66–78, que desde
      2026-08 se acreditan solas, así que contaba dos veces el mismo trabajo. Entró a `RETIREMENTS` en
      `apply-pdtp-2026-catalog-decisions.ts`, así que también se aplica sola en cada deploy.
- [x] T71 Texto de la N°3 corregido (sin "y CPHS") y la guía de la N°23 (sin "por recambios"). También salió
      el CPHS como corresponsable de las N°15, 73 y 76.

**Resultado:** 87 → **81 actividades activas**, 6 retiradas con motivo y fecha efectiva en el change log.
Con eso el hallazgo H9 queda cerrado y `pdtp:apply-mechanisms` ya no reporta actividades sin clasificar.

**Verificación:** `select n from pdtp_activities where status='active' order by n;` no debe traer las retiradas,
y el change log debe registrar quién sacó qué y por qué.

---

## G13 — Decisiones sin módulo

**Objetivo:** resolver los dos subgrupos que el diseño dejó marcados con ⚠️ —sin módulo *y sin decisión*—.
Hoy funcionan como constancia manual, que es un mecanismo válido; la pregunta es si merecen módulo propio.

**Afecta:** N°30, 31, 32 (alcotest), N°79, 80, 81 (CGRD) y N°10 (DS 594).

- [x] T72 **Decidido (D08): se construye módulo.** Ver G14. Lo único que existe hoy es el equipo físico como ítem
      de servicio para su calibración. Son tres actividades con calendario semanal.
- [x] T73 **Decidido (D09): se construye módulo.** Ver G15. Es un comité distinto del paritario, con su matriz,
      sus actas y su plan de trabajo: el mismo patrón que llevó al CPHS a tener el suyo.
- [x] T74 **Decidido (D11): se escribe.** Ver G16. La definición de condiciones ambientales DS 594 que no existe en
      `lib/sst/definitions/`. Con ella la actividad sube de constancia a enganche por inspección.
- [x] T75 **Decidido (D18): se construye.** Ver G17, con el alcance reducido a ocho actividades. No bloquea nada: las 15 constancias ya se
      marcan desde la planilla. Sería para reunirlas en un solo lugar y resolver su relación con `/pendientes`.


---

## Grupos nuevos que crean las decisiones del 2026-09-02

Ninguno estaba en el plan original. Salen de las resoluciones D04, D08, D09, D11, D18, D19 y D21.

---

## G14 — Módulo de alcotest (D08) — ✅ hecho el 2026-09-02 (Fase 5.2)

**Cierra:** N°30, 31, 32. Salen de constancia manual, pasan a `enganche` (`apply-pdtp-2026-mechanisms.ts`,
aplicado en `bodega_dev`).

- [x] T76 `alcohol_tests` recuperada con sus columnas originales de `0011_late_madrox.sql` (se borró en la poda
      de 2026-07-02) más `equipment_id`, FK a `service_equipment` (kind='alcotest') — el alcotómetro es un
      ítem existente, no una tabla nueva, y su calibración ya se controla ahí. `alcohol_test_dispatches` es la
      entidad nueva del envío mensual (N°32): lote con período (año, mes), destinatario, evidencia y
      `test_count`, único por (faena, año, mes). Migración `0243_robust_rafael_vega.sql`.
      `db/schema/prevention/alcotest.ts`.
- [x] T77 `sourceType: "alcotest"` nuevo en `PdtpAccreditationSourceType` (sin migración: `source_type` es texto
      libre). `lib/services/prevention-alcotest.ts`: `resolveAlcotestActivityNumber(roles)` — función pura,
      N°30 si el rol mapea a PRF (`prevencionista_faena`/`prevencionista`), N°31 si mapea a Sup/JT
      (`supervisor_terreno`/`jefe_terreno`), `null` si no mapea a ninguno (mismo criterio que la N°64/65 de
      EPP: dos instrumentos por rol, no un campo de la fila). `recordAlcoholTest` valida alcance, resuelve el
      número, inserta y llama `recordPdtpFulfillmentEvent` — nace `submitted`, no autoaprobado
      (`autoApproveByUserId` es sólo para `"inspeccion"`, `accreditation.ts:169-171`).
- [x] T78 `recordAlcoholTestDispatch`: cuenta los controles del (faena, año, mes) pedido, inserta el envío y
      acredita la N°32 con `sourceId = alcotest-dispatch:${id}` — un acto sobre el lote, no sobre cada control
      (mismo error que ya documentó la N°28 si se acreditara por control). Guarda friendly ante reenvío del
      mismo período (el índice único lo bloquearía con un error de driver, no uno legible).

Permisos propios `prevention:alcotest:view/register/dispatch` (no `alcohol_tests`, retirado y prohibido en
`prevention-rbac.test.ts`). N°30/31/32 sumados a `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS`
(`lib/services/pdtp/fulfillment.ts`) para que la compuerta 81/81 los reconozca como `enganche` con conector
real. Ruta `/prevencion/alcotest`: registrar control y envío mensual, listar ambos por faena.
21 tests PGlite en `lib/__tests__/prevention-alcotest.test.ts`.

**Completado el 2026-09-02, segunda pasada (persona evaluada y equipo).** El primer corte dejó
`tested_worker_id` sin exponer en la UI, lo que acreditaba bien pero dejaba un registro flojo como evidencia:
un alcotest que no dice a quién se le tomó no es oponible ante un fiscalizador. Cerrado así
(migración `0246_remarkable_thunderbolts.sql`):

- **Columna nueva `tested_person_name`** y CHECK `alcohol_tests_subject_valid` excluyente —o trabajador de la
  dotación, o nombre de un tercero, nunca ambos ni ninguno. El fallback por nombre no es un atajo: el alcotest
  se aplica también al chofer de un proveedor, que no está en `workers`. Mismo patrón que
  `prevention_committee_attendance` con integrante vs invitado.
- **Pertenencia a la faena validada en las dos FK**: la persona evaluada y el alcotómetro deben ser de la faena
  del control, y estar activos. Un control atribuido a alguien o a un equipo de otra faena no se sostiene.
- **`equipment_id` expuesto**, con `listAlcotestEquipment` filtrando `kind = 'alcotest'` e `isActive`. La razón
  de enlazarlo es que la calibración se controla en `service_equipment`: un control hecho con un equipo
  descalibrado no prueba nada, y sin el enlace el sistema no podía distinguirlo. Sigue siendo opcional porque
  no todo alcotómetro está dado de alta todavía.

---

## G15 — Módulo de CGRD, DS 44 (D09) — ✅ hecho el 2026-09-02 (Fase 5.1)

**Cierra:** N°79, 80, 81. Deuda normativa: es un comité que el DS 44 exige, distinto del paritario. Pasan de
`constancia` a `enganche` (`apply-pdtp-2026-mechanisms.ts`, aplicado en `bodega_dev`).

- [x] T79 Comité: `prevention_grd_committees` + `prevention_grd_members`, molde de CPHS (constitución por
      faena, integrantes con rol, vigencia, un solo comité activo por faena — índice único parcial).
- [x] **Umbral de dotación resuelto el 2026-09-03** (norma aportada por el usuario, migración
      `0249_next_eddie_brock.sql`). DS 44 y la guía de GRD: **hasta 25 personas corresponde designar un
      Coordinador de Gestión del Riesgo de Desastres; desde 26, constituir el Comité.** Es otra figura que el
      **Delegado de SST** (otro cuerpo normativo, entre 10 y 25 cuando no hay Comité Paritario) y pueden
      coexistir. Implementado como `prevention_grd_coordinators` (molde de `prevention_worksite_delegates`),
      `resolveGrdStructure`/`grdStructureSatisfies`/`GRD_COMMITTEE_MIN_HEADCOUNT` en `lib/prevention/cgrd.ts`
      y `getGrdStructureStatus` para que UI y compuerta lean la misma regla. Reglas:
      - Designar coordinador con 26 o más **se rechaza**: es el mínimo de la norma, no una preferencia.
      - Constituir comité en faena chica **se permite**: la norma fija un mínimo y sobrecumplirlo no es
        incumplir.
      - Constituir el comité **termina** la designación del coordinador, con motivo en la bitácora: es el
        camino de migración de la faena que cruza el umbral, y dos órganos vigentes afirmarían algo que la
        norma no pide.
      - La **N°79 se acredita con el órgano que corresponda**: en una faena de hasta 25 el acto exigible es
        la designación, no un comité.
      - `getGrdStructureStatus` deja visible la brecha del coordinador que dejó de bastar porque la faena
        creció (`satisfied: false`).
- [x] T80 `prevention_grd_matrices` + `prevention_grd_threats`: la **máquina completa de la MIPER** (D09 lo
      pedía así, no la de Emergencias), `draft → in_review → reviewed → approved → published → superseded`,
      tres firmas segregadas, `published_hash_sha256`, una sola publicada por faena. **No es MIPER** — tabla
      de amenazas propia (`origin` obligatoria/detectada, análisis histórico, evaluación legal y plan de
      trabajo por amenaza — los tres componentes que el enum cerrado de
      `prevention_emergency_scenarios.type` no tiene dónde guardar), con puente opcional
      `emergency_scenario_id` al componente 5 (la matriz referencia el plan de emergencia aprobado, no lo
      duplica — la N°83 se sigue acreditando aparte por escenarios, D13).
- [x] T81 `prevention_grd_meetings`: patrón de actas del CPHS (convocar → cerrar con acta → o cancelar).
      **Sin quórum calculado, y ya no por falta de dato: el DS 44 no fija quórum para las reuniones del
      CGRD** (confirmado el 2026-09-03). No hay regla que computar — el `assessQuorum` del CPHS mide mayoría
      de titulares *y* presencia de ambas representaciones porque ese órgano es bipartito por DS 54, y el CGRD
      no lo es. Quien cierra el acta declara si hubo quórum, y queda con autor y fecha en la bitácora. Esto
      deja de ser una simplificación pendiente: es la conducta correcta.
- [x] **Acuerdos del acta derivados a CAPA** (segunda pasada del 2026-09-02, migración
      `0247_little_warpath.sql`). El primer corte los dejó como prosa dentro del texto del acta, sin que nadie
      los persiguiera. Ahora `prevention_grd_agreements` con el mismo criterio que el CPHS: cada acuerdo abre
      una CAPA (`sourceType: 'cgrd'`, valor nuevo en el CHECK de `prevention_capa_actions` y en el enum Zod de
      `capaCreateSchema`) y el acuerdo **no** tiene columna `status` — el estado del acuerdo ES el de su CAPA,
      decisión "CAPA motor único" que prohíbe el espejo porque se desincroniza y miente. Las CAPA se crean
      **antes** del UPDATE del acta: si una falla —un responsable inactivo, por ejemplo— revierte todo y el
      acta no queda cerrada a medias con acuerdos perdidos ni con la N°81 acreditada.
- [x] T82 Tres conectores en `pdtp-accreditation-connectors.ts`: `onGrdCommitteeConstituted` (N°79),
      `onGrdMatrixPublished` (N°80), `onGrdMeetingClosed` (N°81) — `sourceType: "cgrd"` nuevo, sin migración
      (`pdtp_executions.source_type` es texto libre). Sumados a `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS`
      (compuerta 81/81).

Migración `0244_lonely_cerise.sql`: las cinco tablas más `'cgrd'` en el CHECK de
`prevention_pdtp_source_links.source_type` y `'grd_committee'`/`'grd_matrix'`/`'grd_meeting'` en el de
`sst_document_links.entity_type`. Permisos propios (`prevention:cgrd:view` + `committee:manage` +
`matrix:edit/review/approve/publish` + `meeting:manage`, mismo reparto segregado que la MIPER). Helpers puros
en `lib/prevention/cgrd.ts` (máquina de transición + permiso por estado, con sus propios tests). Ruta
`/prevencion/cgrd`: selector de faena, comité + integrantes, matriz (crear versión, agregar/quitar amenaza,
transicionar) y actas (convocar/cerrar/cancelar) en una sola pantalla.

13 tests PGlite (`lib/__tests__/prevention-cgrd.test.ts`): constitución + duplicado bloqueado + fuera de
alcance, integrantes, máquina de estados completa con segregación, supersede, actas con acreditación y
cancelación, y los tres casos de acuerdos (CAPA creada con plazo y prioridad, acta sin acuerdos, y el rollback
completo cuando un acuerdo es inválido). Suite adicional sobre Postgres real (`lib/__tests__/prevention-cgrd-postgres.test.ts`, molde de
`prevention-cphs-postgres.test.ts`) para el mismo invariante de "una sola publicada por faena" — con
`PREVENTION_CGRD_DATABASE_URL`/`PREVENTION_CGRD_ALLOW_DESTRUCTIVE_RESET` ya en `ci.yml`, para que el
`describeIf` no la salte en verde sin que nadie lo note.

---

## G16 — Checklist de condiciones ambientales DS 594 (D11)

**Cierra:** N°10. ✅ Hecho el 2026-09-02.

- [x] T83 `INSPECCION_CONDICIONES_AMBIENTALES` en `lib/sst/definitions/`, molde de `inspeccion_taller`. Doce
      ítems (`cumple_parcial_nocumple_na_obs`) desde la Ley 21.512 (ex DS 594): agua potable, servicios
      higiénicos, duchas, vestidores, comedor, residuos, ventilación, iluminación, orden y aseo, plagas. Sin
      ruido ni temperatura, que ya tienen protocolo propio (N°45-49).
- [x] T84 Declarada en `PDTP_2026_INSPECTION_SPECS` con `n: 10`. Instalada en dev:
      `npm run db:seed-pdtp-inspection-templates` la crea en `draft` (queda T09, habilitarla, como el resto).
- [x] T85 Sacada de `CONSTANCIA`, agregada a `ENGANCHE`. Aplicado en dev con `npm run pdtp:apply-mechanisms`:
      N°10 pasó a `enganche`.

**Verificación:** paridad de 12 ítems puntuables fijada en `lib/sst/__tests__/definitions.test.ts`; test de
definición propio en `lib/__tests__/inspeccion-condiciones-ambientales-definition.test.ts`. Confirmado en
`bodega_dev`: `mechanism = 'enganche'` para la N°10.

---

## G17 — Submódulo Constancias (D18) — ✅ hecho el 2026-09-02 (Fase 4.5)

**Cierra:** nueve actividades — N°3, 6, 20, 22, 28, 42, **44** (el TODO la había omitido), 61, 82 — que **ya se
podían marcar hoy** desde la planilla. El valor es reunirlas, no habilitarlas. Baja a un número más chico
cuando G14/G15 reclasifiquen 30–32 y 79–81 de `constancia` a `enganche`: la ruta no lo necesita saber, filtra
por `mechanism = 'constancia'` en el momento, así que el conteo se ajusta solo.

- [x] T86 Ruta `/prevencion/constancias` (`app/(app)/prevencion/constancias/`) y
      `listPdtpConstanciaActivities` (`lib/services/pdtp/constancias.ts`): una fila por (actividad, faena),
      anclada al primer mes impago — misma regla `impago.mes` que la cola operacional (D12), para que el badge
      de `/pendientes` y esta lista cuenten lo mismo.
- [x] T87 `PdtpExecutionForm` reutilizado sin cambios. Permiso propio (`prevention:constancias:view`/`:execute`,
      no `prevention:pdtp:execute`): `markPdtpExecutionAction` acepta cualquiera de los dos
      (`guardAnyPermission`, nuevo en `lib/auth/can.ts`) y, cuando quien registra sólo tiene el de Constancias,
      exige `assertPdtpActivityMechanism(activityId, 'constancia')` antes de escribir — la UI ya filtra, pero el
      server action no confiaba en eso por su cuenta.
- [x] T88 **Resuelto: complementan, no compiten (ya era la decisión A4 implementada en el SQL).** La cola avisa
      con el CTA "Dejar constancia" → `/prevencion/constancias?faena=…`; Constancias es donde se marca. El 404
      que arrastraba esa ruta (meses en producción sin que ningún test lo detectara) queda cerrado y cubierto
      por un test que lee el literal real de la consulta
      (`lib/__tests__/navigation-targets-exist.test.ts`), no una copia a mano.

11 tests nuevos en `lib/__tests__/pdtp-constancias.test.ts` (PGlite): primer-mes-impago, vencida vs pendiente,
`submitted`/`approved` saldan la deuda y `draft` no, alcance por faena, exclusión R4, mecanismo `enganche`
fuera de la lista, sin programa activo. RBAC: bloque nuevo en `prevention-rbac.test.ts`.

**Hallazgo de paso, no de G17:** al ejercer esta fase con PGlite ya disponible salieron 5 fallas reales en
`prevention-pdtp.test.ts` que la salida intermitente de PGlite había dejado sin verificar desde que se cableó
`closed_on_time` (Fase 3): (a) el fixture compartido `prepareProgramForReview` fijaba `indicatorMode =
'closed_on_time'` en **todas** las actividades del programa de prueba, no sólo en las `on_demand`/`triggered` —
inerte antes de Fase 3, rompía `getPdtpComplianceIndicators` en cualquier test de `planned_vs_completed` en
cuanto ese modo empezó a leerse de verdad; y (b) el `beforeEach` borraba `pdtp_obligations` antes que
`pdtp_executions`, así que la cascada `ON DELETE SET NULL` podía anular dos ejecuciones de la misma celda a la
vez y chocar contra el índice único parcial. Las dos corregidas en el fixture/orden de limpieza del test, no en
el código de producción.

---

## G18 — Correcciones que exigen las decisiones (D04, D19, D21)

- [x] T89 **D04** — declarar en `prevention_inspection_templates` que el ejecutante de registro de
      `reporte_equipos` es el operador nombrado en el formulario, no quien lo teclea, para que el JT pueda
      firmar. Campo declarativo, no una excepción por nombre de plantilla.
- [x] T90 **D21** — resolver la cola de `/pendientes` para la N°25: asignarla al JT que opera, o declararla
      deliberadamente sin cola y dejarlo escrito.
- [x] T91 **D19** — permiso nuevo, más fino que `prevention:hygiene:manage`, que habilite pronunciarse sobre
      protocolos y registrar controles de vigilancia sin habilitar la administración del catálogo global de
      agentes.
- [x] T92 **D17** — blindar `setPdtpActivityWorksiteParams` con el guard condicional, y ajustar los dos tests
      que montan estado sobre un programa activo.
- [x] T93 **D20** — selector de actividad PDTP en el diálogo de campañas, editable después de crearla.


---

## Implementado el 2026-09-02

Todo verificado con las dos suites completas: **1005 tests PGlite** y **5067 non-pglite** en verde, typecheck y
lint limpios.

**Script nuevo** `scripts/apply-pdtp-2026-program-data.ts` (`npm run pdtp:apply-program-data`), enganchado al
deploy de producción como `apply-pdtp-program-data`. Declara el dato que los conectores ya cableados necesitan:

- **G2** — los 12 cursos con su actividad. Crea los que faltan y corrige el `B-01`, que existía con `[]`.
- **G3** — la N°84 en cada plan de emergencia. Hoy no hay ninguno cargado: un plan lleva amenazas y escenarios,
  lo redacta Prevención. El script avisa y vuelve a intentarlo en el próximo deploy.
- **G4** — las 5 campañas por faena, 35 en total, en estado borrador. Nada queda declarado como ejecutado.
- **D21** — quién opera la plataforma por un responsable sin cuenta (`operated_by_role_name`).

**G19 — padrón derivado.** `subject_source` en `pdtp_activities` (migración 0237, digest v10) y
`lib/services/pdtp/subject-registry.ts` con cinco fuentes. Dos clases: stock (dotación, extintores, expuestos
del GES, equipos) y flujo (trabajadores nuevos del mes). La guarda de "sólo meses con calendario" se levanta
para las de flujo, que es lo que hace medible a la N°18. Ocho tests nuevos.

**G11 — el acta de trabajador nuevo acredita.** `evaluacion_sst` en el motor y
`worker-onboarding-connector.ts` con el mapa ítem → actividad, cableado en `closeEvaluation`. Cierra la N°15,
18, 23, 52 y 63; **no** la N°17 (D06). Diez tests, incluido el cierre real de un acta con todos sus ítems.

**G18 — las correcciones de las decisiones.**

- **D04** — `executor_of_record` en las plantillas de inspección (migración 0238). Con `declared_in_form` el
  candado de independencia deja firmar a quien transcribe, porque el ejecutante está nombrado en el
  formulario. Declarado en `reporte_equipos`.
- **D21** — `operated_by_role_name` en el catálogo de responsables (migración 0239) y la cola de
  `/pendientes` lo considera. La N°25 vuelve a tener dueño visible sin cambiar quién responde.
- **D19** — permiso `prevention:hygiene:assess`, más fino que `manage`, que ya no habilita el catálogo global
  de agentes. El PRF pasó a `assess`.
- **D17** — `setPdtpActivityWorksiteParams` blindada: el padrón se corrige siempre, la meta y el responsable
  sólo con el programa editable.
- **D20** — selector de actividad en el diálogo de campañas y editor en la tabla, mientras la campaña no esté
  cerrada.

**G7, G8, G10 — tres conectores nuevos** en `pdtp-accreditation-connectors.ts`:

- `documento` (migración 0240: `pdtp_activity_numbers` en `sst_document_types`, que es el catálogo) → N°43 al
  publicar una versión y N°36 por cada acuse de recibo, que es cobertura.
- `miper` → N°35 al publicar una revisión de la matriz, no al aprobarla: la aprobada todavía no rige.
- N°83 al aprobar el plan de emergencia, con los **escenarios** como cantidad (D13). Conector aparte del
  simulacro, que es la N°84.

### Lo que quedó pendiente y por qué

- **T05** — activar el programa. Es la decisión operativa, no código.
- **T09, T12 (G1)** — habilitar las doce plantillas, que el instalador deja en borrador a propósito. El
  instalador ya corrió en dev y ya es un paso del deploy, así que la D04 quedó en la base.
- **T35 (G5)** — la meta de cobertura de la N°54 y la N°56, que espera los cursos de G2 en producción.
- **T47 (N°19)** — necesita la lista de documentos exigidos por faena, que es la D12 y sigue abierta.
- **T48** — el módulo de Documentación SST está en cero filas, así que su enganche no es verificable con
  datos reales.
- **T51** — revisar la interacción de MIPER con `createRiskReviewTrigger`.
- **T52 a T54 (G9)** — el conector de indicadores de faena, que nunca se empezó.
- **G14 a G17** — los módulos nuevos de alcotest y CGRD, el checklist DS 594 y el submódulo Constancias.

### El programa quedó sin bloqueadores el 2026-09-03

Verificado contra `bodega_dev`: `getPdtpSubmitReviewBlockers('pdtp-2026-v1')` devuelve **0**, y la compuerta
reporta **80/81 listas**. El único pendiente es informativo y no frena el envío: la N°56 midiéndose por
cobertura sin fuente de padrón declarable, que sigue esperando el dato de Prevención.

Antes de esto había un bloqueador vivo con 10 actividades, que **contradecía lo que este documento y mis
informes venían diciendo** ("T05 es sólo una decisión operativa"). Eran dos cosas:

- **Las nueve constancias no declaraban evidencia mínima.** La compuerta la exige —una constancia sin
  evidencia declarada es "alguien dijo que se hizo"— y nada la sembraba: el script de Fase 1 sólo cubrió las
  19 `on_demand`. Ahora `apply-pdtp-2026-demand-slas.ts` trae `CONSTANCIA_EVIDENCE` con las nueve, derivando
  cada texto de la **guía de ejecución del propio catálogo** (columna que viaja en `pdtp_activities.program`)
  y marcándolo como propuesto en `notes`: la guía dice cómo se hace la actividad, no necesariamente qué
  documento queda. `apply-pdtp-2026-mechanisms.ts` quedó con el aviso cruzado, para que quien agregue una
  constancia declare su evidencia en el mismo movimiento.
- **La N°19 era un error mío.** En la reinterpretación de T47 cablée su acreditación en el conector de
  trabajador nuevo —cierra junto con la N°15, N°18 y N°23— pero no la agregué a
  `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS`, así que la compuerta la veía como enganche sin destino declarado.

### Corregido el 2026-09-03 (repaso de huecos de código)

- **La compuerta 81/81 verificaba medio permiso.** Comprobaba que el responsable declarado mapeara a un rol
  RBAC, y ahí se detenía: una actividad pasaba con un responsable que abría su tarjeta en `/pendientes` y se
  encontraba con un 403. Ahora exige además que ese rol **tenga el permiso del módulo donde el cumplimiento
  se registra**, leído de `role_permissions` en base y no del manifest (el manifest es la semilla; lo que
  decide es el grant cargado). `constancia` pide `prevention:constancias:execute`, `formulario`/`compuesta`
  piden `prevention:pdtp:execute`.
  - **`enganche` queda sin verificar a propósito**: su módulo destino depende de la actividad —una cierra en
    Inspecciones, otra en Capacitación, otra en EPP— y no existe el mapa actividad → módulo. Ese mapa es el
    contrato anual que el plan pedía en `fulfillment-contract-2026.ts` y que sigue sin escribirse; mientras
    no exista, la compuerta prefiere no afirmar nada antes que verificar contra el módulo equivocado. Es la
    dependencia que hace que ese archivo pendiente importe más de lo que parecía.
  - De paso: la etiqueta agrupada de `permission_gap` decía "sin un responsable que mapee a un rol real", que
    **mentía** en el caso nuevo (el rol existe, le falta el grant). Ahora dice "sin un responsable que pueda
    registrar el cumplimiento", que cubre los dos.
- **El informe clasificado ya se puede ver.** `getPdtpCoverageReport` + `CoverageReportPanel` en la ficha del
  programa: cuántas de las activas están listas y, por clasificación, cuáles y por qué. Antes
  `PdtpFulfillmentCoverageStatus` distinguía cinco estados y `getPdtpSubmitReviewBlockers` los colapsaba a una
  línea —lo que cabe en un mensaje de error—, así que para saber *cuáles* había que leer la base actividad por
  actividad: justo el trabajo que la compuerta vino a evitar. Se muestra sólo mientras el programa no está
  activo, que es cuando es una decisión pendiente.
- **Fixture de `prevention-pdtp.test.ts`:** el RBAC pasó a sembrarse una sola vez tras las migraciones, con
  los nueve roles que el catálogo real 2026 declara, en vez de por test. Es dato de referencia —ningún caso lo
  modifica— y reinsertarlo 70 veces sólo gastaba tiempo.

- **El desglose por eje perdía 18 de las 81 actividades.** `getPdtpComplianceByCategoryForScope` metía las
  `closed_on_time` en el bucket puntuable pero contaba sus celdas de cronograma, que no existen (son
  `on_demand`): aportaban `planned = 0` y desaparecían en silencio de su eje SG-SST. Ahora cuentan por
  **caso** —obligación vencida en el denominador, cierre dentro de plazo en el numerador—, que es
  proporcional y del mismo orden que "12 inspecciones planificadas". Las de `coverage` siguen fuera, y ahora
  el comentario explica por qué de verdad: su denominador es un padrón de 50 personas, que dominaría un eje
  que cuenta instancias. `loadClosedOnTimeByActivityMonth` pasó a recibir una lista de faenas, así que la
  vista por faena y el desglose por eje comparten consulta y regla.
- **Aviso sobre mi propio informe anterior:** reporté que el agregado mensual mostraba 0 % donde la vista por
  faena mostraba el valor real. **Es falso.** `getPdtpComplianceIndicatorsForScope` ya resolvía bien —calcula
  por faena y suma— y sus dos consumidores de UI siempre pasan faena. El camino sin faena existe en la firma
  pero no es alcanzable desde la aplicación.
- **`prevention_capa_source_type_valid` rechazaba `gps_onway`, y no era teórico.**
  `onway-automation.ts` crea una CAPA con ese `sourceType` cuando una alerta GPS cae en una regla con acción
  CAPA; el CHECK la rechazaba y el cron de OnWay revertía la transacción completa. El enum de Zod y el
  mapeador de href ya lo tenían: sólo el CHECK estaba atrasado. Agregado (migración `0248`). No es del PDTP;
  apareció al sumar `'cgrd'` al mismo CHECK.
- **`target_coverage_percent` sin CHECK de rango.** El 0-100 lo imponía sólo Zod y
  `setPdtpActivityWorksiteParams` escribe sin pasar por ahí, así que una meta de 900 % habría subido el
  umbral de acreditación a un número inalcanzable, callada. Agregado `> 0 AND <= 100` (migración `0248`).
- **`/prevencion/indicadores/${year}/${month}` no existe.** Dos `revalidatePath` apuntaban a esa ruta
  fantasma —el módulo tiene una sola `page.tsx` que resuelve el período por query param—. No fallaba, pero
  tampoco hacía nada y sugería una ruta dinámica que nadie escribió. Quedó sólo la raíz, y de paso se eliminó
  un `return` inalcanzable en `saveSafetyIndicatorMonthAction`.

### Corregido el 2026-09-02, segunda pasada

- **N°21 retirada de verdad.** La D02 estaba escrita y marcada hecha, pero la actividad seguía `active`: el
  script no la tenía en `RETIREMENTS` porque cuando se escribió la decisión no existía. 82 → 81 activas.
- **El instalador de plantillas comparaba mal.** Saltaba una plantilla como "ya instalada" mirando sólo los
  números de actividad, así que una plantilla ya cableada pero con el `executor_of_record` equivocado no se
  corregía nunca — y eso es justamente la D04. Ahora el campo entra en la comparación.
- **La clasificación por mecanismo nunca había corrido en producción.** Era el tercer script de la misma
  clase que los otros dos y no estaba en el deploy: sin él la columna `mechanism` llega vacía a producción y
  el submódulo Constancias (G17) no tendría por dónde filtrar. Quedó como paso `apply-pdtp-mechanisms`, con
  la misma tolerancia (`PDTP_MECHANISMS_DEPLOY_MODE`) y después de los retiros, porque clasifica sólo lo
  activo. De paso salió la N°21 de sus listas.
- **Las plantillas de inspección no estaban en dev.** El instalador ya era un paso del deploy pero nunca se
  había corrido localmente, y eso es lo que escondía el defecto de arriba. Doce plantillas quedan cableadas a
  su actividad y `reporte_equipos v02` con `declared_in_form`. Siguen en borrador, que es T09.
- **Tres cifras falsas en este documento.** Decía que Higiene tenía "10 grupos de exposición, 18 mediciones",
  que MIPER tenía "9 matrices con 30 entradas" y que `fuel_vehicles` tenía "18 equipos en 6 faenas". Las tres
  tablas están en **cero filas**. Venían del documento de diseño de agosto, repetidas sin verificar.

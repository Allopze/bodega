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
| G14 Módulo de alcotest | 3 | sí, módulo nuevo | G0 | |
| G15 Módulo de CGRD (DS 44) | 3 | sí, módulo nuevo | G0 | |
| G16 Checklist DS 594 | 1 | sí, menor | G1 | |
| G17 Submódulo Constancias | 8 | sí | G14, G15, G16 | al final |
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

- [x] T34 `indicator_mode = 'coverage'` puesto en **N°17, 18, 23, 24 y 50** por
      `pdtp:apply-catalog-decisions`, que ahora corre en el deploy. Faltan la **N°54 y la N°56**: no están en
      la lista del script porque dependen de que existan sus cursos (G2), y ponerlas en cobertura antes sería
      medir contra un padrón que nadie alimenta.
- [ ] T35 Cargar `target_coverage_percent = 90` para N°54 y N°56, que declaran meta explícita.
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
- [ ] T47 N°19 — definir la lista de documentos exigidos por faena (D9 del diseño) y acreditar la carpeta de
      requisitos legales contra esa lista.
- [ ] T48 Poblar el módulo: hoy no hay ningún documento cargado, así que el enganche no es verificable.

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
- [ ] T51 Revisar la interacción con `createRiskReviewTrigger`, que ya crea disparadores de revisión MIPER
      desde incidentes: la actividad se cierra al publicar, no al abrir el disparador.

**Verificación:** publicar una revisión y ver la ejecución.

---

## G9 — Indicadores de faena

**Objetivo:** que el ingreso mensual de indicadores acredite la N°7 ("Envío de estadística de cada faena").

**Cierra:** N°7.

- [ ] T52 Sumar `indicadores` al union `PdtpAccreditationSourceType`.
- [ ] T53 Identificar el punto exacto de ingreso de indicadores que constituye el cumplimiento.
- [ ] T54 Conector desde ese punto.

**Verificación:** ingresar los indicadores de un mes y ver la ejecución en ese período.

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

## G14 — Módulo de alcotest (D08)

**Cierra:** N°30, 31, 32. Salen de constancia manual.

- [ ] T76 Modelar el registro: control por trabajador con equipo, fecha, resultado y quién lo aplicó. El equipo
      ya existe como ítem de servicio (`service_equipment`, con `kind` normalizado y faena), así que el
      alcotómetro es el sujeto y su calibración ya se controla ahí.
- [ ] T77 Conector al motor: `sourceType` nuevo, N°30 para el control del PRF y N°31 para el del Sup/JT.
- [ ] T78 N°32 — el envío de registros según DO-48 se acredita desde el propio módulo, no a mano.

---

## G15 — Módulo de CGRD, DS 44 (D09)

**Cierra:** N°79, 80, 81. Deuda normativa: es un comité que el DS 44 exige, distinto del paritario.

- [ ] T79 Comité: constitución por faena, integrantes y vigencia. El molde es el módulo de CPHS.
- [ ] T80 Matriz GRD: análisis histórico, amenazas, evaluación legal y plan de trabajo. **No es MIPER** —
      MIPER es de riesgos laborales, no de desastres.
- [ ] T81 Actas de reunión, con el patrón de las actas del CPHS.
- [ ] T82 Conector: N°79 al constituir, N°80 al publicar la matriz, N°81 por acta cerrada.

---

## G16 — Checklist de condiciones ambientales DS 594 (D11)

**Cierra:** N°10. Es el grupo más chico de los nuevos.

- [ ] T83 Escribir la definición en `lib/sst/definitions/`, con el molde de las otras once.
- [ ] T84 Declararla en `PDTP_2026_INSPECTION_SPECS` con `n: 10` e instalarla.
- [ ] T85 Sacar la N°10 de `CONSTANCIA` en el script de mecanismos.

---

## G17 — Submódulo Constancias (D18)

**Cierra:** ocho actividades — N°3, 6, 20, 22, 28, 42, 61, 82 — que **ya se pueden marcar hoy** desde la
planilla. El valor es reunirlas, no habilitarlas.

Su alcance bajó de quince a ocho por las decisiones vecinas: la D11 se lleva la N°10, la D08 las N°30–32 y la
D09 las N°79–81. Conviene hacerlo al final, cuando el número esté firme.

- [ ] T86 Ruta y listado filtrando por `mechanism = 'constancia'`, que ya está poblado en la base.
- [ ] T87 Marcar hecho con evidencia u observación, reutilizando el formulario de ejecución de la planilla.
- [ ] T88 Resolver su relación con `/pendientes` (decisión A4 del diseño, todavía abierta): la cola avisa y
      Constancias es donde se marca, o el marcado vive en los dos.

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

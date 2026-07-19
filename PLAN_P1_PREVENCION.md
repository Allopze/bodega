# Plan de ejecución de las brechas P1 de Prevención

**Plataforma:** Chome

**Fecha de inicio:** 19 de julio de 2026

**Documento de origen:** `AUDITORIA_MODULO_PREVENCION.md`, secciones 0.4, 7 y 12.

**Documento hermano:** `PLAN_FIX_MITIGACION_P0_PREVENCION.md` (P0 cerrados técnicamente; sus pendientes son productivos).

**Estado:** en ejecución.

---

## 1. Objetivo

Cerrar las brechas funcionales que impiden que Prevención sea un sistema integral y que sostienen la dependencia de SFTI, una capacidad a la vez, con la misma disciplina de evidencia que exigió el plan P0.

Este plan **no autoriza retirar SFTI**. Cada capacidad nueva nace con su propia deuda productiva: cargar datos reales, conciliar y obtener aceptación de los responsables.

---

## 2. Principios heredados del plan P0

Se aplican sin excepción:

1. **Migraciones aditivas y generadas desde schema.** Nunca editar migraciones ni el journal a mano; exigir `No schema changes` en la segunda generación.
2. **Autorización negativa como criterio de cierre.** Rol autorizado en faena ajena, rol sin permiso, identificador inexistente, mutación concurrente y llamada directa al server action deben probarse, no sólo el camino feliz.
3. **La regla legal es un parámetro citado, no una constante silenciosa.** El software controla el proceso; el contenido y la aplicabilidad los valida Prevención.
4. **Segregación de funciones.** Quien prepara no aprueba; quien ejecuta no verifica su propio trabajo.
5. **CAPA común es el único motor de acciones.** Ninguna capacidad nueva crea su propio plan de acción paralelo.
6. **Ningún checkbox se marca porque el código compile.**

---

## 3. Orden de prioridad

Derivado de la columna de prioridad de la matriz legal (auditoría §4.1) y de la Fase 1 de la hoja de ruta (§12).

| # | Capacidad | Fundamento normativo | Prioridad | Estado |
|---:|---|---|---|---|
| 1 | Capacitación, ODI y competencias | DS 44 arts. 15 y 16 | **P0 legal** | ✅ Capacidad técnica cerrada (19-07-2026) |
| 2 | Contratistas y coordinación de faena | DS 76/2006, Ley 20.123 | P0/P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 3 | Permisos de trabajo, AST/JSA y control de energías | DS 44 art. 18; estándar de tarea crítica | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 4 | Inspecciones, observaciones y auditorías | DS 44 art. 22; ISO 45001 9.2 | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 5 | CPHS y gobernanza del SG-SST | DS 44 arts. 17, 23 y ss. | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 6 | Salud ocupacional e higiene industrial | DS 594; protocolos MINSAL/SUSESO | P1 | Pendiente |
| 7 | EPP preventivo integrado con Bodega | DS 594 arts. 53-54; DS 18 | P1 | Pendiente |
| 8 | Emergencias, contingencias y simulacros | DS 44 arts. 18 y 19 | P1 | Pendiente |
| 9 | Gestión del cambio | DS 44 art. 15 | P1 | Pendiente |
| 10 | Sustancias, residuos peligrosos y transporte | DS 148, DS 43, DS 57, DS 298 | P1/P2 | Pendiente |
| 11 | Integraciones, API, SSO y portales | Contractual | P2 | Pendiente |

La capacidad 1 se eligió primero porque el art. 16 era el **único requisito marcado P0 en la matriz legal sin ninguna implementación**, y porque la ODI del art. 15 depende del mismo dominio.

---

## 4. Capacidad 1 — Capacitación, ODI y competencias

### 4.1 Alcance implementado

**Contrato de datos** (`db/schema/prevention/training.ts`, 7 tablas aditivas):

- `prevention_training_courses` — catálogo por tipo, con parámetros regulatorios por curso y trazabilidad opcional a requisito legal y a peligro MIPER.
- `prevention_training_course_versions` — temario, duración, modalidad, evaluación, hash de contenido y máquina de estados.
- `prevention_training_sessions` — sesión por faena, relator interno o externo con evidencia de competencia, versión optimista.
- `prevention_training_attendance` — convocados vs. presentes, evaluación con nota e intentos, acuse firmado.
- `prevention_worker_competencies` — habilitación vigente por persona y curso, fuente única.
- `prevention_competency_requirements` — qué curso exige qué población, con exigibilidad bloqueante o de advertencia.
- `prevention_training_history` — historial inmutable.

**Reglas de negocio verificables:**

- El piso del DS 44 art. 16 (480 minutos, vigencia ≤ 24 meses) se declara por curso con cita normativa y se contrasta al crear el curso, al versionar el contenido y al cerrar la sesión. Una charla operacional no queda sujeta al piso; un curso legal obligatorio sí, y además exige fundamento normativo escrito.
- Una ODI debe derivar de un peligro identificado en la MIPER.
- El autor de un contenido no puede aprobarlo ni publicarlo.
- Publicar reemplaza la versión vigente anterior dentro de la misma transacción.
- Sólo se dicta una versión publicada.
- No se convoca a un trabajador de otra faena ni inactivo.
- No se cierra una sesión con convocados sin resultado de asistencia.
- **Sólo obtiene competencia quien asistió y aprobó la evaluación cuando el curso la exige.** Una asistencia sin evaluación aprobada no habilita.
- El vencimiento se deriva de la vigencia del curso; un curso sin vigencia declarada no inventa fecha.
- Una competencia `valid` con fecha pasada se reporta como vencida aunque el job todavía no la haya marcado.
- Sólo la persona convocada acusa su propia capacitación, una sola vez.
- Convalidar o revocar altera la habilitación sin sesión ni evaluación: no se concede a roles de terreno.

**Superficies:** `/prevencion/capacitacion`, `/prevencion/capacitacion/competencias`, `/prevencion/capacitacion/brechas`, `/api/prevencion/capacitacion/export`, `/api/cron/prevention-training-reminders`.

**Permisos (8, con grants deliberados):** `view`, `manage`, `approve`, `deliver`, `ack`, `convalidate`, `revoke`, `export`.

### 4.2 Evidencia de esta pasada

- Migración `0078_fearless_overlord.sql` generada exclusivamente desde schema; segunda generación informó `No schema changes`; aplicada al PostgreSQL local y verificada: 7 tablas con 13/18/24/16/10/23/21 columnas.
- Extensión aditiva del check de CAPA para admitir `sourceType = 'training'`, verificada en la base real.
- 23 pruebas puras del motor de brechas, vigencia y piso legal.
- 7 pruebas de paridad RBAC, incluida la segregación negativa de `convalidate`/`revoke`.
- 19 escenarios sobre PostgreSQL real desechable.
- Typecheck completo, ESLint completo y build de producción Next.js verdes; las 4 rutas nuevas aparecen en el manifiesto de build.
- React Doctor `--scope changed`: **0 errores**, score 78 igual al baseline del branch. Los 11 errores `server-auth-actions` detectados en la primera pasada se corrigieron inlineando `guardPermission` en cada Server Action, alineando el módulo con el refactor ya en curso en `miper`, `requisitos-legales` y `pdtp/cobertura`.
- Regresión: 49 archivos y 267 pruebas de prevención pasan; navegación, cobertura de rutas y RBAC verdes.

### 4.3 Pendientes de la capacidad 1

- [ ] **Operación** — Definir con Prevención el catálogo real de cursos, su tipo, duración y vigencia, y cuáles califican como legal obligatorio bajo el art. 16.
- [ ] **Operación** — Declarar los requisitos de competencia por cargo y faena, y decidir cuáles son bloqueantes. El software no puede inferir qué tarea es crítica.
- [ ] **Operación** — Cargar el historial formativo existente (SFTI y registros externos) mediante convalidación auditada, conservando emisor, número de certificado y evidencia.
- [ ] **Producción** — Aplicar la migración `0078` y programar el cron `prevention-training-reminders`.
- [ ] **Aceptación** — Jefatura de Prevención valida que las reglas codificadas del art. 16 corresponden a su interpretación.
- [ ] **Producto (diferido, no bloqueante)** — UI de alta de cursos, versiones, sesiones y requisitos: hoy las Server Actions existen y están probadas, pero el alta se realiza por acción directa. La bandeja, la matriz, las brechas, el acuse y la revocación sí tienen UI.
- [ ] **Producto (diferido)** — Requisitos de alcance `task`: el modelo los admite y el motor los ignora deliberadamente porque se resuelven al asignar la tarea, lo que depende de la capacidad 3 (permisos de trabajo/AST).

---

## 5. Hallazgo transversal — RESUELTO el 19 de julio de 2026

**Las pruebas PostgreSQL de Prevención no corrían en CI.** El workflow ejecutaba únicamente `lib/__tests__/*concurrency-postgres.test.ts` y `lib/__tests__/*scope-postgres.test.ts`. Los escenarios reales de CAPA, incidentes, indicadores, privacidad, MIPER/legal y capacitación —la evidencia principal del cierre P0— **nunca pasaban por el gate**.

La preocupación inicial de aislamiento resultó infundada: `vitest.config.ts` ya define `fileParallelism: false`, y el paso de CI usa esa configuración por defecto. Las suites corren en serie, cada una hace su propio `DROP SCHEMA` + `migrate`, y pueden compartir la base desechable `bodega_e2e` sin interferirse.

- [x] Paso `Prevention domain tests (real Postgres)` agregado a `.github/workflows/ci.yml` con las 7 suites (`prevention-*-postgres.test.ts`), verificado localmente en conjunto: 7 archivos, 55 pruebas.

### 5.1 Defecto real que el gate ausente ocultaba

Al ejecutar las suites por primera vez en conjunto apareció un fallo **preexistente y genuino** (reproducible también en aislamiento, sobre base limpia):

`prevention-incidents-postgres.test.ts` declaraba `miperUpdateRequired: true` **y** `miperUpdated: true` en la misma llamada a `savePreventionIncidentInvestigation`. El servicio crea el disparador MIPER en esa misma invocación, por lo que nunca puede estar `completed`, y el guard de `prevention-incidents.ts:971` rechazaba la operación.

**El servicio estaba correcto**: la regla —introducida en la pasada P0-05— exige que una investigación que declara actualización de MIPER se respalde en una versión publicada *después* del disparador, y no en un checkbox. El test codificaba un flujo que el servicio prohíbe a propósito. La bitácora P0-05 afirmaba que esta regresión pasaba; no era efectivo, porque la suite nunca se ejecutaba.

- [x] Test corregido para probar la cadena regulatoria completa: se abre la investigación creando el disparador, se comprueba que declarar `miperUpdated` y que completar la investigación **fallan** mientras el disparador siga abierto, se publica una MIPER real con segregación autor/revisor/aprobador, se resuelve el disparador con esa versión y recién entonces la investigación se completa con `miperUpdatedAt` poblado.

**Lección para la bitácora:** una afirmación de "la regresión pasa" sólo vale si la suite está en un gate automatizado. Las tres pruebas restantes del archivo sí corrían y pasaban, lo que hizo el fallo invisible en revisiones manuales parciales.

---

## 5bis. Capacidad 2 — Contratistas y coordinación de faena (DS 76)

### 5bis.1 Alcance implementado

**Contrato de datos** (`db/schema/prevention/contractors.ts`, 8 tablas aditivas): empresas con RUT y organismo administrador y subcontratación mediante `parentCompanyId`; contratos por faena con relación, alcance, vigencia y dotación; personas del contratista identificadas por su propio RUT; requisitos de acreditación por alcance empresa/contrato/persona; evidencia presentada con ciclo y vencimiento; reuniones de coordinación con participantes; historial inmutable.

**Reglas de negocio verificables:**

- **Un contrato nace con el acceso bloqueado.** La liberación es un acto explícito y recalcula las brechas contra la evidencia real en ese momento; no existe "autorizar igual".
- Una brecha bloqueante de empresa o contrato impide liberar el contrato completo; una brecha de una persona bloquea sólo a esa persona. Liberar el contrato acredita en el mismo acto a quienes no tienen brecha propia.
- Quien presenta la evidencia no puede aprobarla ni observarla.
- Observar exige indicar qué corregir; reenviar evidencia limpia la revisión anterior para que nadie herede una aprobación caducada.
- Un requisito que exige vencimiento no admite evidencia sin fecha; un requisito por persona no admite presentación sin persona, y viceversa.
- **La evidencia vencida re-bloquea el contrato**: la habilitación no sobrevive a su propia evidencia.
- Suspender o terminar un contrato corta el acceso en el mismo acto, para no dejar un contrato cerrado con ingreso liberado.
- Cerrar una reunión de coordinación exige acta y deriva cada acuerdo a **CAPA común** (`sourceType = 'contractor'`); un acuerdo sin acción trazable no es coordinación efectiva.
- No se convoca a un contrato de otra faena.

**Superficies:** `/prevencion/contratistas`, `/prevencion/contratistas/brechas`, `/prevencion/contratistas/coordinacion`, `/api/prevencion/contratistas/export`.

**Permisos (7):** `view`, `manage`, `submit`, `accredit`, `authorize_access`, `coordinate`, `export`. `accredit` y `authorize_access` se separan de `submit` y no se conceden a roles de terreno.

### 5bis.2 Evidencia

Migración `0079_polite_morlun.sql` generada desde schema, segunda generación sin drift, aplicada y verificada (8 tablas). 17 pruebas puras del motor de brechas y de la decisión de acceso; 17 escenarios sobre PostgreSQL real; RBAC ampliado con la matriz de segregación. Typecheck, ESLint, build y React Doctor (0 errores) verdes.

Durante la prueba en Postgres real, el constraint `prevention_accreditation_item_expiry_after_issue` rechazó un intento de fijar un vencimiento anterior a la emisión: la restricción funcionó como corresponde y se corrigió el escenario, no la restricción.

### 5bis.3 Pendientes de la capacidad 2

- [ ] **Operación** — Definir el catálogo real de requisitos de acreditación por faena y relación, y cuáles son bloqueantes.
- [ ] **Operación** — Cargar empresas, contratos y dotación contratista reales; migrar la acreditación que hoy vive en SFTI u otras planillas.
- [ ] **Producción** — Aplicar la migración `0079` y programar el vencimiento de acreditaciones (`expireLapsedAccreditations`) como job diario.
- [ ] **Producto (diferido)** — Portal de autocarga para la empresa contratista: hoy la evidencia la presenta un usuario interno con permiso `submit`.
- [ ] **Producto (diferido)** — Acreditación de vehículos y equipos del contratista, y estadística de incidentes por contratista. El modelo de requisitos admite extenderse a esos sujetos sin migración destructiva.
- [ ] **Producto (diferido)** — UI de alta de empresas, contratos, requisitos y reuniones: las Server Actions existen y están probadas; las bandejas, brechas y coordinación sí tienen UI de lectura.

---

## 5ter. Capacidad 3 — Permisos de trabajo, AST/JSA y control de energías

Es la capacidad que amarra las anteriores: un permiso no se habilita si alguien de la cuadrilla no tiene su competencia vigente (capacidad 1) o pertenece a un contratista con el ingreso bloqueado (capacidad 2).

### 5ter.1 Alcance implementado

**Contrato de datos** (`db/schema/prevention/permits.ts`, 7 tablas aditivas): tipos de permiso configurables; permiso con ventana, supervisor y máquina de estados; cuadrilla mixta interna/contratista; controles verificables; aislamientos LOTO; mediciones; pasos de AST/JSA; historial inmutable. Además, `ppa_submissions` recibió una columna `work_permit_id` nullable para que el PPA sea la verificación breve dentro del permiso, como pide la auditoría §7.7, sin romper su uso autónomo.

**Reglas de negocio verificables:**

- La habilitación devuelve **todos los bloqueadores a la vez**, no de a uno: en terreno importa la lista completa de lo que falta.
- Un control obligatorio se cumple verificándolo **o** declarando por qué no aplica; no basta dejarlo en blanco.
- Si el tipo exige aislamiento, debe haber al menos uno aplicado y con **energía cero verificada**; un aislamiento retirado no cuenta como vigente.
- Las mediciones se evalúan por la **lectura más reciente de cada parámetro**: una relectura en rango reemplaza una anterior fuera de rango, y una lectura vencida no habilita aunque esté en rango.
- El AST sólo se edita **antes de la aprobación**: si pudiera cambiarse después, aprobar no significaría nada.
- Quien solicita el permiso no puede aprobarlo.
- **No se retira un aislamiento con el permiso vigente** ni se cierra el permiso con energías bloqueadas sin retirar.
- La ventana manda sobre el registro: un permiso vigente cuya ventana venció se suspende automáticamente, y una extensión exige motivo y no puede superar el máximo del tipo.
- Activar **recalcula la habilitación completa en el momento**; no hereda una evaluación previa que pudo quedar obsoleta.

**Superficies:** `/prevencion/permisos`, `/api/prevencion/permisos/export`.

**Permisos (9):** `view`, `manage`, `request`, `verify`, `approve`, `activate`, `suspend`, `close`, `export`. La cadena solicitar → verificar → aprobar → habilitar se reparte entre roles distintos; suspender ante riesgo es deliberadamente amplio e incluye al CPHS y al jefe de terreno.

### 5ter.2 Cierre de un diferido de la capacidad 1

Los requisitos de competencia con alcance `task`, que la pasada 1 dejó explícitamente diferidos porque «se resuelven al asignar la tarea», **quedaron cerrados aquí**: el tipo de permiso declara un `competencyTaskKey` y el servicio lee los requisitos `scopeType = 'task'` existentes en vez de duplicar el catálogo de cursos. No hizo falta ninguna tabla nueva.

### 5ter.3 Evidencia

Migración `0080_furry_bucky.sql` generada desde schema, sin drift, aplicada y verificada. 27 pruebas puras de la decisión de habilitación y de la máquina de estados; 20 escenarios sobre PostgreSQL real; RBAC con aserciones negativas. Typecheck, ESLint, build y React Doctor (0 errores) verdes.

Durante la primera ejecución en Postgres el servicio rechazó, correctamente, editar el AST de un permiso ya aprobado. Era la secuencia del test la que no reflejaba el flujo real de terreno (AST y controles se definen en borrador; aislamientos y mediciones se ejecutan tras la aprobación y antes de habilitar). Se corrigió el test, no la regla.

### 5ter.4 Pendientes de la capacidad 3

- [ ] **Operación** — Definir el catálogo real de tipos de permiso y qué competencia exige cada uno.
- [ ] **Producción** — Aplicar la migración `0080` y programar `suspendExpiredPermits` como job periódico.
- [ ] **Producto (diferido)** — UI de detalle del permiso: hoy existe la bandeja con estado, ventana, acuses y LOTO abierto; las acciones de terreno (verificar control, aplicar/retirar aislamiento, registrar medición, transiciones) tienen Server Actions probadas pero aún no formulario.
- [ ] **Producto (diferido)** — Enganche efectivo del PPA al permiso: la columna `work_permit_id` existe y está indexada, pero el formulario de PPA todavía no la puebla.
- [ ] **Producto (diferido)** — Captura móvil/offline de permisos, mediciones y acuses en terreno.

---

## 5quater. Retiro de la importación desde SFTI

Decisión de producto ejecutada el 19 de julio de 2026: la importación de incidentes desde SFTI/Safeti deja de ser una capacidad de la plataforma.

Se eliminaron el servicio, la ruta y el workbench, las Server Actions, la navegación, el diccionario de columnas, las dos tablas de staging y la procedencia (`sfti_external_id`, `import_row_id`, origen `sfti_import`). El menú desplegable de la bandeja de incidentes quedaba con una sola opción tras el retiro, así que se simplificó a un botón directo de exportación.

La migración `0081_condemned_logan.sql` es destructiva y lleva una **guarda previa** que aborta con mensaje y sugerencia si encuentra procedencia SFTI o lotes de staging, en vez de borrarlos en silencio. La guarda se probó insertando un lote y verificando que la migración falla; luego se aplicó sobre la base local, que tenía cero filas.

La cobertura del job de recordatorios que vivía dentro del escenario SFTI —conservar el primer `escalatedAt` de un carril atrasado entre corridas— se reescribió sobre un incidente reportado normalmente, para no perderla junto con la importación.

El importador XLSX de MIPER **no se tocó**: es genérico, no un conector a SFTI.

- [ ] **Operación** — Decidir qué se hace con la historia de incidentes que vivía en SFTI: la plataforma ya no ofrece un camino de importación versionado para ese origen.
- [ ] **Producción** — Aplicar la migración `0081`. Si la guarda aborta, hay datos productivos con procedencia SFTI que deben conciliarse antes.

---

## 5quinquies. Capacidad 4 — Inspecciones, observaciones y auditorías

### Alcance implementado

Seis tablas aditivas: plantillas versionadas con snapshot y hash, programación por faena y frecuencia, ejecuciones, respuestas, hallazgos e historial.

**Reuso en vez de duplicación.** El motor consume las definiciones SST ya existentes (`CHECKLIST_DEFINITIONS`) en vez de inventar otro formato de preguntas, tal como pide la auditoría §7.8. Las nueve definiciones de inspección que estaban latentes —taller, extintores, contenedores, carros, equipos móviles, EPP, observación planeada, ampliroll y maquinaria— quedan incorporables. Las evaluaciones de personas se rechazan explícitamente: la auditoría pide no mezclar inspección de activos con evaluación de trabajadores.

**Reglas verificables:**

- La plantilla congela un snapshot al importarse; una edición posterior del catálogo en código no altera la evidencia de una inspección ya ejecutada.
- Quien incorpora una plantilla no puede aprobarla; aprobar reemplaza la versión vigente anterior del mismo código.
- Sólo se programa y se ejecuta una plantilla aprobada.
- La creación de ejecución es idempotente por `clientSubmissionId`, para que un reenvío offline no duplique la inspección.
- Una respuesta que no corresponde a ningún ítem de la plantilla se rechaza.
- El cumplimiento excluye los «no aplica» del denominador y devuelve **null**, no cero, cuando no hay ítems evaluables.
- Cada incumplimiento materializa un hallazgo cuya **criticidad deriva del `danoPotencial` de la plantilla**, no del criterio de quien ejecuta.
- Revisar y cerrar exige independencia de quien ejecutó, y que todo hallazgo alto o crítico tenga CAPA enlazada.
- Completar una ejecución reagenda el programa desde la fecha real, no desde la teórica.

### Hallazgo sobre el catálogo heredado

Ninguna de las definiciones SST declara `required` ni `danoPotencial`; ambos campos son opcionales en el tipo y nunca se usaron. Eso dejaba dos gates inertes: una inspección podría declararse ejecutada **sin una sola respuesta**, y ningún hallazgo alcanzaría criticidad alta.

Se agregó un **piso de seguridad**: cuando la plantilla no declara obligatorios, se exigen todos los ítems que cuentan para cumplimiento. En cuanto Prevención marque obligatorios reales, manda la marca por ítem. La criticidad sigue cayendo a media mientras el catálogo no declare daño potencial, lo que es correcto pero deja el bloqueo por hallazgo grave sin efecto práctico hasta enriquecerlo.

- [ ] **Operación** — Enriquecer el catálogo con `required` y `danoPotencial` por ítem. Sin eso, la criticidad de todo hallazgo es media y ningún hallazgo bloquea el cierre.
- [ ] **Producción** — Aplicar la migración `0082` e incorporar y aprobar las plantillas que la faena vaya a usar.
- [ ] **Producto (diferido)** — Formulario de ejecución en terreno y captura móvil/offline: las Server Actions existen y están probadas, la bandeja de lectura tiene UI.
- [ ] **Producto (diferido)** — Tendencias por pregunta, control, activo y contratista; auditorías con alcance, muestra y equipo auditor.

### Evidencia

Migración `0082_fearless_mastermind.sql` desde schema, sin drift, aplicada. 22 pruebas puras y 16 escenarios en PostgreSQL real. Typecheck, ESLint, build y regresión completa verdes.

---

## 5sexies. Capacidad 5 — CPHS y gobernanza del SG-SST

Siete tablas aditivas: comité por centro de trabajo, integrantes, sesiones, asistencia nominativa, acuerdos, revisión por la dirección e historial.

**Reglas verificables:**

- Un solo comité activo por centro de trabajo, con mandato cuya fecha de término debe ser posterior a la de constitución.
- **Paridad exigida:** igual número de titulares de la empresa y de las personas trabajadoras, más presidencia y secretaría únicas. El número total de integrantes depende de la dotación y lo define Prevención; el software sostiene la paridad y los cargos.
- Un integrante debe pertenecer al mismo centro de trabajo del comité.
- **Quórum real para cerrar el acta:** mayoría de titulares activos, donde un suplente presente cubre a un titular ausente **de su misma representación**. Sin quórum el cierre se rechaza, en vez de registrar una sesión que el DS 44 no reconocería.
- Cada acuerdo se deriva a **CAPA común** (`sourceType = 'cphs'`) con responsable y plazo.
- Un mandato vencido invalida al comité y bloquea convocar nuevas sesiones.
- La **revisión por la dirección** (art. 22) no cierra sin conclusiones, y sus compromisos con plazo también van a CAPA.

### Pendientes de la capacidad 5

- [ ] **Operación** — Constituir los comités reales, registrar elecciones e integrantes con fuero, y definir cuántos titulares corresponden por dotación.
- [ ] **Producción** — Aplicar la migración `0083` y programar `expireLapsedCommittees`.
- [ ] **Producto (diferido)** — Formularios de constitución, designación, convocatoria y cierre de acta; documentos electorales; indicadores de funcionamiento del comité.

Evidencia: migración `0083_closed_maverick.sql` sin drift, 17 pruebas puras de paridad, quórum y cadencia, y 15 escenarios en PostgreSQL real.

---

## 6. Bitácora de ejecución

### 19 de julio de 2026 — Capacidad 1: capacitación, ODI y competencias

- [x] Orden de prioridad derivado de la matriz legal y la hoja de ruta de la auditoría, no de conveniencia de implementación.
- [x] Patrón del repositorio estudiado antes de escribir código: schema CAPA/risk-legal, manifiesto y grants, servicio con scope por faena, exportación XLSX, jobs de recordatorio y pruebas PostgreSQL.
- [x] Contrato de datos agregado en `db/schema/prevention/training.ts` con 7 tablas aditivas y checks que sostienen las reglas en la base, no sólo en el servicio.
- [x] CAPA común extendida a `sourceType = 'training'` en vez de crear un segundo motor de acciones; etiqueta y enlace de origen agregados a `lib/prevention/capa.ts`.
- [x] Piso del DS 44 art. 16 implementado como parámetro por curso con cita normativa y verificado en tres momentos: creación del curso, versión del contenido y cierre de la sesión.
- [x] Motor de brechas implementado como función pura y probado con 23 casos antes de conectarlo a la base.
- [x] Migración `0078_fearless_overlord.sql` generada desde schema, sin drift en la segunda generación, aplicada y verificada en PostgreSQL real.
- [x] Ocho permisos declarados con grants deliberados; `convalidate` y `revoke` quedan fuera de los roles de terreno porque alteran la habilitación sin evidencia formativa.
- [x] El test de paridad RBAC dejó de tratar `prevention:training:*` como permiso eliminado: capacitación vuelve como módulo implementado, no como resto de la poda de 2026-07-02. El cambio quedó comentado en el propio test.
- [x] UI conectada: bandeja de sesiones con cuatro métricas accionables, acuse propio en contexto, matriz de competencias con pestaña de requisitos y bandeja de brechas con escalamiento a CAPA. Estados y alcances en español, sin exponer enums internos.
- [x] Exportación XLSX de seis hojas con neutralización de fórmulas, `no-store` y `nosniff`.
- [x] Job diario agregado con dedupe estable por fecha de vencimiento; el N+1 de resolución de permisos por faena se resolvió con caché dentro de la corrida.
- [x] 19 escenarios en PostgreSQL real cubren segregación autor/aprobador, versión optimista obsoleta, convocatoria y scope entre faenas, cierre bloqueado por asistencia incompleta y por duración insuficiente, otorgamiento sólo a quien aprobó, doble cierre idempotente, escalamiento CAPA exactamente una vez, acuse por titular y no por terceros, vencimiento, convalidación, revocación y XLSX.
- [x] Gate React Doctor corregido de 11 errores a 0 inlineando la autorización en cada Server Action, en línea con el refactor que el usuario ya tenía en curso en otros módulos de prevención.
- [x] `formatDateTime` del design system reutilizado en vez de `toLocaleString` en render, eliminando el riesgo de desajuste de hidratación.
- [x] Typecheck, ESLint, build de producción y regresión de prevención verdes.
- [x] Auditoría actualizada con la sección 0.5 y con el estado revisado de la Fase 1.
- [ ] Pendiente productivo y de aceptación de la capacidad 1: ver sección 4.3.

### 19 de julio de 2026 — Gate de CI y capacidad 2: contratistas DS 76

- [x] Las 7 suites PostgreSQL de Prevención se incorporaron al gate de CI. La preocupación de aislamiento resultó infundada: `fileParallelism: false` ya estaba configurado, así que corren en serie sobre una base desechable compartida.
- [x] El primer ejercicio conjunto destapó un **fallo preexistente real** en la regresión de incidentes, reproducible en aislamiento sobre base limpia. El servicio estaba correcto; el test declaraba `miperUpdated` en la misma llamada que creaba el disparador MIPER, algo que la regla de P0-05 prohíbe deliberadamente.
- [x] El test se corrigió para probar la cadena regulatoria completa —incidente → disparador → MIPER publicada con segregación → disparador resuelto → investigación completable— en vez de saltársela con un checkbox. Se agregó un usuario aprobador dedicado para sostener la segregación autor/revisor/aprobador.
- [x] Contrato de datos DS 76 agregado en `db/schema/prevention/contractors.ts` con 8 tablas aditivas y checks que sostienen las reglas en la base.
- [x] CAPA común extendida a `sourceType = 'contractor'` en vez de crear una lista de acuerdos paralela.
- [x] Motor de brechas y decisión de acceso implementados como funciones puras y probados con 17 casos antes de conectarlos a la base, distinguiendo el bloqueo de contrato del bloqueo de una persona.
- [x] Migración `0079_polite_morlun.sql` generada desde schema, sin drift, aplicada y verificada en PostgreSQL real.
- [x] Siete permisos declarados con grants deliberados; `accredit` y `authorize_access` quedan fuera de los roles de terreno y separados de `submit`, con aserciones negativas en el test de RBAC.
- [x] UI conectada: bandeja de contratos con cuatro métricas accionables y estado de acceso explícito, bandeja de brechas y bandeja de coordinación. Estados y relaciones en español.
- [x] Exportación XLSX de siete hojas: registro de faena, personas, evidencia, brechas, requisitos, coordinación y asistencia.
- [x] 17 escenarios en PostgreSQL real cubren acceso bloqueado por defecto, scope negativo entre faenas, segregación presentador/revisor, requisito sin vencimiento, requisito por persona sin persona, bloqueo parcial por trabajador, acreditación al aprobar, reenvío que limpia la revisión previa, vencimiento que re-bloquea, suspensión que corta acceso, acuerdos derivados a CAPA y doble cierre rechazado.
- [x] React Doctor sin errores; se corrigieron el índice como key en las métricas y un N+1 en la actualización de asistentes.
- [x] Typecheck, ESLint, build de producción y regresión (28 archivos, 201 pruebas + 7 suites PostgreSQL con 55 pruebas) verdes.
- [ ] Pendiente productivo y de aceptación de la capacidad 2: ver sección 5bis.3.

### 19 de julio de 2026 — Capacidad 3: permisos de trabajo, AST/JSA y LOTO

- [x] Contrato de datos agregado en `db/schema/prevention/permits.ts` con 7 tablas aditivas; `ppa_submissions` recibió `work_permit_id` nullable para enlazar el PPA al permiso sin romper su uso autónomo.
- [x] CAPA común extendida a `sourceType = 'work_permit'`.
- [x] Decisión de habilitación implementada como función pura que devuelve todos los bloqueadores, probada con 27 casos antes de tocar la base.
- [x] Cerrado el diferido de la capacidad 1: los requisitos de competencia con alcance `task` ahora se consumen desde el tipo de permiso mediante `competencyTaskKey`, sin tablas nuevas ni un segundo catálogo.
- [x] Integración real con contratistas: un integrante de contratista con ingreso bloqueado o sin acreditar impide habilitar el permiso.
- [x] Migración `0080_furry_bucky.sql` generada desde schema, sin drift y aplicada.
- [x] Nueve permisos con grants deliberados y aserciones negativas: el jefe de terreno solicita y verifica pero no aprueba ni habilita; suspender incluye al CPHS.
- [x] 20 escenarios en PostgreSQL real cubren ventana excedida, cuadrilla de otra faena, scope negativo, lista completa de bloqueadores, AST inmutable tras aprobación, autoaprobación rechazada, transición inválida draft → active, habilitación sólo con todos los gates, retiro de LOTO bloqueado con permiso vigente, cierre bloqueado con energías aplicadas, cierre limpio tras normalizar, versión optimista y suspensión automática por vencimiento.
- [x] La suite de permisos se incorporó al gate de CI junto a las otras siete.
- [x] React Doctor sin errores ni hallazgos nuevos; typecheck, ESLint, build y regresión (54 archivos, 357 pruebas + 8 suites PostgreSQL con 75 pruebas) verdes.
- [ ] Pendiente productivo y de aceptación de la capacidad 3: ver sección 5ter.4.

### 19 de julio de 2026 — Retiro de la importación desde SFTI

- [x] Eliminados servicio, ruta, workbench, Server Actions, navegación y diccionario de la importación SFTI de incidentes.
- [x] Eliminadas las tablas de staging y las columnas de procedencia; el origen `sfti_import` deja de ser alcanzable.
- [x] Migración `0081_condemned_logan.sql` con guarda previa que aborta si existen datos con procedencia SFTI. Probada con datos presentes antes de aplicarla limpia.
- [x] Preservada la cobertura de idempotencia del job de recordatorios mediante una prueba equivalente sin SFTI.
- [x] La bandeja de incidentes simplifica su menú de datos a un botón de exportación directo, al quedar con una sola opción.
- [x] Typecheck, ESLint, build y regresión completa (54 archivos, 357 pruebas + 8 suites PostgreSQL con 75 pruebas) verdes.

### 19 de julio de 2026 — Capacidad 4: inspecciones, observaciones y auditorías

- [x] Motor transversal implementado reusando `CHECKLIST_DEFINITIONS`; las nueve definiciones de inspección latentes quedan incorporables y las evaluaciones de personas se rechazan.
- [x] La plantilla congela snapshot y hash al importarse: la evidencia histórica no cambia si el catálogo en código se edita.
- [x] Detectado que el catálogo SST no declara `required` ni `danoPotencial` en ningún ítem, lo que dejaba inertes el gate de ejecución y la derivación de criticidad. Se agregó un piso de seguridad que exige responder todo lo que cuenta para cumplimiento cuando no hay obligatorios declarados.
- [x] Migración `0082` desde schema, sin drift y aplicada; CAPA extendida con `sourceType = 'inspection'`.
- [x] Seis permisos con grants deliberados: ejecutar y revisar separados, con aserción negativa de que el jefe de terreno no cierra.
- [x] 22 pruebas puras y 16 escenarios en PostgreSQL real; suite incorporada al gate de CI (ya son nueve).
- [x] Regresión completa: 55 archivos, 380 pruebas y 9 suites PostgreSQL con 91 pruebas.
- [ ] Pendiente productivo de la capacidad 4: ver sección 5quinquies.

### 19 de julio de 2026 — Capacidad 5: CPHS y gobernanza

- [x] Comité paritario con validación de paridad, cargos, mandato y cadencia mensual.
- [x] Quórum implementado con suplencia por representación; sin quórum el acta no cierra.
- [x] Acuerdos del comité y compromisos de la revisión por la dirección derivados a CAPA común (`sourceType = 'cphs'`).
- [x] Migración `0083` desde schema, sin drift y aplicada; 17 pruebas puras y 15 escenarios PostgreSQL; suite incorporada al gate de CI (ya son diez).
- [x] **Visibilidad de calibración agregada al motor de inspecciones**: se detectó que `danoPotencial` no se declara en ningún ítem del catálogo y que PDTP también deriva prioridad y plazo desde ese campo, por lo que toda acción correctiva de checklist en producción cae a "media / +7 días" sin importar la gravedad real. No se inventaron severidades —es juicio de Prevención— pero la bandeja y la exportación ahora declaran qué plantillas tienen la criticidad sin calibrar.
- [x] Regresión completa: 56 archivos, 401 pruebas y 10 suites PostgreSQL con 106 pruebas.
- [ ] Pendiente productivo de la capacidad 5: ver sección 5sexies.

---

## 7. Regla de actualización

Al cerrar cada capacidad, registrar: fecha, migración, pruebas ejecutadas, resultado, evidencia de rol × faena × endpoint, decisión de negocio o legal asociada, y pendientes con su riesgo residual.

Una capacidad está **técnicamente cerrada** cuando su flujo completo existe, no hay bypass por endpoint y las pruebas negativas pasan. Está **corregida** sólo cuando además tiene datos productivos conciliados y la aceptación del dueño del proceso.

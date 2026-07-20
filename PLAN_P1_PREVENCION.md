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
| 2 | ~~Contratistas y coordinación de faena~~ | DS 76/2006, Ley 20.123 | — | ❌ **Eliminada el 19-07-2026**: no aplica a Chome, que es contratista y no empresa principal (ver 5bis) |
| 3 | Permisos de trabajo, AST/JSA y control de energías | DS 44 art. 18; estándar de tarea crítica | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 4 | Inspecciones, observaciones y auditorías | DS 44 art. 22; ISO 45001 9.2 | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 5 | CPHS y gobernanza del SG-SST | DS 44 arts. 17, 23 y ss. | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 6 | Salud ocupacional e higiene industrial | DS 594; protocolos MINSAL/SUSESO | P1 | ✅ Capacidad técnica cerrada (19-07-2026) |
| 7 | EPP preventivo integrado con Bodega | DS 594 arts. 53-54; DS 18 | P1 | ✅ Capacidad técnica cerrada (20-07-2026) |
| 8 | Emergencias, contingencias y simulacros | DS 44 arts. 18 y 19 | P1 | ✅ Capacidad técnica cerrada (20-07-2026) |
| 9 | Gestión del cambio | DS 44 art. 15 | P1 | ✅ Capacidad técnica cerrada (20-07-2026) |
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
- [x] ~~UI de alta de cursos, versiones y requisitos~~ — **entregada el 19-07-2026** en `/prevencion/capacitacion/catalogo`: alta de curso con el piso del art. 16 visible en el formulario, alta de contenido con temario y contador de minutos, transiciones de versión con motivo obligatorio, y alta de requisito de competencia.
- [x] ~~UI de alta de sesiones y de registro de asistencia/cierre~~ — **completado el 19-07-2026** (ver 5decies). El flujo de capacitación queda cerrado de punta a punta: programar, convocar, registrar asistencia y evaluación, cerrar otorgando competencias, cancelar y acusar recibo.
- [x] ~~Requisitos de alcance `task`~~ — **cerrado en la capacidad 3** (19-07-2026): el tipo de permiso los consume mediante `competencyTaskKey`, sin tablas nuevas. Ver sección 5ter.2.

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

## 5bis. Capacidad 2 — Contratistas y coordinación de faena (DS 76) — **ELIMINADA el 19-07-2026**

La capacidad se construyó completa (8 tablas, 34 pruebas, 3 superficies, 7 permisos) y se **eliminó del producto el 19 de julio de 2026**, con su migración de retiro `0086_cold_revanche.sql`.

### Por qué: el módulo estaba construido del lado equivocado

El DS 76/2006 y el art. 66 bis de la Ley 16.744 obligan a la **empresa principal** —la que es dueña de la obra o faena— a acreditar, vigilar y coordinar a sus contratistas y subcontratistas.

**Chome no es la empresa principal.** Chome opera como **empresa contratista** en faenas de terceros (CMPC, Biodiversa) gestionando sus residuos, y lo hace **con dotación propia**. Las faenas no son suyas. Por lo tanto:

- las obligaciones del DS 76 que este módulo cubría recaen en el mandante, no en Chome;
- Chome no acredita empresas externas ni libera su ingreso a una faena que no controla;
- no hay subcontratación encadenada que registrar.

Se consultó explícitamente antes de borrar, porque un requisito legal no se elimina por conveniencia. La respuesta —Chome es contratista, con personal propio— cierra la pregunta: **no aplica**.

### Lo que sí aplica y este módulo no cubría

Como contratista, Chome tiene obligaciones **hacia el mandante**: entregar antecedentes de su dotación, cumplir el reglamento especial de cada faena, participar en las reuniones de coordinación que convoca el mandante y reportarle sus accidentes.

Eso es el lado receptor —Chome entregando, no acreditando a terceros— y es una capacidad distinta que **nunca se construyó**. No se pierde nada al borrar este módulo, pero conviene no confundir una cosa con la otra.

- [ ] **Producto (sin priorizar)** — Lado contratista: expediente de antecedentes por mandante, con lo que cada faena exige y su vencimiento. Hoy no existe. Sólo vale la pena si hoy se administra a mano y duele.

### Alcance del retiro

Se eliminaron 8 tablas, 3 páginas, la ruta de exportación, el servicio, el motor de brechas, la validación, las 34 pruebas y los 7 permisos con sus concesiones por rol y su entrada de navegación.

**Acoplamientos desmontados en módulos que sí se conservan:**

- **Permisos de trabajo.** La cuadrilla admitía identidad interna *o* de contratista; ahora `worker_id` es obligatorio y desapareció el bloqueador `crew_access_blocked`. Es una simplificación real: toda cuadrilla es personal propio.
- **CAPA.** El `sourceType` `'contractor'` salió del check de la base y del esquema de validación.
- **Incidentes.** Se conservó el tipo de evento `contractor_or_third_party`: Chome trabaja en faenas ajenas, así que un incidente que involucre a un tercero es más probable ahora, no menos. No dependía de las tablas eliminadas.

**Riesgo de la migración de retiro:** `DROP TABLE ... CASCADE` elimina la llave foránea pero **no** las filas de cuadrilla cuya única identidad era un trabajador de contratista, que quedarían con `worker_id` nulo y harían fallar el `SET NOT NULL`. La migración incluye un `DELETE` previo acotado a esas filas. En producción es inocuo: la migración de permisos (`0080`) todavía no está aplicada.

---

## 5ter. Capacidad 3 — Permisos de trabajo, AST/JSA y control de energías

Es la capacidad que amarra las anteriores: un permiso no se habilita si alguien de la cuadrilla no tiene su competencia vigente (capacidad 1).

### 5ter.1 Alcance implementado

**Contrato de datos** (`db/schema/prevention/permits.ts`, 7 tablas aditivas): tipos de permiso configurables; permiso con ventana, supervisor y máquina de estados; cuadrilla de personal propio; controles verificables; aislamientos LOTO; mediciones; pasos de AST/JSA; historial inmutable. Además, `ppa_submissions` recibió una columna `work_permit_id` nullable para que el PPA sea la verificación breve dentro del permiso, como pide la auditoría §7.7, sin romper su uso autónomo.

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
- [x] ~~UI de detalle del permiso~~ — **completado el 20-07-2026** (ver 5ter.5). El flujo queda cerrado de punta a punta: tipo de permiso, alta con cuadrilla y controles, AST/JSA, LOTO, mediciones, transiciones, extensión y acuse.
- [x] ~~Enganche efectivo del PPA al permiso~~ — **completado el 20-07-2026** (ver 5ter.6). La columna `work_permit_id` ahora se puebla desde el formulario público.
- [ ] **Producto (diferido)** — Captura móvil/offline de permisos, mediciones y acuses en terreno.

### 5ter.5 Formularios de alta y detalle — Permisos de trabajo (20 de julio de 2026)

Cierra la capacidad 3 de punta a punta en UI. Hasta ahora la bandeja era de solo lectura y ningún formulario llegaba a `createWorkPermitAction` ni a las diez Server Actions de terreno: sin un permiso creado, la capacidad entera era inalcanzable desde la interfaz.

**Entregado**

- **Alta de tipo de permiso**, con los tres interruptores (aislamiento, medición, AST/JSA) reflejando lo que la habilitación va a exigir, y la clave de tarea para enlazar con los requisitos de competencia de Capacitación.
- **Alta de permiso**, con cuadrilla filtrada por faena (igual que en Capacitación: el servicio rechaza asignar a alguien de otra faena, así que la lista se acota antes de enviar) y controles declarados como lista dinámica.
- **Detalle en `/prevencion/permisos/[permitId]`**: ficha completa, banner de bloqueadores cuando el permiso no puede habilitarse, AST/JSA editable mientras no está aprobado, controles verificables uno a uno, LOTO (agregar/aplicar/retirar), mediciones, cuadrilla con estado de competencia y acuse propio, y el panel de transiciones completo (enviar a aprobación, aprobar, rechazar, habilitar, suspender, cerrar, cancelar, extender).
- Cada transición a `active` muestra los bloqueadores reales de `evaluatePermitReadiness` **antes** de enviar, y el botón "Aprobar" no se ofrece cuando quien mira la pantalla es quien solicitó el permiso: el servicio lo rechaza, así que la UI no ofrece una acción condenada a fallar.
- Cerrar con aislamientos aplicados sin retirar se bloquea igual, mostrando cuáles quedan abiertos.

### Defecto preexistente corregido: `getWorkPermitDetail` nunca detectaba competencia faltante

Al construir la vista de detalle, `getWorkPermitDetail` resultó estar pasando `null` como `competencyTaskKey` a `resolveCrewEligibility` en vez del valor real del tipo de permiso. La activación (`evaluatePermitReadiness`) sí bloqueaba correctamente por falta de competencia, pero la lectura de detalle nunca podía mostrarlo: cualquier vista construida sobre esa función habría mostrado a toda la cuadrilla como habilitada aunque el permiso estuviera bloqueado por esa misma razón.

Se corrigió pasando `permit.competencyTaskKey` real y se enriqueció la función con rol, acuse y el usuario ligado a cada integrante (para el botón de acuse propio) y los nombres de supervisor y solicitante, que la vista necesitaba y la función no traía.

**Verificación:** typecheck, ESLint (0 avisos) y build limpios; React Doctor sin hallazgos en los archivos tocados (el único —`.filter().map()` combinables— se corrigió); 57 pruebas de permisos y RBAC contra PostgreSQL real en verde; regresión completa de 341 archivos y 2.927 pruebas en verde. Las dos rutas nuevas se agregaron al inventario de capturas para no repetir el defecto de gate en rojo de la pasada anterior.

No se probó en navegador con sesión autenticada: la única cuenta administradora de la base de desarrollo es la personal del usuario, sin credencial disponible para el agente. Se verificó en su lugar que ambas rutas compilan y responden (redirección a login con el `callbackUrl` exacto, sin error 500) contra el servidor de desarrollo ya corriendo.

### 5ter.6 Enganche del PPA al permiso (20 de julio de 2026)

La columna `work_permit_id` existía desde la capacidad 3 original, indexada, pero ningún camino de escritura la poblaba: ni el schema del formulario público la aceptaba, ni `createPpaSubmission` la persistía.

**Decisión de diseño:** el enganche se resolvió en el **formulario público de envío**, no en la revisión posterior del responsable. La revisión (`reviewPpa`) sólo se ejecuta para PPA `detenido`; enganchar ahí habría dejado fuera el caso más común, el PPA `aprobado_auto`, que es exactamente el que corresponde a una tarea rutinaria bajo un permiso vigente.

Esto significa exponer datos de permisos en una ruta pública sin login. Se acotó la exposición al mismo criterio que ya rige `findWorkerByRutAction` y `listWorksitesForPublicForm`: mínimo necesario, nada sensible.

- **Nueva función pública** `listActiveWorkPermitsForPublicForm()`: expone sólo `id`, `código` y `descripción de la tarea` de permisos con `status = 'active'`. Nada de supervisor, cuadrilla, AST ni aislamientos.
- **`ppaSubmitSchema`** admite `workPermitId` opcional.
- **`createPpaSubmission`** revalida el permiso server-side aunque el selector público sólo ofrezca permisos activos: el cliente no es de confianza. Rechaza si el permiso no existe, no es de la misma faena declarada, o no está `active`.
- El selector en `ppa-form.tsx` sólo aparece si hay permisos activos en la faena elegida (filtrado en cliente, igual que `worksites`); cambiar de faena limpia la selección.

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando `/ppa`; React Doctor sin hallazgos propios; 60 pruebas de PPA y RBAC en verde; regresión completa de 341 archivos y 2.927 pruebas en verde. El envío offline no requirió cambios: `enqueuePpa` acepta el payload completo sin tipar sus campos, así que `workPermitId` viaja igual que el resto.

Defecto preexistente ajeno encontrado y corregido de paso: `scripts/capture-all-routes.test.ts` estaba en rojo por `/admin/epps`, una página nueva de la feature de catálogo EPP en desarrollo concurrente, sin registrar en el inventario. Se agregó la línea de inventario sin tocar esa feature.

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

- [x] ~~Enriquecer el catálogo con `danoPotencial`~~ — **completado y cargado el 19-07-2026**: 182/182 ítems calibrados por Prevención. El bloqueo de cierre por hallazgo grave o crítico ya tiene efecto real.
- [ ] **Producto (baja prioridad, no es un defecto)** — Aplicabilidad condicional de ítems. Ningún ítem declara `required`, así que el piso de seguridad exige responder todo lo que cuenta para cumplimiento; se puede marcar «no aplica», pero con motivo escrito. Ese es el comportamiento conservador y correcto: un ítem opcional sin responder desaparecería sin dejar rastro, y en una inspección de equipos móviles eso es justo lo que no se quiere.

  La fricción real está en 7 ítems que en su propio texto ya declaran que a veces no corresponden (seis «Solo camión carretera» en equipos móviles y el certificado CECMEC en extintores): obligan a justificar por escrito en cada inspección de un equipo que no es camión de carretera.

  Si esa fricción se vuelve un problema, **la solución no es marcar `required`** sino declarar aplicabilidad condicional por sujeto, de modo que el formulario no muestre el ítem cuando no corresponde. Quita la fricción sin perder trazabilidad, y es trabajo de producto, no una decisión de Prevención.
- [ ] **Producción** — Aplicar la migración `0082` e incorporar y aprobar las plantillas que la faena vaya a usar.
- [x] ~~Formulario de ejecución en terreno~~ — **completado el 20-07-2026** (ver 5quinquies.5). Sigue diferida la captura móvil/offline propiamente tal (uso desconectado con sincronización posterior).
- [ ] **Producto (diferido)** — Captura móvil/offline de inspecciones, respuestas y evidencia en terreno sin conectividad.
- [ ] **Producto (diferido)** — Tendencias por pregunta, control y activo; auditorías con alcance, muestra y equipo auditor.

### Evidencia

Migración `0082_fearless_mastermind.sql` desde schema, sin drift, aplicada. 22 pruebas puras y 16 escenarios en PostgreSQL real. Typecheck, ESLint, build y regresión completa verdes.

### 5quinquies.5 Formularios de alta y ejecución (20 de julio de 2026)

Cierra la capacidad 4 en UI para el flujo de escritorio. Hasta ahora la bandeja era de sólo lectura y ningún formulario llegaba a `importInspectionTemplateAction` ni al resto de las ocho Server Actions: sin una plantilla incorporada, aprobada, programada y ejecutable, la capacidad entera era inalcanzable desde la interfaz.

**Entregado**

- **`/prevencion/inspecciones/catalogo`**: incorporar plantilla (desde `listImportableDefinitions()`, que ya expone la calibración de cada definición), aprobarla de forma segregada del autor, y programarla por faena y frecuencia.
- **Alta de inspección** desde la bandeja, sólo sobre plantillas aprobadas.
- **Detalle en `/prevencion/inspecciones/[runId]`**: grilla de respuesta por sección con guardado en bloque, banner de obligatorios pendientes calculado en el cliente con la misma función pura `assessRunCompletion` que usa el servicio (no una reimplementación), "Declarar ejecutada", hallazgos con derivación a CAPA, y "Revisar y cerrar" con los mismos bloqueadores de `assessRunReview` mostrados antes de enviar.
- Enlace directo a la acción CAPA derivada desde cada hallazgo (`/prevencion/capa/[id]`), gratis por reusar la ruta ya existente.

### Dos defectos preexistentes corregidos por el camino

1. **`getInspectionRunDetail` no traía nombres de asignado, ejecutor ni revisor** — sólo IDs, inútiles para una pantalla pensada para personas. Se agregaron los tres joins alias, mismo patrón que en `getWorkPermitDetail`.
2. **Inventario de capturas con una clave dinámica muerta.** `scripts/capture-all-routes.test.ts` registraba `"/prevencion/inspecciones/[id]"` desde antes de que esta carpeta existiera; la carpeta real que se construyó es `[runId]`. La clave nunca hizo nada porque no había página que produjera ese patrón — quedó expuesta recién al crear la ruta real, y el gate se habría puesto en rojo sin la corrección.

**No construido a propósito:** la cancelación de una inspección (`status = 'cancelled'`) existe en el schema y en las etiquetas, pero **no tiene ninguna Server Action que la dispare** — es un estado alcanzable sólo por escritura directa. No se inventó una mutación nueva para llenar ese hueco: eso es una decisión de producto (¿quién cancela, con qué motivo, se puede después de ejecutada?), no wiring de UI sobre algo ya construido.

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando las 3 rutas nuevas; React Doctor sin hallazgos propios tras corregir un `.filter().map()` combinable (el único hallazgo restante, `new Date()` en un Server Component, es el mismo falso positivo ya documentado); 55 pruebas de inspecciones y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde. No se probó con sesión autenticada por la misma razón que en permisos: se verificó en su lugar que las tres rutas responden sin error 500.

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
- [x] ~~Formularios de constitución, designación, convocatoria y cierre de acta; indicadores de funcionamiento del comité~~ — **completado el 20-07-2026** (ver 5sexies.1). Indicadores de funcionamiento = `getCommitteeStatus` (paridad, mandato, cadencia), ya calculado desde la capacidad original y ahora expuesto en el detalle del comité.
- [ ] **Producto (no priorizado)** — Documentos electorales. El vínculo genérico de documentos (`sst_document_links`) ya declara `'committee'` como tipo de entidad válido en el check constraint de la base, pero `DOCUMENT_LINK_ENTITY_TYPES` (la unión de TypeScript que consume el módulo) nunca lo implementó — ni `resolveDocumentLinkTarget` tiene el caso `'committee'`. Es una capacidad más amplia del módulo de documentos, no específica de CPHS, y no se inventó aquí.
- [ ] **Producto (no priorizado)** — Reemplazo o renuncia de un integrante. El schema admite los estados `replaced`/`resigned`, pero ninguna Server Action los produce; sólo existe el alta.

Evidencia: migración `0083_closed_maverick.sql` sin drift, 17 pruebas puras de paridad, quórum y cadencia, y 15 escenarios en PostgreSQL real.

### 5sexies.1 Formularios de alta y detalle (20 de julio de 2026)

Cierra la capacidad 5 en UI para el flujo de escritorio. Hasta ahora la bandeja era de sólo lectura y ningún formulario llegaba a `constituteCommitteeAction` ni a las otras cinco Server Actions: sin un comité constituido, la capacidad entera era inalcanzable desde la interfaz. La revisión por la dirección tampoco tenía superficie alguna, ni de lectura.

**Entregado**

- Alta de comité desde la bandeja.
- Tercera pestaña «Revisión por la dirección» con alta, y cierre con compromisos dinámicos — cada uno deriva a CAPA con faena, responsable, prioridad y plazo propios.
- Detalle en `/prevencion/cphs/[committeeId]`: indicadores de funcionamiento (paridad, mandato, cadencia), alta de integrante, convocatoria y cierre de acta con **vista previa de quórum en vivo** usando la misma función `assessQuorum` del servicio — el botón de cierre se deshabilita si no alcanza, antes de que el servidor lo rechace.

`getCommitteeStatus` se enriqueció con la nómina de integrantes y el nombre de la faena, que la vista necesitaba y la función no traía.

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando las 2 rutas nuevas; React Doctor sin hallazgos propios (los 6 hallazgos en `prevention-cphs.ts` son código preexistente que no toqué: schemas `datetime()` y loops secuenciales dentro de una misma transacción); 43 pruebas de CPHS y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde. No se probó con sesión autenticada real; se verificó que ambas rutas responden sin error 500.

---

## 5septies. Capacidad 6 — Higiene industrial y vigilancia ocupacional

Se construye **encima** del dominio clínico cifrado de P0-06, no en paralelo: el resultado del examen sigue viviendo en `prevention_health_records` con su payload cifrado, y la matrícula de vigilancia sólo lo enlaza.

Siete tablas aditivas: agentes con límite permisible y nivel de acción, grupos de exposición similar (GES), integrantes, mediciones, programas de vigilancia, matrículas e historial.

**Reglas verificables:**

- El límite permisible y el nivel de acción son **parámetros por agente con su fuente normativa declarada**, no constantes de código.
- Un agente **sin límite declarado devuelve «no comparable», nunca «cumple»**: no poder comparar no es estar bajo el límite. Es el mismo criterio que «no calculable» en los indicadores DS 44.
- Superar el **nivel de acción** ya obliga a vigilancia; no se espera a superar el límite permisible.
- El límite y el nivel de acción **se congelan en la fila de la medición**: si el agente cambia su límite después, la evidencia sigue diciendo contra qué se comparó.
- La obligación de vigilancia se recalcula con **todo el historial**. Una campaña posterior bajo el nivel de acción libera, pero el fundamento deja constancia de las excedencias previas para que la salida sea una decisión explícita y no un olvido.
- La nómina de vigilancia **se deriva de la pertenencia al GES**, no se arma a mano: eso es lo que impide que una persona expuesta quede fuera por omisión.
- El **panel agregado suprime los grupos con menos de 5 integrantes**. En un grupo de dos, «50 % asistió» identifica a una persona y su vínculo con un programa de vigilancia, que es dato de salud. Mismo criterio que la desagregación por sexo del DS 44.

### Pendientes de la capacidad 6

- [ ] **Operación** — Cargar el inventario real de agentes con su límite y fuente, y constituir los GES por proceso.
- [ ] **Producción** — Aplicar la migración `0084`.
- [x] ~~Formularios de alta de agentes, GES, mediciones y matrículas~~ — **completado el 20-07-2026** (ver 5septies.1).
- [ ] **Producto (diferido)** — Citaciones automáticas y recordatorio de controles vencidos; medidas prescritas por el organismo administrador. No existe cron ni campo para citación; es trabajo nuevo, no wiring de UI.
- [ ] **Producto (diferido)** — Protocolos específicos (CEAL-SM, TMERT, PREXOR) como plantillas con sus hitos propios; hoy se modelan como programas con periodicidad.

Evidencia: migración `0084_confused_switch.sql` sin drift, 19 pruebas puras y 13 escenarios en PostgreSQL real.

### 5septies.1 Formularios de alta y detalle (20 de julio de 2026)

Cierra la capacidad 6 en UI para el flujo de escritorio. Hasta ahora el dashboard era de sólo lectura y ningún formulario llegaba a `createExposureAgentAction` ni a las otras seis Server Actions.

**Entregado**

- Alta de agente, GES y programa de vigilancia desde el dashboard.
- Detalle de GES en `/prevencion/higiene/grupos/[groupId]`: integrantes, y mediciones con **vista previa de resultado en vivo** usando la misma función `assessMeasurement` del servicio mientras se escribe el valor — antes de que el límite y el nivel de acción queden congelados en la fila al guardar.
- Detalle de programa en `/prevencion/higiene/programas/[programId]`: matricular grupo (deriva la nómina completa desde el GES, no se arma a mano) y registrar resultado de control por persona, con el campo de ID de registro de salud aclarando que el dato clínico vive en el dominio cifrado, no aquí.

Se extendió `listGroupMeasurements` con la nómina de integrantes y los datos del agente (antes sólo traía las mediciones), y se agregó `listProgramEnrollments`, que no existía.

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando las 3 rutas nuevas; React Doctor sin hallazgos propios (el único hallazgo en `prevention-hygiene.ts` es un loop secuencial preexistente dentro de una transacción, mismo patrón ya visto en CPHS); 43 pruebas de higiene y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde. No se probó con sesión autenticada real; se verificó que las tres rutas responden sin error 500.

---

## 5undecies. Capacidad 8 — Emergencias, contingencias y simulacros (20 de julio de 2026)

Nueve tablas aditivas: plan de emergencia por faena, escenarios, organigrama de respuesta (titular + reemplazo), recursos, contactos, simulacros, participantes de simulacro e historial.

**Reglas verificables:**

- Un plan nace en preparación (`draft`). Aprobar exige al menos un escenario y un rol del organigrama de emergencia (`assessPlanReadiness`) — un plan sin eso no es un plan operable, es un documento en blanco.
- **Segregación:** quien crea el plan no puede aprobarlo, mismo criterio que permisos de trabajo y plantillas de inspección. Se valida en el servicio comparando `createdByUserId`, no restringiendo el permiso `prevention:emergency:approve` a un rol distinto — así el software no depende de que el organigrama de roles coincida exactamente con quién hizo qué.
- Sólo un plan aprobado puede programar simulacros.
- Titular y reemplazo de cada rol, y cada participante de simulacro, deben pertenecer a la faena del plan.
- Completar un simulacro exige participantes registrados y un resultado explícito (`assessDrillCompletion`): un simulacro "completado" sin nadie presente ni conclusión no deja aprendizaje verificable.
- Un simulacro con resultado "requiere mejora" **deriva su hallazgo a CAPA común** (`sourceType = 'emergency'`) con responsable y plazo — el aprendizaje del simulacro no se queda en un campo de texto.

**Entregado en UI:** bandeja en dos pestañas (Planes/Simulacros) en `/prevencion/emergencias`, con alta de plan; detalle en `/prevencion/emergencias/[planId]` con banner de bloqueadores antes de aprobar (misma función `assessPlanReadiness` del servicio), alta de escenarios/roles/recursos/contactos, programación de simulacro y su cierre con **vista previa en vivo** de `assessDrillCompletion` mientras se marca asistencia — el botón "Completar" se deshabilita antes de que el servidor lo rechace.

### Defecto preexistente corregido por el camino

`lib/prevention/capa.ts` (`CAPA_SOURCE_LABELS` y `capaSourceHref`) nunca se actualizó cuando se agregaron las capacidades de permisos de trabajo, inspecciones y CPHS: sus `sourceType` (`work_permit`, `inspection`, `cphs`) no tenían etiqueta ni enlace desde la pantalla de CAPA. Se completaron esos tres junto con `emergency` (sin enlace directo — el `sourceId` es el simulacro, no hay ruta propia por simulacro, mismo tratamiento que `cphs`) y `change` (enlace directo, ver §5duodecies).

Además, un commit ajeno concurrente (`bab1afb`, feature de catálogo EPP) había borrado por accidente `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx`, el fixture binario que usa `lib/__tests__/prevention-pdtp-catalog.test.ts`. Se restauró desde el commit anterior (`f5cc248`) donde el archivo aún existía completo; no se tocó ningún otro archivo de esa feature.

### Pendientes de la capacidad 8

- [ ] **Operación** — Cargar los planes de emergencia reales por faena y designar el organigrama con la dotación vigente.
- [ ] **Producción** — Aplicar la migración `0093`.
- [ ] **Producto (no priorizado)** — Cancelación de plan (`archived`) y de simulacro (`cancelled`): ambos estados existen en el schema pero ninguna Server Action los produce, sólo el alta y el flujo de aprobación/cierre. No se inventó una mutación nueva para llenarlo: es una decisión de producto (¿quién archiva, con qué motivo?), no wiring de UI sobre algo ya construido.
- [ ] **Producto (diferido)** — Captura móvil/offline de simulacros y evidencia en terreno sin conectividad, igual que permisos e inspecciones.

Evidencia: migración `0093_whole_mastermind.sql` sin drift (segunda pasada de `db:generate` confirmó "No schema changes"), 8 pruebas puras de disponibilidad del plan y cierre de simulacro, 11 escenarios en PostgreSQL real (incluida la segregación de aprobación y la derivación a CAPA).

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando las 2 rutas nuevas; React Doctor sin ningún hallazgo en los archivos de esta capacidad; regresión completa de 306 archivos y 2.650 pruebas en verde (incluyendo el fix del fixture PDTP y una entrada nueva en `dynamicSamples` de `capture-all-routes.test.ts` para la ruta dinámica `/prevencion/emergencias/[planId]`, sin la cual el gate de inventario de capturas quedaba en rojo). No se probó con sesión autenticada real; se verificó que ambas rutas compilan.

---

## 5duodecies. Capacidad 9 — Gestión del cambio (20 de julio de 2026)

Tres tablas aditivas: solicitud de cambio, evaluación por dimensión de impacto (una fila por dimensión) e historial.

**Reglas verificables:**

- Un cambio nace en preparación (`draft`) con las **seis dimensiones de impacto pre-creadas y sin evaluar** (riesgo, permisos, capacitación, documentos, MIPER, emergencia) — no se arman a mano, evitando que una dimensión quede fuera por omisión.
- Evaluar la primera dimensión mueve el cambio a `under_evaluation` automáticamente; no hay una transición manual separada para eso.
- Aprobar exige las **seis dimensiones evaluadas y una fecha de revisión posterior** declarada (`assessChangeReadiness`) — sin eso el cambio queda sin trazabilidad de qué se evaluó y cuándo se revisa si la evaluación siguió siendo válida.
- **Segregación:** quien solicita el cambio no puede aprobarlo, mismo criterio que emergencias, permisos de trabajo y plantillas de inspección; se valida en el servicio, no restringiendo el permiso a un rol distinto.
- Una dimensión marcada como que **requiere acción** deriva de inmediato a CAPA común (`sourceType = 'change'`, `sourceId` = el propio cambio) con responsable, prioridad y plazo, dentro de la misma transacción de la evaluación — la acción correctiva es un prerrequisito para implementar el cambio, no una consecuencia posterior a su aprobación.
- Un cambio ya decidido (`approved`/`rejected`/`implemented`/`closed`) no admite nuevas evaluaciones.

**Entregado en UI:** bandeja en `/prevencion/gestion-cambio` con alta de solicitud; detalle en `/prevencion/gestion-cambio/[changeId]` con las seis dimensiones en tabla, diálogo de evaluación por dimensión (deriva a CAPA cuando corresponde, con enlace directo a la acción creada), y aprobar/rechazar con el botón "Aprobar" deshabilitado mientras la disponibilidad no se cumple.

**No construido a propósito:** los estados `implemented` y `closed` existen en el schema (columnas `implementedAt`/`closedAt` incluidas) pero ninguna Server Action los produce — es una decisión de producto (¿quién marca implementado, con qué evidencia de que la revisión posterior ocurrió?), no wiring de UI sobre algo ya construido. Mismo criterio que la cancelación de plan/simulacro en emergencias.

### Pendientes de la capacidad 9

- [ ] **Operación** — Definir el flujo real de quién solicita, evalúa y aprueba cambios por faena, y si `implemented`/`closed` deben cerrarse manualmente o requieren evidencia de la revisión posterior.
- [ ] **Producción** — Aplicar la migración `0094`.

Evidencia: migración `0094_melted_sheva_callister.sql` sin drift (segunda pasada de `db:generate` confirmó "No schema changes"), 6 pruebas puras de disponibilidad y 11 escenarios en PostgreSQL real (incluida la segregación de aprobación, la transición automática a `under_evaluation` y la derivación a CAPA).

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando las 2 rutas nuevas; React Doctor sin ningún hallazgo en los archivos de esta capacidad; regresión completa de 307 archivos y 2.656 pruebas en verde. No se probó con sesión autenticada real; se verificó que ambas rutas compilan.

---

## 5terdecies. Capacidad 7 — EPP preventivo integrado con Bodega (20 de julio de 2026)

**Investigación previa:** la capacidad 10 (sustancias/residuos peligrosos) fue descartada para esta pasada: no existe en ningún lugar del código perfil de residuo, HDS, clasificación de peligrosidad, número ONU ni manifiesto — `trazabilidad`/`recepción`/`entregas` modelan procurement y bodega **interna** de Chome, no manifiestos de residuos de clientes (confirmado por `README.md` y por §0.13 de la auditoría). Construirla ahora habría violado el principio de la propia auditoría ("Prevención consume entidades operacionales, no las inventa"). Se pivotó a EPP preventivo, que sí tiene sustrato real.

**Diseño deliberado: mirror de Capacitación, no una capacidad desde cero.** Es el mismo problema (persona × requisito por cargo/faena/tarea → brecha → CAPA) que `prevention_competency_requirements`/`computeCompetencyGaps`/`escalateBlockingGapsToCapa` ya resuelven para competencias. Dos tablas aditivas (`prevention_epp_requirements`, `prevention_epp_history`); todo lo demás se reutiliza sin duplicar:

- **Catálogo técnico** (`epp_product_families`: certificación, vida útil, pictograma) y **talla del trabajador** (`workers.size_*`) — ya existen, del feature de catálogo EPP concurrente (commit `1463d99`).
- **Entrega real con acuse** — `deliveries`/`delivery_items` ya modela `destinationType='worker'`, firma (`signaturePath`) y **devolución con motivo** (`returnReason IN (desgastado|dañado|vencido|otro)`); nada de esto se construyó de nuevo.

**Reglas verificables:**

- La cobertura se calcula comparando cada requisito activo aplicable a un trabajador contra su **entrega más reciente** de ese tipo de EPP: sin entrega → brecha "nunca entregado"; con entrega pero `fecha + vida_útil < hoy` → brecha "vencido".
- **Decisión de diseño explícita**: una familia de producto sin `lifespanMonths` declarado se trata como vigente indefinidamente, no como brecha perpetua — a diferencia del criterio "no comparable ≠ cumple" de higiene, porque la ausencia de vida útil es el estado normal de mucho EPP (cascos, arneses sin fecha fija) y forzar brecha perpetua sería ruido, no protección.
- Un requisito por tarea (`scopeType='task'`) nunca genera brecha por dotación estática — se resuelve al asignar la tarea, mismo diferimiento ya aceptado en Capacitación.
- Escalar brechas bloqueantes a CAPA es idempotente por `trabajador:tipo de EPP` (`sourceType = 'epp'`), mismo mecanismo que Capacitación.

**Entregado en UI:** `/prevencion/epp-preventivo` con dos pestañas (Cobertura/Brechas | Requisitos), mirror directo de `/prevencion/capacitacion/brechas` (banner de bloqueantes con botón de escalamiento, filtros por exigibilidad y tipo de brecha) más una pestaña simple de alta de requisitos.

### No construido a propósito

- **Selección/aprobación técnica formal** — el requisito ya declara `preferredFamilyId`; sin flujo de aprobación separado, mismo criterio que los requisitos de competencia.
- **Prueba de ajuste (fit test)** — específico de respiradores DS 594; no modelado.
- **Instrucción y demostración práctica** — YA cubierta por Capacitación (declarar un curso de instrucción de EPP como competencia obligatoria); no requiere código nuevo aquí.
- **Inspecciones periódicas del EPP en uso** — YA cubierta por el motor de inspecciones: existe una definición latente "EPP" en `CHECKLIST_DEFINITIONS`, sólo falta que Prevención la incorpore y programe.
- **Mantención y limpieza del EPP** — no modelada; no existe esa entidad operacional en ningún lugar del código.
- **Conciliación automática con stock y generación de solicitud de compra** — el dashboard muestra qué falta, pero no genera automáticamente una `purchase_request`; integración cruzada mayor, fuera de este alcance.
- **Devolución/baja/disposición** — YA existe vía `delivery_items.returnQuantity`/`returnReason`; no requiere trabajo nuevo.

### Pendientes de la capacidad 7

- [ ] **Operación** — Declarar los requisitos de EPP reales por cargo/faena (hoy no hay ninguno cargado).
- [ ] **Producción** — Aplicar la migración `0095`.

Evidencia: migración `0095_faithful_colleen_wing.sql` sin drift (segunda pasada de `db:generate` confirmó "No schema changes"), 12 pruebas puras de alcance y cobertura, 6 escenarios en PostgreSQL real (incluida la exclusión de entregas fuera de alcance y el escalamiento idempotente a CAPA).

**Verificación:** typecheck y ESLint (0 avisos) limpios; build compilando la ruta nueva; React Doctor sin ningún hallazgo en los archivos de esta capacidad; regresión completa de 308 archivos y 2.668 pruebas en verde. No se probó con sesión autenticada real; se verificó que la ruta compila.

---

## 5octies. Formularios de alta — Capacitación (19 de julio de 2026)

Primera entrega de la línea «hacer usable lo construido». Hasta ahora las seis capacidades tenían bandejas de lectura pero ningún formulario: el alta sólo era posible invocando la Server Action.

**Entregado:** `/prevencion/capacitacion/catalogo`, con tres pestañas y cuatro formularios.

- **Alta de curso.** El formulario refleja la regla legal en vez de esconderla: al elegir «curso legal obligatorio», la duración mínima toma 480 min, la vigencia se vuelve obligatoria con tope de 24 meses, y aparece el campo de fundamento normativo. Al elegir «ODI», aparece el peligro MIPER de origen. La validación real sigue viviendo en el servicio; el formulario sólo evita que el usuario descubra el rechazo después de escribirlo todo.
- **Alta de contenido versionado**, con temario dinámico y contador de minutos declarados, que es la comparación que el servicio va a hacer contra la duración total.
- **Transiciones de versión** con motivo obligatorio. Los botones se filtran por permiso: «Aprobar» y «Publicar» sólo aparecen con `training:approve`. La segregación autor/aprobador sigue validándose por actor en el servicio.
- **Alta de requisito de competencia**, con el campo de alcance adaptándose: cargo, faena, tarea o global. El texto declara explícitamente que el sistema no puede inferir qué tarea es crítica.

### Hallazgo: dos tipos distintos con el mismo nombre

`lib/services/prevention-indicadores.ts` exporta su propio `WorksiteScope = string[] | "all"`, incompatible con el canónico de `lib/auth/scope` (`{ mode, ids }`). Al intentar reusar `listVisibleWorksites` desde el catálogo, el typecheck lo detectó.

No se refactorizó en el momento: unificarlo tocaba todo el módulo de indicadores y sus pruebas, y no correspondía arrastrarlo dentro de una entrega de formularios. Se agregó `listTrainingWorksites` al servicio de capacitación, que sí usa el tipo canónico.

- [x] ~~Unificar el `WorksiteScope` de `prevention-indicadores.ts` con el canónico~~ — **completado el 20-07-2026**. `lib/services/prevention-indicadores.ts` ahora importa `WorksiteScope` de `@/lib/auth/scope` (`{mode, ids}`) en vez de declarar el suyo propio (`string[] | "all"`). Se reescribieron las siete funciones internas que discriminaban por `scope === "all"`/`scope.length` para usar `scope.mode`/`scope.ids`, y se retiró el helper `scopeToIds` que **tres archivos distintos duplicaban de forma idéntica** (`page.tsx`, `actions.ts`, `export/route.ts`) sólo para adaptar el tipo canónico de la sesión al tipo local del servicio — ahora pasan `resolveWorksiteScope(session)` directo. Cuatro archivos de prueba (`actions.test.ts`, `prevention-indicators-postgres.test.ts`, `prevention-indicators-close.test.ts`) actualizados a la forma canónica.

  Se verificó que el mismo patrón de conversión (`scopeToIds`) existe también en PPA, PDTP y el módulo `prevencion/actions` — **no se tocaron**: son ámbitos separados y ese no era el ítem de deuda señalado por el plan, que nombraba específicamente `prevention-indicadores.ts`.

  Defecto preexistente encontrado y corregido de paso, no relacionado con el refactor: `scripts/export-epps-xlsx.ts` (un script suelto sin trackear) tenía un cast `as Buffer` que ya no compilaba contra la versión actual de `@types/node`, y `writeFileSync` recién fallaba al quitarlo. Se resolvió con `Buffer.from(buffer)`, el patrón correcto para el tipo que devuelve `exceljs`.

  **Verificación:** typecheck y ESLint (0 avisos) limpios; build verde; React Doctor sin hallazgos en los 4 archivos tocados del refactor; 5 pruebas de indicadores contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.

---

## 5nonies. Carga de la calibración de daño potencial (19 de julio de 2026)

Prevención devolvió la planilla con **182 de 182 ítems calibrados**, sin valores inválidos y con justificación escrita en cada uno. Se cargó al catálogo con `scripts/import-checklist-dano-potencial.ts`, contraparte del script de exportación.

**Tres trampas que el importador tuvo que resolver, y que justifican que no sea un buscar/reemplazar:**

1. Los `id` de ítem **colisionan entre archivos** (hay varios `luces`), así que el destino se resuelve por el archivo de secciones que cada checklist realmente importa, leído de su `import`.
2. `observacion-seguridad-sections` lo comparten dos checklists y **repite cada `id` una vez por checklist**. Parchear sólo la primera aparición dejaba 20 ítems sin calibrar; el importador aplica a todas las apariciones. La validación previa rechaza calibraciones divergentes, de modo que aplicar el mismo valor a todas es correcto.
3. El archivo devuelto venía **re-guardado con prefijo de namespace** (`<x:row>`) y con las cabeceras locales del ZIP en tamaño cero. El lector usa el directorio central y tolera ambos formatos, sin sumar dependencias al repositorio.

**Verificación:** el catálogo cargado reproduce exactamente la distribución de la planilla (fatal 78, grave 69, moderado 28, leve 7), cero ítems sin calibrar, typecheck y ESLint limpios, y 64 archivos con 592 pruebas en verde.

### Consecuencia operacional que conviene revisar

`fatal` genera acción correctiva con plazo el mismo día. Con esta calibración, un incumplimiento aislado produce plazo inmediato en el 64 % de los ítems de contenedores, ampliroll y maquinaria pesada.

Es una decisión legítima —en operación con equipos pesados muchos incumplimientos sí pueden matar— pero significa que la bandeja CAPA mostrará acciones vencidas el mismo día en que nacen.

- [x] ~~Separar detención inmediata y plazo administrativo~~ — **aprobado y ejecutado el 19-07-2026**. `prevention_capa_actions.requires_immediate_stop` (migración `0085`) transporta la respuesta de terreno; `fatal` pasa a compartir el plazo de 48 h con `grave`. La calibración, la escala y el importador no cambiaron. La bandeja CAPA lo muestra como métrica accionable y distintivo por acción.

---

## 5decies. Sesiones, asistencia y cierre — Capacitación (19 de julio de 2026)

Segunda entrega de «hacer usable lo construido», y la que **cierra la capacidad 1 de punta a punta**: hasta ahora existían el catálogo y las bandejas, pero programar una sesión, tomar asistencia o cerrarla seguía requiriendo invocar la Server Action.

**Entregado**

- **Programar sesión**, desde la propia bandeja. Sólo ofrece versiones **publicadas**, que es la única condición bajo la cual el servicio permite dictar. El relator se declara interno o externo, y su evidencia de competencia es obligatoria porque es exigible en fiscalización.
- **Convocatoria acotada por faena.** El servicio rechaza convocar a alguien de otra faena; la lista de convocables se filtra por la faena elegida y se vacía al cambiarla, de modo que el rechazo no aparezca recién al enviar. Incluye buscador por nombre y cargo.
- **Detalle de sesión** en `/prevencion/capacitacion/[sessionId]`: ficha con duración exigida contra duración dictada, vigencia que se otorgará, relator y su evidencia.
- **Registro de asistencia** como grilla editable: estado por persona, minutos, nota cuando el curso evalúa —deshabilitada si la persona no asistió, porque una nota sin asistencia no significa nada— y campo de justificación que aparece sólo al marcar «ausencia justificada», que es cuando el servicio la exige.
- **Cierre con el piso legal visible antes de enviar.** El diálogo calcula la duración dictada del par inicio/término y la contrasta con **la misma función** `assessLegalFloor` que usa el servicio, en vez de reimplementar la regla. Si el curso es legal obligatorio y la sesión no alcanza su duración, el botón queda deshabilitado con el motivo citado. Lo mismo con los convocados sin resultado de asistencia.
- **Cancelación** con motivo obligatorio, separada del cierre.

### Errores encontrados y corregidos por el camino

1. **Revalidación incompleta.** `revalidatePath` cubría la bandeja y sus tres subrutas estáticas, pero no la ruta dinámica del detalle ni el catálogo. La asistencia recién guardada habría seguido mostrando el valor anterior. Se agregó `revalidatePath(BASE/[sessionId], "page")` y el catálogo.
2. **Desajuste de hidratación** detectado por React Doctor: `new Date()` leído desde JSX para el valor por defecto de la fecha programada da un valor distinto en el servidor y en el navegador. Se resuelve al abrir el diálogo, no al renderizar.
3. **Sombra de variable**: el `worksites` derivado de las sesiones (para el filtro) chocaba con el nuevo prop de faenas del alcance. Se renombró a `sessionWorksites`, y de paso queda explícito que el filtro sólo debe ofrecer valores capaces de devolver alguna fila.

### Decisiones de diseño

- `useOperation`, `Field` y `selectClass` estaban duplicándose en el segundo consumidor, así que se extrajeron a `app/(app)/prevencion/capacitacion/form-kit.tsx`. Dos consumidores justifican el archivo; uno no lo habría justificado.
- La convocatoria (dotación completa y versiones) **sólo se consulta si el usuario puede programar**. Para el resto son dos consultas sobre toda la dotación que nadie va a mirar.
- Se agregó `listTrainingWorkers` al servicio, con el tipo `WorksiteScope` canónico, devolviendo `worksiteId` para que el formulario pueda filtrar sin ida y vuelta.

**Verificación:** typecheck y ESLint limpios (los 8 avisos restantes son del módulo de respaldos, en desarrollo concurrente y ajeno a esta entrega), React Doctor sin hallazgos en los archivos tocados, 19 pruebas de integración PostgreSQL de capacitación en verde, y `next build` compilando la ruta dinámica sin colisionar con `catalogo`, `competencias` ni `brechas`.

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
- [x] ~~Integración real con contratistas~~ — revertida el 19-07-2026 al eliminarse la capacidad 2; la cuadrilla es siempre personal propio.
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

### 19 de julio de 2026 — Capacidad 6: higiene industrial y vigilancia

- [x] Capa de higiene construida sobre el dominio clínico cifrado existente, sin duplicarlo: la matrícula enlaza al registro de salud, no guarda el resultado.
- [x] Agentes con límite permisible y nivel de acción como parámetros con fuente normativa; un agente sin límite devuelve «no comparable», nunca «cumple».
- [x] Límite y nivel de acción congelados en cada medición, para que la evidencia no dependa de recalcular límites que pudieron cambiar.
- [x] Obligación de vigilancia recalculada con todo el historial; la salida tras excedencias previas queda documentada en el fundamento.
- [x] Nómina de vigilancia derivada del GES y matrícula idempotente por período.
- [x] Panel agregado con supresión de grupos pequeños, aplicando el mismo criterio de reidentificación que los indicadores DS 44.
- [x] Migración `0084` desde schema, sin drift y aplicada; suite incorporada al gate de CI (ya son once).
- [x] Regresión completa: 57 archivos, 421 pruebas y 11 suites PostgreSQL con 119 pruebas.
- [ ] Pendiente productivo de la capacidad 6: ver sección 5septies.

### 19 de julio de 2026 — Formularios de alta: capacitación

- [x] Página `/prevencion/capacitacion/catalogo` con alta de curso, alta de contenido versionado, transiciones de versión y alta de requisito de competencia.
- [x] El formulario de curso refleja el piso del DS 44 art. 16 según el tipo elegido, en vez de dejar que el usuario descubra el rechazo al enviar.
- [x] Los botones de transición se filtran por permiso; la segregación autor/aprobador se sigue validando por actor en el servicio.
- [x] Detectada una deuda técnica preexistente: `prevention-indicadores.ts` define un `WorksiteScope` incompatible con el canónico. Se evitó el acoplamiento agregando un helper propio; la unificación queda anotada.
- [x] Typecheck, ESLint, build y regresión (57 archivos, 421 pruebas) verdes. React Doctor sin errores ni hallazgos nuevos.
- [x] Resuelto en la entrada «Sesiones, asistencia y cierre» de esta misma fecha: el formulario de sesiones y el registro de asistencia/cierre ya existen.

### 19 de julio de 2026 — Carga de la calibración de daño potencial

- [x] Recibida de Prevención con 182/182 ítems calibrados y justificación por ítem; validada sin valores inválidos ni calibraciones divergentes entre checklists que comparten archivo.
- [x] Importador `scripts/import-checklist-dano-potencial.ts` agregado, sin dependencias nuevas: lee el ZIP por directorio central y tolera etiquetas con prefijo de namespace.
- [x] Resuelto que los `id` colisionan entre archivos y que el archivo compartido repite cada `id`; el importador aplica a todas las apariciones tras rechazar divergencias.
- [x] Catálogo cargado y verificado contra la planilla: distribución idéntica, cero sin calibrar.
- [x] Typecheck, ESLint y regresión (64 archivos, 592 pruebas) verdes.
- [x] Resuelto: `fatal` ya no implica plazo el mismo día. Ver la entrada siguiente.

### 19 de julio de 2026 — Detención inmediata separada del plazo administrativo

- [x] Campo `requires_immediate_stop` agregado a CAPA (migración `0085`, aditivo con default `false`). Vive en el motor común porque aplica igual a hallazgos de PDTP y del motor de inspecciones.
- [x] `plazoFromDañoPotencial` deja de devolver hoy para `fatal`: comparte el plazo más corto con `grave`. Se agregó `requiereDetencionInmediata` como concepto explícito, reexportado desde el índice del módulo PDTP.
- [x] `capaPriorityForCriticality` devuelve la bandera para criticidad crítica; el generador de plan de acción de PDTP la propaga al crear la CAPA.
- [x] La bandeja CAPA muestra «Exigen detener la tarea» como métrica accionable y un distintivo junto al hallazgo: una bandera invisible en terreno no cambia conducta.
- [x] Pruebas nuevas en ambos motores: que sólo `fatal`/crítico exigen detención, que el plazo de `fatal` ya no es hoy y que los plazos crecen al bajar la severidad. Se corrigió una aserción previa que fijaba la forma del objeto de prioridad.
- [x] Regresión completa: 72 archivos, 651 pruebas y 11 suites PostgreSQL con 119 pruebas. Typecheck, ESLint y build verdes.

### 19 de julio de 2026 — Sesiones, asistencia y cierre de capacitación

- [x] `SessionDialog` en la bandeja: programa sesión sobre versiones publicadas, con relator interno o externo y evidencia de competencia obligatoria.
- [x] Convocatoria filtrada por la faena elegida, con buscador, y vaciada al cambiar de faena: el rechazo del servicio por faena cruzada ya no aparece recién al enviar.
- [x] Ruta `/prevencion/capacitacion/[sessionId]` con ficha de sesión, grilla de asistencia editable, cierre y cancelación.
- [x] El cierre muestra el piso legal antes de enviar reusando `assessLegalFloor`, la misma función del servicio, en vez de reimplementar la regla en el cliente.
- [x] La nota se deshabilita si la persona no asistió y la justificación aparece sólo al marcar ausencia justificada, que es exactamente cuando el servicio la exige.
- [x] Corregido: `revalidatePath` no cubría la ruta dinámica del detalle ni el catálogo, así que la asistencia guardada habría seguido mostrando el valor anterior.
- [x] Corregido un desajuste de hidratación detectado por React Doctor (`new Date()` leído desde JSX) y una sombra de variable entre las faenas del filtro y las del alcance.
- [x] `useOperation`, `Field` y `selectClass` extraídos a `form-kit.tsx` al aparecer el segundo consumidor.
- [x] Typecheck, ESLint y build verdes; 19 pruebas PostgreSQL de capacitación en verde; React Doctor sin hallazgos en los archivos tocados.
- [x] Reclasificado el pendiente de `required` por ítem: no es un defecto, y si la fricción molesta la solución es aplicabilidad condicional, no marcar obligatorios.

### 19 de julio de 2026 — Eliminación de la capacidad 2 (contratistas DS 76)

- [x] Establecido con el negocio que **Chome es empresa contratista**, no empresa principal: trabaja en faenas de CMPC y Biodiversa con dotación propia. Las obligaciones del DS 76 que el módulo cubría recaen en el mandante.
- [x] Se consultó antes de borrar, por tratarse de una norma legal. La eliminación procedió sólo con la confirmación del rol.
- [x] Eliminadas 8 tablas, 3 páginas, la ruta de exportación, el servicio, el motor de brechas, la validación, 34 pruebas y 7 permisos con sus concesiones y su navegación.
- [x] Desmontado el acoplamiento en permisos de trabajo: `worker_id` pasa a obligatorio, desaparecen la columna de contratista, su índice único, el check de identidad excluyente y el bloqueador `crew_access_blocked`.
- [x] `sourceType = 'contractor'` retirado del check de CAPA y del esquema de validación.
- [x] Conservado el tipo de evento `contractor_or_third_party` en incidentes: trabajando en faenas ajenas, un incidente con terceros es **más** probable, no menos, y no dependía de las tablas eliminadas.
- [x] Migración `0086_cold_revanche.sql` generada desde schema; segunda generación sin drift; journal estrictamente creciente con 87 entradas; aplicada de cero sobre PostgreSQL real y verificada (0 tablas de contratistas, `worker_id` NOT NULL, columna de contratista ausente).
- [x] **Dos defectos corregidos en la migración generada**, ambos detectados al aplicarla contra PostgreSQL real y no en la revisión del SQL:
  1. `DROP TABLE ... CASCADE` elimina la llave foránea pero **no** las filas de cuadrilla cuya única identidad era un contratista; quedaban con `worker_id` nulo y hacían fallar el `SET NOT NULL`. Se agregó un `DELETE` acotado a esas filas.
  2. Drizzle generó además un `DROP CONSTRAINT` explícito de esa misma llave, que el CASCADE ya había eliminado: abortaba la migración con «constraint does not exist». Se le agregó `IF EXISTS`.
- [x] Retiradas las variables de la suite de contratistas del gate de CI.

### 19 de julio de 2026 — Defecto preexistente: inventario de capturas desactualizado

Al correr por primera vez la **regresión completa del repositorio** (359 archivos) apareció un fallo que las pasadas anteriores no vieron porque sólo se ejecutaban pruebas dirigidas: `scripts/capture-all-routes.test.ts` exige que toda página concreta del App Router tenga destino de captura, y **ninguna de las pantallas creadas en esta sesión estaba declarada**.

- [x] Agregadas al inventario las 9 rutas faltantes: las 4 de capacitación más el detalle de sesión, permisos, inspecciones con su detalle, CPHS e higiene.
- [x] Agregada también `/admin/backups`, de la feature de respaldos en desarrollo concurrente: sin ella el gate seguía rojo. Es una línea de inventario y no toca su lógica.
- [x] Retirada `/prevencion/contratistas` del inventario junto con el módulo.
- [x] **Lección de método:** correr sólo el subconjunto dirigido dejó pasar un gate rojo durante cinco capacidades. La regresión completa pasa a ser parte del cierre de cada pasada, no del cierre del plan.

### 20 de julio de 2026 — Formularios de alta y detalle: permisos de trabajo

- [x] `PermitTypeDialog` y `NewPermitDialog` en la bandeja: alta de tipo con sus tres interruptores de exigencia, y alta de permiso con cuadrilla filtrada por faena y controles como lista dinámica.
- [x] Ruta `/prevencion/permisos/[permitId]` con ficha, banner de bloqueadores, AST/JSA editable, controles verificables, LOTO, mediciones, cuadrilla con acuse propio y panel de transiciones completo (7 estados) más extensión.
- [x] "Aprobar" no se ofrece a quien solicitó el permiso, y "Cerrar" muestra los aislamientos abiertos que lo bloquean: la UI no ofrece acciones que el servicio va a rechazar.
- [x] Corregido un defecto preexistente en `getWorkPermitDetail`: pasaba `null` como `competencyTaskKey` en vez del valor real del tipo, así que la vista de detalle nunca podía mostrar a un integrante como falto de competencia aunque la activación sí lo bloqueara correctamente.
- [x] Agregadas `listPermitWorksites`, `listPermitWorkers` y `listPermitSupervisors` al servicio, con el tipo `WorksiteScope` canónico.
- [x] `permisos/permit-form-kit.tsx` extraído desde el primer archivo que lo necesitó, mismo patrón que `capacitacion/form-kit.tsx`.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin hallazgos tras corregir el único propio (`.filter().map()` combinables); 57 pruebas de permisos y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.
- [x] Agregadas las dos rutas nuevas al inventario de capturas antes de cerrar la pasada, no después.
- [ ] **Sin probar en navegador con sesión autenticada** — la única cuenta administradora de la base de desarrollo es personal y sin credencial disponible para el agente. Verificado en su lugar que ambas rutas compilan y responden contra el servidor de desarrollo activo, sin error 500.

### 20 de julio de 2026 — Formularios de alta y ejecución: inspecciones

- [x] `/prevencion/inspecciones/catalogo` con incorporar plantilla, aprobarla y programarla por faena y frecuencia; nav actualizado con el hijo "Catálogo y programación".
- [x] Alta de inspección desde la bandeja, sólo sobre plantillas aprobadas.
- [x] Ruta `/prevencion/inspecciones/[runId]`: grilla de respuesta por sección con guardado en bloque, "Declarar ejecutada" con los bloqueadores reales de `assessRunCompletion` mostrados antes de enviar, hallazgos con derivación a CAPA, "Revisar y cerrar" con los bloqueadores de `assessRunReview`.
- [x] Corregido un defecto preexistente en `getInspectionRunDetail`: no traía nombres de asignado/ejecutor/revisor, sólo IDs.
- [x] Corregido un defecto preexistente en el inventario de capturas: la clave dinámica `/prevencion/inspecciones/[id]` no correspondía a ninguna carpeta real (`[runId]`) y nunca había sido ejercida hasta ahora.
- [x] Agregadas `listInspectionWorksites` y `listInspectionAssignees` al servicio.
- [x] Detectado y dejado sin construir a propósito: `status = 'cancelled'` existe en el schema pero ninguna Server Action lo produce. No se inventó la mutación porque quién cancela y bajo qué condición es una decisión de producto, no wiring de UI.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin hallazgos propios; 55 pruebas de inspecciones y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.
- [x] Agregadas las dos rutas nuevas al inventario de capturas antes de cerrar la pasada.
- [ ] **Sin probar en navegador con sesión autenticada**, misma razón que en permisos. Verificado que las tres rutas responden sin error 500.

### 20 de julio de 2026 — Formularios de alta y detalle: CPHS

- [x] `NewCommitteeDialog` en la bandeja: constituye comité por faena.
- [x] Tercera pestaña «Revisión por la dirección»: alta y cierre con compromisos dinámicos derivados a CAPA (faena, responsable, prioridad, plazo propios).
- [x] Ruta `/prevencion/cphs/[committeeId]`: indicadores de funcionamiento (`getCommitteeStatus`, ya existente y ahora expuesto), alta de integrante, convocatoria y cierre de acta con vista previa de quórum en vivo usando `assessQuorum` del servicio.
- [x] `getCommitteeStatus` enriquecido con nómina de integrantes y nombre de faena.
- [x] Agregadas `listCommitteeWorksites`, `listCommitteeWorkers` y `listCommitteeAssignees` al servicio.
- [x] Detectados y dejados sin construir a propósito: reemplazo/renuncia de integrante (schema lo admite, ninguna acción lo produce) y documentos electorales (tipo de entidad declarado en la base pero nunca implementado en el módulo de documentos).
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin hallazgos propios; 43 pruebas de CPHS y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.
- [x] Agregada la ruta nueva al inventario de capturas antes de cerrar la pasada.

### 20 de julio de 2026 — Formularios de alta y detalle: Higiene

- [x] Alta de agente, GES y programa de vigilancia desde el dashboard.
- [x] Ruta `/prevencion/higiene/grupos/[groupId]`: integrantes, y mediciones con vista previa de resultado en vivo usando `assessMeasurement` del servicio.
- [x] Ruta `/prevencion/higiene/programas/[programId]`: matricular grupo (deriva la nómina desde el GES) y registrar resultado por persona.
- [x] `listGroupMeasurements` extendida con integrantes y datos del agente; agregada `listProgramEnrollments`, que no existía.
- [x] Detectado y dejado sin construir a propósito: citaciones automáticas y recordatorio de controles vencidos requieren cron y campos nuevos — no es wiring de UI.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin hallazgos propios; 43 pruebas de higiene y RBAC contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.
- [x] Agregadas las dos rutas nuevas al inventario de capturas antes de cerrar la pasada.

### 20 de julio de 2026 — Deuda técnica: unificación de WorksiteScope

- [x] `prevention-indicadores.ts` importa el `WorksiteScope` canónico de `@/lib/auth/scope` en vez de declarar el suyo (`string[] | "all"`). Siete funciones internas reescritas para discriminar por `scope.mode`/`scope.ids`.
- [x] Retirado el helper `scopeToIds`, duplicado idéntico en tres archivos (`page.tsx`, `actions.ts`, `export/route.ts`) sólo para adaptar tipos; ahora pasan `resolveWorksiteScope(session)` directo.
- [x] Actualizados `actions.test.ts`, `prevention-indicators-postgres.test.ts` y `prevention-indicators-close.test.ts` a la forma canónica.
- [x] Verificado que el mismo patrón (`scopeToIds`) existe en PPA, PDTP y `prevencion/actions` — no tocado, por ser un ámbito distinto al ítem de deuda señalado.
- [x] Corregido de paso un defecto preexistente ajeno al refactor: `scripts/export-epps-xlsx.ts` (script suelto sin trackear) tenía un cast `as Buffer` que ya no compilaba; resuelto con `Buffer.from(buffer)`.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin hallazgos en los archivos tocados; 5 pruebas de indicadores contra PostgreSQL real; regresión completa de 341 archivos y 2.927 pruebas en verde.

### 20 de julio de 2026 — Capacidad 8: emergencias, contingencias y simulacros

- [x] Nueve tablas aditivas (plan, escenarios, organigrama, recursos, contactos, simulacros, participantes, historial). Migración `0093` sin drift.
- [x] Dominio puro `lib/prevention/emergency.ts` (`assessPlanReadiness`, `assessDrillCompletion`) reusado en la vista previa en vivo del cliente.
- [x] Segregación: quien crea el plan no puede aprobarlo, validado en el servicio, no restringiendo el permiso a un rol distinto.
- [x] Simulacro con resultado "requiere mejora" deriva a CAPA común (`sourceType = 'emergency'`) con responsable y plazo.
- [x] Rutas `/prevencion/emergencias` y `/prevencion/emergencias/[planId]` con alta de plan, escenarios, roles, recursos, contactos, programación y cierre de simulacro.
- [x] Corregido de paso: `CAPA_SOURCE_LABELS`/`capaSourceHref` en `lib/prevention/capa.ts` nunca se habían completado para `work_permit`, `inspection` ni `cphs` desde que esas capacidades se agregaron.
- [x] Corregido de paso: un commit ajeno concurrente había borrado por accidente el fixture `PROGRAMA DE TRABAJO PREVENTIVO SG-SST 2026.xlsx`; restaurado desde el commit anterior donde aún existía.
- [x] Agregada la entrada de `/prevencion/emergencias/[planId]` a `dynamicSamples` en `capture-all-routes.test.ts`, sin la cual el gate de inventario de capturas quedaba en rojo.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin ningún hallazgo en los archivos de esta capacidad; 8 pruebas puras y 11 escenarios en PostgreSQL real; regresión completa de 306 archivos y 2.650 pruebas en verde.

### 20 de julio de 2026 — Capacidad 9: gestión del cambio

- [x] Tres tablas aditivas (solicitud, evaluación por dimensión, historial). Migración `0094` sin drift.
- [x] Un cambio nace con las seis dimensiones de impacto pre-creadas y sin evaluar; evaluar la primera lo mueve a `under_evaluation` automáticamente.
- [x] Dominio puro `lib/prevention/change.ts` (`assessChangeReadiness`) reusado en el botón "Aprobar" del cliente.
- [x] Segregación: quien solicita el cambio no puede aprobarlo, validado en el servicio.
- [x] Una dimensión que requiere acción deriva de inmediato a CAPA común (`sourceType = 'change'`) con responsable, prioridad y plazo, en la misma transacción de la evaluación.
- [x] Rutas `/prevencion/gestion-cambio` y `/prevencion/gestion-cambio/[changeId]` con alta, evaluación por dimensión con enlace a la CAPA derivada, y aprobar/rechazar.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin ningún hallazgo en los archivos de esta capacidad; 6 pruebas puras y 11 escenarios en PostgreSQL real; regresión completa de 307 archivos y 2.656 pruebas en verde.

### 20 de julio de 2026 — Capacidad 7: EPP preventivo integrado con Bodega

- [x] Descartada la capacidad 10 (sustancias/residuos) para esta pasada: sin sustrato operacional en el código; pivote a EPP preventivo, que sí lo tiene.
- [x] Dos tablas aditivas (requisitos, historial). Migración `0095` sin drift. Mirror deliberado de `prevention_competency_requirements`/`computeCompetencyGaps` de Capacitación.
- [x] Reutiliza sin duplicar: catálogo técnico (`epp_product_families`) y entrega real con acuse/devolución (`deliveries`/`delivery_items`), ambos ya existentes.
- [x] Dominio puro `lib/prevention/epp.ts` (`computeEppCoverageGaps`): entrega sin vida útil declarada nunca vence; requisito por tarea nunca genera brecha estática.
- [x] Escalamiento idempotente a CAPA (`sourceType = 'epp'`, `sourceId = trabajador:tipoEpp`), mismo mecanismo que Capacitación.
- [x] Ruta `/prevencion/epp-preventivo` con pestañas Cobertura/Brechas (mirror de `/prevencion/capacitacion/brechas`) y Requisitos.
- [x] Typecheck, ESLint (0 avisos) y build verdes; React Doctor sin ningún hallazgo en los archivos de esta capacidad; 12 pruebas puras y 6 escenarios en PostgreSQL real; regresión completa de 308 archivos y 2.668 pruebas en verde.

---

## 7. Regla de actualización

Al cerrar cada capacidad, registrar: fecha, migración, pruebas ejecutadas, resultado, evidencia de rol × faena × endpoint, decisión de negocio o legal asociada, y pendientes con su riesgo residual.

Una capacidad está **técnicamente cerrada** cuando su flujo completo existe, no hay bypass por endpoint y las pruebas negativas pasan. Está **corregida** sólo cuando además tiene datos productivos conciliados y la aceptación del dueño del proceso.

# Simplificación de capacitación: cumplimiento por actividad, no por persona

**Base:** commit `31468093 feat: simplify prevention training workflow`, que
introdujo el modelo de ocurrencias y lo dejó conviviendo con el modelo anterior.

## Problema

El módulo de capacitación sostiene hoy dos modelos de cumplimiento en paralelo.

El **modelo por actividad** ya es la pantalla principal de
`/prevencion/capacitacion`: un catálogo anual controlado
(`prevention_training_catalog_items`) genera ocurrencias por faena y posición
del cronograma (`prevention_training_occurrences`), y cada ocurrencia se marca
`completed` o `not_completed` con evidencia adjunta
(`prevention_training_occurrence_evidence`). Son tres tablas.

El **modelo por persona** quedó en pie debajo: cursos con un ciclo de versiones
`draft → in_review → observed → approved → published → superseded`, sesiones con
instructor y evidencia de competencia del relator, asistencia individual con
nota de evaluación y acuse firmado SHA-256, competencias vigentes por trabajador
con convalidación de certificados externos, requisitos de competencia por
alcance y brechas derivadas. Son siete tablas y 1.092 líneas sólo en
`lib/services/prevention-training.ts`.

La duplicación no es inerte: el modelo por persona alimenta la habilitación de
actividades PDTP, una obligación PDTP automática, el bloqueo de activación de
permisos de trabajo, la certificación del CPHS, el dashboard de gobernanza, dos
recordatorios y el selector de fuentes de evidencia de riesgos. Mientras siga
conectado, cada cambio en capacitación obliga a razonar sobre ambos modelos.

## Objetivo

Dejar un único modelo de cumplimiento —**se hizo / no se hizo + evidencia**, a
nivel de actividad y faena— y retirar por completo el seguimiento por persona,
reemplazando cada consumidor externo antes de borrar aquello de lo que depende.

Fuera de alcance: cambiar el modelo de ocurrencias, que ya está en producción y
funciona; tocar inspecciones, campañas, planes de emergencia o tipos documentales.

## Decisiones tomadas

Cuatro decisiones del titular del módulo fijan el alcance. Se registran porque
ninguna se deduce del código:

1. **El seguimiento por persona se elimina por completo.** No se conserva un
   registro reducido de competencia vigente.
2. **Los dos bloqueos que dependían de él se eliminan con él.** Un permiso de
   trabajo pasa a activarse sin verificar la habilitación de la cuadrilla, y la
   certificación del CPHS deja de mirar cursos de sus integrantes.
3. **La habilitación PDTP pasa al ítem del catálogo anual.** Una actividad de
   capacitación queda habilitada porque el ítem existe y está activo, sin ciclo
   de aprobación previo.
4. **La obligación PDTP N°57 pasa a nacer de la ocurrencia vencida**, no de la
   brecha por persona.

Producción no tiene datos en las tablas afectadas, por lo que la migración las
dropea sin volcado previo.

### Consecuencia no evidente: el acuse individual

El trabajador sin cuenta firma hoy su capacitación por token en
`/acuse/capacitacion/<attendanceId>/<token>`, y ese flujo vive sobre
`prevention_training_attendance` (`lib/services/prevention-ack-public.ts`).
Eliminar la asistencia elimina ese canal. El acuse de AST
(`/acuse/permiso/...`) no se toca. La ODI queda como categoría documental en
`lib/services/prevention-documents/taxonomy.ts`, sin registro firmado por
persona.

Esto es coherente con la decisión 1, pero no es un efecto obvio del enunciado
"simplificar los cursos", y por eso se deja escrito.

## Enfoques considerados

### A. Por capas, de afuera hacia adentro — elegido

Cuatro pasos, cada uno compilando y con tests verdes antes del siguiente:
reemplazar consumidores, borrar pantallas, borrar servicios, migrar esquema.

El riesgo real de este trabajo no es que el repo deje de compilar —eso lo guía
el compilador— sino que un reemplazo quede devolviendo un vacío que nadie nota:
`resolveCrewEligibility` puede terminar declarando elegible a toda la cuadrilla
sin que ningún test falle, porque los tests que lo cubren se borran en el mismo
commit. Reemplazar primero, con el modelo viejo todavía en pie, permite afirmar
en un test que el instrumento nuevo habilita exactamente las mismas actividades
que habilitaba el viejo.

### B. Big-bang

Un commit que borra todo y arregla lo que el compilador señale. Más rápido si
sale bien, y ciego exactamente donde importa: la lógica que desaparece en
silencio no produce error de tipos.

### C. Deprecar sin borrar

Sacar del nav y dejar el código muerto. Descartado: es el estado actual —el
catálogo ya estuvo huérfano una vez y hubo que reactivarlo con una página
dedicada— y no entrega la simplificación.

## Modelo objetivo

Sobreviven las tres tablas del modelo de ocurrencias, sin cambios.

Se eliminan seis tablas de `db/schema/prevention/training.ts`:
`prevention_training_courses`, `prevention_training_course_versions`,
`prevention_training_sessions`, `prevention_training_attendance`,
`prevention_worker_competencies` y `prevention_competency_requirements`.

**Corrección durante la implementación (2026-09-19):** este diseño decía siete
e incluía `prevention_training_history`. Esa tabla es la bitácora de cambios de
estado de una **ocurrencia** —la escribe `recordTrainingOccurrenceStatus` y es
el único registro que queda de un estado anterior, porque la ocurrencia se
actualiza en sitio—. Vivía en `training.ts` por vecindad, no por pertenencia.
Se conserva y se mudó a `training-occurrences.ts`.

Se elimina además la columna `competency_task_key` de
`prevention_permit_types`, que queda sin ningún lector.

De los nueve permisos `prevention:training:*` sobreviven tres: `view`, `record`
y `export`. Se retiran `manage`, `approve`, `deliver`, `ack`, `convalidate` y
`revoke`, del manifiesto y de los roles que los llevan.

## Paso 1 — Reemplazo de consumidores

Ningún borrado ocurre en este paso.

### Habilitación PDTP

`lib/services/pdtp/instruments.ts` sustituye el `kind: "training_course"` por
`kind: "training_catalog_item"`, leyendo `prevention_training_catalog_items`,
que ya lleva `pdtpActivityNumbers`. Un ítem es `usable` cuando `isActive` es
verdadero y su `catalogVersion` es `PREDEFINED_TRAINING_CATALOG_VERSION`
(`lib/prevention/training-occurrences-catalog.ts`), que es la constante única
que hoy identifica el catálogo controlado vigente.

Desaparecen los tres blockers de versión (`course_has_no_version`,
`course_version_not_published`, `course_version_below_minimum_duration`) y el
ranking `VERSION_PROGRESS` que elegía qué versión mostrar. Queda un blocker:
`catalog_item_inactive`.

`lib/services/pdtp/instrument-gap.ts` ajusta el tipo `PdtpCoverageInstrument` y
el mensaje correspondiente. La disyunción entre instrumentos no cambia.

### Enlace de resolución

`trainingCourseLink` en `lib/prevention/pdtp-readiness-links.ts` pasa a apuntar
a `/prevencion/capacitacion?year=YYYY`.

**Sin parámetro `q`.** El destino, `training-occurrence-list.tsx`, sólo lee
`faena` y `year`; el test de ese archivo existe precisamente para impedir un
enlace que llegue a la pantalla correcta y no haga nada.

### Obligación PDTP N°57

`lib/services/pdtp-adapters/competency-gap-connector.ts` pasa a
`occurrence-gap-connector.ts`.

El sujeto de la obligación deja de ser `worker:<id>:curso:<id>` y pasa a ser la
ocurrencia. El hecho gatillante deja de ser la brecha de competencia y pasa a
ser: venció la posición del cronograma y la ocurrencia sigue `pending`, o quedó
marcada `not_completed`. La obligación cierra cuando la ocurrencia pasa a
`completed`.

El conector conserva su propiedad actual de no escribir el número 57 en ninguna
parte: resuelve qué ítems del catálogo acreditan una actividad `on_demand`
medida por plazo, vía `pdtpActivityNumbers`.

### Permisos de trabajo

`lib/services/prevention-permits.ts` pierde la rama de competencia de
`resolveCrewEligibility` y el motivo bloqueante asociado. La función conserva
sus otros criterios de elegibilidad y su forma de retorno; sólo deja de
reportar el motivo de competencia faltante. La UI que lo muestra se ajusta en
consecuencia.

### CPHS

`lib/services/prevention-cphs-certification.ts` pierde la verificación de curso
vigente por integrante y el criterio que esa verificación aportaba a la madurez
de certificación. El resto de los criterios no cambia.

### CAPA, dashboard y recordatorios

`lib/prevention/capa.ts` apunta las CAPA de origen `training` a
`/prevencion/capacitacion` en vez de a la ficha de competencias del trabajador.

`app/(app)/dashboard/sections/governance-section.tsx` retira la tarjeta
"brechas bloqueantes".

`lib/services/prevention-training-reminders.ts` queda sin razón de existir: sus
dos recordatorios son competencia por vencer y brecha de competencia, y ambos
desaparecen con el modelo. En este paso se desengancha de quien lo invoca; el
archivo se borra en el paso 3.

### Fuentes de evidencia de riesgo

`lib/services/prevention-risk-legal.ts` cambia `trainingSources` de códigos de
sesión a ocurrencias.

Es el único frente donde la simplificación agrega capacidad en vez de quitarla:
la ocurrencia tiene evidencia adjunta y la sesión no la tenía.

### Documentos

`lib/services/prevention-documents/links.ts` retira el vínculo
documento → sesión de capacitación y su resolución de faena.

## Pasos 2 y 3 — Borrado de superficie

**Pantallas.** `app/(app)/prevencion/capacitacion/`: `catalogo/`,
`competencias/`, `brechas/`, `[sessionId]/` y `training-session-list.tsx` —este
último ya está huérfano: ningún archivo lo monta.

**Navegación.** El hijo "Catálogo de cursos" en `modules/prevention/manifest.ts`
y la entrada `/prevencion/capacitacion/catalogo` de `ROUTES_WITH_OWN_SEARCH` en
`components/layout/top-bar.tsx`.

**Acuse público.** La rama `kind === "capacitacion"` de
`app/(public)/acuse/[kind]/[targetId]/[token]/page.tsx`, su acción y
`getTrainingAckPublicView`. La ruta queda sirviendo sólo `permiso`.

**Servicios y validación.** `lib/services/prevention-training.ts`,
`prevention-training-gaps.ts`, `prevention-training-reminders.ts`,
`lib/prevention/training.ts`, `lib/validation/prevention-module/training.ts`, y
la porción legacy de `prevention-training-export.ts` y de
`app/(app)/prevencion/capacitacion/actions.ts`.

**Scripts.** `seed-pdtp-2026-course-versions.ts`,
`reclassify-pdtp-2026-specific-courses.ts`,
`seed-prevention-cphs-orientation-course.ts` y `seed-demo-gaps.ts` se eliminan.
`apply-pdtp-2026-program-data.ts`, `preflight-pdtp-accreditation-wiring.ts`,
`backfill-pdtp-catalog-activities.ts` y `capture-all-routes.ts` se ajustan.

`db/seed.ts` pierde la siembra del modelo por persona.

## Paso 4 — Migración

Una migración Drizzle: `DROP TABLE IF EXISTS ... CASCADE` de las seis tablas y
`DROP COLUMN IF EXISTS` de `prevention_permit_types.competency_task_key`.

`IF EXISTS` no es opcional: el verificador de la cadena de migraciones
(`npm run db:verify-migrations`) rechaza un DROP sin guardia, porque una
migración que dropea algo ya ausente aborta el deploy entero y no se puede
re-aplicar.

Sin volcado previo: producción no tiene datos en estas tablas.

`db/schema/prevention/training.ts` se elimina y sale de
`db/schema/prevention/index.ts`.

## Verificación

**Se eliminan** los tests del modelo retirado:
`prevention-training-postgres.test.ts`, `prevention-training-calc.test.ts`,
`prevention-acuse-sin-cuenta.test.ts`,
`pdtp-competency-gap-obligation.test.ts`.

**Se reescriben, no se borran**, los tres que cubren el reemplazo:
`pdtp-coverage-instrument-identity.test.ts`, `pdtp-fulfillment.test.ts`,
`pdtp-lifecycle-instrument-gate.test.ts`. Durante el paso 1, mientras ambos
modelos coexisten, se agrega una aserción de equivalencia: el índice de
instrumentos construido desde ítems de catálogo habilita el mismo conjunto de
números de actividad que el construido desde cursos con versión publicada. Esa
aserción se retira junto con el modelo viejo en el paso 4.

`prevention-permits-postgres.test.ts` pierde sus casos de competencia y
conserva el resto. `prevention-rbac.test.ts` se ajusta a los tres permisos
sobrevivientes.

**E2E.** `pdtp-habilitacion.spec.ts` apunta al nuevo destino de resolución.
`prevencion-odi-capacitacion.spec.ts` pierde la aserción de compatibilidad del
marcador de catálogo. `prevencion-cphs-*.spec.ts` se revisan por el criterio de
certificación retirado.

**Criterio de término.** `npm run typecheck`, la suite unitaria y los E2E de
prevención y PDTP en verde, y ninguna referencia restante a los siete símbolos
de tabla eliminados fuera del historial de git.

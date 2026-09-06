# Plan de remediación — las 5 actividades segregadas y la firma de la JDPR

## Contexto

La implementación del 2026-09-05 dejó el programa en **76 `ok` / 5 `segregada` / 0 `solo_manual`**. Las
cinco que quedan —**N°35** (publicar la MIPER), **N°43** (publicar el procedimiento), **N°77** (cerrar el
incidente), **N°80** (publicar la matriz GRD) y **N°83** (aprobar el plan de emergencia)— no son brechas:
en todas el responsable hace el trabajo y otro firma, que es lo que vuelve la evidencia oponible.

El problema no es el diseño, es que **la firma no llega**. Hoy: los 7 planes de emergencia siguen en
`draft` —y arrastran la N°84, porque sin plan aprobado no se programa un simulacro—, hay **cero matrices
MIPER y cero GRD**, y nada avisa. El modo de falla de este grupo es silencioso por construcción: el
responsable cumple su parte y la actividad queda esperando a alguien que no sabe que le toca.

Los cuatro actos que faltan los tienen hoy sólo `jefa_chome` (2 usuarios) y `administrador`. **La Jefa
del Departamento de Prevención de Riesgos —el rol `prevencionista`— no está entre los firmantes**, que
es exactamente al revés de lo que el cargo supone.

**Resultado buscado:** que la firma exista, que llegue a tiempo y que quede rastro de quién la dio.

### Decisiones tomadas (usuario, 2026-09-05)

1. La JDPR firma **los cuatro** actos: publicar MIPER, aprobar y publicar documentos SST, publicar la
   matriz GRD, y cerrar incidentes.
2. **Es firmante, no responsable declarada.** No se toca `responsible_slugs`: cambiar el contenido del
   programa obligaría a reaprobarlo.
3. Se agrega el control **publicar ≠ aprobar** en MIPER, GRD y documentación, **con la JDPR exenta**:
   puede aprobar y publicar su propio trabajo por ser la autoridad técnica del área. El Programa de
   Prevención queda fuera de la exención —y ya lo está: su paso JDPR exige `not_elaborator`
   ([approval-flow.ts:29](lib/services/pdtp/approval-flow.ts#L29)).
4. Se agrega **quien cierra ≠ quien completó la investigación** en el RE-20, con la misma exención.
5. Las exenciones se expresan con **un permiso propio**, no con el nombre del rol.
6. Entran además: el administrador de contrato en la N°43 y la N°80, los planes y matrices vacíos, y una
   alerta cuando la firma no llega.

---

## Lo que la exploración cambió respecto del encargo

Tres hallazgos que hay que leer antes de las tareas, porque dos de ellos convierten un cambio aparente
de una línea en algo que puede empeorar la evidencia.

**El grant solo no es seguro.** `prevencionista` es hoy un rol **autor**: tiene `docs:manage`,
`risk:edit` y `cgrd:matrix:edit` — que `jefa_chome` **no** tiene. Y **publicar no tiene control de actor
en ninguno de los tres servicios**: `publishDocumentVersion`
([workflow.ts:241](lib/services/prevention-documents/workflow.ts#L241)) sólo comprueba estado, y
`transitionRiskMatrix` / `transitionGrdMatrix` sólo segregan el paso de *aprobar*. Hoy la persona que
publica no puede ser la autora **porque el rol autor no tiene el permiso de publicar** — esa es toda la
garantía. El grant la disuelve. De ahí que el control de actor (Tarea 2) tenga que ir **antes** que el
grant (Tarea 3), no después.

**El cierre de incidentes no tiene ningún control de actor.** `assertIncidentTransition`
([prevention-incidents.ts:1075](lib/services/prevention-incidents.ts#L1075)) exige cuatro compuertas
—investigación completa, CAPA cerradas, carriles resueltos, evidencia adjunta— y ninguna mira quién
firma. `prevencionista` ya tiene `incidents:investigate`, así que sin la Tarea 2 el grant permite que
quien investigó cierre su propio caso sin dejarlo dicho.

**Ocho crons de Prevención existen y no están agendados en ninguna parte.** `pdtp-weekly-reminders`,
`prevention-capa-reminders`, `prevention-cphs-alerts`, `prevention-incident-reminders`,
`prevention-training-reminders`, `prevention-document-ack-reminders`, `sst-weekly-alerts` y
`pdtp-evidence-gc` no aparecen en `scripts/cron-runner.mjs`, ni en el crontab de
`docker-compose.yml`, ni en los workflows de `.github/workflows/`. **Toda la maquinaria de
recordatorios está escrita y nunca corre.** Una alerta nueva hereda el problema, así que agendarlos es
parte de la tarea, no un extra.

---

## Restricciones globales

- Los grants viven en `defaultGrants` de los manifests. `ensureSystemRbac`
  ([bootstrap.ts:61](lib/auth/bootstrap.ts#L61)) borra y reconstruye los grants de los 15 roles del
  sistema, y el deploy lo corre solo: lo que se otorgue desde `/admin/roles` se pierde.
- `administrador` recibe **todos** los permisos automáticamente
  ([system-rbac.ts:70](lib/auth/system-rbac.ts#L70)), incluida la exención nueva. No hay que declararlo.
- Un permiso nuevo exige tres lugares del manifest (`permissions`, `permissionMeta` con id corto único,
  `defaultGrants`) más la lista `expected` de
  [prevention-rbac.test.ts:6-108](lib/__tests__/prevention-rbac.test.ts#L6).
- **No se toca `pdtp_activities`**: la JDPR entra como firmante, no como responsable.

---

## Fase 1 · Que la firma exista y sea trazable

### Tarea 1 · El permiso de excepción

**Archivos:** `modules/prevention/manifest.ts` · `lib/__tests__/prevention-rbac.test.ts`

- [ ] Declarar `prevention:sign_own_work` (id corto `p-prev-sign-own`), con una descripción que diga qué
      exime y por qué: *"Aprobar, publicar o cerrar un registro en cuyas etapas previas la persona ya
      participó. Reservado a la jefatura técnica del área."*
- [ ] Grant único: `prevencionista`. (`administrador` lo recibe solo.)
- [ ] Agregarlo a la lista `expected` del test de catálogo.
- [ ] Test de invariante: **nadie más lo tiene**.
      `expect(rolesFor("prevention:sign_own_work")).toEqual(["administrador", "prevencionista"])`.
      Es la excepción a la regla de segregación de todo el módulo; si un día se ensancha, que sea a
      propósito.

### Tarea 2 · Control por actor en las tres publicaciones y en el cierre

**Archivos:** `lib/services/prevention-risk-legal.ts` · `lib/services/prevention-cgrd.ts` ·
`lib/services/prevention-documents/workflow.ts` · `lib/services/prevention-incidents.ts`

El patrón ya existe tres veces en el repo —`if (data.toStatus === "approved" && (matrix.createdByUserId
=== access.userId || matrix.reviewedByUserId === access.userId)) throw` — y se replica una etapa más
abajo. **Va antes que la Tarea 3.**

- [ ] **Paso 1.** Tests que fallan, uno por flujo: quien aprobó no puede publicar; y en el RE-20, quien
      completó la investigación no puede cerrar. Más el caso complementario: **con
      `prevention:sign_own_work` sí puede**, en los cuatro.
- [ ] **Paso 2 · MIPER.** En `transitionRiskMatrix`
      ([:493](lib/services/prevention-risk-legal.ts#L493)), junto al chequeo de `approved`:
      `published` exige `matrix.approvedByUserId !== access.userId`, salvo exención.
- [ ] **Paso 3 · GRD.** Lo mismo en `transitionGrdMatrix`
      ([prevention-cgrd.ts:481](lib/services/prevention-cgrd.ts#L481)).
- [ ] **Paso 4 · Documentación.** `publishDocumentVersion`
      ([workflow.ts:241](lib/services/prevention-documents/workflow.ts#L241)) no pasa por
      `transitionVersion`, así que el chequeo va explícito: `version.approvedBy !== ctx.userId`, salvo
      exención. Reusar el vocabulario de `transitionVersion` (`preventUploader`, `preventReviewer`) en
      el mensaje de error, para que los tres flujos hablen igual.
- [ ] **Paso 5 · Incidentes.** En `assertIncidentTransition`
      ([:1075](lib/services/prevention-incidents.ts#L1075)), quinta compuerta de `closed`: el actor no
      puede ser `prevention_incident_investigations.completed_by_user_id`, salvo exención. El campo ya
      existe ([incidents.ts:204](db/schema/prevention/incidents.ts#L204)); hay que pasarlo a
      `assertIncidentTransition`, que hoy recibe `investigationCompleted: boolean`.
- [ ] **Paso 6.** El mensaje de error nombra la salida: *"Quien aprobó la versión no puede publicarla:
      debe firmarla otra persona"*. Un 403 mudo manda a la gente a pedir permisos que no necesita.

**Por qué basta `publicar ≠ aprobar` y no hace falta además `publicar ≠ autor`:** de los roles **no**
exentos, el único que tendrá `publish` es `jefa_chome`, y no tiene `docs:manage`, `risk:edit` ni
`cgrd:matrix:edit`. La cadena autor→publicador ya es imposible por reparto de roles para quien no está
exento. Dejarlo escrito en el código evita que alguien "complete" la regla más adelante sin entender por
qué estaba así.

### Tarea 3 · La JDPR entra al conjunto de firmantes

**Archivos:** `modules/prevention/manifest.ts` · `lib/__tests__/prevention-rbac.test.ts`

- [ ] Grants a `prevencionista`: `risk:approve`, `risk:publish`, `docs:approve`, `docs:publish`,
      `cgrd:matrix:approve`, `cgrd:matrix:publish`, `incidents:close`.
- [ ] **Tests con lista cerrada que hay que actualizar** —los tres fallan si no:
      `cgrd:matrix:approve` ([:259](lib/__tests__/prevention-rbac.test.ts#L259)), su par acoplado
      `cgrd:matrix:publish` ([:262](lib/__tests__/prevention-rbac.test.ts#L262)), y `docs:approve` /
      `docs:publish` ([:276](lib/__tests__/prevention-rbac.test.ts#L276)).
      `risk:approve`, `risk:publish` e `incidents:close` **no** tienen lista cerrada: pasarían en verde
      y en silencio, que es justamente por lo que conviene agregarles una ahora.
- [ ] **Reescribir el comentario de [:255-258](lib/__tests__/prevention-rbac.test.ts#L255)**, que hoy
      dice *"quien edita la matriz no debe tener, por defecto, el mismo permiso de aprobación o
      publicación"*. Con este cambio la JDPR tiene `edit`, `review`, `approve` y `publish` a la vez, y
      la aserción (`not.toEqual` entre dos arreglos) **sigue pasando sin proteger nada**. La garantía se
      mudó al control por actor de la Tarea 2: el comentario debe decir eso, o el test miente sobre lo
      que cuida.

**Dos efectos laterales que hay que dejar escritos, no descubrir:**

- `incidents:close` es el **canal de escalamiento** de carriles DT/SEREMI vencidos y de eventos fatales
  ([prevention-incident-reminders.ts:98](lib/services/prevention-incident-reminders.ts#L98)). La JDPR
  empieza a recibir esas alertas. Es deseable, y nadie lo dedujo del nombre del permiso.
- `docs:publish` además habilita el export de integridad documental, la regularización masiva y la
  reubicación de documentos (`app/api/prevencion/documentacion/...`).

### Tarea 4 · Que el contrato siga diciendo la verdad

**Archivos:** `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` ·
`lib/services/pdtp/responsible-execution.test.ts`

Los textos `segregated:` son evidencia oponible. Dos quedan desactualizados: el de la **N°77** dice
*"cerrar el incidente es de jefatura"* —ahora también de la jefatura de Prevención— y el de la **N°80**
describe el reparto de firmas que la Tarea 2 cambia.

- [ ] Actualizar los dos textos. Los de la N°35, N°43 y N°83 siguen siendo ciertos: hablan de que el
      **responsable declarado** (el prevencionista de faena) no firma, y eso no cambia.
- [ ] **El conteo no se mueve, y es lo correcto.** La JDPR no es responsable declarada de ninguna de las
      cinco, así que siguen clasificadas `segregada` y el preflight sigue diciendo **76 / 5 / 0**. Lo
      que cambia es operativo: pasa a haber tres roles capaces de firmar en vez de dos.
- [ ] **Test de regresión sobre el conteo real.** `classifyPdtpResponsibleExecution` evalúa `ok` antes
      que `segregada` ([responsible-execution.ts:134](lib/services/pdtp/responsible-execution.ts#L134)),
      así que un grant futuro a un rol que **sí** sea responsable haría saltar una actividad de
      `segregada` a `ok` sin que nadie borre su `segregated:`. Fijar que las cinco siguen siendo cinco.

### Tarea 5 · El administrador de contrato en la N°43 y la N°80

**Archivos:** `modules/prevention/manifest.ts`

Figura como corresponsable de las dos y no puede hacer **ni el paso de autoría**: le quedan `docs:view`
y `cgrd:view`. O le falta el permiso, o la planilla lo declara de más — y como la planilla está firmada,
lo que se corrige es el permiso.

- [ ] `prevention:docs:manage` y `prevention:docs:submit_review` (N°43: redactar el procedimiento y
      enviarlo a revisión). Publicar **sigue segregado** para él.
- [ ] `prevention:cgrd:matrix:edit` (N°80: crear la versión de la matriz y sus amenazas).
- [ ] Verificar que ninguno de los cuatro tiene lista cerrada en `prevention-rbac.test.ts`; si la tiene,
      actualizarla en el mismo commit.

---

## Fase 2 · Que la falta de firma se note

### Tarea 6 · Agendar los ocho crons huérfanos

**Archivos:** `scripts/cron-runner.mjs` · `docker-compose.yml` · o `.github/workflows/`

Va **antes** que la alerta: sin esto la alerta se escribe y no corre nunca, que es el estado actual de
otros siete recordatorios.

- [ ] Decidir el scheduler. Hay dos en uso: el `JOBS` congelado de
      [cron-runner.mjs:15](scripts/cron-runner.mjs#L15) (busybox `crond` del servicio `cron` en
      `docker-compose.yml`, 13 jobs) y workflows de GitHub Actions que hacen `curl` con
      `Authorization: Bearer $CRON_SECRET` (`prevention-inspection-programs.yml` es el modelo más
      cercano). **Recomiendo `cron-runner.mjs`**: los ocho son de Prevención y ya hay allí una lista
      única con su horario en `America/Santiago`.
- [ ] Agendar los ocho, escalonados, fuera del horario de los jobs de combustible (05:00–05:45) y de
      DTE (07:00).
- [ ] `withCronLock` ([cron-lock.ts:29](lib/services/cron-lock.ts#L29)) ya evita corridas solapadas: no
      hay que inventar nada.

### Tarea 7 · La alerta de firma pendiente

**Archivos:** `lib/services/pdtp/reminders.ts` · `app/api/cron/pdtp-weekly-reminders/route.ts` ·
`lib/services/pdtp/reminders-firma-pendiente.test.ts`

Se cuelga del route que ya encadena tres jobs bajo un solo lock, en vez de crear un endpoint nuevo que
habría que agendar aparte.

- [ ] **Paso 1.** `runPdtpSignaturePendingReminders(asOf = new Date())`, con la anatomía de
      `runPdtpObligationReminders` ([reminders.ts:222](lib/services/pdtp/reminders.ts#L222)):
      proyección explícita de columnas, tope por corrida, `todayInChile()` para el día civil, y
      resolución de destinatarios **pre-agrupada por faena** para evitar el N+1 — el patrón de
      [prevention-capa-reminders.ts:59](lib/services/prevention-capa-reminders.ts#L59).
- [ ] **Paso 2 · Qué se considera "esperando firma".** Cuatro consultas, una por entidad, según la tabla
      de abajo. El permiso de destino sale del estado, igual que `MATRIX_PERMISSION`
      ([prevention-risk-legal.ts:389](lib/services/prevention-risk-legal.ts#L389)) — no se duplica el
      mapa, se importa.

| Entidad | Condición | Se avisa a |
|---|---|---|
| `prevention_emergency_plans` | `status = 'draft'` | `prevention:emergency:approve` |
| `prevention_risk_matrices` | `status IN ('in_review','reviewed','approved')` | el permiso del paso siguiente |
| `prevention_grd_matrices` | idem | idem |
| `sst_document_versions` | `status IN ('en_revision','aprobado')` | idem |
- [ ] **Paso 3 · Desde cuándo.** Ninguna de las cuatro tablas tiene `awaiting_signature_since`. Se usa
      `updated_at`, que **mide "sin movimiento en este estado", no "desde que se pidió la firma"** — y
      hay que escribirlo así en el docblock, porque para los planes de emergencia es especialmente
      débil: no existe un estado `in_review`, el plan nace `draft` y salta a `approved`. Es suficiente
      para avisar y no exige migración. La fuente exacta —`prevention_risk_legal_history`,
      `sst_document_audit`, `prevention_emergency_history`— queda anotada como refinamiento.
- [ ] **Paso 4 · Dedupe.** Clave con la ventana adentro, como
      `cphs-mandate:${id}:${end}:${threshold}` ([prevention-cphs-reminders.ts:145](lib/services/prevention-cphs-reminders.ts#L145)):
      `pdtp-firma-pendiente:${entityType}:${entityId}:${status}:${bucket}` con `bucket ∈ {7d, 15d, 30d}`.
      Tres avisos escalonados, no uno diario. Cambiar de estado produce clave nueva, que es lo correcto:
      volvió a moverse.
- [ ] **Paso 5.** Encadenar en el route y sumar sus contadores al JSON, como los otros tres.
- [ ] **Paso 6.** Tests con el molde de
      [reminders-obligations.test.ts](lib/services/pdtp/reminders-obligations.test.ts) —mockear `@/db`,
      `notifications` y correr dos veces— más un caso por bucket.

---

## Fase 3 · Operativo (no es código)

Lo que desbloquea las cinco. Ninguna de estas la hace la plataforma.

- [ ] **1.** Aprobar los **7 planes de emergencia** en `draft`. Desbloquea la N°83 **y la N°84**, que
      está esperando detrás: `scheduleEmergencyDrill`
      ([prevention-emergency.ts:539](lib/services/prevention-emergency.ts#L539)) exige plan aprobado.
      Ya lo puede hacer `prevencionista`: `emergency:approve` no le faltaba.
- [ ] **2.** Crear y publicar la **primera versión de la MIPER** por faena (N°35). Hoy hay **cero**
      matrices: no hay ni qué publicar.
- [ ] **3.** Crear y publicar la **primera matriz GRD** por faena (N°80). Mismo caso: cero filas.
- [ ] **4.** Publicar el primer **procedimiento de trabajo seguro** (N°43).
- [ ] **5.** Verificar que las personas de `prevencionista` y `jefa_chome` tengan **faenas asignadas**
      donde corresponda. Los dos son `isGlobal: true`, así que su alcance es todo — pero conviene
      confirmarlo antes de contar con ellas como firmantes de faena.

---

## Verificación

**Por tarea:**

```bash
npm run typecheck && npm run lint
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/prevention-rbac.test.ts
npx vitest run --config vitest.pglite.config.ts lib/__tests__/prevention-cgrd.test.ts \
  lib/__tests__/prevention-incidents-re20.test.ts lib/__tests__/prevention-documents-persistence.test.ts
```

**Suites completas** (línea base actual: **6.553 en verde**, 5.302 non-pglite + 1.251 pglite):

```bash
npx vitest run --config vitest.non-pglite.config.ts
npx vitest run --config vitest.pglite.config.ts        # ~9 min
```

Tests que este plan rompe **a propósito** y hay que actualizar en el mismo commit:
`prevention-rbac.test.ts` (tres listas `toEqual`, la lista `expected`, y el comentario de
[:255](lib/__tests__/prevention-rbac.test.ts#L255)).

**El conteo, que no debe moverse:**

```bash
npm run db:sync-rbac
npx tsx --env-file=.env.local scripts/preflight-pdtp-accreditation-wiring.ts
```

Debe seguir reportando **76 `ok` / 5 `segregada` / 0 `solo_manual`**. Si el número sube, algo clasificó
como `ok` una actividad cuyo `segregated:` sigue en pie — es el fallo que la Tarea 4 viene a fijar.

**End to end, con dos cuentas** (es la única forma de probar una regla de dos personas):

1. Con `prevencionista_faena`: crear una versión de la MIPER y enviarla a revisión.
2. Con `jefa_chome`: revisarla y aprobarla. **Intentar publicarla → debe rechazar** ("quien aprobó no
   puede publicarla").
3. Con `prevencionista` (JDPR): publicarla. Debe permitir.
4. Con `prevencionista`: crear otra versión, aprobarla y publicarla ella misma. **Debe permitir** — es
   la exención, y es el caso que hay que ver funcionando para saber que el permiso quedó bien otorgado.
5. Con `prevencionista_faena`: intentar lo mismo → debe rechazar.

**La alerta:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" localhost:3001/api/cron/pdtp-weekly-reminders
```

Con los 7 planes en `draft` y más de 7 días de antigüedad, debe crear notificaciones para quienes tengan
`prevention:emergency:approve`. Correrlo dos veces seguidas **no** debe duplicarlas.

**E2E existentes** que cubren estos caminos: `e2e/prevencion-miper-matriz.spec.ts`,
`e2e/prevencion-incidentes-re20.spec.ts`, `e2e/prevencion-emergencias-simulacros.spec.ts`,
`e2e/prevencion-documentacion.spec.ts`.

---

## Fuera de alcance, anotado

- **Requisitos legales.** `approved` y `published` comparten el **mismo** permiso
  (`legal:approve_applicability`, [prevention-risk-legal.ts:829](lib/services/prevention-risk-legal.ts#L829)),
  así que ahí no hay dos pasos que segregar: es peor que los tres flujos que este plan arregla. La
  decisión fue "los tres", y esto queda dicho para que no parezca un olvido.
- **Una rama "esperando tu firma" en `/pendientes`.** Sería complementaria a la alerta y **no depende
  del cron** —es una proyección SQL sin estado nuevo—, así que es más confiable que la notificación. Se
  deja fuera porque exige agregar tablas al contrato de columnas del `UNION ALL`. Buen siguiente paso.
- **Columna `awaiting_signature_since`.** Haría honesta la métrica de "lleva N días esperando" en vez de
  "N días sin moverse". Exige migración y tocar cada transición.

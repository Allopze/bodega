# Plan de remediación y mejora — ejecución y acreditación del Programa de Trabajo Preventivo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Al ejecutar, copiar este archivo a `docs/superpowers/plans/2026-09-06-prevencion-remediacion-submodulos.md` en el primer commit, que es la ubicación canónica del repositorio.

## Contexto

La auditoría del 6 de septiembre ([AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md](AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md))
respondió si cada actividad del programa preventivo puede ejecutarse y generar cumplimiento desde un
submódulo. De las **81 actividades activas** de `pdtp-2026-v1`, hoy **ninguna** puede acreditar porque el
programa sigue en `draft`. Suponiendo que se active, sólo **27** quedan completas de punta a punta.

El resto no falla por falta de submódulos: los submódulos existen y 40 de 45 conectores llegan a una
pantalla. Falla por cuatro cosas distintas, y el plan las separa porque se arreglan en momentos distintos:

1. **Cuatro defectos que dejan cumplimiento fantasma o invisible.** La N°62 nunca acredita porque su
   conector cuelga de un servicio sin llamador. La cola de pendientes y Constancias muestran deudas de
   meses que el registro de ejecución rechaza, así que no se pueden pagar nunca. La N°1 se acredita antes
   de que exista programa activo y su evento queda en `error` sin que nada lo reconcilie ni lo muestre.
   La N°9 se cierra con un permiso que ningún responsable tiene y la compuerta no lo verifica.
2. **Compuertas que mienten.** La compuerta de cobertura es ciega al estado del instrumento: da por
   cableada una actividad cuya plantilla está en borrador, cuyo curso no tiene versión publicable o cuyo
   plan de emergencia no está aprobado. Y no descuenta exclusiones por faena, así que exigirá plan de
   emergencia en faenas donde la actividad no aplica.
3. **El calendario firmado contra la decisión D01.** 22 actividades tienen todo su calendario 2026 antes
   de septiembre. Activar "desde el mes en curso" las deja sin nada que cumplir ni medir este año, lo que
   vuelve inertes seis conectores completos que funcionan perfecto.
4. **Configuración que corta la ejecución.** 13 plantillas de inspección en borrador, 13 cursos con cero
   versiones, 7 planes de emergencia en borrador, y las 81 actividades exigibles en Oficina Central y en
   faenas de 3 y 4 personas.

**Resultado buscado:** que el programa se pueda activar sin perder hechos ni prometer trabajo sin dónde
realizarlo, que las compuertas bloqueen exactamente lo que corresponde, y que ninguna actividad quede
acreditando en silencio o pidiendo lo imposible.

**Goal:** cerrar los cuatro defectos de acreditación, volver honestas las dos compuertas, reprogramar el
calendario vencido y dejar el programa listo para activar con las 81 actividades ejecutables.

**Architecture:** todo el trabajo de código entra por tres capas ya existentes y ninguna se duplica. El
libro durable de eventos (`lib/services/pdtp/fulfillment.ts`) sigue siendo el único lugar que envuelve al
motor de acreditación; se le agrega un estado de compuerta y se corrige su reconciliador. El contrato
anual (`lib/services/pdtp-adapters/fulfillment-contract-2026.ts`) sigue siendo el único mapa
actividad → módulo. Los conectores siguen siendo llamadas post-commit desde el servicio de dominio,
mirando el patrón de `cancelTrainingSession`. El trabajo de datos va en scripts idempotentes de la familia
`scripts/apply-pdtp-*.ts`, con dry-run y modo deploy, registrados en la paridad dev/producción.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM sobre PostgreSQL 18, vitest con dos
proyectos (`vitest.non-pglite.config.ts` y `vitest.pglite.config.ts` con PGlite en memoria), Zod,
`tsx` para scripts.

**Spec:** [AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md](AUDITORIA_PREVENCION_EJECUCION_SUBMODULOS_2026-09-06.md),
que a su vez continúa [AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md](AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md)
y [AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md](AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md).

---

## Global Constraints

- **Los grants RBAC viven en `defaultGrants` de `modules/*/manifest.ts`, nunca en migraciones ni en
  `/admin/roles`.** `ensureSystemRbac` ([lib/auth/bootstrap.ts:61](lib/auth/bootstrap.ts#L61)) borra y
  reconstruye `role_permissions` de los roles del sistema, y el deploy corre `sync-rbac`
  ([scripts/deploy-prod.sh:417](scripts/deploy-prod.sh#L417)).
- **`lib/__tests__/prevention-rbac.test.ts` tiene listas cerradas `toEqual`.** Las dos que este plan toca
  son `prevention:training:approve` ([:387](lib/__tests__/prevention-rbac.test.ts#L387)) y
  `prevention:governance:review` ([:477](lib/__tests__/prevention-rbac.test.ts#L477), con dos
  `not.toContain` que **no** se tocan). Se actualizan en el mismo commit que el grant.
- **El contenido firmado sólo es editable en `draft`.** `assertPdtpProgramEditableState`
  ([lib/services/pdtp/helpers.ts:60](lib/services/pdtp/helpers.ts#L60)) bloquea calendario base,
  exclusiones, metas por faena, responsables por faena y membresía de faenas en cuanto el programa entra a
  revisión. **Toda la Fase 1 es irreversiblemente draft-only.**
- Lo que **no** es contenido firmado y puede hacerse después de enviar a revisión: aprobar plantillas de
  inspección, publicar versiones de curso, aprobar planes de emergencia.
  `computePdtpProgramContentDigest` sólo lee tablas `pdtp_*`, así que nada de eso invalida las firmas.
- **Nunca `void` una promesa de reconciliación en un server action.** El contenedor puede congelarse
  después de la respuesta y el reintento se pierde sin rastro.
- Los tests PGlite nuevos **deben** registrarse en `tests/pglite-files.ts` (advertencia en
  [tests/pglite-files.ts:8](tests/pglite-files.ts#L8)); si no, corren en el proyecto paralelo y compiten
  por CPU.
- Un paso de datos nuevo va en las **dos** listas: `PDTP_DATA_STEPS` de
  [scripts/apply-pdtp-data.sh](scripts/apply-pdtp-data.sh) y la etapa equivalente de
  `scripts/deploy-prod.sh`. `lib/__tests__/pdtp-data-steps-parity.test.ts` falla si se agrega en una sola.
- No se modifican `responsible_slugs` de ninguna actividad: cambiarlos obligaría a reaprobar el programa.

---

## Fase 0 · Decisiones tomadas

Registradas antes de tocar código porque tres de ellas determinan qué se construye. Confirmadas por el
usuario el 2026-09-06.

| # | Decisión | Resolución | Consecuencia en el plan |
|---|---|---|---|
| E01 | Alcance de la remediación | Código, datos y decisiones | Fases 1 a 4 |
| E02 | Las 22 actividades con calendario vencido | **Reprogramar todas.** Ninguna se acepta como no realizada en 2026 | Tarea 3. No se usa `retirePdtpActivity` |
| E03 | Mes destino de la reprogramación | **Parámetro, script re-ejecutable** mientras el programa siga en borrador | Tarea 3 recibe `PDTP_REPROGRAM_FROM_MONTH` |
| E04 | Alcance por faena | **Declarar membresía del programa y además corregir la compuerta** para que descuente exclusiones | Tareas 1 y 2 |
| E05 | Permisos de la JDPR | **Otorgar** `prevention:governance:review` y `prevention:training:approve` al rol `prevencionista` | Tareas 7 y 11 |

**Riesgo declarado de E05, reafirmado por el usuario tras plantearlo:** con `training:approve` más la
excepción `prevention:sign_own_work`, una sola persona puede redactar, revisar, aprobar y publicar
contenido formativo auditable por DS 44, y la etapa `in_review` no tiene segregación por actor. La Tarea 11
implementa la decisión aplicando la mitigación más fuerte compatible con ella: la excepción se limita al
último eslabón (`published`) reutilizando `canSignOwnWork`, de modo que aprobar sigue exigiendo no haber
redactado. Queda registrado que la publicación de cursos **ya funcionaba** sin este grant (la JDPR redacta
con `training:manage` y la jefa Chome publica), así que E05 es una mejora de autonomía, no un
desbloqueo — y por eso la Tarea 11 va al final y no bloquea la activación.

**Pendientes de la jefatura, fuera del código** (bloquean la Fase 4, no las Fases 1-3): confirmar la
semántica de la N°19 (¿carpeta de requisitos legales en Documentación, o expediente del acta de trabajador
nuevo?) y de la N°17 (¿barrido mensual del 95 % de la dotación, o barrido anual con actualización por
ingreso?). Ver §6 de la auditoría.

---

## Estructura de archivos

**Código nuevo**

| Archivo | Responsabilidad |
|---|---|
| `lib/services/pdtp/instruments.ts` | Único lugar que responde "el instrumento que acredita este número está vigente": plantilla `approved`, versión de curso `published`, plan de emergencia `approved`. Consultado por la compuerta y por el preflight, para que no vuelvan a opinar distinto |
| `lib/services/pdtp/backlog.ts` | Conteo de eventos de cumplimiento `pending`/`error` y deriva de huella de contenido, para el panel y el preflight |
| `scripts/apply-pdtp-2026-worksite-scope.ts` | Declara membresía de faenas y exclusiones por actividad (E04) |
| `scripts/reprogram-pdtp-2026-schedule.ts` | Reprograma el calendario vencido a la ventana restante (E02, E03) |
| `app/(app)/prevencion/pdtp/[programId]/fulfillment-backlog-panel.tsx` | Panel de sólo lectura con eventos pendientes, en error y deriva de huella |

**Código modificado** (una responsabilidad por archivo, sin abstracciones nuevas)

| Archivo | Cambio |
|---|---|
| `lib/services/pdtp/fulfillment.ts` | Descontar exclusiones en la compuerta; estado `instrument_required`; el reconciliador deja de resucitar revocados |
| `lib/services/pdtp/lifecycle.ts` | Separar bloqueadores de envío a revisión de bloqueadores de activación |
| `lib/services/operational-work-queue.ts` | Filtro por período de activación en la rama del PDTP |
| `lib/services/pdtp/constancias.ts` | Filtro por período de activación y por año del programa |
| `lib/services/pdtp/executions.ts` | Exigir la evidencia mínima que la actividad declara |
| `lib/services/deliveries-worker-stock.ts` | Acreditar la N°62 al entregar EPP |
| `lib/services/deliveries-void.ts` | Revocar la N°62 al anular la entrega |
| `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` | Destino real de la N°9 |
| `lib/services/prevention-cphs.ts`, `prevention-cgrd.ts`, `prevention-emergency.ts`, `sst-module/evaluations.ts` | Revocaciones faltantes |
| `lib/services/prevention-training.ts` | Excepción de firma del último eslabón |
| `modules/prevention/manifest.ts` | Grants de E05 |
| `app/api/cron/pdtp-weekly-reminders/route.ts` | Encadenar la reconciliación |
| `app/(app)/prevencion/pdtp/actions/program-lifecycle.ts` | Reconciliar después de activar |
| `scripts/preflight-pdtp-accreditation-wiring.ts` | Incluir instrumentos y backlog en `ok` |

**Código eliminado:** `lib/services/deliveries-worker-epp.ts` (servicio huérfano, segunda puerta de
entrada a la misma entrega física), su re-exportación en `lib/services/deliveries.ts:12`,
`resolveWorkerEntryActor` ([worker-lifecycle-connector.ts:133](lib/services/pdtp-adapters/worker-lifecycle-connector.ts#L133))
e `invalidateClosedIndicatorPeriod` ([prevention-indicadores.ts:845](lib/services/prevention-indicadores.ts#L845)).

---

# Fase 1 · Alcance y calendario (sólo posible mientras el programa esté en `draft`)

Va primero y es irreversible: en cuanto alguien envíe el programa a revisión, nada de esta fase se puede
hacer sin reabrir y reaprobar. **Antes de empezar, verificar que el programa sigue en borrador:**

```bash
psql "$DATABASE_URL" -c "SELECT id, status, activated_at FROM pdtp_programs WHERE year = 2026"
```

Si `status` no es `draft`, detenerse y avisar: la Fase 1 exige `reopenRejectedPdtpProgram` o una versión
de contenido nueva, que es una decisión de la jefatura.

---

### Tarea 1: La compuerta descuenta exclusiones por faena

**Files:**
- Modify: `lib/services/pdtp/fulfillment.ts` (`wiringIssueFor` ~:563-593, `assertPdtpFulfillmentCoverage` ~:601)
- Test: `lib/__tests__/pdtp-fulfillment.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `wiringIssueFor(activity, ctx)` con `ctx.excludedWorksiteIds: Set<string>` agregado al objeto de contexto. La Tarea 8 extiende el mismo `ctx`.

**Por qué:** `wiringIssueFor` calcula las faenas que faltan desde `programWorksiteIds()`, que cuando no hay
membresía declarada devuelve **todas las faenas activas**, y no resta las exclusiones de la actividad. Con
el estado del instrumento de la Tarea 8, eso convierte "N°84 excluida de Oficina Central" en un
`config_required` permanente que bloquea la activación. Las exclusiones sí se respetan en la cola, en las
obligaciones, en la acreditación (R4) y en el indicador: la compuerta es el único lugar que las ignora.

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/pdtp-fulfillment.test.ts`, dentro del `describe` que ya cubre la compuerta, junto al test
de planes de emergencia (~:318):

```ts
it("una actividad excluida de una faena no exige configuración en esa faena", async () => {
  await seedActivity({ n: 84, mechanism: "enganche", activity: "Simulacros", evidenceRequirement: null })
  const activityId = `${PROGRAM_ID}-a-084`
  const now = new Date().toISOString()

  // Sólo la faena principal declara el número; la segunda no tiene plan.
  await inMemoryDb.insert(schema.preventionEmergencyPlans).values({
    id: "plan-excl-1", worksiteId: WS_ID, code: "PE-01", title: "Plan de emergencia",
    status: "draft", version: 1, pdtpActivityNumbers: [84],
    createdByUserId: USER_ID, createdAt: now, updatedAt: now,
  })

  const antes = (await assertPdtpFulfillmentCoverage(PROGRAM_ID))
    .filter((i) => i.n === 84 && i.status === "config_required")
  expect(antes).toHaveLength(1)

  await inMemoryDb.insert(schema.pdtpActivityWorksiteExclusions).values({
    id: "excl-84-ws2", activityId, worksiteId: "ws-fulfill-2",
    reason: "Oficina sin operación de terreno", excludedByUserId: USER_ID, createdAt: now,
  })

  const despues = (await assertPdtpFulfillmentCoverage(PROGRAM_ID))
    .filter((i) => i.n === 84 && i.status === "config_required")
  expect(despues).toEqual([])
})
```

Verificar antes de escribirlo que el fixture crea la segunda faena `ws-fulfill-2` en `beforeEach` (el test
de planes de emergencia ya la usa) y que `seedActivity` acepta el `n`. Ajustar los nombres de columna de
`pdtpActivityWorksiteExclusions` leyendo `db/schema/prevention/pdtp.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts -t "excluida de una faena"`
Expected: FAIL — `despues` trae un `config_required` porque `ws-fulfill-2` sigue en el denominador.

- [ ] **Step 3: Write minimal implementation**

En `lib/services/pdtp/fulfillment.ts`, agregar el cargador y sumarlo al contexto:

```ts
/**
 * Faenas donde cada actividad NO aplica. La compuerta las tiene que descontar
 * del denominador: exigirle plan de emergencia a una faena que declaró no
 * hacer simulacros es pedir configuración para trabajo que nadie prometió.
 */
async function excludedWorksitesByActivity(
  client: QueryClient,
  activityIds: string[],
): Promise<Map<string, Set<string>>> {
  if (activityIds.length === 0) return new Map()
  const rows = await client.select({
    activityId: pdtpActivityWorksiteExclusions.activityId,
    worksiteId: pdtpActivityWorksiteExclusions.worksiteId,
  }).from(pdtpActivityWorksiteExclusions)
    .where(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds))
  const byActivity = new Map<string, Set<string>>()
  for (const row of rows) {
    const set = byActivity.get(row.activityId) ?? new Set<string>()
    set.add(row.worksiteId)
    byActivity.set(row.activityId, set)
  }
  return byActivity
}
```

En `wiringIssueFor`, cambiar la firma del contexto a `ctx: { …; excludedWorksiteIds: Set<string> }` y
reemplazar el cálculo de faenas faltantes:

```ts
  // Las faenas donde la actividad no aplica no son denominador.
  const applicableWorksiteIds = ctx.worksiteIds.filter((id) => !ctx.excludedWorksiteIds.has(id))
  if (applicableWorksiteIds.length === 0) return null

  const declaringWorksites = ctx.declaredPerWorksite.get(activity.n)
  if (declaringWorksites) {
    const missing = applicableWorksiteIds.filter((id) => !declaringWorksites.has(id))
    if (missing.length === 0) return null
    const names = missing.map((id) => ctx.worksiteNameById.get(id) ?? id)
    return {
      n: activity.n, activity: activity.activity, status: "config_required",
      reason: `Su número no está declarado en ${missing.length} de las ${applicableWorksiteIds.length} faenas donde aplica: ${names.join(", ")}.`,
    }
  }
```

En `assertPdtpFulfillmentCoverage`, cargar el mapa una vez y pasarlo por actividad:

```ts
  const excludedByActivity = await excludedWorksitesByActivity(client, activities.map((a) => a.id))
  …
      const issue = wiringIssueFor(activity, {
        declaredGlobally, declaredPerWorksite, worksiteIds, worksiteNameById,
        excludedWorksiteIds: excludedByActivity.get(activity.id) ?? new Set<string>(),
      })
```

Agregar `pdtpActivityWorksiteExclusions` al bloque de imports de `@/db/schema`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts`
Expected: PASS, incluidos los tests preexistentes de planes de emergencia y de `compuesta`.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pdtp/fulfillment.ts lib/__tests__/pdtp-fulfillment.test.ts
git commit -m "fix(pdtp): la compuerta descuenta las faenas donde la actividad no aplica"
```

---

### Tarea 2: Declarar membresía de faenas y exclusiones por actividad

**Files:**
- Create: `scripts/apply-pdtp-2026-worksite-scope.ts`
- Modify: `package.json` (script `pdtp:apply-worksite-scope`), `scripts/apply-pdtp-data.sh` (`PDTP_DATA_STEPS`), `scripts/deploy-prod.sh` (etapa equivalente), `docker-compose.yml` (servicio one-shot)
- Test: `lib/__tests__/pdtp-data-steps-parity.test.ts` (pasa solo si las dos listas coinciden)

**Interfaces:**
- Consumes: `wiringIssueFor` con exclusiones descontadas (Tarea 1).
- Produces: filas en `pdtp_program_worksites` y `pdtp_activity_worksite_exclusions`. La Tarea 8 depende de que esto exista para no bloquear la activación.

**Por qué:** hoy `pdtp_program_worksites` está vacío y `pdtp_activity_worksite_exclusions` también, así que
las 81 actividades son exigibles en las 7 faenas, incluida Oficina Central (8 personas), Teno (3) y
Horcones (4). Inspección de maquinaria, contenedores, report de uso diario, campañas de conducción, CGRD y
simulacros quedan planificados en una oficina. Es la fuente más probable de incumplimiento estructural
desde el primer mes.

**Precedente a copiar:** [scripts/apply-pdtp-2026-catalog-decisions.ts](scripts/apply-pdtp-2026-catalog-decisions.ts)
ya tiene el `bail()` con modo deploy, la resolución del actor y la forma exacta de llamar a
`setPdtpActivityWorksiteAdjustment`. Leerlo antes de escribir.

- [ ] **Step 1: Escribir el script con la tabla de alcance declarada**

`scripts/apply-pdtp-2026-worksite-scope.ts`. Estructura obligatoria: encabezado explicando por qué
(igual que los otros `apply-pdtp-*`), `DRY_RUN` y `DEPLOY_MODE` por variable de entorno, `bail()` tolerante
en deploy, e idempotencia (re-ejecutar no cambia nada).

Las dos tablas de datos, que son la decisión y no una heurística:

```ts
/**
 * Faenas que operan el programa. Las que no están acá no reciben ninguna
 * actividad: no es una exclusión actividad por actividad sino "esta faena no
 * ejecuta el programa de terreno".
 */
const PROGRAM_WORKSITE_NAMES = [
  "Biodiversa", "Cholguan - Arauco", "Horcones", "Masisa", "Santa Fe - Grúas", "Teno - Arauco",
] as const

/**
 * Actividades que no aplican en una faena que SÍ opera el programa, con el
 * motivo que queda en el registro de cambios. `reason` exige 10 caracteres.
 */
const ACTIVITY_EXCLUSIONS: Array<{ n: number; worksiteName: string; reason: string }> = [
  // Ejemplo del formato, no un dato aprobado:
  // { n: 33, worksiteName: "Teno - Arauco", reason: "La faena no opera maquinaria pesada propia." },
]
```

**Este arreglo puede quedar vacío y la tarea sigue completa.** Sacar Oficina Central de la membresía es lo
que resuelve el bloqueo de la compuerta; las exclusiones por actividad dentro de una faena que sí opera el
programa son un ajuste fino que la jefatura puede declarar después, en cualquier momento mientras el
programa siga en borrador, re-ejecutando el mismo script.

Lógica:

1. Resolver el programa del año (`active` si existe, si no el último) y `bail` si no hay.
2. Resolver ids de faena por nombre desde `worksites` y `bail` con la lista de nombres no encontrados —
   fallar por un nombre mal escrito es preferible a excluir la faena equivocada.
3. Membresía: llamar a `setPdtpProgramWorksites` de [lib/services/pdtp/worksites.ts:46](lib/services/pdtp/worksites.ts#L46).
   Exige `scope === "all"`, así que el script pasa `"all"`. Imprimir el diff (faenas que entran y salen)
   antes de escribir y omitir la escritura en dry-run.
4. Exclusiones: por cada entrada, `setPdtpActivityWorksiteAdjustment({ activityId, worksiteId, excluded: true, reason }, actorUserId, "all")`.
   La firma completa está en [worksites.ts:617](lib/services/pdtp/worksites.ts#L617); `reason` es siempre
   obligatorio con 10 caracteres mínimo y el gate de edición sólo corre cuando algo cambia de verdad, así
   que re-ejecutar sobre un programa ya firmado no lanza.
5. Resumen final: faenas del programa, exclusiones aplicadas, exclusiones ya presentes.

- [ ] **Step 2: Registrar el paso en las dos listas y verificar la paridad**

En `package.json`:

```json
"pdtp:apply-worksite-scope": "tsx --env-file=.env.local scripts/apply-pdtp-2026-worksite-scope.ts",
```

En `scripts/apply-pdtp-data.sh`, dentro de `PDTP_DATA_STEPS`, **después** de
`pdtp:apply-catalog-decisions` (necesita saber qué actividades siguen activas) y **antes** de
`db:preflight-pdtp-wiring`:

```
  "pdtp:apply-worksite-scope|apply-pdtp-worksite-scope"
```

En `scripts/deploy-prod.sh`, la etapa equivalente en la misma posición relativa, siguiendo el formato de
las de al lado:

```bash
run_timed "Declarando el alcance por faena del PDTP" run_in_prod docker compose run --rm apply-pdtp-worksite-scope
```

En `docker-compose.yml`, el servicio one-shot `apply-pdtp-worksite-scope` copiando el bloque de
`apply-pdtp-mechanisms` y cambiando el comando. Confirmar en el `Dockerfile` si el script necesita su
propio `esbuild` como los otros pasos de deploy y agregarlo con el mismo patrón.

Run: `npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-data-steps-parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Dry-run contra la base de desarrollo**

Run: `PDTP_WORKSITE_SCOPE_DRY_RUN=true npm run pdtp:apply-worksite-scope`
Expected: imprime las 6 faenas que quedarían en el programa, la que sale (Oficina Central), las
exclusiones que aplicaría, y no escribe nada. Verificar con
`psql "$DATABASE_URL" -c "SELECT count(*) FROM pdtp_program_worksites"` que sigue en 0.

- [ ] **Step 4: Aplicar y verificar la compuerta**

Run: `npm run pdtp:apply-worksite-scope && npm run db:preflight-pdtp-wiring | head -60`
Expected: `pdtp_program_worksites` con 6 filas; `coverageIssues` sin `config_required` nuevos;
`worksitesWithoutEmergencyPlan` deja de listar Oficina Central.

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-pdtp-2026-worksite-scope.ts package.json scripts/apply-pdtp-data.sh scripts/deploy-prod.sh docker-compose.yml Dockerfile
git commit -m "feat(pdtp): declarar el alcance por faena del programa 2026"
```

---

### Tarea 3: Reprogramar el calendario vencido

**Files:**
- Create: `scripts/reprogram-pdtp-2026-schedule.ts`
- Modify: `package.json`
- Test: `lib/__tests__/pdtp-schedule-reprogram.test.ts` (nuevo, PGlite), `tests/pglite-files.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `planScheduleReprogram(input: { cells: ScheduleCell[]; fromMonth: number }): ScheduleCell[]` — función pura exportada del script, testeable sin base de datos. `ScheduleCell = { month: number; week: number; plannedQuantity: number }`.

**Por qué:** 22 actividades tienen todo su calendario 2026 antes de septiembre. `filterPdtpRowsFromActivation`
descarta del numerador y del denominador cualquier celda anterior a la semana de activación, así que
activar en septiembre volvería inertes seis conectores completos que funcionan. La decisión E02 es
reprogramarlas todas, y E03 que el mes destino sea parámetro para poder re-ejecutar el día que se congele
la fecha de activación.

**Mecanismo:** `updatePdtpActivity({ activityId, scheduleOverrides, expectedScheduleFingerprint })`.
Verificado: `resolveScheduleWrite` ([activities.ts:75-82](lib/services/pdtp/activities.ts#L75-L82))
devuelve `manual_matrix` en la primera rama, así que **no** hace falta `scheduleReplaceConfirmed` y la
regla de recurrencia no se proyecta. El calendario escrito es autoritativo para el año
([activities.ts:338-358](lib/services/pdtp/activities.ts#L338-L358)).

**No se toca `recurrenceRule`.** Una compresión de varias semanas en un mes no es expresable como regla
(`projectRecurrenceToLegacySchedule` emite una semana por mes salvo `weekly`), así que la regla quedaría
mintiendo. Con celdas manuales, `derivePdtpScheduleSource` devuelve `"manual"` y la UI no vuelve a
proyectar: el guard de reemplazo exige un cambio real de regla. La constancia de la decisión va en el
registro de cambios del programa, que `updatePdtpActivity` ya escribe.

- [ ] **Step 1: Write the failing test for the pure planner**

`lib/__tests__/pdtp-schedule-reprogram.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { planScheduleReprogram } from "@/scripts/reprogram-pdtp-2026-schedule"

describe("planScheduleReprogram", () => {
  it("mueve las celdas vencidas a la ventana restante conservando la cantidad total", () => {
    const cells = [
      { month: 1, week: 4, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(result.every((cell) => cell.month >= 9)).toBe(true)
    expect(result.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(2)
  })

  it("conserva intactas las celdas que ya caen en la ventana", () => {
    const cells = [
      { month: 3, week: 1, plannedQuantity: 1 },
      { month: 10, week: 2, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(result).toContainEqual({ month: 10, week: 2, plannedQuantity: 1 })
    expect(result).toHaveLength(2)
  })

  it("no crea dos celdas en el mismo mes y semana: suma la cantidad", () => {
    const cells = [
      { month: 1, week: 1, plannedQuantity: 1 },
      { month: 2, week: 1, plannedQuantity: 1 },
      { month: 3, week: 1, plannedQuantity: 1 },
      { month: 4, week: 1, plannedQuantity: 1 },
      { month: 5, week: 1, plannedQuantity: 1 },
    ]
    const result = planScheduleReprogram({ cells, fromMonth: 11 })
    const keys = result.map((cell) => `${cell.month}-${cell.week}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(result.reduce((sum, cell) => sum + cell.plannedQuantity, 0)).toBe(5)
  })

  it("es idempotente: re-planificar lo ya planificado no cambia nada", () => {
    const cells = [{ month: 2, week: 3, plannedQuantity: 2 }]
    const once = planScheduleReprogram({ cells, fromMonth: 9 })
    expect(planScheduleReprogram({ cells: once, fromMonth: 9 })).toEqual(once)
  })
})
```

Registrar el archivo en `vitest.non-pglite.config.ts` no hace falta (es el proyecto por defecto); **no**
agregarlo a `tests/pglite-files.ts` porque no usa base de datos. Confirmar que `@/scripts/...` resuelve en
el `tsconfig.json`; si no, importar por ruta relativa.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-schedule-reprogram.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Write the planner and the script**

`scripts/reprogram-pdtp-2026-schedule.ts`:

```ts
export type ScheduleCell = { month: number; week: number; plannedQuantity: number }

/**
 * Reubica las celdas anteriores a `fromMonth` dentro de la ventana que queda
 * del año, conservando la cantidad total planificada (decisión E02: ninguna
 * actividad se acepta como no realizada en 2026).
 *
 * Reparte en orden por (mes, semana) sobre las celdas libres de la ventana para
 * no apilar todo en un mes, y suma cuando ya no queda celda libre — el índice
 * único de `pdtp_activity_schedule` es (actividad, año, mes, semana), así que
 * dos filas del mismo período son imposibles.
 */
export function planScheduleReprogram(input: { cells: ScheduleCell[]; fromMonth: number }): ScheduleCell[] {
  const kept = input.cells.filter((cell) => cell.month >= input.fromMonth && cell.plannedQuantity > 0)
  const lapsed = input.cells.filter((cell) => cell.month < input.fromMonth && cell.plannedQuantity > 0)
  const byKey = new Map(kept.map((cell) => [`${cell.month}-${cell.week}`, { ...cell }]))

  const window: Array<{ month: number; week: number }> = []
  for (let month = input.fromMonth; month <= 12; month++) {
    for (let week = 1; week <= 4; week++) window.push({ month, week })
  }
  if (window.length === 0) throw new Error(`No queda ventana en el año desde el mes ${input.fromMonth}.`)

  const ordered = [...lapsed].sort((a, b) => a.month - b.month || a.week - b.week)
  let cursor = 0
  for (const cell of ordered) {
    // Primera celda libre de la ventana; si no queda ninguna, se suma sobre la
    // siguiente en rotación.
    let slot = window.find((candidate, index) => index >= cursor && !byKey.has(`${candidate.month}-${candidate.week}`))
    if (!slot) slot = window[cursor % window.length]!
    cursor = window.indexOf(slot) + 1
    const key = `${slot.month}-${slot.week}`
    const existing = byKey.get(key)
    byKey.set(key, existing
      ? { ...existing, plannedQuantity: existing.plannedQuantity + cell.plannedQuantity }
      : { month: slot.month, week: slot.week, plannedQuantity: cell.plannedQuantity })
  }

  return [...byKey.values()].sort((a, b) => a.month - b.month || a.week - b.week)
}
```

El `main()` del script:

1. Leer `PDTP_REPROGRAM_FROM_MONTH` (obligatorio, 1-12) y `PDTP_REPROGRAM_DRY_RUN` (default `true`, para
   que correrlo sin pensar no escriba).
2. Resolver el programa 2026. **Si `status !== "draft"`, abortar** con el mensaje de que el calendario base
   está bloqueado y hay que reabrir el programa. No intentar overrides: la cola de pendientes no los lee
   ([operational-work-queue.ts:812-828](lib/services/operational-work-queue.ts#L812-L828) consulta sólo
   `pdtp_activity_schedule`), así que un calendario por override produciría indicador sin tareas.
3. Por cada actividad activa con `schedule_mode = 'scheduled'`: leer sus celdas del año, calcular
   `planScheduleReprogram`, y si el plan difiere de lo actual, llamar a
   `updatePdtpActivity({ activityId, scheduleOverrides: plan, expectedScheduleFingerprint: scheduleCellsFingerprint(current) }, actorUserId)`.
   `scheduleCellsFingerprint` se importa de [lib/services/pdtp/recurrence.ts:155](lib/services/pdtp/recurrence.ts#L155)
   y descarta celdas con cantidad `<= 0`, así que construir el arreglo actual con el mismo filtro.
4. Imprimir una tabla por actividad: `n`, celdas antes, celdas después, total antes, total después.
5. Con `PDTP_REPROGRAM_EXPORT=<ruta.xlsx>`, exportar la misma tabla para la firma de la jefatura, usando la
   librería de Excel que el repositorio ya usa en los otros exports (buscar el patrón con
   `grep -rn "exceljs\|xlsx" lib/services --include=*.ts | head`).
6. Resumen final con la **carga resultante por mes**, porque E02 comprime trabajo real en la ventana que
   queda y ése es el número que la jefatura tiene que ver antes de firmar.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-schedule-reprogram.test.ts`
Expected: PASS, los 4 tests.

- [ ] **Step 5: Dry-run y export para la firma**

```bash
PDTP_REPROGRAM_FROM_MONTH=9 PDTP_REPROGRAM_EXPORT=/tmp/reprogramacion-pdtp-2026.xlsx \
  npx tsx --env-file=.env.local scripts/reprogram-pdtp-2026-schedule.ts
```
Expected: lista las 22 actividades con calendario vencido más las que ya caen en la ventana; no escribe
nada; genera el archivo. Verificar con
`psql "$DATABASE_URL" -c "SELECT count(*) FROM pdtp_activity_schedule s JOIN pdtp_activities a ON a.id=s.activity_id WHERE a.program_id='pdtp-2026-v1' AND s.month < 9 AND s.planned_quantity > 0"`
que sigue en 542.

**No aplicar todavía.** Aplicar es el paso 1 de la Fase 4, cuando la fecha de activación esté congelada.

- [ ] **Step 6: Commit**

```bash
git add scripts/reprogram-pdtp-2026-schedule.ts lib/__tests__/pdtp-schedule-reprogram.test.ts package.json
git commit -m "feat(pdtp): herramienta para reprogramar el calendario vencido del programa 2026"
```

---

# Fase 2 · Lo que rompe o miente el día de la activación

Cuatro defectos que hoy no se notan porque el programa está en borrador, y que fallan el día uno.

---

### Tarea 4: La N°62 acredita en la ruta de entrega que se usa de verdad

**Files:**
- Modify: `lib/services/deliveries-worker-stock.ts` (fin de transacción ~:289), `lib/services/deliveries-void.ts` (~:164), `lib/services/deliveries.ts:12`
- Delete: `lib/services/deliveries-worker-epp.ts`
- Test: `lib/__tests__/pdtp-epp-delivery-accreditation.test.ts` (nuevo, PGlite), `tests/pglite-files.ts`

**Interfaces:**
- Consumes: nada.
- Produces: la constante `PDTP_EPP_DELIVERY_ACTIVITY_NUMBER = 62` se muda a `lib/services/deliveries-worker-stock.ts`.

**Por qué:** `onEppDeliveryCompleted` se llama sólo desde `registerWorkerEppDelivery`, que **no tiene
ningún llamador de producción**: la ruta viva es `registerWorkerStockDelivery`
([entregas/actions.ts:60](app/(app)/entregas/actions.ts#L60)), que no tiene una sola referencia al PDTP. La
N°62 nunca acredita. Y `voidWorkerStockDelivery` no revoca, así que una entrega anulada por "trabajador
equivocado" dejaría la acreditación en pie.

Se borra el servicio huérfano en vez de dejarlo: dos puertas de entrada a la misma entrega física
permitirían acreditar dos veces el mismo hecho, y el código no debe prometer un cable que no corre.

- [ ] **Step 1: Medir si `products.isEpp` alcanza como predicado**

`product_categories` tiene su propia bandera `isEpp`, así que un producto de categoría EPP con
`products.isEpp = false` no dispararía la acreditación.

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM products p JOIN product_categories c ON c.id = p.category_id WHERE c.is_epp AND NOT p.is_epp"
```

Si el resultado es 0, el predicado es `product.isEpp` a secas. Si es mayor que 0, el predicado es
`product.isEpp || category.isEpp` y hay que traer la categoría en la consulta del producto dentro de la
transacción. Anotar el número obtenido en el mensaje del commit.

- [ ] **Step 2: Write the failing test**

`lib/__tests__/pdtp-epp-delivery-accreditation.test.ts`, con el boilerplate PGlite de
[lib/__tests__/pdtp-fulfillment.test.ts:16-40](lib/__tests__/pdtp-fulfillment.test.ts#L16-L40) (instancia
`new PGlite()`, `vi.mock("@/db")` con getter perezoso, `migratePGlite`, import dinámico del servicio
**después** del mock). Sembrar: usuario, faena, trabajador de esa faena, producto con `isEpp: true`, otro
con `isEpp: false`, stock suficiente, y un programa PDTP `active` del año en curso con la actividad n=62.

```ts
it("entregar un EPP acredita la N°62 en la faena de la entrega", async () => {
  const deliveryId = await registerWorkerStockDelivery({
    sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
    items: [{ productId: EPP_PRODUCT_ID, quantity: 1 }],
  })
  const events = await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({ sourceType: "epp", sourceId: deliveryId, eventType: "completed", status: "accredited" })
})

it("una entrega sin ningún EPP no acredita nada", async () => {
  await registerWorkerStockDelivery({
    sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
    items: [{ productId: PLAIN_PRODUCT_ID, quantity: 1 }],
  })
  expect(await inMemoryDb.select().from(schema.pdtpFulfillmentEvents)).toEqual([])
})

it("anular la entrega revoca la acreditación y deja el motivo", async () => {
  const deliveryId = await registerWorkerStockDelivery({
    sourceWorksiteId: WS_ID, workerId: WORKER_ID, deliveredBy: USER_ID,
    items: [{ productId: EPP_PRODUCT_ID, quantity: 1 }],
  })
  await voidWorkerStockDelivery({ deliveryId, voidedBy: USER_ID, reason: "Trabajador equivocado en la guía" })

  const revocacion = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
    .find((event) => event.eventType === "revoked")
  expect(revocacion).toMatchObject({ sourceType: "epp", sourceId: deliveryId, status: "revoked" })
  expect(revocacion?.evidenceRef).toContain("Trabajador equivocado")

  const [ejecucion] = await inMemoryDb.select().from(schema.pdtpExecutions)
  expect(ejecucion?.status).toBe("draft")
})
```

Registrar el archivo en `tests/pglite-files.ts`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-epp-delivery-accreditation.test.ts`
Expected: FAIL — el primer test encuentra 0 eventos.

- [ ] **Step 4: Write the implementation**

En `lib/services/deliveries-worker-stock.ts`, declarar la constante junto a los imports y capturar durante
la transacción si hubo EPP y la ruta de la evidencia:

```ts
/** N°62: "Registrar la entrega de los EPP y dejar documentada su entrega". */
const PDTP_EPP_DELIVERY_ACTIVITY_NUMBER = 62
```

Dentro de la transacción, en el bucle de items (~:203-210), marcar la bandera con el predicado que definió
el paso 1; y al insertar el adjunto, capturar la misma ruta que se persiste en `attachments` (leer esa
inserción y usar el mismo valor de campo, no reconstruirlo). Después del cierre de la transacción, antes de
`return deliveryId`:

```ts
  // N°62 del PDTP. Va fuera de la transacción y no propaga: la entrega ya está
  // registrada y `recordPdtpFulfillmentEvent` deja el intento en el libro
  // durable para que el reconciliador lo retome.
  //
  // El conector vivía en `deliveries-worker-epp.ts`, un servicio sin llamador,
  // así que la actividad nunca acreditó. `worksiteId` es la faena de origen: el
  // servicio ya exige que el trabajador pertenezca a ella, así que es también
  // la faena de la persona equipada.
  if (deliveredEpp) {
    await onEppDeliveryCompleted({
      deliveryId,
      worksiteId: input.sourceWorksiteId,
      deliveredAt,
      workerCount: 1,
      activityNumbers: [PDTP_EPP_DELIVERY_ACTIVITY_NUMBER],
      // Sin un artefacto real, el motor marca la ejecución
      // `evidenceStatus: "not_required"` y la N°62 —"dejar documentada su
      // entrega"— quedaría acreditada sin documento.
      evidenceRef: proofStoragePath ?? undefined,
    })
  }
```

Extender `onEppDeliveryCompleted` en
[pdtp-accreditation-connectors.ts:234](lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts#L234)
con el parámetro opcional `evidenceRef?: string`, pasándolo al `safeAccredit` y conservando la etiqueta
descriptiva actual como valor por defecto.

En `lib/services/deliveries-void.ts`, después del cierre de la transacción:

```ts
  // Revierte la N°62. Mismo patrón que `cancelTrainingSession`: post-commit,
  // sin propagar, con el motivo de la anulación como evidencia del evento para
  // que la revocación se audite sin volver a la guía.
  await recordPdtpFulfillmentRevocation({
    sourceType: "epp",
    sourceId: input.deliveryId,
    worksiteId: sourceWorksiteId,
    revokedBy: input.voidedBy,
    reason: `Entrega anulada: ${reason}`,
  })
```

`sourceWorksiteId` está en alcance en [deliveries-void.ts:64](lib/services/deliveries-void.ts#L64); si el
cierre de la transacción lo deja fuera de alcance, elevarlo a un `let` declarado antes.

Borrar `lib/services/deliveries-worker-epp.ts`, su línea de re-exportación en `lib/services/deliveries.ts:12`
y los tests que lo cubrían (buscar con `grep -rln registerWorkerEppDelivery lib app`). Si alguno de esos
tests cubre comportamiento que el flujo de stock también debe tener —el adjunto de respaldo o el rechazo de
cantidades no enteras para EPP— portar la aserción al test de stock antes de borrarlo.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-epp-delivery-accreditation.test.ts
npx vitest run --config vitest.non-pglite.config.ts -t "deliver"
npm run typecheck
```
Expected: los tres verdes. `typecheck` es obligatorio acá porque se borró un módulo exportado.

- [ ] **Step 6: Commit**

```bash
git add -A lib/services/deliveries-worker-stock.ts lib/services/deliveries-void.ts lib/services/deliveries.ts lib/services/deliveries-worker-epp.ts lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts lib/__tests__ tests/pglite-files.ts
git commit -m "fix(pdtp): la entrega de EPP acredita y revoca la N°62 desde la ruta viva"
```

---

### Tarea 5: Pendientes y Constancias respetan el período de activación

**Files:**
- Modify: `lib/services/operational-work-queue.ts` (lateral ~:812-828), `lib/services/pdtp/constancias.ts` (~:91-101), `lib/services/pdtp/helpers.ts` (~:178)
- Test: `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts`, `lib/__tests__/pdtp-constancias.test.ts`
- Modify: `tests/pglite-files.ts` (registrar el test de la cola, que hoy falta)

**Interfaces:**
- Consumes: nada.
- Produces: nada nuevo. Reutiliza `filterPdtpRowsFromActivation` de [lib/services/pdtp/period.ts](lib/services/pdtp/period.ts).

**Por qué:** la cola toma `MIN(month)` desde enero y Constancias hace lo mismo, sin filtrar por
`activatedAt`. Pero `markPdtpExecution` rechaza cualquier período anterior a la semana de activación y el
formulario recorta los meses ofrecidos. Al activar en septiembre, la tarjeta diría "Vencida · enero" y el
formulario no ofrecería enero: la deuda no se puede saldar y no desaparece nunca. Con 542 de 797 celdas
antes de septiembre, la mayoría de las tarjetas serían fantasma el día uno.

**Cuidado con el mes suelto.** Comparar sólo el mes vacía la rama completa para un programa 2027 activado
en diciembre de 2026. La comparación tiene que ser la terna (año, mes, semana), igual que
`isPdtpPeriodOnOrAfterActivation`. Y `activatedAt` nulo significa "sin filtro" —el caso de programas
importados que ya estaban activos—, no "nada exigible".

- [ ] **Step 1: Write the failing tests**

En `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts`, el fixture ya crea un programa
`active`; agregarle `activatedAt` y un caso:

```ts
it("no ofrece deuda de un período anterior a la activación del programa", async () => {
  // El programa se activó este mes: las celdas de meses anteriores ya no son
  // exigibles y `markPdtpExecution` las rechazaría.
  await testGlobal.__db!.update(schema.pdtpPrograms)
    .set({ activatedAt: new Date().toISOString() })
    .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

  const items = await getOperationalWorkQueue(makeSession(["jefe_terreno"], [WS_ID]))
  const pdtpItems = items.filter((item) => item.sourceType === "pdtp_activity")
  expect(pdtpItems.every((item) => item.statusLabel !== "Vencida")).toBe(true)
})
```

Ajustar `getOperationalWorkQueue` al nombre y la forma real que el test ya usa en sus otros casos, y
sembrar al menos una celda de un mes anterior para que el test tenga algo que descartar.

En `lib/__tests__/pdtp-constancias.test.ts`, el caso simétrico: con `activatedAt` en el mes en curso, una
constancia con celdas planificadas en meses anteriores no aparece como deuda vencida.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts lib/__tests__/pdtp-constancias.test.ts
```
Expected: FAIL en los dos casos nuevos.

- [ ] **Step 3: Write the implementation**

En `lib/services/operational-work-queue.ts`, dentro del `CROSS JOIN LATERAL`, junto a
`AND ${pdtpActivitySchedule.month} <= ${currentMonth}`:

```ts
          -- El programa no es exigible antes de su semana de activación
          -- (`isPdtpPeriodOnOrAfterActivation`): sin esto la tarjeta dice
          -- "Vencida · enero" y el formulario no ofrece enero, así que la deuda
          -- no se puede saldar nunca. `activatedAt` nulo es un programa
          -- importado ya activo: sin filtro, mismo criterio que period.ts.
          AND (
            ${pdtpPrograms.activatedAt} IS NULL
            OR (${pdtpActivitySchedule.year}, ${pdtpActivitySchedule.month}, ${pdtpActivitySchedule.week})
               >= (
                 EXTRACT(YEAR  FROM (${pdtpPrograms.activatedAt} AT TIME ZONE 'America/Santiago'))::int,
                 EXTRACT(MONTH FROM (${pdtpPrograms.activatedAt} AT TIME ZONE 'America/Santiago'))::int,
                 LEAST(4, CEIL(EXTRACT(DAY FROM (${pdtpPrograms.activatedAt} AT TIME ZONE 'America/Santiago'))::numeric / 7))::int
               )
          )
```

En `lib/services/pdtp/constancias.ts`, no reimplementar la regla: envolver las filas antes del filtro por
mes, y agregar el año, porque `loadProgramScheduleAndExecutions`
([helpers.ts:178](lib/services/pdtp/helpers.ts#L178)) consulta `pdtp_activity_schedule` sin filtrar año:

```ts
      const plannedMonths = filterPdtpRowsFromActivation(scheduleRows, program.activatedAt)
        .filter((row) => row.activityId === activityId
          && row.year === program.year
          && row.month <= period.month
          && row.plannedQuantity > 0)
        .map((row) => row.month)
```

Importar `filterPdtpRowsFromActivation` desde `./period` (el archivo ya importa `pdtpActivationPeriod` y
`currentPdtpPeriod` de ahí).

Aprovechar el paso por `helpers.ts:178` para agregarle el filtro de año que le falta: hoy es inocuo porque
2026 es el único programa, pero el día que se importe 2027 sus celdas entran al denominador de 2026.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts lib/__tests__/pdtp-constancias.test.ts lib/__tests__/prevention-pdtp.test.ts lib/__tests__/pdtp-coverage-r2.test.ts
```
Expected: PASS. Los dos últimos cubren el indicador y el cálculo de cobertura, que comparten
`loadProgramScheduleAndExecutions`.

- [ ] **Step 5: Registrar el test de la cola en el proyecto PGlite y commit**

Agregar `"lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts"` a `tests/pglite-files.ts`
(hoy falta, junto con `pdtp-accreditation.test.ts` y `worksite-deactivation-pdtp.test.ts`; agregar los tres).

```bash
git add lib/services/operational-work-queue.ts lib/services/pdtp/constancias.ts lib/services/pdtp/helpers.ts lib/__tests__ tests/pglite-files.ts
git commit -m "fix(pdtp): pendientes y constancias respetan la semana de activación del programa"
```

---

### Tarea 6: Reconciliación que no resucita revocados, se dispara al activar y se ve

**Files:**
- Modify: `lib/services/pdtp/fulfillment.ts` (`reconcilePdtpFulfillmentEvents` ~:271)
- Create: `lib/services/pdtp/backlog.ts`, `app/(app)/prevencion/pdtp/[programId]/fulfillment-backlog-panel.tsx`
- Modify: `app/(app)/prevencion/pdtp/actions/program-lifecycle.ts` (~:41-50, ~:121-132), `app/api/cron/pdtp-weekly-reminders/route.ts` (~:40-52), `app/(app)/prevencion/pdtp/[programId]/page.tsx`, `scripts/preflight-pdtp-accreditation-wiring.ts`
- Test: `lib/__tests__/pdtp-fulfillment.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `countPdtpFulfillmentBacklog(programId: string): Promise<{ pending: number; errored: number; lastError: string | null; digestDrift: boolean }>` desde `lib/services/pdtp/backlog.ts`. Lo consumen el panel y el preflight.

**Por qué:** `reconcilePdtpFulfillmentEvents` tiene un solo llamador, el script manual del deploy. La N°1 se
acredita al firmar el paso legal, cuando el programa todavía está `in_review`, así que su evento queda en
`error` y nadie lo ve ni lo reintenta: ninguna pantalla lee `pdtp_fulfillment_events`.

Y el reconciliador tiene un defecto propio que la Tarea 4 amplifica: reintenta cualquier evento `completed`
en `pending`/`error` sin mirar si existe un `revoked` para la misma fuente. Las dos filas coexisten porque
la clave idempotente separa por `eventType`. Una entrega de EPP anulada cuyo `completed` quedó en error se
**re-acreditaría** en el siguiente barrido.

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/pdtp-fulfillment.test.ts`:

```ts
it("no vuelve a acreditar un hecho que ya fue revocado", async () => {
  await seedProgram("draft")   // el completed queda pendiente
  await seedActivity({ n: ACT_N })
  await recordPdtpFulfillmentEvent({
    sourceType: "epp", sourceId: "entrega-1", worksiteId: WS_ID,
    activityNumbers: [ACT_N], occurredAt: new Date().toISOString(), executedQuantity: 1,
  })
  await recordPdtpFulfillmentRevocation({
    sourceType: "epp", sourceId: "entrega-1", worksiteId: WS_ID, reason: "Entrega anulada",
  })

  await inMemoryDb.update(schema.pdtpPrograms)
    .set({ status: "active", activatedAt: new Date().toISOString() })
    .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

  await reconcilePdtpFulfillmentEvents({})

  expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toEqual([])
  const completed = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
    .find((event) => event.eventType === "completed")
  expect(completed?.status).toBe("rejected")
  expect(completed?.lastError).toContain("revocado")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts -t "revocado"`
Expected: FAIL — se crea una ejecución.

- [ ] **Step 3: Write the implementation**

En `reconcilePdtpFulfillmentEvents`, antes del bucle:

```ts
  // Un `completed` en pending/error puede tener un `revoked` posterior: las dos
  // filas coexisten porque la clave idempotente separa por `eventType`.
  // Reintentar el completed sin mirar eso re-acredita un hecho anulado — el
  // caso concreto es una entrega de EPP anulada cuyo completed quedó en error
  // mientras el programa estaba en borrador.
  const revokedSources = new Set(
    (await db.select({ sourceType: pdtpFulfillmentEvents.sourceType, sourceId: pdtpFulfillmentEvents.sourceId })
      .from(pdtpFulfillmentEvents)
      .where(and(
        eq(pdtpFulfillmentEvents.eventType, "revoked"),
        inArray(pdtpFulfillmentEvents.sourceId, pending.map((event) => event.sourceId)),
      ))
    ).map((row) => `${row.sourceType}:${row.sourceId}`),
  )
```

Y dentro del bucle, en la rama `completed`:

```ts
    if (event.eventType === "completed") {
      if (revokedSources.has(`${event.sourceType}:${event.sourceId}`)) {
        // Terminal, no pendiente: dejarlo en `pending` lo haría reintentar para
        // siempre contra una fuente que ya no existe.
        await db.update(pdtpFulfillmentEvents).set({
          status: "rejected",
          lastError: "El hecho fue revocado en su módulo de origen: no se reintenta.",
          updatedAt: new Date().toISOString(),
        }).where(eq(pdtpFulfillmentEvents.id, event.id))
        continue
      }
      …
```

`continue` sin sumar a ningún contador, o sumando a `processed` solamente, para que el resumen no reporte
como acreditado algo que se descartó.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit el arreglo del reconciliador**

```bash
git add lib/services/pdtp/fulfillment.ts lib/__tests__/pdtp-fulfillment.test.ts
git commit -m "fix(pdtp): el reconciliador no vuelve a acreditar un hecho revocado"
```

- [ ] **Step 6: Disparar la reconciliación al activar, bajo candado propio**

En `app/(app)/prevencion/pdtp/actions/program-lifecycle.ts`, después de que
`activatePdtpProgram(programId, userId)` retorne, tanto en `activatePdtpIfAllStepsApproved` (~:49) como en
`activatePdtpProgramAction` (~:121):

```ts
  // Al activar hay que retomar lo que quedó en el libro mientras el programa
  // estaba en borrador — la N°1 entre otros: se acredita al firmar el paso
  // legal, con el programa todavía en revisión, así que su evento queda en
  // `error`. Se espera el resultado (nunca `void`: el contenedor puede
  // congelarse tras la respuesta) y va bajo candado propio, porque el cron
  // semanal recorre las mismas filas y las dos escrituras colisionarían contra
  // el índice único de ejecuciones.
  await withCronLock("pdtp-fulfillment-reconcile", () => reconcilePdtpFulfillmentEvents({ limit: 50 }))
```

`withCronLock` viene de [lib/services/cron-lock.ts:30](lib/services/cron-lock.ts#L30). El nombre del
candado tiene que ser **distinto** del de la ruta de cron: `pg_try_advisory_lock` es reentrante en la misma
sesión, así que reutilizar `"pdtp-weekly-reminders"` devolvería `true` y no daría exclusión ninguna.

- [ ] **Step 7: Encadenar la reconciliación al cron semanal**

En `app/api/cron/pdtp-weekly-reminders/route.ts`, dentro del `withCronLock` existente, después de
`runPdtpSignaturePendingReminders()`:

```ts
      const reconciled = await withCronLock(
        "pdtp-fulfillment-reconcile",
        () => reconcilePdtpFulfillmentEvents({ limit: 200 }),
      )
```

y agregarlo a la respuesta como `reconciled`. El candado anidado es seguro porque es otra clave sobre la
misma conexión reservada.

- [ ] **Step 8: Panel de sólo lectura y preflight**

`lib/services/pdtp/backlog.ts`:

```ts
/**
 * Lo que el libro de cumplimiento tiene sin resolver, y si el programa vivo
 * todavía coincide con lo que se firmó.
 *
 * Nada leía `pdtp_fulfillment_events`, así que un evento en `error` era
 * invisible hasta que alguien corría el script del deploy. La deriva de huella
 * se mide acá porque los overrides por faena son legales sobre un programa
 * activo y entran al digest: es el único lugar donde alguien notaría que lo
 * vigente ya no es lo firmado.
 */
export async function countPdtpFulfillmentBacklog(programId: string): Promise<{
  pending: number
  errored: number
  lastError: string | null
  digestDrift: boolean
}>
```

Implementarla con dos `count()` sobre `pdtpFulfillmentEvents` filtrando por `status`, el `lastError` del
evento en error más reciente, y `digestDrift` comparando `computePdtpProgramContentDigest(programId)` contra
`pdtpPrograms.contentDigest` (sólo cuando `contentDigest` no es nulo; si es nulo, `false`).

`app/(app)/prevencion/pdtp/[programId]/fulfillment-backlog-panel.tsx`: componente de servidor, sin
acciones, que no renderiza nada cuando los tres valores están en cero y sin deriva. Montarlo en
`app/(app)/prevencion/pdtp/[programId]/page.tsx` junto a `coverage-report-panel.tsx`, siguiendo sus
convenciones de `PageContainer` y tokens de color.

En `scripts/preflight-pdtp-accreditation-wiring.ts`, agregar `fulfillmentBacklog` al reporte y sumarlo a
`ok` (`pending === 0 && errored === 0`).

- [ ] **Step 9: Verificar y commit**

```bash
npm run typecheck && npm run lint
npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts
npm run db:preflight-pdtp-wiring | head -40
```
Expected: verde; el reporte incluye `fulfillmentBacklog` en ceros.

```bash
git add lib/services/pdtp/backlog.ts app/\(app\)/prevencion/pdtp app/api/cron/pdtp-weekly-reminders/route.ts scripts/preflight-pdtp-accreditation-wiring.ts
git commit -m "feat(pdtp): reconciliar al activar y hacer visible el libro de cumplimiento"
```

---

### Tarea 7: La N°9 apunta a donde se cierra, y la JDPR puede cerrarla

**Files:**
- Modify: `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` (~:97), `modules/prevention/manifest.ts` (grants)
- Test: `lib/__tests__/pdtp-enganche-destinations.test.ts`, `lib/__tests__/navigation-targets-exist.test.ts`, `lib/__tests__/prevention-rbac.test.ts` (~:477)

**Interfaces:**
- Consumes: nada.
- Produces: entrada `9` de `PDTP_2026_ENGANCHE_DESTINATIONS` con `module: "cphs"` y permiso real.

**Por qué:** el contrato declara la N°9 con `sinDestino(...)`, así que la cola manda a su responsable a la
planilla del PDTP en vez de a `/prevencion/cphs`, que es donde `closeManagementReview` cierra la revisión
por la dirección. Y ese acto exige `prevention:governance:review`, que ningún responsable declarado tiene
(`gerente_legal_rrhh`, `jdpr`, `prf`). La compuerta no lo ve porque la entrada está exenta por contrato: es
el mismo patrón que ocultó la N°36, la N°43 y la N°84 en la lista blanca.

Por decisión E05 el permiso se otorga a `prevencionista`, así que la entrada **no** lleva `segregated`.

- [ ] **Step 1: Write the failing tests**

En `lib/__tests__/pdtp-enganche-destinations.test.ts`:

```ts
it("la N°9 se cumple en CPHS y no en la planilla del programa", () => {
  const destino = engancheDestinationFor(9)
  expect(destino?.module).toBe("cphs")
  expect(destino?.permission).toBe("prevention:governance:review")
  expect(destino?.href("ws-1")).toBe("/prevencion/cphs?faena=ws-1")
})
```

En `lib/__tests__/prevention-rbac.test.ts` (~:477), actualizar la lista cerrada, conservando los dos
`not.toContain`:

```ts
    // La revisión por la dirección la cierra la jefatura, y desde 2026-09-06
    // también la Jefa del Depto. de Prevención: es la responsable declarada de
    // la N°9 del programa y sin el permiso la actividad sólo podía marcarse a
    // mano en la planilla.
    expect(rolesFor("prevention:governance:review")).toEqual(["administrador", "jefa_chome", "prevencionista"])
    expect(rolesFor("prevention:governance:review")).not.toContain("cphs")
    expect(rolesFor("prevention:governance:review")).not.toContain("jefe_terreno")
```

Confirmar el orden exacto que `rolesFor` devuelve (alfabético, según las otras aserciones) antes de fijarlo.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-enganche-destinations.test.ts lib/__tests__/prevention-rbac.test.ts
```
Expected: FAIL los dos.

- [ ] **Step 3: Write the implementation**

En `fulfillment-contract-2026.ts`, reemplazar la entrada `9`:

```ts
  /* La cierra `closeManagementReview` en CPHS, que exige
   * `prevention:governance:review`. Estuvo declarada `sinDestino` —"gobernanza,
   * sin permiso propio"— y esa exención hacía dos cosas malas: mandaba a su
   * responsable a la planilla del PDTP en vez de a la reunión, y eximía a la
   * actividad de la verificación de permiso que sí le correspondía. Ninguno de
   * sus tres responsables tenía el permiso y la compuerta no lo reportaba. */
  9: {
    module: "cphs",
    permission: "prevention:governance:review",
    href: (worksiteId) => `/prevencion/cphs?faena=${worksiteId}`,
  },
```

En `modules/prevention/manifest.ts`, agregar a `defaultGrants`, junto a los otros grants de
`prevencionista`:

```ts
    { roleSlug: "prevencionista",      permission: "prevention:governance:review" },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-enganche-destinations.test.ts lib/__tests__/prevention-rbac.test.ts lib/__tests__/navigation-targets-exist.test.ts
```
Expected: PASS. El test de navegación recorre el contrato completo y confirma que `/prevencion/cphs` existe.

- [ ] **Step 5: Aplicar el grant y verificar el conteo de responsables**

```bash
npm run db:sync-rbac && npm run db:preflight-pdtp-wiring | grep -A 25 responsibleExecution
```
Expected: `ok` sube de 76 a 77 y la N°9 desaparece de la columna "no puede" del rol.

- [ ] **Step 6: Commit**

```bash
git add lib/services/pdtp-adapters/fulfillment-contract-2026.ts modules/prevention/manifest.ts lib/__tests__
git commit -m "fix(pdtp): la N°9 declara su destino real en CPHS y su responsable puede cerrarla"
```

---

### Tarea 8: La compuerta exige instrumento vigente, no sólo declarado

**Files:**
- Create: `lib/services/pdtp/instruments.ts`
- Modify: `lib/services/pdtp/fulfillment.ts`, `lib/services/pdtp/lifecycle.ts` (~:16-47, ~:199, ~:304), `scripts/preflight-pdtp-accreditation-wiring.ts`
- Test: `lib/__tests__/pdtp-fulfillment.test.ts`

**Interfaces:**
- Consumes: `wiringIssueFor` con exclusiones (Tarea 1); membresía declarada (Tarea 2).
- Produces:
  - `PdtpFulfillmentCoverageStatus` gana el valor `"instrument_required"`.
  - `fulfillmentActivationBlockers(issues: PdtpFulfillmentCoverageIssue[]): string[]` en `lifecycle.ts`, que **sí** incluye `instrument_required`, frente a `fulfillmentCoverageBlockers`, que no.
  - `usablePdtpInstrumentNumbers(client): Promise<{ global: Set<number>; perWorksite: Map<number, Set<string>> }>` en `instruments.ts`.

**Por qué:** la compuerta da por cableada una actividad cuyo número aparece en cualquier fila, sin mirar el
estado. Hoy eso significa que reporta 0 bloqueadores mientras 13 plantillas de inspección están en
borrador, 13 cursos no tienen ninguna versión publicable y 7 planes de emergencia están en borrador: 28
actividades imposibles de ejecutar y la compuerta en verde.

**Dónde bloquear.** `instrument_required` bloquea la **activación** y sólo advierte al enviar a revisión.
Enviar a revisión es sobre el contenido firmado; activar es sobre que el programa sea ejecutable. Verificado
que la separación no crea bloqueo circular: aprobar plantillas, publicar cursos y aprobar planes **no**
toca el digest de contenido (`computePdtpProgramContentDigest` sólo lee tablas `pdtp_*`), así que toda la
Fase 4 puede ocurrir entre el envío a revisión y la activación sin invalidar las firmas.

**Cómo, sin romper los tests existentes.** No se narran los cargadores de declaración: `config_required`
sigue significando "nadie declara este número". Se agrega una comprobación aparte de usabilidad, así que el
test de planes de emergencia ([pdtp-fulfillment.test.ts:318-343](lib/__tests__/pdtp-fulfillment.test.ts#L318-L343)),
que siembra planes en `draft` y afirma que `config_required` se limpia, sigue pasando sin tocarlo.

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/pdtp-fulfillment.test.ts`:

```ts
it("una plantilla en borrador declara el número pero no lo vuelve ejecutable", async () => {
  await seedProgram("draft")
  await seedActivity({ n: 24, mechanism: "enganche", evidenceRequirement: null })
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.preventionInspectionTemplates).values({
    id: "tpl-draft-24", code: "inspeccion_extintores", versionLabel: "02", status: "draft",
    title: "Inspección de extintores", executorOfRecord: "platform_user",
    pdtpActivityNumbers: [24], createdByUserId: USER_ID, createdAt: now, updatedAt: now,
  })

  const issues = await assertPdtpFulfillmentCoverage(PROGRAM_ID)
  const n24 = issues.filter((issue) => issue.n === 24)
  expect(n24).toEqual([expect.objectContaining({ status: "instrument_required" })])
  expect(n24[0]!.reason).toContain("aprobada")
})

it("aprobar la plantilla limpia el bloqueo de instrumento", async () => {
  // …mismo montaje, status "approved" con approvedByUserId/approvedAt (el CHECK
  // de la tabla los exige) → sin issues para n=24.
})
```

Leer `db/schema/prevention/inspections.ts` para los campos obligatorios de la plantilla antes de escribirlo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts -t "instrumento"`
Expected: FAIL — hoy no se emite ningún issue para n=24.

- [ ] **Step 3: Write `lib/services/pdtp/instruments.ts`**

```ts
/**
 * lib/services/pdtp/instruments.ts
 *
 * "El instrumento que acredita este número está vigente", en un solo lugar.
 *
 * Declarar no es poder ejecutar, y la compuerta confundía las dos cosas: daba
 * por cableada una actividad cuya plantilla estaba en borrador —y sólo una
 * plantilla `approved` se puede programar o ejecutar—, cuyo curso no tenía
 * ninguna versión `published` —`createTrainingSession` la exige— o cuyo plan de
 * emergencia seguía en `draft`, que es lo que la N°84 necesita aprobado para
 * poder programar un simulacro.
 *
 * El preflight ya calculaba una parte de esto por su cuenta y la dejaba fuera
 * de su propio `ok`. Dos lugares que opinan sobre lo mismo se desincronizan y
 * el que avisa termina mintiendo, así que la respuesta vive acá y los dos la
 * consultan.
 *
 * `sst_document_types` no participa: no tiene columna de estado, y el
 * instrumento de la N°36 y la N°43 es el documento publicado, que es un hecho y
 * no una configuración.
 */
export async function usablePdtpInstrumentNumbers(client: QueryClient): Promise<{
  global: Set<number>
  perWorksite: Map<number, Set<string>>
}>
```

Implementación:
- `global`: números de `preventionInspectionTemplates` con `status = 'approved'`, más números de
  `preventionTrainingCourses` que tengan al menos una `preventionTrainingCourseVersions` con
  `status = 'published'` (el join que el preflight ya hace en
  [preflight-pdtp-accreditation-wiring.ts:140-149](scripts/preflight-pdtp-accreditation-wiring.ts#L140-L149)),
  más los números de `sstDocumentTypes` sin condición de estado.
- `perWorksite`: campañas sin condición de estado (una campaña en borrador es trabajo por hacer, no un
  instrumento faltante), y planes de emergencia con `status = 'approved'` — excluyendo `archived`, que es
  el tercer valor del CHECK.

- [ ] **Step 4: Enchufarlo en la compuerta y separar los bloqueadores**

En `lib/services/pdtp/fulfillment.ts`:
1. Agregar `"instrument_required"` a `PdtpFulfillmentCoverageStatus`, con el comentario de por qué bloquea
   activación y no envío a revisión.
2. En `assertPdtpFulfillmentCoverage`, llamar a `usablePdtpInstrumentNumbers(client)` una vez, junto a los
   otros cargadores:

```ts
  const { global: usableGlobally, perWorksite: usablePerWorksite } = await usablePdtpInstrumentNumbers(client)
```
3. Después del bloque de `wiringIssueFor` y antes del de destino, para `enganche` y `compuesta`:

```ts
      // Declarado no es vigente. Va después del cableado —una actividad sin
      // número declarado ya salió como `config_required` y repetirlo sería
      // ruido— y antes del destino, porque sin instrumento el permiso del
      // destino es una pregunta prematura.
      if (!STRUCTURALLY_WIRED_ACTIVITY_NUMBERS.has(activity.n)) {
        const issue = instrumentIssueFor(activity, {
          usableGlobally, usablePerWorksite, worksiteIds, worksiteNameById,
          excludedWorksiteIds: excludedByActivity.get(activity.id) ?? new Set<string>(),
        })
        if (issue) { issues.push(issue); continue }
      }
```

`instrumentIssueFor` espeja a `wiringIssueFor` —misma resta de exclusiones, misma lógica por faena— y emite
`status: "instrument_required"` con un motivo que nombre el acto que falta: "su plantilla no tiene una
versión aprobada", "su curso no tiene ninguna versión publicada", "su plan de emergencia no está aprobado
en N faenas: …".

`STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` corta antes, así que el estado sólo alcanza a los grupos de
inspecciones y capacitación más la N°84 y las campañas. La N°83 no lo necesita: su número está fijo en el
conector.

En `lib/services/pdtp/lifecycle.ts`:
- Agregar `instrument_required` a `COVERAGE_STATUS_LABELS` y al mapa `labels` de
  `fulfillmentCoverageBlockers`, y hacer que esa función lo **omita** (junto a `decision_required` y
  `destination_review`).
- Crear `fulfillmentActivationBlockers(issues)`, que omite sólo `decision_required` y
  `destination_review`, y usarla en `activatePdtpProgram` (~:304) en lugar de `fulfillmentCoverageBlockers`.
- En `getPdtpCoverageReport`, el campo `blocks` de un grupo `instrument_required` es `true`, y agregar un
  campo que distinga "bloquea activación" de "bloquea envío" para que el panel no mienta. Si eso obliga a
  cambiar el tipo `PdtpCoverageReport`, actualizar `coverage-report-panel.tsx` en el mismo commit.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-fulfillment.test.ts lib/__tests__/prevention-pdtp.test.ts
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-2026-contract.test.ts
npm run typecheck
```
Expected: PASS, incluidos los tests preexistentes de planes de emergencia y de `compuesta` sin
modificarlos.

- [ ] **Step 6: Verificar contra la base real**

Run: `npm run db:preflight-pdtp-wiring | grep -c instrument_required`
Expected: 28 actividades aproximadamente (13 inspecciones + 13 capacitación + N°84 y campañas según el
estado del día), que es exactamente lo que la Fase 4 tiene que cerrar.

- [ ] **Step 7: Commit**

```bash
git add lib/services/pdtp/instruments.ts lib/services/pdtp/fulfillment.ts lib/services/pdtp/lifecycle.ts app/\(app\)/prevencion/pdtp scripts/preflight-pdtp-accreditation-wiring.ts lib/__tests__
git commit -m "feat(pdtp): la compuerta exige instrumento vigente antes de activar el programa"
```

---

### Tarea 9: Una constancia no se envía sin la evidencia que declara

**Files:**
- Modify: `lib/services/pdtp/executions.ts` (~:20-45), `app/(app)/prevencion/pdtp/pdtp-execution-form.tsx`, `app/(app)/prevencion/constancias/constancias-workbench.tsx`
- Test: `lib/__tests__/pdtp-evidence-validation.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `PdtpExecutionForm` gana las props opcionales `evidenceRequirement?: string | null` y `defaultWeek?: number`.

**Por qué:** las 9 constancias declaran evidencia mínima y la compuerta la exige para enviar el programa a
revisión, pero al ejecutar la constancia esa exigencia es sólo un texto en la tarjeta:
`pdtpExecutionSchema` deja evidencia opcional y `markPdtpExecution` no consulta `evidenceRequirement`. La
única red es el aprobador.

**Dónde validar.** En `markPdtpExecution`, no en el esquema. El esquema es agnóstico de la actividad (no
tiene acceso a la base), lo comparten los dos caminos, y
[lib/__tests__/pdtp-evidence-validation.test.ts](lib/__tests__/pdtp-evidence-validation.test.ts) lo parsea
sin evidencia en varios casos legítimos. El servicio ya carga la actividad, así que basta agregar la
columna al `select`.

Queda una asimetría que hay que dejar escrita: `accreditPdtpFromEvent` escribe ejecuciones sin pasar por
`markPdtpExecution`, así que lo acreditado por integración está exento de esta regla. Por eso la Tarea 4
pasa un `evidenceRef` real.

- [ ] **Step 1: Write the failing test**

En `lib/__tests__/pdtp-evidence-validation.test.ts` o en el test PGlite de constancias, según dónde estén
los casos de servicio:

```ts
it("rechaza una constancia sin evidencia cuando la actividad declara una", async () => {
  await expect(markPdtpExecution({
    activityId: ACT_ID, worksiteId: WS_ID, year: YEAR, month: MONTH, week: 1,
    executedQuantity: 1, evidenceText: "", evidenceUrl: "", evidencePhotos: [],
  }, USER_ID, "all")).rejects.toThrow(/evidencia/i)
})

it("acepta la misma constancia con una observación que la respalda", async () => {
  // La actividad declara "Acta de difusión firmada"; el texto de evidencia
  // cuenta, porque no toda constancia tiene archivo.
  await expect(markPdtpExecution({
    activityId: ACT_ID, worksiteId: WS_ID, year: YEAR, month: MONTH, week: 1,
    executedQuantity: 1, evidenceText: "Acta firmada por los 12 asistentes", evidenceUrl: "", evidencePhotos: [],
  }, USER_ID, "all")).resolves.toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-constancias.test.ts`
Expected: FAIL — el primer caso resuelve en vez de rechazar.

- [ ] **Step 3: Write the implementation**

En `lib/services/pdtp/executions.ts`, agregar `evidenceRequirement: pdtpActivities.evidenceRequirement` al
`select` de la actividad (~:20-24) y validar justo después del guard de período de activación (~:43-45),
para que el orden de errores siga siendo "por qué no puedes" antes de "qué te falta":

```ts
  // La actividad declara qué evidencia exige y hasta ahora eso era sólo un
  // texto en la tarjeta: el esquema deja la evidencia opcional y la única red
  // era el aprobador. Lo acreditado por integración no pasa por acá y queda
  // exento a propósito — su evidencia es el registro del módulo de origen.
  const requirement = activity.evidenceRequirement?.trim()
  const hasEvidence = Boolean(data.evidenceText?.trim())
    || Boolean(data.evidenceUrl?.trim())
    || (data.evidencePhotos?.length ?? 0) > 0
  if (requirement && !hasEvidence) {
    throw new Error(`Esta actividad exige evidencia: ${requirement}`)
  }
```

En `pdtp-execution-form.tsx`, agregar las props `evidenceRequirement` y `defaultWeek`, mostrar el requisito
junto al campo de evidencia y marcarlo como obligatorio cuando venga. En `constancias-workbench.tsx`,
pasar `evidenceRequirement={row.evidenceRequirement}` —el dato ya viaja en la fila y se descartaba en el
borde del formulario— y `defaultWeek` si la fila lo puede aportar.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-constancias.test.ts
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp-evidence-validation.test.ts lib/__tests__/pdtp-execution-action.test.ts
```
Expected: PASS. Verificar que los casos preexistentes que parsean el esquema sin evidencia siguen verdes:
la validación es del servicio, no del esquema.

- [ ] **Step 5: Commit**

```bash
git add lib/services/pdtp/executions.ts app/\(app\)/prevencion/pdtp/pdtp-execution-form.tsx app/\(app\)/prevencion/constancias/constancias-workbench.tsx lib/__tests__
git commit -m "fix(pdtp): exigir la evidencia mínima que la actividad declara al registrar cumplimiento"
```

---

### Tarea 10: Revocaciones faltantes y código muerto

**Files:**
- Modify: `lib/services/prevention-cphs.ts` (`dissolveCommittee` ~:149, `expireLapsedCommittees` ~:963), `lib/services/prevention-cgrd.ts` (`dissolveGrdCommittee` ~:264, `cancelGrdMeeting` ~:644), `lib/services/prevention-emergency.ts` (`cancelEmergencyDrill` ~:735), `lib/services/sst-module/evaluations.ts` (`deleteEvaluation` ~:313)
- Delete: `resolveWorkerEntryActor` en `lib/services/pdtp-adapters/worker-lifecycle-connector.ts:133`, `invalidateClosedIndicatorPeriod` en `lib/services/prevention-indicadores.ts:845`
- Test: `lib/__tests__/pdtp-revocations.test.ts` (nuevo, PGlite), `tests/pglite-files.ts`

**Interfaces:**
- Consumes: el reconciliador que no resucita revocados (Tarea 6). **Sin esa tarea, estas revocaciones se deshacen solas en el siguiente barrido.**
- Produces: nada nuevo. Reutiliza `recordPdtpFulfillmentRevocation`.

**Por qué:** cinco dominios acreditan y tienen la operación inversa, y la operación inversa no revoca:
disolver un comité paritario (N°11), disolver el comité GRD (N°79), cancelar un acta CGRD (N°81), cancelar
un simulacro (N°84) y borrar un acta SST (N°15, 17, 18, 19, 23, 52, 63). El acta merece un comentario
propio: el conector se justificó diciendo que es inmutable por DS 44, y `deleteEvaluation` existe y
contradice esa premisa —aunque se niega a borrar una cerrada, que es justamente la que acredita, así que la
revocación ahí es defensa en profundidad y no un agujero abierto.

**Patrón único a copiar:** `cancelTrainingSession`
([prevention-training.ts:517-522](lib/services/prevention-training.ts#L517-L522)) — acumular el payload
dentro de la transacción en un `let`, disparar después de que retorne, sin propagar el error.

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/pdtp-revocations.test.ts`, con el boilerplate PGlite habitual y un caso por dominio. El
esqueleto de uno, replicado para los cinco:

```ts
it("cancelar un simulacro revoca la acreditación de la N°84", async () => {
  // …sembrar plan aprobado con pdtpActivityNumbers [84], programar y completar
  // el simulacro, comprobar que hay una ejecución.
  await cancelEmergencyDrill({ drillId: DRILL_ID, expectedVersion: 1, reason: "Se reprograma por lluvia" }, access)

  const revocacion = (await inMemoryDb.select().from(schema.pdtpFulfillmentEvents))
    .find((event) => event.eventType === "revoked" && event.sourceId === DRILL_ID)
  expect(revocacion?.status).toBe("revoked")
})
```

Registrar el archivo en `tests/pglite-files.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-revocations.test.ts`
Expected: FAIL los cinco — no se escribe ningún evento de revocación.

- [ ] **Step 3: Write the implementations**

Cinco cambios del mismo molde. `sourceType` y `sourceId` tienen que coincidir **exactamente** con lo que
usó el conector que acreditó, porque `revokePdtpAccreditationWithClient` los compara literalmente:

| Función | `sourceType` | `sourceId` | Motivo |
|---|---|---|---|
| `dissolveCommittee`, `expireLapsedCommittees` | `"cphs"` | id del comité | comité disuelto / mandato vencido |
| `dissolveGrdCommittee` | `"cgrd"` | id del comité GRD | comité disuelto |
| `cancelGrdMeeting` | `"cgrd"` | el mismo id que usó `onGrdMeetingClosed` | acta cancelada |
| `cancelEmergencyDrill` | `"emergencia"` | id del simulacro | simulacro cancelado |
| `deleteEvaluation` | `"evaluacion_sst"` | el mismo id que usó el conector, incluido el prefijo `sensibles:` cuando corresponda | acta eliminada |

Leer cada conector antes de escribir el `sourceId`: el de personas sensibles usa `sensibles:${evaluationId}`
y el de trabajador nuevo no, así que `deleteEvaluation` tiene que revocar los dos según el
`definicionCode` del acta que borra.

`expireLapsedCommittees` es un barrido que devuelve varias filas: recorrerlas y revocar una por una después
del commit, sin abortar el barrido si una falla.

Borrar las dos funciones muertas y comprobar que nada las importa:

```bash
grep -rn "resolveWorkerEntryActor\|invalidateClosedIndicatorPeriod" lib app scripts --include=*.ts --include=*.tsx
```

`invalidateClosedIndicatorPeriod` tiene una hermana `invalidateClosedIndicatorPeriodWithClient` que sí se
usa: borrar sólo la que no tiene llamadores, y si algún test cubre la muerta, moverlo a la viva.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.pglite.config.ts lib/__tests__/pdtp-revocations.test.ts lib/__tests__/pdtp-indicators-reopen-revocation.test.ts
npm run typecheck && npm run lint
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/prevention-cphs.ts lib/services/prevention-cgrd.ts lib/services/prevention-emergency.ts lib/services/sst-module/evaluations.ts lib/services/pdtp-adapters/worker-lifecycle-connector.ts lib/services/prevention-indicadores.ts lib/__tests__ tests/pglite-files.ts
git commit -m "fix(pdtp): revocar la acreditación cuando el hecho de origen se deshace"
```

---

### Tarea 11: Autonomía de firma de la JDPR en capacitación (decisión E05)

**Files:**
- Modify: `modules/prevention/manifest.ts`, `lib/services/prevention-training.ts` (~:203-205)
- Test: `lib/__tests__/prevention-rbac.test.ts` (~:387), test de capacitación existente

**Interfaces:**
- Consumes: nada.
- Produces: nada nuevo. Reutiliza `canSignOwnWork` de [lib/services/prevention-signing.ts:31](lib/services/prevention-signing.ts#L31).

**Va al final a propósito.** No desbloquea nada: la Fase 4 puede publicar los 13 cursos hoy con la JDPR
redactando (`training:manage`) y la jefa Chome publicando. Es una mejora de autonomía, y su riesgo —la
cadena de firmas de contenido auditable concentrada en una persona— está declarado en la Fase 0 y
reafirmado por el usuario. Si algo de la Fase 4 apura, esta tarea se puede diferir sin costo.

**Mitigación aplicada:** la excepción se limita al último eslabón. Aprobar sigue exigiendo no haber
redactado, para todos; sólo publicar una versión ya aprobada admite la excepción. Es exactamente la regla
que `prevention-signing.ts` documenta para MIPER, matriz GRD y documentación SST, así que capacitación deja
de ser el caso especial.

- [ ] **Step 1: Write the failing tests**

En `lib/__tests__/prevention-rbac.test.ts` (~:387):

```ts
    // Desde 2026-09-06 la JDPR también aprueba y publica contenido formativo:
    // es la responsable declarada de los cursos del programa y sin el permiso
    // dependía de jefatura para dictar cualquier sesión. La segregación se
    // conserva por actor, no por rol: `prevention:sign_own_work` sólo la exime
    // del último eslabón (publicar), y aprobar sigue exigiéndole no haber
    // redactado la versión.
    expect(rolesFor("prevention:training:approve")).toEqual(["administrador", "jefa_chome", "prevencionista"])
```

Y en el test de capacitación (buscar el que cubre `transitionTrainingCourseVersion`):

```ts
it("la jefatura técnica publica su propia versión aprobada, pero no la aprueba", async () => {
  // Con `prevention:sign_own_work`, el autor puede pasar approved → published.
  await expect(transitionTrainingCourseVersion(
    { versionId: VERSION_ID, toStatus: "published", expectedVersion: 3 },
    { userId: AUTHOR_ID, permissions: ["prevention:training:approve", "prevention:sign_own_work"], /* … */ },
  )).resolves.toBeDefined()
})

it("ni con la excepción puede aprobar la versión que redactó", async () => {
  await expect(transitionTrainingCourseVersion(
    { versionId: DRAFT_IN_REVIEW_ID, toStatus: "approved", expectedVersion: 2 },
    { userId: AUTHOR_ID, permissions: ["prevention:training:approve", "prevention:sign_own_work"], /* … */ },
  )).rejects.toThrow(/no puede aprobar/i)
})
```

Ajustar la forma de `access` a la que el servicio realmente recibe (`TrainingAccess`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/prevention-rbac.test.ts -t "training"
```
Expected: FAIL la lista cerrada, y el caso de publicación con excepción.

- [ ] **Step 3: Write the implementation**

En `modules/prevention/manifest.ts`, junto a los otros grants de `prevencionista`:

```ts
    { roleSlug: "prevencionista",      permission: "prevention:training:approve" },
```

En `lib/services/prevention-training.ts`, reemplazar el chequeo incondicional de ~:203-205:

```ts
    // Aprobar exige no haber redactado, para todos. Publicar —el último
    // eslabón— admite la única excepción declarada del módulo: la jefatura
    // técnica responde por el contenido y no puede quedar esperando que un
    // tercero firme su propio criterio. Misma regla que MIPER, matriz GRD y
    // documentación SST; ver lib/services/prevention-signing.ts.
    if (data.toStatus === "approved" && current.authorUserId === access.userId) {
      throw new Error("El autor del contenido no puede aprobar su propia versión.")
    }
    if (data.toStatus === "published"
      && current.authorUserId === access.userId
      && !canSignOwnWork(access.permissions)) {
      throw new Error("El autor del contenido no puede publicar su propia versión.")
    }
```

Importar `canSignOwnWork` desde `@/lib/services/prevention-signing`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/prevention-rbac.test.ts
npx vitest run --config vitest.pglite.config.ts -t "capacitación"
npm run db:sync-rbac
```
Expected: PASS y el grant aplicado.

- [ ] **Step 5: Commit**

```bash
git add modules/prevention/manifest.ts lib/services/prevention-training.ts lib/__tests__
git commit -m "feat(prevencion): la jefatura tecnica publica contenido formativo con la excepcion declarada"
```

---

# Fase 3 · Verificación integral antes de tocar datos

- [ ] **Step 1: Suite completa y build**

```bash
npm run typecheck
npm run lint
npm run test:fast
npm run test:pglite
npm run build
```
Expected: todo verde. `test:pglite` es la compuerta de CI y esta remediación toca ocho de sus archivos.

- [ ] **Step 2: Diagnóstico contra la base de desarrollo**

Run: `npm run db:preflight-pdtp-wiring > /tmp/preflight-post-codigo.json && head -80 /tmp/preflight-post-codigo.json`

Expected, y **esto es el criterio de salida de las Fases 1 y 2**:
- `ok: false`, con los bloqueos concentrados en `instrument_required` (las 28 de la Fase 4), no en
  `config_required`.
- `fulfillmentBacklog` en ceros.
- `responsibleExecution.ok` en 77 (la N°9 entró) y `soloManual` en 0.
- `worksitesWithoutEmergencyPlan` sin Oficina Central.

- [ ] **Step 3: Verificación en la aplicación**

Levantar la app y recorrer, con la sesión de un `prevencionista_faena`:
`/pendientes` (ninguna tarjeta del PDTP lleva a la planilla ni a una ruta inexistente),
`/prevencion/constancias` (el requisito de evidencia se ve y el envío sin evidencia se rechaza),
`/prevencion/pdtp/[programId]` (el panel de backlog no aparece porque está en cero),
y una entrega de EPP en `/entregas` seguida de su anulación, comprobando en
`pdtp_fulfillment_events` el par `completed` + `revoked`. Guardar la evidencia Playwright de los dos
recorridos que cambian comportamiento visible.

---

# Fase 4 · Runbook de datos y activación

Sin código. El orden importa y está forzado por lo que el digest de contenido congela.

**Antes de enviar a revisión** (el programa tiene que seguir en `draft`):

- [ ] **1. Congelar la fecha de activación con la jefatura** y reprogramar el calendario con ese mes:
  ```bash
  PDTP_REPROGRAM_FROM_MONTH=<mes> PDTP_REPROGRAM_EXPORT=/tmp/reprogramacion.xlsx \
    npx tsx --env-file=.env.local scripts/reprogram-pdtp-2026-schedule.ts   # dry-run
  ```
  Revisar la carga por mes resultante con la jefatura, obtener la firma sobre el Excel, y sólo entonces
  aplicar con `PDTP_REPROGRAM_DRY_RUN=false`. El script es re-ejecutable mientras el programa siga en
  borrador: si la fecha se corre, se vuelve a correr con el mes nuevo.
- [ ] **2. Aplicar el alcance por faena** con la tabla de exclusiones ya decidida:
  `npm run pdtp:apply-worksite-scope`
- [ ] **3. Confirmar la semántica de la N°19 y la N°17** con la jefatura (§6 de la auditoría). Si la N°19 se
  mide en Documentación y no en el acta, o si la N°17 es un barrido anual, los dos cambios son de contenido
  y **tienen que entrar acá**, no después.

**Enviar a revisión y firmar:**

- [ ] **4. Enviar el programa a revisión.** `instrument_required` sólo advierte en este paso; si aparece un
  `config_required` o un `permission_gap`, resolverlo antes.
- [ ] **5. Firma JDPR y firma Legal/RRHH.** Al firmar el paso legal se emite el evento de la N°1, que queda
  `pending`; se acredita en el paso 10.

**Configurar instrumentos** (no toca el digest, puede ir después de la firma):

- [ ] **6. Resolver el duplicado de `inspeccion_taller`** —dos borradores, `001` y `02`, ambos declarando la
  N°27— y aprobar las 13 plantillas de inspección desde `/prevencion/inspecciones`. Aprobar exige
  `prevention:inspections:approve` (`administrador`, `prevencionista`) y marca la versión anterior como
  `superseded`. Verificar que `reporte_equipos` queda vigente en la v02 con
  `executor_of_record = declared_in_form`, que es la decisión D04.
- [ ] **7. Crear y publicar una versión por cada uno de los 13 cursos** del programa. La JDPR redacta con
  `training:manage`; publica ella misma si ya se aplicó la Tarea 11, o la jefa Chome si no. El curso
  `PDTP-16` **tiene que llevar evaluación con nota de corte**: la actividad es "prueba de evaluación IRL" y
  con `assessmentType: "none"` acreditaría a todo asistente sin evaluar a nadie.
- [ ] **8. Aprobar los 7 planes de emergencia.** Desbloquea la N°83 y la N°84. Aprueban `prevencionista`,
  `jefa_chome` o `administrador`, y el servicio rechaza que el aprobador sea quien creó el plan.
- [ ] **9. Confirmar que la compuerta quedó limpia:**
  `npm run db:preflight-pdtp-wiring | grep -E '"ok"|instrument_required|config_required'`
  Expected: `ok: true`.

**Activar y observar:**

- [ ] **10. Activar el programa.** La compuerta de activación ahora incluye `instrument_required`, así que
  no puede activarse prometiendo trabajo sin instrumento. Al activar se dispara la reconciliación y la N°1
  pasa de `pending` a acreditada.
- [ ] **11. Observar la primera semana:** `fulfillmentBacklog` en el panel del programa (pendientes y
  errores en cero), `/pendientes` sin tarjetas de meses anteriores a la activación, y el indicador de
  cumplimiento moviéndose con los primeros hechos reales.
- [ ] **12. Verificar producción aparte:** correr el preflight contra producción y contrastar. Los scripts
  de despliegue siembran plantillas, cursos, tipos y campañas, pero **no** aprueban plantillas, no crean
  versiones de curso ni aprueban planes: los pasos 6, 7 y 8 hay que hacerlos en cada entorno.
- [ ] **13. Asignar faenas en `worksite_users`** a los usuarios de `supervisor_terreno`, `jefe_terreno`,
  `admin_contrato` y `jefe_mantencion`, y **resolver el rol legado `supervisor_faena`**, que existe en base
  con un usuario y no en `lib/auth/system-rbac.ts`. Sin alcance por faena los permisos no sirven: es
  ortogonal al grant. Queda del informe del 5 de septiembre y sigue abierto.

---

## Verificación de la entrega

**Por tarea:** cada una cierra con sus tests focalizados verdes y su commit. Las Tareas 1, 4, 5, 6, 8, 9 y
10 son PGlite y corren con `vitest.pglite.config.ts`; las Tareas 3, 7 y 11 son del proyecto por defecto.

**De la remediación completa, antes de la Fase 4:**

```bash
npm run typecheck && npm run lint && npm run test:fast && npm run test:pglite && npm run build
npm run db:preflight-pdtp-wiring
```

**Criterio de salida del código** (Fases 1-3): el preflight reporta `ok: false` con los bloqueos
exclusivamente en `instrument_required`, `fulfillmentBacklog` en ceros, `responsibleExecution` en 77 `ok`
y 0 `soloManual`, y ninguna faena sin plan por fuera del alcance declarado.

**Criterio de salida de la entrega** (Fase 4): el preflight reporta `ok: true`, el programa está `active`,
la N°1 acreditada, y las 81 actividades tienen instrumento vigente, responsable con permiso y destino
resoluble.

**Recorridos de navegador exigidos** (contrato de QA del repositorio, para lo visible en la aplicación):
registrar una constancia con y sin evidencia; abrir una tarjeta del PDTP desde `/pendientes` y comprobar
que aterriza en el módulo de origen prefiltrado; registrar y anular una entrega de EPP; abrir la ficha del
programa con y sin backlog. No hace falta un recorrido por cada una de las 81: los que comparten adaptador
comparten prueba, y la prueba de contrato es la que enumera las 81.

## Lo que este plan deja fuera, a propósito

Cinco cosas de la auditoría no entran, y conviene que estén dichas en vez de descubiertas después. Ninguna
bloquea la activación.

1. **La cola de pendientes sigue sin leer los overrides por faena** mientras Constancias sí los aplica, así
   que los comentarios que afirman que las dos "cuentan exactamente lo mismo" seguirán siendo falsos en ese
   borde. No importa hoy porque `pdtp_activity_schedule_overrides` está en cero filas, y empieza a importar
   el primer día que alguien cree un override sobre el programa activo.
2. **Una sesión de capacitación cerrada sin nadie que obtenga la competencia acredita 1.**
   `onTrainingSessionClosed` usa `Math.max(1, attendedCount)`. Es inocuo para las actividades que se miden
   contra lo planificado e infla en uno las tres que se miden por cobertura (N°16, 54 y 56). Arreglarlo es
   una línea, pero cambia el numerador de un indicador firmado: es decisión de la jefatura, no de la
   remediación.
3. **La N°11 acredita por dos caminos** —ejecución directa y obligación— y como se mide por `closed_on_time`
   la ejecución se ignora. Es redundante, no doble: no altera el indicador.
4. **La N°35 y la N°80 conservan la acreditación de una matriz que quedó `superseded`.** Es defendible —la
   publicación anterior ocurrió de verdad— pero no está razonado por escrito, a diferencia del acta
   inmutable y de los protocolos MINSAL, que sí llevan su justificación en el código.
5. **La etapa `in_review` de las versiones de curso no tiene segregación por actor**, así que la mitigación
   de la Tarea 11 protege el paso de aprobación y no el de revisión. Cerrarlo exigiría tocar la máquina de
   estados de capacitación completa, que es más de lo que esta remediación abarca.

# Análisis en profundidad — Módulo de Prevención

**Fecha:** 2026-07-15 · **Rama:** `Allopze/feat/move-buttons-to-pageheader-actions` · **Verificado contra el working tree actual**

**Método:** lectura dirigida de la capa completa (páginas → server actions → servicios → schema → rutas API → crons → manifests RBAC), greps de reglas transversales del repo, y verificación ejecutable: **113 tests de prevención en verde** (14 archivos, vitest) y **`npm run typecheck` limpio**.

---

## 1. Contexto: el módulo ya no es el que describen las auditorías previas

El 2026-07-02, el commit `06db2f0` **podó deliberadamente 14 submódulos** de prevención (alcotest, capacitaciones, comités, contratistas, emergencias, EPP, equipos, incidentes, inspecciones, IPER, KPIs, permisos, salud, y sus 13 rutas de export), y renombró `biblioteca` → `documentacion` (con redirects permanentes en `next.config`). La poda fue limpia: se llevó también servicios, schema, validación, tests y permisos — no encontré huérfanos de código de esa limpieza.

**El módulo vivo hoy son 5 submódulos:**

| Submódulo | Rutas | Servicios | Schema |
|---|---|---|---|
| Evaluaciones SST | `/prevencion`, `/prevencion/[id]`, `/nueva`, `/trabajador/[workerId]` | `lib/services/sst-module/` (9 archivos) | `db/schema/sst.ts` |
| PDTP (Programa de Trabajo Preventivo) | `/prevencion/pdtp/**` (8 rutas) | `lib/services/pdtp/` (21 archivos, ~3.600 LOC) | `db/schema/prevention/pdtp.ts` (12 tablas) |
| PPA Digital (público + revisión interna) | `/ppa` (público, PWA offline), `/prevencion/ppa/**` | `lib/services/ppa-module/` | `db/schema/ppa.ts` |
| Documentación (tipo Drive) | `/prevencion/documentacion/**` | `lib/services/prevention-documents/` (11 archivos) | `db/schema/prevention/library.ts` |
| Indicadores de accidentabilidad | `/prevencion/indicadores` | `lib/services/prevention-indicadores.ts` | `db/schema/prevention/safety-indicators.ts` |

Transversal: 2 crons (`/api/cron/sst-weekly-alerts`, `/api/cron/pdtp-weekly-reminders`), 10 rutas API (`/api/prevencion/**`), 3 manifests RBAC (`modules/sst`, `modules/ppa`, `modules/prevention`).

> **Consecuencia documental:** `docs/auditoria/AUDITORIA_PREVENCION.md` y `PLAN_PREVENCION.md` describen el scope pre-poda. Sus "pendientes" (índice de gravedad IG, stock EPP, DIAT, escalamiento alcotest, matriz de capacitación, etc.) refieren a features **que ya no existen**. Ver sugerencia S9.

---

## 2. Estado de salud general

| Dimensión | Estado |
|---|---|
| Tests del módulo | ✅ 113/113 en verde (PDTP, PPA, SST, documentación, RBAC) |
| Typecheck | ✅ `tsc --noEmit` sin errores |
| Regla exports Excel (nunca CSV) | ✅ Cumplida en las 4 rutas de export + action de indicadores |
| Reglas de layout (PageHeader/PageContainer, sin `<h1>` sueltos) | ✅ 17/20 páginas; las 3 restantes son stubs `redirect()` (ok) |
| Búsqueda (TopBar vs propia) | ✅ `/prevencion/ppa` está en `ROUTES_WITH_OWN_SEARCH` y es la única con input propio |
| Toasts | ✅ Todos vía `@/lib/toast`, ninguno importa `sonner` directo |
| Scoping por faena | ✅ Patrón `resolveWorksiteScope` + `scopeToIds` consistente en todas las capas |
| Índices/uniques de schema | ✅ Muy completo (uniques compuestos en ejecuciones, overrides, respuestas, action plan) |

El módulo está en **buen estado estructural**. Los hallazgos de abajo son mayormente de consistencia, granularidad y un bug funcional real en recordatorios.

---

## 3. Hallazgos (ordenados por severidad)

### H1 — Bug funcional: el motor de recordatorios PDTP sobre-notifica 🔴 media-alta

[lib/services/pdtp/reminders.ts:52-99](lib/services/pdtp/reminders.ts#L52-L99) (`findPdtpWeeklyPending`):

1. **Ignora la semana del plan.** Trae actividades planificadas en el mes actual **o el anterior** (línea 59), pero la clave de "ejecutado" que compara es solo `mes-actual::semana-actual` (línea 88). Una actividad planificada solo para la semana 1 y **ya ejecutada en la semana 1** vuelve a marcar "pendiente" en las semanas 2, 3 y 4. Y una actividad planificada solo el mes pasado cuenta como pendiente de esta semana.
2. **Ignora los overrides por faena.** El plan por faena (`pdtp_activity_schedule_overrides`, que `loadProgramScheduleAndExecutions` sí honra para el tablero) no se consulta: una faena con meta 0 en esa celda igual recibe recordatorio.
3. **No filtra faenas inactivas.** `db.select(...).from(worksites)` sin `isActive` (línea 80); toda faena histórica genera targets. El impacto se auto-limita porque una faena inactiva rara vez tiene usuarios con `prevention:pdtp:manage` asignados, pero es ruido y trabajo de más en el cron.

El `dedupeKey` por `(user, faena, año, mes, semana)` acota el spam a 1 notificación semanal, pero esa notificación **es un falso positivo** para los tres casos de arriba. Fix sugerido: construir el set de celdas pendientes a partir de `loadProgramScheduleAndExecutions` (la misma fuente que el tablero), filtrando por `week === period.week` y `worksites.isActive`.

### H2 — Inconsistencia RBAC: ~25 actions PDTP e Indicadores no usan `guardPermission` 🟠 media

Todo PPA, SST y Documentación usa el patrón canónico `guardPermission("permiso")`. En cambio, **todas** las actions de [pdtp/actions.ts](app/(app)/prevencion/pdtp/actions.ts), [pdtp/actions/checklist-actions.ts](app/(app)/prevencion/pdtp/actions/checklist-actions.ts) e [indicadores/actions.ts](app/(app)/prevencion/indicadores/actions.ts) usan:

```ts
const { session, error } = await guardAuth()
if (!session.user.permissions?.includes("prevention:pdtp:manage")) { ... }
```

Funcionalmente equivalente, pero: (a) contradice el criterio de cierre del propio plan del módulo ("`guardPermission(...)` en cada action, no `guardAuth` plano"); (b) pierde el `logger.warn` centralizado de intentos denegados; (c) cada action inventa su propio mensaje de error; (d) el check manual no está tipado contra `Permission` (un typo en el string compila). Es un reemplazo mecánico de ~25 sitios, bajo riesgo, alto valor de consistencia.

### H3 — Granularidad de permisos: `prevention:pdtp:manage` mezcla operación con administración 🟠 media

El mismo permiso habilita **registrar ejecuciones semanales** (operación de terreno) y **crear/editar/eliminar programas, hojas, actividades y objetivos** (administración del catálogo). Según [modules/prevention/manifest.ts](modules/prevention/manifest.ts), `prevencionista_faena`, `admin_contrato` y `jefe_terreno` reciben `manage` — es decir, un jefe de terreno puede borrar un programa draft o renombrar objetivos del programa global.

Mitigantes reales: `deletePdtpProgram`/`updatePdtpProgram`/`importPdtpFromExcel` solo operan sobre programas en `draft` ([programs.ts:180-191](lib/services/pdtp/programs.ts#L180-L191)), y activar exige aprobación JDPR + firma legal. Aun así, un draft en preparación por el prevencionista es borrable por cualquier rol de terreno. Sugerencia: separar `prevention:pdtp:execute` (marcar ejecuciones + overrides propios) de `prevention:pdtp:program:manage` (CRUD estructural), otorgando el segundo solo a `prevencionista`/`administrador`.

### H4 — Ciclo de vida PDTP: un programa `closed` puede reactivarse 🟡 media-baja

[lifecycle.ts:45-72](lib/services/pdtp/lifecycle.ts#L45-L72) (`activatePdtpProgram`) solo rechaza `status === "active"`. Un programa `closed` (que conserva sus aprobaciones JDPR/legal en la fila) pasa todos los guards y vuelve a `active` — cerrando de paso al activo vigente. Esto contradice el comentario del propio archivo ("draft→closed es el estado final") y el changelog escribe `{ status: "draft" } → { status: "active" }` hardcodeado, registrando una transición que no ocurrió. Fix: exigir `status === "draft"` (o registrar el estado real previo si la reactivación es deseada).

### H5 — Concurrencia: check-then-write sin transacción en ejecuciones PDTP 🟡 baja

[executions.ts:33-122](lib/services/pdtp/executions.ts#L33-L122): `markPdtpExecution` lee el estado (`approved` → rechaza) y luego hace el upsert **fuera de transacción**. Una aprobación concurrente entre el SELECT y el upsert deja una ejecución aprobada degradada a `submitted` con el rechazo limpiado. Lo mismo (menor) en `approvePdtpExecution`/`rejectPdtpExecution` (read-then-update). Probabilidad baja con pocos usuarios, pero el fix es barato: upsert condicional (`WHERE status != 'approved'` vía SQL) o envolver en `db.transaction` con el SELECT dentro.

### H6 — Documentación: crear + subir primera versión no es atómico 🟡 baja

[documentacion/actions.ts:84-104](app/(app)/prevencion/documentacion/actions.ts#L84-L104): `createAndUploadSstDocumentAction` hace `createDocument` y luego `uploadDocumentVersion` en llamadas separadas. Si la subida falla (archivo inválido, error de disco), queda un documento sin ninguna versión en la biblioteca. Sugerencia mínima: si `uploadDocumentVersion` lanza, archivar/borrar el doc recién creado en el mismo catch (compensación), o mover la orquestación al servicio dentro de una transacción + escritura de archivo al final.

### H7 — Semántica del indicador de cumplimiento PDTP: confirmar que es la deseada 🟡 decisión de producto

[compliance.ts:57-75](lib/services/pdtp/compliance.ts#L57-L75): el cumplimiento mensual cuenta **actividades distintas** (Sets), no cantidades: una actividad planificada 4 veces en el mes con 1 sola ejecución cuenta como 100% ejecutada ese mes. Además, las ejecuciones en `submitted` (aún no aprobadas) **suman igual que las aprobadas** — el flujo de aprobación no gatea el indicador; un rechazo posterior sí lo descuenta. Ambas pueden ser decisiones válidas, pero inflan el % frente a una lectura por cantidades/solo-aprobadas. Vale dejarlo decidido y documentado (el archivo ya documenta bien la trampa fracción-0-1 vs entero-0-100).

### H8 — Indicadores: export inconsistente y acoplamiento cross-módulo 🟢 menor

[indicadores/actions.ts:45-103](app/(app)/prevencion/indicadores/actions.ts#L45-L103): es el único export del sistema que se hace **en una server action devolviendo base64** en vez de una ruta API con streaming (como PDTP/PPA/documentación). Funciona, pero duplica patrón y paga serialización RSC del archivo completo. Además importa `addExportMetadataSheet` desde `@/lib/combustibles/xlsx-utils` — prevención dependiendo de combustibles. Mover ese helper a `lib/reports/` (donde ya vive `buildXlsxBuffer`) elimina el acople.

### H9 — Evidencia PDTP: la misma URL se guarda duplicada 🟢 menor

[pdtp/actions.ts:63-73](app/(app)/prevencion/pdtp/actions.ts#L63-L73): `markPdtpExecutionAction` mete `evidenceUrl` también como `evidencePhotos[0]`. El dedupe del servicio y el filtro `p !== evidenceUrl` del componente de thumbnails lo esconden en UI, pero el modelo queda con la referencia repetida. O `evidenceUrl` es "el destacado" y no va en el array, o se elimina `evidenceUrl` y todo vive en `evidencePhotos`.

### H10 — Mensajes de error crudos hacia el cliente 🟢 menor

El patrón `return { ok: false, message: (e as Error).message }` en las actions de PDTP y documentación reenvía al navegador cualquier error no controlado (p. ej. un error de driver de Postgres con detalles de constraint). Los servicios lanzan mayormente errores de negocio en español (bien), pero no hay barrera para los inesperados. El cron PDTP ya resuelve esto correctamente (mensaje genérico en producción, [route.ts:38-48](app/api/cron/pdtp-weekly-reminders/route.ts#L38-L48)); replicar el criterio con un helper `toActionError(e)` que solo deje pasar errores de negocio conocidos.

### H11 — Micro-limpiezas 🟢

- [documentacion/actions.ts:312-315](app/(app)/prevencion/documentacion/actions.ts#L312-L315): `canApprove: false, canAck: false, canLink: false` hardcodeados — flags muertos de las features podadas (acks/links); el detalle ya no las renderiza. Quitar los flags y el código condicionado a ellos.
- `documentacion/{nuevo,revisiones,vencimientos}/page.tsx`: stubs de 4 líneas que solo hacen `redirect("/prevencion/documentacion")`. Si son compat de bookmarks, van mejor como `redirects()` en `next.config.ts` (como ya se hizo con `/prevencion/biblioteca`); si no, borrarlos.
- [programs.ts:190](lib/services/pdtp/programs.ts#L190): `void userId` — parámetro sin uso en `deletePdtpProgram` (el changelog no puede sobrevivir al cascade; ok, pero entonces el parámetro sobra).
- [evaluaciones.ts:156-175](lib/services/ppa-module/evaluaciones.ts#L156-L175): `revokePpaToken` consulta la misma fila dos veces (scope check + existencia); una sola query basta.
- `publicToken` PPA se guarda **en texto plano** ([ppa.ts:39](db/schema/ppa.ts#L39)). Con nanoid(32) el brute-force es inviable y el contenido expuesto es acotado, así que es riesgo aceptado — pero si la página de resultado crece en PII (hoy muestra nombre, supervisor, decisión), considerar hashear el token en DB.

---

## 4. Lo que está bien (y conviene proteger)

- **Superficie pública PPA ejemplar:** rate limit escopado por identidad (workerId → RUT → IP) para no castigar NAT compartido, umbral separado para lookup por RUT con telemetría de enumeración, minimización de PII en la respuesta pública (nombre enmascarado, sin RUT/cargo/faena), validación de RUT, cola offline PWA con manejo explícito del fallback del service worker ([app/(public)/ppa/actions.ts](app/(public)/ppa/actions.ts)).
- **Evidencias PDTP bien defendidas:** subida con permiso + scope + magic bytes + límite 25MB; descarga con guard anti-IDOR real (el archivo debe estar referenciado por una ejecución dentro del scope del usuario, con LIKE escapado) y nombre validado anti-traversal; GC de huérfanos con ventana de gracia de 1h y dry-run ([evidence/[name]/route.ts](app/api/prevencion/pdtp/evidence/%5Bname%5D/route.ts), [evidence-gc.ts](lib/services/pdtp/evidence-gc.ts)).
- **Integridad de datos seria:** uniques compuestos en todas las tablas de celdas (ejecución/override/respuesta por período), upserts `onConflictDoUpdate`, transacciones donde importa (activación de programa, import Excel como reemplazo total, cierre de evaluación SST con `assertEditable` dentro de la tx), manejo explícito de carrera en creación de versiones de programa (unique violation → mensaje amistoso).
- **Ciclo de aprobación PDTP con dos firmas** (JDPR + legal) antes de activar, y changelog (`pdtp_change_log`) en lifecycle, metadata, overrides e import.
- **Cultura de comentarios de decisión** (`H-B7`, `Bug C`, `ponytail:`) que explica el porqué de cada guard — hace exactamente lo que este tipo de auditoría necesita.
- **Cobertura de tests real** sobre las partes con lógica: dedupe de recordatorios, revocación de tokens, RBAC, constraints de integridad, GC de evidencias, parser del Excel PDTP.

---

## 5. Sugerencias priorizadas

| # | Acción | Esfuerzo | Impacto |
|---|---|---|---|
| S1 | Arreglar `findPdtpWeeklyPending`: filtrar por semana actual, honrar overrides, excluir faenas inactivas (H1) | Medio | Alto — elimina falsos positivos semanales a todos los responsables |
| S2 | Reemplazo mecánico `guardAuth`+includes → `guardPermission` en PDTP/indicadores (H2) | Bajo | Consistencia + logging + tipado de permisos |
| S3 | Exigir `status === "draft"` en `activatePdtpProgram` (H4) | Trivial | Cierra hueco de ciclo de vida |
| S4 | Separar permiso `prevention:pdtp:program:manage` del operativo (H3) | Medio | Menor blast radius de roles de terreno |
| S5 | Upsert condicional / transacción en `markPdtpExecution` (H5) | Bajo | Elimina carrera aprobado→submitted |
| S6 | Compensación o transacción en crear+subir documento (H6) | Bajo | Sin docs huérfanos sin versión |
| S7 | Decidir y documentar semántica del % PDTP: ¿cantidades o actividades?, ¿submitted cuenta? (H7) | Decisión | Credibilidad del indicador ante fiscalización |
| S8 | Mover `addExportMetadataSheet` a `lib/reports/` y (opcional) el export de indicadores a ruta API (H8) | Bajo | Desacopla prevención de combustibles |
| S9 | Archivar o re-baselinear `docs/auditoria/{AUDITORIA,PLAN}_PREVENCION.md` post-poda | Bajo | Evita que futuras sesiones "implementen pendientes" de features eliminadas |
| S10 | Micro-limpiezas de H9–H11 | Bajo | Higiene |

---

*Generado el 2026-07-15 analizando el working tree de `Allopze/feat/move-buttons-to-pageheader-actions` (incluye todo lo mergeado de `feat/shell-cohesion` y la poda `06db2f0`). Verificación: 113 tests de prevención en verde, typecheck limpio.*

---

## 6. Estado de implementación — 2026-07-15

| Hallazgo | Estado | Corrección aplicada |
|---|---|---|
| H1 | Resuelto | Recordatorios calculados desde la planificación efectiva por faena, respetando semana, overrides y faenas activas. |
| H2 | Resuelto | Actions PDTP, checklist e indicadores unificadas bajo `guardPermission`. |
| H3 | Resuelto | Se separó `execute` de `program:manage`: ejecución para Prevención, Prevención faena, Administración de contrato, Jefatura de terreno y Administración; catálogo, cronograma y overrides solo para Jefa del Dpto. de Prevención de riesgos y Administración. El permiso anterior se retira también de grants directos al sincronizar RBAC. |
| H4 | Resuelto | Activación permitida solo desde `draft` y changelog con estado anterior real. |
| H5 | Resuelto | Upsert de ejecución no degrada aprobadas y transiciones aprobar/rechazar son condicionales al estado persistido. |
| H6 | Resuelto | Fallo de primera carga archiva el documento creado y registra cualquier fallo de compensación. |
| H7 | Resuelto | El cumplimiento formal mide cantidades, se limita a 100% y considera solo ejecuciones `approved`; las `submitted` permanecen visibles como avance operativo y pendientes de validación. |
| H8 | Resuelto | Metadata Excel pasó a `lib/reports`; indicadores exporta por ruta HTTP protegida, sin base64 por Server Action. |
| H9 | Resuelto | La URL de evidencia destacada no se duplica en `evidencePhotos`. |
| H10 | Resuelto | Errores inesperados se registran en servidor y devuelven un mensaje genérico; Zod conserva errores de validación. |
| H11 | Resuelto | Se eliminaron flags muertos, stubs se reemplazaron por redirects permanentes, se quitó el parámetro sin uso y la consulta PPA duplicada. |

No quedan pendientes de implementación automática en este análisis.

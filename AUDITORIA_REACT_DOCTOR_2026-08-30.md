# Auditoría React Doctor — pendientes

**Fecha del escaneo:** 2026-08-30 · `npx react-doctor@latest --verbose`
**Estado:** 835 hallazgos abiertos, 10 de severidad `error` — y **los 10 son falsos
positivos ya documentados en §0**. Baseline inicial: 878 / 11 errores.
**Última pasada:** §1, §2 (flags de carga), §3 y el bulk seguro de §5.

Cada regla enlaza a su receta canónica. **Antes de tocar código, leer la receta**:
la mayoría exige evidencia concreta y varias declaran falsos positivos propios.
`https://react.doctor/docs/rules/react-doctor/<regla>`

---

## 0. Ya cerrado (no reabrir)

| Regla | Resultado |
|---|---|
| `prefer-module-scope-pure-function` | **16 → 0.** Helpers puros subidos a scope de módulo en 14 archivos. Verificado contra la herramienta. |
| `effect-needs-cleanup` (pwa-register) | Corregida la carrera real: `register()` resolvía después del cleanup y dejaba un `setInterval` horario y un listener huérfanos. |
| `server-sequential-independent-await` (muestra) | 3 páginas paralelizadas con `Promise.all`: `admin/suplencias`, `admin/taxonomia-sst`, `prevencion/pdtp/aprobaciones`. |

### Falsos positivos documentados — **no volver a litigar**

- **`no-prevent-default` (21 hallazgos, 10 archivos).** La propia receta dice que
  `preventDefault` es correcto en "client-only flows, local validation, uploads,
  offline handling, and SPA submission". Los 21 son diálogos modales sobre
  `useOperation`, que gobierna `pending`, toasts, cierre del modal y devuelve la
  nueva `version` del bloqueo optimista al cliente. Migrarlos a
  `<form action={serverAction}>` rompería las tres cosas.
  → **Rechazado.** Si molesta el ruido, silenciar por configuración, no por código.

- **`effect-needs-cleanup` — 3 de los 4 restantes.**
  `sa-health-section.tsx:128` y `navigation-progress.tsx:31` ya retornan
  `clearTimers`; `fleet-gps-map.tsx:21` retorna `map.remove()`, que desmonta el
  mapa y sus listeners. La receta documenta esta ceguera del detector: busca el
  *registro* dentro de funciones anidadas pero sólo mira el nivel superior para
  el *cleanup*. El cuarto (`pwa-register.tsx:15`) ya está corregido y ahora
  apunta a un `statechange` sobre un worker efímero.
  → **Rechazado.**

---

## 1. Prioridad alta — errores ✅ CERRADA

- [x] **`server-auth-actions` (5) — RECHAZADOS, falsos positivos.**
      La receta nombra el caso exacto: *"KEY FALSE POSITIVE: the action IS the
      authentication/credential-establishing endpoint… password reset/forgot"*.
  - `lib/services/password-reset.ts:21/79/96` — son el flujo de recuperación de
    contraseña: por definición no hay sesión previa. La autorización es el token
    (32 bytes aleatorios, hasheado SHA-256 en reposo, un solo uso, TTL 1 h,
    consumido en transacción), más protección anti-enumeración y contra oráculo
    de tiempo. Añadir `auth()` rompería la recuperación por completo.
  - `combustibles/actions-module/suppliers.ts:237` — `deleteFuelSupplierAction`
    delega en `toggleFuelSupplierActive`, cuya **primera** sentencia es
    `requirePermission("combustibles:manage_suppliers")`.
  - `facturacion/propuestas/actions.ts:228` — sí tiene `guardPermission("billing:view")`
    antes de cualquier acceso a datos. El detector no reconoce los nombres de
    helper del proyecto (`guardPermission`/`requirePermission`), sólo su lista fija.
- [x] **`no-hydration-branch-on-browser-global` (1) — CORREGIDO.**
      `app/(public)/ppa/offline-saved.tsx`. Era **bug real**: el bloque "Activar
      notificaciones" se renderizaba en el servidor (siempre `"default"`) y
      desaparecía al hidratar en un equipo con el permiso ya concedido —
      estructura distinta, React descarta el subárbol. `isIosSafari()` en render
      tenía el mismo problema. Ambos parten del valor del servidor y se corrigen
      en un efecto tras montar.
- [x] **`nextjs-no-side-effect-in-get-handler` (1) — RECHAZADO.**
      `app/api/purchase-orders/dtes/[id]/pdf/route.ts:17`. El `.set()` marcado es
      `body.set(pdf.buffer)` sobre un `Uint8Array` **local** para construir la
      respuesta — el falso positivo textual de la receta. El GET además hace
      `auth()` + `can(session, "purchasing:view")` y no escribe estado.
- [x] ~~`effect-needs-cleanup` (4)~~ — 1 corregido, 3 falsos positivos (ver §0).

---

## 2. Prioridad alta — bugs reales de React

- [ ] **`no-adjust-state-on-prop-change` (20 en 11 archivos).** Estado que se
      "corrige" cuando cambia una prop: causa renders extra y estado obsoleto.
      Concentrado en `prevencion/pdtp/[programId]/editar/*` (3 archivos) y
      `inspection-run-detail.tsx`.
- [ ] **`no-derived-useState` (19 en 10 archivos).** Estado derivable de props,
      duplicado en `useState`: se desincroniza. Casi todo en `prevencion/`.
- [x] **`no-loading-flag-reset-outside-finally` (13 en 9 archivos) — CORREGIDO, 13 → 0.**
      Los 13 tenían el reset después del `await`, fuera de `finally`: si la acción
      rechazaba (red caída, excepción del servidor) el botón quedaba deshabilitado
      hasta recargar la página. Todos envueltos en `try/finally`. En los diálogos
      el cierre se mantiene dentro del `try`, así que ante un error el modal sigue
      abierto y el botón se re-habilita para reintentar.
- [ ] `no-array-index-as-key` (18 en 12) — reordenar/borrar filas corrompe el estado del DOM.
- [ ] `no-effect-chain` (3), `no-derived-state` (3), `no-mirror-prop-effect` (2),
      `no-prop-callback-in-effect` (1), `exhaustive-deps` (1 — `lib/hooks/use-local-storage-state.ts:39`).

---

## 3. Prioridad media — corrección y seguridad ✅ CERRADA

- [x] **`raw-sql-injection-risk` (3) — RECHAZADOS.** Los tres son `sql.raw()` sobre
      constantes de compilación, sin entrada de usuario: `PROVIDER_SQL` es el literal
      de módulo `('factura_en_linea', 'chipax', 'manual')`, y `sqlExcluded(column)`
      se invoca **sólo** con nombres de columna literales en todos sus call sites.
- [x] `no-fetch-response-used-without-status-check` (2) — **RECHAZADOS.** Ambos ya
      comprueban: `movement-sheet.tsx` hace `if (!res.ok) throw`; `tae-sw.js` usa
      `response.ok` y clasifica reintentables por `response.status`.
- [x] `nextjs-no-redirect-in-try-catch` (2) — **RECHAZADOS.** El `catch` ya llama
      `unstable_rethrow(e)` como primera sentencia, con un comentario que explica
      exactamente este riesgo. Es la corrección canónica, ya aplicada.
- [x] `no-async-event-handler-without-reentry-guard` (1) — **RECHAZADO.** El botón
      lleva `loading={login.isPending}` y `Button` aplica `disabled={disabled || loading}`:
      el guardia de reentrada existe.
- [x] `query-mutation-missing-invalidation` (1) — **RECHAZADO.** La mutación hace
      `router.refresh()`, que es la invalidación correcta en App Router; no hay caché
      de React Query con datos de sesión que invalidar.
- [x] `html-no-nested-form` (1) — **RECHAZADO.** El `<form>` interno vive dentro de
      `DialogContent`, que renderiza en un `<DialogPortal>` a `document.body`: en el
      DOM real no hay anidamiento. Sólo lo parece en el árbol JSX.
- [x] **`no-mutating-array-method-on-prop-or-hook-result` (1) — CORREGIDO.**
      Era **bug real**: `actionPlan.sort()` ordena en sitio y `actionPlan` llega como
      prop, así que mutaba el array del padre durante el render. Ahora copia.

---

## 4. Prioridad media — limpieza (borrado puro, bajo riesgo)

- [ ] **`unused-export` (54 en 30 archivos).**
- [ ] **`unused-file` (16).** ⚠️ **No borrar a ciegas.** La lista incluye seeds
      que se ejecutan a mano (`db/seed-combustibles.ts`, `db/seed/nuevos-roles.ts`)
      y un scratch sin trackear (`diag-import.mjs`). Verificar uno por uno.
- [ ] `unused-dependency` (2) — `package.json`.
- [ ] `only-export-components` (36 en 18) — rompe Fast Refresh en desarrollo.
- [ ] `no-barrel-import` (3), `no-multi-component-file` (3 en 1 archivo).

---

## 5. Escala de migración — **decisión tomada, requiere tu visto bueno**

Muestreé las tres y las recetas **no autorizan** una migración masiva en dos de
ellas. Resumen de la evidencia:

- [~] **`server-sequential-independent-await` — EN CURSO, 50 → 37.**
      13 paralelizados con `Promise.all` y verificados. **De los 37 restantes, 15
      están dentro de transacciones de BD y deben quedarse secuenciales**: una
      transacción drizzle/postgres.js vive en UNA conexión, así que un
      `Promise.all` interlearía sentencias sobre ella. Quedan ~20 candidatos.

      **Rechazos con motivo (no reabrir):**
      - `lib/services/prevention-cphs-reminders.ts:59` — `expireLapsedCommittees()`
        **escribe** y la lectura siguiente filtra por `status = "active"`: tiene que
        ver el estado post-expiración. Dependencia de orden real.
      - `lib/services/worksite-inventory.ts:354` — está dentro de
        `loadEmergencyImportContext(client)`, que en la línea 460 se invoca con un
        `tx`. Paralelizar ahí rompería la transacción.
      - `lib/services/prevention-documents/folders-move.ts:53` — las dos lecturas
        lanzan; paralelizarlas cambia cuál error ve el usuario. Valor bajo, riesgo
        de regresión en mensajes. Omitido a propósito.

      **Ya paralelizados:** `admin/suplencias/page`, `admin/taxonomia-sst/page`,
      `prevencion/pdtp/aprobaciones/page`, `admin-roles`, `stock-epp-alerts`,
      `sst-module/dashboard`, `notification-read`, `notification-targeting`,
      `feedback-sla-reminders`, `maintenance-reminders`,
      `prevention-documents/folders-crud`, `prevention-privacy`, `dispatch-guides`,
      `worksite-inventory:417`.

- [ ] **`async-await-in-loop` (186 en 92) — sólo ~82, a mano.**
      La receta exige evidencia de *measurement* y excluye explícitamente
      transacciones, estado acumulativo y efectos ordenados.
      **Escaneo: 103 de 185 están dentro de transacciones de BD y deben quedarse
      secuenciales.** Los ~82 restantes se revisan uno por uno, no en bloque.

- [ ] **`js-combine-iterations` (153 en 113) — cerrar como "sin evidencia".**
      La receta: *"Fuse chained array iterations only when profiling identifies
      the chain as a hot path... For ordinary collections, the readable chain is
      often the better tradeoff."* Exige *measurement*. Todos los sitios
      muestreados iteran colecciones diminutas (submódulos, atributos de
      producto, campos de formulario). Sin un perfil de producción que las
      señale como calientes, **reescribirlas empeora la legibilidad a cambio de
      nada**.

- [ ] Relacionadas, mismo criterio de evidencia: `js-set-map-lookups` (53 en 38),
      `js-flatmap-filter` (17 en 15), `js-index-maps` (2), `js-cache-property-access` (3),
      `js-hoist-intl` (5), `async-parallel` (3), `async-defer-await` (1),
      `server-hoist-static-io` (2).

---

## 6. Prioridad baja — rendimiento y accesibilidad

- [ ] `no-giant-component` (25 en 25) — refactor por archivo, no mecánico.
- [ ] `prefer-dynamic-import` (14), `prefer-useReducer` (11),
      `rerender-memo-with-default-value` (9), `rerender-lazy-state-init` (7),
      `rerender-defer-reads-hook` (5), `rerender-state-only-in-handlers` (2),
      `jsx-no-constructed-context-values` (2), `prefer-module-scope-static-value` (1),
      `prefer-use-effect-event` (1), `no-initialize-state` (1).
- [ ] `zod-v4-prefer-top-level-string-formats` (20 en 10) — migración de API de Zod v4, mecánica.
- [ ] `nextjs-no-client-side-redirect` (8), `nextjs-no-img-element` (5),
      `nextjs-no-a-element` (4).
- [ ] Accesibilidad: `no-static-element-interactions` (2), `no-autofocus` (2),
      `prefer-tag-over-role` (2), `label-has-associated-control` (2),
      `click-events-have-key-events` (1), `control-has-associated-label` (1),
      `html-no-nested-interactive` (1), `no-noninteractive-element-to-interactive-role` (1),
      `prefer-html-dialog` (1).
- [ ] `rendering-hydration-mismatch-time` (5), `rendering-hydration-no-flicker` (2),
      `no-pass-live-state-to-parent` (4), `no-pass-data-to-parent` (4),
      `no-many-boolean-props` (7), `no-transition-all` (4),
      `no-json-parse-stringify-clone` (3).

---

## 7. Contexto del entorno (leer antes de culpar a un cambio)

- **Tests:** queda **1 fallo**, `scripts/backup-encryption.test.ts`, por falta de
  Postgres local (`ECONNREFUSED :5432`). Los otros 20 fallos preexistentes (trabajo
  SST/inspecciones) los resolvió el proceso concurrente durante la sesión.
  582 archivos de test en verde. `tsc --noEmit` y `eslint` limpios.
- **`tsc` necesita más heap:** `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`.
  Sin eso muere con OOM.
- **Edición concurrente:** durante la sesión del 2026-08-30, archivos de
  `prevencion/inspecciones/` cambiaron en disco desde otro proceso, sumando 8
  hallazgos nuevos en archivos no tocados. Si los números no cuadran, revisar eso
  antes que el diff propio.

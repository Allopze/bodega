# QA — Mantención: pautas en borrador, menú Exportar y correcciones del seed (2026-10-31)

Rama `feat/mantencion-borrador-pautas`. Plan: «lo que falta del módulo de mantención» (líneas A–D).

## Qué cambió

- **Pautas en borrador + «Publicar versión N+1».** Editar ya no publica: las tablas vivas son el
  borrador y lo publicado es el snapshot de `mant_schedule_versions` de la versión vigente.
  `publishSchedule`, `discardScheduleDraft` y `scheduleDraftDiff`
  (`lib/services/mantencion/schedule-draft.ts`). `fleet.ts` lee nombre e intervalos del
  snapshot vigente, así el teléfono, el panel y la lista de equipos no ven el borrador.
  Barra «Cambios sin publicar» fija, «Descartar cambios» con confirmación, rótulo en la lista.
- **Matriz:** columna «Actividad» fija en móvil; las flechas recorren también el botón de
  plegar sistema y «+ Agregar ítem» (una sola parada de Tab).
- **Registro:** menú «Exportar ▾» (PDF / Excel) con `useXlsxExport` extraído de `ExportButton`;
  la bandeja de revisión usa `StageTabs param="revision"` (`StageTabs` gana `param`,
  `pageParam`, `countTone`, 44 px táctiles y anillo de foco en sus tres usos).
- **Seed:** `origen` de las dos pautas pasa a una descripción útil. Script one-shot
  `scripts/apply-mantencion-correcciones-2026-10-31.ts` (dry-run por defecto) con servicio
  `apply-mantencion-correcciones` (perfil `oneshot`) en `docker-compose.yml`. P3 queda como
  propuesta para Alexis (`docs/mantencion/propuesta-correcciones-seed-2026-10-31.md`); el
  script no cambia nada de P3 hasta cargar las filas aprobadas.

## Verificación

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run test:fast` | 15 800 pasan, 1 falla **preexistente en main** (`scripts/backup-env-whitelist.test.ts`: variables `VISIONLINK_*` del compose fuera del whitelist; no es de esta rama) |
| PGlite mantención (`schedules`, `equipment`, `records`, `sync-catalog`, script de correcciones) | OK, de a una |
| E2E `mantencion-1` a `mantencion-4`, en orden, chromium | 48/48 |
| E2E `oc-flow`, `recepcion-flow`, `epp-variant-request-flow`, `control-operacional-navegacion` | pasan (primera corrida completa) |

Ajustes de prueba hechos durante la E2E (sin cambio de producto):

- 3b, columna fija: la casilla de 30.000 km lleva «(columna por revisar)» en su nombre; el
  localizador usaba `exact: true`.
- 3b, borrador: los toasts tapan la barra fija y Sonner no los cierra con el mouse encima;
  la prueba aparta el mouse y espera a que se cierren.
- 4, permisos: `{ name: "App del mecánico" }` coincidía por substring con el CTA del estado
  vacío «Abrir la app del mecánico»; ahora `exact: true`.

## Hallazgos

- **UX FINDING (menor):** los toasts (arriba a la derecha, globales) tapan unos segundos el
  extremo derecho de la barra «Cambios sin publicar» («Ver cambios», «Descartar cambios»).
  Es del toaster global, no de esta página; no se cambió.
- **COVERAGE GAP:** no hubo recorrido de navegador asistido en :3001/:3002 sobre la rama; la
  cobertura de interfaz es la E2E determinista de arriba.

## Riesgos y decisiones

- Copiar una pauta copia su borrador (las tablas vivas), no sólo lo publicado.
- `needsReview` de las columnas no forma parte del snapshot: marcar o desmarcar una columna
  por revisar no deja la pauta con cambios sin publicar.
- El `origen` de «Maquinaria pesada» también cambió (tenía texto de archivo).
- P3: la lectura de LC-1315 como grúa horquilla en horas es una inferencia; la decide Alexis.

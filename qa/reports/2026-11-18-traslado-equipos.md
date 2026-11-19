# QA — Traslado de equipos entre faenas (2026-11-18)

Rama `feat/traslado-equipos-faena` (worktree `bodega-wt/traslado-equipos`), sobre `main` 57c7fb430.
Spec: `docs/superpowers/specs/2026-11-18-traslado-equipos-faena-design.md`.
Plan: `docs/superpowers/plans/2026-11-18-traslado-equipos-faena.md`.

## Alcance recorrido

Verificado:

- Puertas deterministas.
- E2E dirigida sobre `next dev`.
- Recorrido de navegador sobre una copia desechable de `bodega_dev` (`bodega_traslado_qa`), con la migración 0391, `db:sync-rbac`, la reconstrucción aplicada y el submódulo encendido sólo en la copia.

No recorrido:

- `next build` / E2E completa (bloqueada, ver más abajo).
- Producción.
- Usuarios reales distintos del QA administrador. Los roles acotados están cubiertos por pruebas y por la E2E de `scoped@e2e`.
- El rendimiento con volumen de producción.

## Puertas

| Puerta | Resultado |
| --- | --- |
| `npm run typecheck` | OK (0 errores) |
| `npm run lint` | OK |
| `npm run check:secrets` | OK |
| `npm run check:security-audit` | OK (sin altos ni críticos) |
| `npm run db:verify-migrations` | OK (392 entradas hasta `0391_round_big_bertha`) |
| `npm run test:fast` | 20.864 pasan, 3 fallaban (`actions-consumos.test.ts` simulado, desactualizado por el arreglo de importación «todas»). Corregido en 5b51f0ddf: 14/14 |
| `npm run test:pglite` | 5.173 pasan, 1 falla: `queries.test.ts` «litros por mes y medio». **Preexistente**: falla igual en `main` 57c7fb430 |
| `npm run test:e2e` | **Bloqueada**: `next build` aborta con `SecurityFatalError` de Next 16.4.2. Problema conocido desde el 2026-11-17, resuelto en la rama sin fusionar `chore/actualizar-next-dependencias` (Next 16.4.6). Se usó la alternativa de `next dev` |

## E2E dirigida (next dev :3100)

| Spec | Resultado |
| --- | --- |
| `traslado-equipos` (nueva) | Flujo completo OK: traslado, folio, lista, recorrido de dos estadías, anulación y vuelta a una. El caso del usuario sin permisos es inestable y pasa al reintentar |
| `flota`, `mantencion-3c-incorporar-flota` | OK |
| `mantencion-3a-equipos` | OK; un caso inestable que pasa al reintentar |
| `ficha-vehiculo` :42 | Falla 3/3 por latencia de compilación: cada reintento avanza una pestaña. La primera compilación tarda 5,3–5,4 s contra una espera de 5 s, y las tres pestañas responden 200 |
| `indicadores-gps`, `indicadores-mantencion`, `indicadores-combustibles` | OK (21 + 1 omitido) |
| `combustibles-control`, `control-operacional-combustible` | OK (9) |
| `control-operacional-navegacion` | 1 falla real corregida (el menú no contaba «Traslados»: 2017c5d4b). Quedan 5 casos que fallan **igual en `main`** sobre `next dev`, con abortos de navegación, conexión rechazada y tiempos vencidos |

## Recorrido de navegador (copia desechable, usuario QA administrador)

13/13 pasos OK:

- login;
- botón «Trasladar equipos» en `/flota`;
- en el modal: destino Horcones, búsqueda «KA-72», casilla del grupo Masisa (marca sólo el visible), motivo y autorizado por;
- resumen «1 equipo pasa a Horcones desde el 18-11-2026»;
- toast «TR-0001: 1 equipo pasa a Horcones desde el 18-11-2026.» con la acción «Ver traslados»;
- fila en `/flota/traslados`;
- «Recorrido por faena» en la ficha: Masisa (Alta, desde el inicio hasta 17-11-2026) y Horcones (TR-0001 · motivo · autorizado por · registrado por, desde 18-11-2026);
- `/combustibles/consumo/motor-en-vacio`, `/flota/indicadores`, `/mantencion/panel` y `/combustibles/consumo/litros` responden 200;
- modal a 390 px sin desborde horizontal;
- anulación con motivo y estado «Anulado».

Errores de consola: 0. Fallas de red: 3 prefetch `_rsc` abortados por la propia navegación (normal en Next).

Reconstrucción en la copia:

- en seco: 1 s, no escribe;
- `--apply`: 3 equipos y 6 estadías;
- segunda corrida: 0 escritos (idempotente).

Las filas «Por confirmar» se leen bien (p. ej. KA-120, 137 días sin evidencia entre Pacífico y Masisa).

## Hallazgos

### PRODUCT BUG

- Ninguno abierto. La revisión final y su ronda de arreglos cerraron 4 Important y 16 Minor; la re-revisión acotada los dio por resueltos.

### FUNCTIONAL FINDING

- **Alertas OnWay que fallan quedan «bloqueadas» sin reintento**, también por un error transitorio. Así una sola alerta no detiene la cola, pero esa alerta pierde su CAPA automática. Seguimiento posible: contador de reintentos.
- **El Panel operacional cuenta inspecciones, hallazgos y CAPA del período por la faena actual del equipo**, no por la del día. Es una desviación del spec que queda para decisión del usuario.

### UX FINDING

- En el teléfono (390 px), los campos del modal ocupan casi toda la altura y la lista de equipos muestra 1–2 filas a la vez. Funciona, pero conviene que en móvil desplace todo el cuerpo del diálogo.

### INCONSISTENCY

- La miga de pan de Traslados es «Control operacional / Vehículos / Traslados», aunque en el menú «Traslados» es hermano de «Vehículos».

### AUTOMATION WARNING

- E2E completa bloqueada por `next build` (Next 16.4.2).
- Inestabilidad de `next dev`: reinicios por memoria y primeras compilaciones de más de 5 s.

### COVERAGE GAP

- Sin E2E completa sobre build de producción.
- Sin prueba de rendimiento con volumen de producción (en la copia: ~1 µs por fila en la subconsulta de estadía).
- Recorrido de navegador sólo con el usuario administrador.

## Recomendaciones (en orden)

1. Antes del merge, si `feat/ot-sin-costo` entra antes, regenerar la migración 0391 de esta rama y llevar su SQL propio (backfill, triggers, toggle).
2. Correr la E2E completa cuando Next suba a 16.4.6.
3. Despliegue:
   - migración;
   - reconstrucción en seco en producción, con el JSON de planillas acordado con el usuario;
   - revisar «Por confirmar»;
   - `--apply`;
   - encender `submodule.enabled:flota:/flota/traslados`;
   - registrar por pantalla los cambios de la planilla de noviembre.
4. Seguimientos menores: modal en móvil, miga de pan, reintentos de OnWay y conteos del Panel operacional.

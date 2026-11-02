# QA · Historial del equipo en la app del mecánico (2026-11-02)

Rama `feat/historial-equipo-app`. Alcance: el historial de la flota (los últimos 10 trabajos vigentes por equipo, de todas las faenas y todos los mecánicos) y el detalle con fotos en `/m/mantencion`, con y sin señal.

## Pruebas deterministas
| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `eslint`, archivos tocados | 0 errores; 1 warning previo en `ot-model.ts` |
| vitest `lib/mantencion`, `components/mantencion`, `lib/security` | 45 archivos: 509 OK y 1 omitido |
| PGlite: app-history, sync-http, records y equipment-life | 77/77 |
| E2E `mantencion-1-app`, `-4-permisos` y `-5-ot` (worktree desechable, Chromium 390×844) | 20/20 |

Escenario E2E nuevo, «6 · otro mecánico ve el historial del equipo…»: mecánico 2 abre el historial del equipo donde trabajó mecánico 1 y ve su correctiva con el autor. Al abrir el detalle se cargan las 3 fotos. Luego, sin señal y tras recargar, la lista y las 3 fotos siguen disponibles. La consola no registra errores.

## PASS (verificado)
- La lista con autor, la lectura, el estado de la pauta y la marca «Historial actualizado el …» se ven en la captura de la lista.
- El detalle de la correctiva muestra los trabajos, si sigue en taller y la foto en miniatura (`?v=thumb`).
- Sin señal: el historial sale de IndexedDB y las fotos ya vistas, del caché local.
- Los permisos y la OT no tuvieron regresiones: los specs 4 y 5 pasan completos.

## COVERAGE GAP
- No hice un recorrido manual contra `bodega_dev`: ese entorno sigue atrasado en migraciones (0366). La verificación en navegador fue la de la E2E.
- La preventiva con ítems no realizados solo está probada con tests de componente (RTL) y PGlite, no con E2E.
- Tampoco está probada con E2E la entrada «Ver historial» desde la pauta ni desde la OT. Están cubiertas por RTL.
- No medí el tamaño real del historial con datos de producción. La estimación es de 1–3 MB para unos 200 equipos; falta una lectura READ ONLY autorizada.

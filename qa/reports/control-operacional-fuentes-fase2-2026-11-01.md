# Verificación — Fase 2: fuentes y conciliación en el Panel operacional

**Fecha:** 2026-11-01
**Alcance:** tarjeta lateral de fuentes de combustible, servicio de resumen y enlaces a Fuentes/Cuadratura.
**Estado:** implementado y verificado de forma determinista; la verificación de navegador quedó pendiente.

## Qué se implementó

- `getOperationalSourceHealth` (`lib/services/operational-control-sources.ts`) reutiliza `getFuelSourceStatuses` y `summarizeFuelSources`; no reimplementa el estado de cada importador ni sus permisos.
- `getOperationalReconciliationHealth` cuenta casos `unmatched`, `ambiguous`, `accepted_exception` y rechazos abiertos, con alcance por faena.
- La tarjeta «Fuentes de combustible» reemplaza a «Última importación de combustible»: muestra el estado global, hasta tres problemas con su fuente, la última actualización y la conciliación. No usa tarjetas anidadas; el color signal queda sólo para pendientes.
- Los enlaces «Ver todas las fuentes» y «Ver conciliación» llevan el período del panel. El primero sólo aparece con `combustibles:import`, `tae_import` o `sync_integrations`, que es el gate real de `/combustibles/fuentes`.
- `getFuelSourceStatuses` acepta `keys` para acotar las fuentes consultadas; el panel hoy consulta todas las que expone (siete). Aramco se muestra aparte en `/combustibles/fuentes`, fuera de ese read model.
- Se retiró del hub el `sourceHealth` de una sola importación (`fuelImportBatches`), para no mantener dos verdades.

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npx eslint` sobre los archivos modificados | Verde |
| `operational-control-sources.test.ts` | 5/5 |
| Pruebas del panel/export/hub | 24/24 (4 archivos) |
| `npm run typecheck` antes de los últimos ajustes de copy/enlaces | Verde |
| `npm run typecheck` final | Bloqueado por el resource guard compartido: otro worktree (`bodega-retire-aramco-verify`) tenía eslint, react-doctor, tsc y un docker build activos. No se forzó la ejecución. |

La prueba unitaria cubre: resumen de fuentes pendientes, ausencia de permiso, fallo de conciliación sin tumbar las fuentes, fallo total con fuente explícita y estado «al día». No valida el SQL de los conteos de conciliación; esa consulta no tiene prueba PGlite propia.

## Verificación no ejecutada

- **Navegador/E2E:** la tarjeta no se recorrió a 375/768/1440 px, ni con lector de pantalla, ni se hicieron clic los enlaces a Fuentes/Cuadratura.
- **Performance:** no se midió el costo de consultar siete fuentes más dos conteos de conciliación en cada carga del panel. El parámetro `keys` queda disponible si la medición muestra que hace falta acotar.
- **Consistencia visual con Fuentes:** no se comparó en navegador la tarjeta con `/combustibles/fuentes?desde=…&hasta=…`.

## Cómo cerrar la cobertura

```bash
E2E_DATABASE_URL=<base-desechable> E2E_ALLOW_DESTRUCTIVE_RESET=true \
  npx playwright test e2e/control-operacional-navegacion.spec.ts
```

Después, recorrer `/control-operacional?desde=2026-10-01&hasta=2026-10-31`:

- admin: tarjeta de fuentes, problemas, última actualización y ambos enlaces con el período;
- rol con `combustibles:view` sin permisos de importación: tarjeta sin «Ver todas las fuentes»;
- 375/768/1440 px: sin desborde en la tarjeta lateral;
- medir el tiempo de carga del panel y, si es necesario, acotar `getFuelSourceStatuses` con `keys`.

## Riesgos conocidos

- La tarjeta consulta todas las fuentes en cada carga; si el panel se vuelve lento, la optimización prevista es `keys` más una tarjeta que declare su subconjunto.
- La conciliación se muestra como conteos, no como veredicto por mandante; el detalle sigue en Cuadratura.
- El guard compartido impidió la puerta final de typecheck/lint en este turno; la última ejecución completa anterior fue verde y el lint focalizado posterior también.

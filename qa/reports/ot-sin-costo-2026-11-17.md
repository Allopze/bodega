# OT sin costo de mano de obra — 2026-11-17

Rama `feat/ot-sin-costo` (worktree `bodega-wt/ot-sin-costo`), sobre `main` 8725e74a9.

## Pedido y decisión

«Hay que eliminar el costo mano de obra de la OT». El usuario eligió **borrar la columna**
`mant_work_orders.total_cost` con migración, no dejarla sin uso. Vuelve a la decisión del
2026-11-02 («la OT no lleva costos»), que la migración 0377 (2026-11-06) había revertido, y
cierra el hallazgo OT-4 de `mantencion-auditoria-2026-11-16.md`.

## Qué cambió

| Superficie | Antes | Ahora |
|---|---|---|
| Nueva OT | Campo «Costo mano de obra / taller externo (CLP, opcional)» | Sin campo; el esquema Zod ya no acepta `totalCost` (una clave sobrante se descarta) |
| Edición de la solicitud | Conservaba o cambiaba `total_cost` | Sin costo |
| Detalle de la OT | Tarjeta «Mano de obra / taller externo» (con `showCosts`) | Sin tarjeta; `OtAside` pierde la prop |
| Panel de mantención | Cifra «Mano de obra y taller (OT)» en la tira de OT | La tira queda con «OT cerradas en el período» y «Tiempo medio de reparación» |
| Control operacional (tabla, Excel, glosario) | Columna «Mano de obra / taller (OT)»; «Costo total» = combustible + mano de obra + compras, sólo con capacidad de OT | Sin columna ni término; «Costo total» = combustible + compras por OC y no exige `mant:ot:view_*`; igual el costo por km u hora (tabla, Excel y cruce GPS) |
| Base de datos | `total_cost numeric(14,2)` | Migración `0391_spicy_tarantula`: `DROP COLUMN IF EXISTS "total_cost"` |

La clave del glosario `ot-total-cost` pasa a `total-cost` (ya no depende de la OT).

## Verificación

**Puertas deterministas**

- `npm run typecheck`: sin errores.
- `npm run lint` sobre los 34 archivos tocados: sin errores.
- `npm run test:fast` completo: 1378 archivos y 20 606 pruebas en verde (32 archivos omitidos por configuración).
- `npm run test:pglite` de lo tocado (`mantencion-work-orders-metrics`, `operational-control-purchases`, `indicators`, `mantencion-work-orders`): 5 archivos y 123 pruebas en verde. Estas suites aplican la cadena completa de migraciones, incluida la 0391.
- `npm run db:verify-migrations`: 392 entradas verificadas, con el checksum de la 0391 registrado. `npm run db:generate` posterior: «No schema changes».

**Navegador** (`next dev` del worktree en :3002, contra `bodega_ot_sin_costo`, copia desechable de `bodega_dev` migrada con la 0391; administrador QA)

Antes de migrar la copia, a dos OT cerradas se les cargó `total_cost = 125000` (OT-PAC-0005 y OT-STF-0005). La migración borró la columna con esos datos.

| Comprobación | Resultado |
|---|---|
| Nueva OT: sin campo de costo ni mención de mano de obra | PASS |
| Crear una OT `QA_` de punta a punta (KA-140) y llegar a su detalle | PASS |
| Detalle de la OT nueva y de OT-PAC-0005: sin tarjeta de costo, el historial carga | PASS |
| Panel: «OT cerradas» y «Tiempo medio de reparación» presentes, sin cifra de mano de obra | PASS |
| Control operacional con una vista guardada que pide `maintenanceCost`: la columna no aparece y la tabla no se rompe | PASS |
| «Costo total» = «Costo combustible» + «Repuestos y servicios (OC)» fila a fila | PASS (25 filas, 0 discrepancias) |
| Excel de Control operacional: sin columna de mano de obra, encabezado «Costo total (combustible + compras)» | PASS |
| Errores de consola | 0 |
| Respuestas 5xx | 0 |

Las dos únicas peticiones fallidas del recorrido son `net::ERR_ABORTED` de navegación: el `/login` cortado por la redirección tras el login y `/mantencion/ot` cortado al saltar al detalle de la OT creada. No son defectos.

**E2E** (`e2e/indicadores-mantencion.spec.ts` y `e2e/control-operacional-navegacion.spec.ts`, proyecto `chromium`): ver la sección siguiente.

## E2E

`npm run test:e2e` no se pudo usar tal cual: `next build` aborta con `SecurityFatalError`, un aviso de
vulnerabilidad del CLI de Next 16.4.2, antes de levantar el servidor. Como `playwright.config.ts` reutiliza un
servidor existente en :3100, las specs se corrieron contra `next dev --webpack` del worktree, con el mismo
entorno que `e2e/start-server.sh` y la base E2E (:55432) recién preparada con `npm run e2e:setup`.

| Corrida | Alcance | Resultado | Lectura |
|---|---|---|---|
| 1 | `indicadores-mantencion` + `control-operacional-navegacion` (37) | 17 pasan, 14 fallan, 6 no corren | El dev se reinició 5 veces por memoria («approaching the used memory threshold»): `ERR_CONNECTION_RESET`, `ERR_EMPTY_RESPONSE` y logins que no cargan. La prueba modificada de Control operacional (`:615`) **pasa**. |
| 2 | Lo mismo, con 8 GB de heap | 16 pasan, 15 fallan, 6 no corren | 3 reinicios; el conjunto de fallos cambia de una corrida a otra. `:615` cae con `ERR_CONNECTION_REFUSED` en `/login` durante un reinicio. |
| 3 | `indicadores-mantencion` + `:615`, servidor nuevo | 4 pasan, 1 falla | Sin reinicios. **Fallo real del cambio:** `:150` esperaba 3 cifras en la tira de OT y ahora son 2. Se corrigió la spec. |
| 4 | `indicadores-mantencion` + `:615` + `mantencion-5-ot` | 9 pasan, 1 falla, 6 no corren | **`indicadores-mantencion` 7/7 y `:615` en verde.** En `mantencion-5-ot`, «a» (crear la OT) pasa y «b» falla en el paso de notificaciones (ver abajo). |

`mantencion-5-ot` «b» falla porque `getByRole("button", { name: /^Notificaciones/ })` encuentra los dos botones
de la campana (`hidden sm:flex` y `sm:hidden`). Lo mismo se corrió sobre `main` 8725e74a9 en un worktree
desechable: la primera vez falló «a» (título vacío) y la segunda falló «b» en ese mismo paso, porque el aviso
de la OT no aparece. Este cambio no toca la campana, el TopBar ni los avisos. Se lee como inestabilidad de
`next dev` en este entorno, no como regresión. Las pruebas «c» a «h» de esa spec no llegaron a correr.

Sin verificar de forma estable: el resto de `control-operacional-navegacion` (menú, pestañas y roles de
Combustible y Flota, que este cambio no toca) y `mantencion-5-ot` de «b» en adelante. Hay que repetirlas con
una build de producción cuando `next build` vuelva a funcionar, o en el CI.

## Riesgos y pendientes

- **Datos en producción:** el despliegue borra los `total_cost` ya cargados en prod. No se consultó prod; el usuario aceptó la pérdida al elegir borrar la columna.
- **`bodega_dev` sigue en 0390.** Migrarla antes de fusionar rompería a los `next dev` con código de `main`, que todavía leen `total_cost`.
- **`next build` aborta en este equipo** con `SecurityFatalError` (aviso de vulnerabilidad de Next 16.4.2). Bloqueó `npm run test:e2e` y es probable que también bloquee el build del CI y del deploy. No se tocó la versión de Next.
- **Lo que no se recorrió:** la app del mecánico (no usa el costo) y roles distintos de administrador. La regla de capacidades del «Costo total» sin `mant:ot:view_*` está cubierta por pruebas unitarias y PGlite, no en navegador.

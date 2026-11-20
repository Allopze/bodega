# QA — Uso personal de equipos (2026-11-20)

Rama `feat/uso-personal-equipos` (HEAD `8fdb7c9a7`), spec `docs/superpowers/specs/2026-11-20-uso-personal-equipos-design.md`.

## Entorno

- **Navegador:** build de producción de la rama (`next build` + standalone) en `127.0.0.1:3003`.
- **Base:** `bodega_uso_personal`, un clon de `bodega_dev` (clon de prod + mock), migrado sólo él hasta la 0397 y con `db:sync-rbac`. `bodega_dev`, la E2E compartida y plataforma-dev no se migraron (acuerdo de coordinación).
- **Usuario:** `qa.uso.personal@local.test`, administrador global, creado sólo en el clon.
- **Equipo:** KA-137 (Horcones), con 9 transacciones Copec, 3 cargas en terreno y 3 líneas de OC en octubre de 2026.
- **Período de prueba:** del 20-10-2026 al 26-10-2026 (7 días).
- **Capturas:** fuera del repo, en `~/backups-dev/qa-uso-personal-2026-11-20/`, porque el clon trae nombres reales.

## Puertas deterministas

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run check:secrets` | OK |
| `npm run db:verify-migrations` | OK (398 entradas, hasta la 0397) |
| `npm run test:fast` | 21.362 OK · 277 omitidas |
| `npm run test:pglite` | 5.442 OK · **1 falla preexistente** (ver abajo) |
| E2E, worktree desechable, base `bodega_e2e_usopersonal`, puerto 3150 | Antes de las correcciones: 59/59. Después: 31/31 (uso-personal, flota-turnos, ficha-vehiculo, control-operacional-combustible, combustibles-control, indicadores-combustibles, indicadores-gps) |

La falla preexistente es `lib/__tests__/module-toggles.test.ts` («mantiene inventariadas todas las páginas autenticadas…»), que pide inventariar `/apps/recientes` y `/apps/visita`. Falla igual en `main` limpio (`b88e22111`), así que no viene de esta rama.

## Recorrido en navegador (PASS)

| Paso | Resultado |
|---|---|
| Control operacional, octubre, sin período | litros 967,9 · combustible $1.654.365 · OC $299.020 |
| Ficha › Flota sin períodos | estado vacío «Este equipo no tiene uso personal marcado» con CTA |
| Marcar 20-10 → 26-10 con nota | guardado; la fila «20-10-2026 → 26-10-2026» queda listada |
| Marcar 25-10 → 27-10 (se cruza) | rechazado: «Se cruza con otro uso personal de este equipo (20-10-2026 → 26-10-2026).» |
| Control operacional, octubre, con período | litros 645,7 (−322,2 de la carga del 23-10) · combustible $1.280.773 (−$373.592 del 22-10) · OC $0 (−$299.020 del 25-10) · nota «Excluye 7 días de uso personal» |
| Panel de combustible, octubre | nota «Excluye uso personal» |
| Cargas (bitácora) de KA-137 | la carga del 23-10 lleva la marca «Uso personal» y no se oculta |
| Ficha › Combustible | la carga del 23-10 marcada en el historial |
| Ficha › Mantención | idéntica salvo 3 marcas «Uso personal» en las líneas de la OC del 25-10; costos y lecturas sin cambio |
| Período abierto desde el 18-11 | insignia «En uso personal» en Resumen, Flota, Mantención y Combustible |
| Quitar (diálogo de confirmación) | el texto explica que las cifras vuelven a contar; el período desaparece |
| Control operacional sin períodos | vuelve exacto: 967,9 · $1.654.365 · $299.020 · sin nota |
| Consola y red (build de producción) | 0 errores de consola · 0 respuestas ≥ 400 |

## Avisos de automatización (no son defectos)

- `next dev --webpack` se reinició por memoria a mitad del recorrido. Por eso se rehízo sobre la build de producción.
- En el clon, la contraseña de `.env.qa` no coincide; se usó un usuario QA creado en el clon.
- La tarjeta «Repuestos y servicios comprados» de la pestaña Flota no se dibuja para KA-137, porque depende de `includeMaintenance`. Su marca se verificó en la pestaña Mantención.
- `getByText` del rango coincide dos veces con el diálogo abierto, porque el diálogo repite el rango. La fila aparece una sola vez.

## Cobertura que no se recorrió en navegador

- **Turnos y ralentí** (`/flota/turnos`): KA-137 no tiene telemetría por hora. Lo cubren la PGlite `fleet-shifts-views-pglite` (16), el componente `shift-views` (9) y la E2E `flota-turnos`.
- **Costo por contrato** con el período: lo cubre la PGlite `contract-costs-pglite`, con el cuadre contratos + «Sin contrato» + «Por repartir» = C − P.
- **Excel** de Control operacional con «Días de uso personal excluidos»: lo cubren las pruebas de columnas y de la acción de exportación.
- **Usuario sin `flota:personal_use`:** lo cubre la E2E (ve el bloque, no el botón).
- **Móvil:** no se recorrió.

## Pendiente de decisión (revisión final, punto 4)

Consumo (`fuel_consumption_records`) prorratea el registro mensual de Copec por días, como manda la spec. Control operacional, Flota y Analítica excluyen las transacciones exactas del período. En un mismo equipo y mes con uso personal, las dos cifras difieren. Hay que decidir si, cuando la patente tiene transacciones, Consumo debe restar lo exacto en vez de prorratear.

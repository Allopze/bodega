# Recorrido de navegador — Rediseño del tablero (`/dashboard`)

Fecha: 2026-10-26 · Rama: `feat/dashboard-rediseno` · Entorno: `next dev` local (:3001) sobre `bodega_dev` · Sesión: usuario QA (`playwright/.auth/monkeytest.json`) · Herramienta: Chromium de `@playwright/test` + `@axe-core/playwright` (WCAG 2 A/AA) · Referencia visual: `mockup-dashboard.html` (aprobado por el usuario, sin versionar).

## Qué cambió

- **Superficie:** un panel con divisiones finas por grupo (`DashboardPanel`, `PanelBlock`, `ChartSlot`) y cifras sans en el tablero. Es una excepción declarada a la regla 7 de AGENTS.md y a DESIGN.md.
- **Gráficos interactivos:**
  - tooltip que se desliza entre puntos;
  - guía punteada;
  - foco de luz bajo el cursor y brillo en la serie protagonista;
  - columna activa que apaga a las vecinas;
  - cifra principal que sigue al mes apuntado;
  - leyenda que resalta su serie.

  Todo respeta `prefers-reduced-motion`.
- **Rankings:** `RankedList` de un tono reemplaza a las barras multicolor (Inversión por faena, Proveedores, Clientes, Distribución por módulo, Costo por unidad, EPP por trabajador, MIPER y PDTP por faena).
- **Variaciones:** `Delta` es la única forma de mostrarlas y solo se usa donde existe el dato del período anterior.
- **Resumen:**
  - «Requiere atención» en filas compactas;
  - sin el botón «Ver N vencidas» (A5);
  - medidor de marcas radiales;
  - actividad reciente agrupada.
- **Finanzas:**
  - abre con los gráficos;
  - se quitan «Pendiente de cobro» y «Vencido» (A5), porque esas cifras ya están en la cabecera de la antigüedad de la deuda;
  - tiles vacíos con acción (A1).

## Alcance recorrido

- **Escritorio 1600 px:** Resumen, Finanzas, Prevención, Adquisiciones, Control operacional (`flota`), Bodega y Prevención en terreno.
- **Móvil 390 px:** Resumen y Finanzas.
- **axe a 1440 px:** Resumen, Finanzas, Prevención, Adquisiciones, Control operacional, Prevención en terreno y Bodega.
- **Interacción en Tendencia operativa:**
  - con el mouse: la cifra pasa de «3 solicitudes en octubre» a «14 solicitudes en agosto = 0 vs. jul» y el tooltip muestra las tres series del mes;
  - con el teclado (Tab y flechas): el tooltip aparece;
  - la carga con `reducedMotion: "reduce"` se verificó sin errores.
- **Sin recorrer:**
  - la vista Gobierno: `?vista=gobierno` no es su clave y cayó al Resumen; no la busqué;
  - móvil en las otras vistas;
  - otros roles: solo se usó el usuario QA;
  - datos de SST, ambientales, de combustible y de mantención: `bodega_dev` no los tiene, así que esos gráficos no se vieron con datos.

## Resultado

| Chequeo | Resultado |
|---|---|
| Errores de consola / `pageerror` | 0 (se excluye el avatar externo de dicebear) |
| Respuestas de red ≥ 500 | 0 |
| Violaciones axe WCAG 2 A/AA (`main`) | 0 en las 7 vistas |
| Desborde horizontal a 390 px | 0 px (Resumen y Finanzas) |
| Familia de las cifras de KPI en `/dashboard` | `myriad` (sans) |

## Hallazgos y su resolución

| # | Clase | Hallazgo | Evidencia | Resolución |
|---|---|---|---|---|
| 1 | PRODUCT BUG | Prevención dejaba un hueco de dos columnas cuando la tasa SST estaba en cero: el envoltorio `xl:col-span-2` se pintaba aunque el gráfico devolviera `null` | Captura previa al cambio | `ChartSlot` con `empty:hidden`. El mismo patrón se corrigió en Finanzas, Adquisiciones (sin guarda) y Flota |
| 2 | PRODUCT BUG | La antigüedad de la deuda se reordenaba por monto (31–60, 1–30, 61–90…) | `ThresholdRankingChart invert` | `DebtAgingChart` conserva el orden de `AGING_BUCKETS`; hay prueba unitaria |
| 3 | PRODUCT BUG | El ranking de PDTP por faena descartaba a la peor faena con 9 faenas (`slice(-8)`) | Revisión de código | `RankedList` en modo umbral ordena lo peor primero y nunca descarta filas sin decirlo («y N más») |
| 4 | UX FINDING | PDTP por faena dibujaba barras en 0 % a todo el ancho | Captura previa | Estado vacío con significado, contexto y CTA (A4) |
| 5 | UX FINDING | «Cobertura de la matriz» quedaba sola en su fila con la mitad derecha vacía | Captura del primer recorrido | PDTP por faena pasa a una columna, junto a la cobertura |
| 6 | UX FINDING | Con barras cortas, el borde de color del ranking tachaba el nombre | Captura de Adquisiciones | El borde solo aparece desde el 25 % del ancho |
| 7 | UX FINDING | Ingresos (2 tiles) dejaba media fila vacía en una grilla de 4 | Informe de la línea de Finanzas | Grilla de KPI con `auto-fit` |
| 8 | AUTOMATION WARNING | En `dashboard.spec.ts`, dos localizadores por subcadena («Facturación», «Compras») empataban los nuevos enlaces «Ver facturación» y la fila «Compras» del ranking | E2E: strict mode violation | `exact: true`, como pide AGENTS.md |
| 9 | COVERAGE GAP | El E2E del orden de la antigüedad de la deuda se omite: la base E2E no tiene saldo abierto y el gráfico muestra su estado vacío | E2E `skipped` | Cubierto por `debt-aging-chart.test.tsx` (orden con el mayor monto en un tramo intermedio) |
| 10 | IMPROVEMENT OPPORTUNITY | La cifra principal de la tendencia sigue al mouse pero no a las flechas del teclado (el tooltip sí aparece) | Informe de la línea de gráficos y prueba de teclado | Pendiente |
| 11 | FUNCTIONAL FINDING (preexistente) | `periodWindowHref` pasa el fin exclusivo como `hasta` y `/compras` lo trata como inclusivo: un día de más | Informe de la línea de Finanzas | Fuera de alcance; los enlaces nuevos de proveedores usan la fecha exacta |

## Pruebas deterministas

- `npm run typecheck`: sin errores en el código del repo. Los únicos errores son de la carpeta local `dashboards-referencia/`, que está ignorada por git y no existe en CI.
- `npm run lint`: limpio.
- `npm run test:fast`: 1011 archivos y 13.491 pruebas pasan.
- E2E en un worktree desechable (`e2e/dashboard.spec.ts`, `e2e/dashboard-rediseno.spec.ts`, `e2e/densidad-kpi.spec.ts`, `e2e/densidad-kpi-filtros.spec.ts`):
  - primera corrida: 61 pasan, 2 fallan por el hallazgo 8 y 1 se omite por el 9;
  - nueva corrida de `dashboard.spec.ts` tras el arreglo: 27 de 27 pasan.

## Revisión de código y correcciones (commit `12ea3b0c`)

Revisión en dos ejes (estándares del repo y especificación + errores) sobre `c34e1efe...HEAD`. Se corrigió:

| # | Clase | Hallazgo | Resolución |
|---|---|---|---|
| R1 | PRODUCT BUG | En el Resumen, el tile vacío «Gasto en OC» mostraba «↓100% vs. sep» en verde (rol sin permiso de crear OC) | La variación se anula sin OC y `KpiCard` nunca muestra variación en un tile vacío |
| R2 | PRODUCT BUG (preexistente) | «Entregas de EPP» contaba filas trabajador × producto de un top 10: nunca pasaba de 10 | Conteo de trabajadores distintos en el servicio de analítica (`eppWorkerCount`) |
| R3 | ACCESIBILIDAD | La cifra principal seguía al mouse pero no a las flechas | `ChartActiveSync` lee el punto activo de recharts para puntero y teclado; verificado en navegador (octubre → septiembre con flechas) |
| R4 | INCONSISTENCY | La variación de gasto se calculaba distinto en Resumen y Finanzas; porcentajes escritos de tres formas | `spendVariationPct` y `formatPercent` como única fuente |
| R5 | INCONSISTENCY | Dona del tablero con cifras mono; tooltip, brillo y nombres de mes duplicados | Sans, `ChartTooltipCard` con formato por serie, `GlowFilter` corregido, `MONTH_NAMES` en `lib/utils` |
| R6 | UX FINDING | Margen de más en Finanzas al ocultarse el panel de gráficos; «×N» de actividad enlazaba a una sola entidad sin decirlo | `gap` en vez de márgenes; el enlace declara que abre el más reciente |
| R7 | COVERAGE GAP | `densidad-kpi.spec.ts` contaba cualquier `h3` (pasaba siempre); la prueba de celdas vacías no esperaba a los gráficos diferidos | `data-kpi-group-label` y espera de `[data-chart-loading]` |

Puertas tras las correcciones: `typecheck` y `lint` limpios (salvo la carpeta local `dashboards-referencia/`), `test:fast` 13.492 pruebas pasan, E2E de los cuatro specs del tablero: 63 pasan y 1 se omite (orden de la antigüedad de la deuda: la base E2E no tiene saldo abierto; lo cubre la prueba unitaria).

Quedan para decisión del usuario: devolver a un rol que sólo aprueba una acción primaria en la cabecera, y el orden tendencia/medidor del Resumen (sigue el del mockup).

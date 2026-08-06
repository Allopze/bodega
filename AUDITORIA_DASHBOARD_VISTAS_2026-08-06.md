# Inicio por vistas — medición y cierre

Fecha: 6 de agosto de 2026
Plan que ejecuta: `PLAN_DASHBOARD_INICIO_POR_VISTAS_2026-08-06.md`
Rama: `feat/dashboard-vistas`

## 1. Qué cambió

Inicio dejó de apilar seis secciones de dominio bajo el Centro de Control y pasa
a pintar **una vista a la vez**, elegida en una barra de pestañas que vive en la
URL como `?vista=`, junto a `?faena=` y `?periodo=`.

Las nueve vistas, en el orden que decide el perfil de permisos:

| Vista | Contenido |
|---|---|
| Resumen | 4 KPIs por ranura semántica (el primero, hero) · medidor radial de cumplimiento PDTP · tendencia operativa · alertas · flujo del período · backlog comparado · actividad reciente |
| Mi trabajo | La cola operacional completa, con sus atajos y su orden |
| Finanzas | **Nuevo.** 8 tiles en dos filas rotuladas (Ingresos / Egresos) + 6 gráficos |
| Adquisiciones | Proceso de compra: OC emitidas, por recibir, rechazo, por aprobar |
| Flota | Consumo y estado de equipos |
| Prevención · Bodega · Terreno · Gobernanza | Sin cambios de contenido |

## 2. Medición

### Scroll

El punto de partida es `audit/screenshots/inicio-2026-08-05/`, donde `/dashboard`
montaba todo a la vez. Medido sobre el contenedor de scroll real del shell —el
`document` no crece, así que `documentElement.scrollHeight` no sirve—:

| Viewport | Antes | Vista más larga | Vista más corta |
|---|---|---|---|
| desktop 1920 | 8 pantallas (~8.640 px) | 1,5 (Prevención, 1.579 px) | 1,0 (Finanzas, Adquisiciones, Bodega, Terreno, Gobernanza) |
| laptop 1366 | 11 pantallas | 3,1 (Prevención, 2.351 px) | 1,0 (Terreno, Gobernanza) |
| mobile 390 | 15 pantallas | 4,3 (Resumen, 3.601 px) | 1,3 (Gobernanza, 1.132 px) |

Ninguna vista desborda horizontalmente en ninguno de los tres anchos.

Las capturas nuevas viven en `audit/screenshots/2026-08-06-playwright/`, una por
vista y por viewport (`dashboard`, `dashboard-trabajo`, `dashboard-finanzas`, …):
27 archivos donde antes había 2.

### Consultas por carga

Antes, cada visita a `/dashboard` disparaba:

- el lote del Centro de Control (13 servicios en un `Promise.all`), **más**
- las seis secciones de dominio en paralelo, cada una con su propio lote —
  Adquisiciones sola llama a `getAnalyticsDashboard`, que son ~20 consultas.

Ahora la página resuelve alcance y vista, consulta la cola **una vez** (con
`limit: 1` fuera de la vista Mi trabajo, porque `summary` y `total` salen del CTE
`filtered`, o sea de la población completa, no de la página) y delega en la vista
activa. Ninguna otra vista consulta nada.

### Densidad

| Vista | Tiles | Grupos |
|---|---|---|
| Resumen | 4 | 1 |
| Finanzas | 8 | 2 (Ingresos / Egresos) |
| Adquisiciones · Flota · Prevención · Bodega · Terreno · Gobernanza | 4 | 1 |

Verificado con `e2e/densidad-kpi.spec.ts`, que ahora recorre las pestañas reales
en vez de una lista fija.

## 3. Reglas tocadas

**AGENTS.md §A1** gana una excepción declarada para `/dashboard`: 8 tiles por
vista, y sobre 4 la fila se parte en grupos rotulados. El resto de las pantallas
conserva el tope de 4 sin excepciones.

**A5 no se relajó**, y forzó tres movimientos:

1. El gasto en OC, el ticket medio, los proveedores por gasto, el gasto por
   módulo, la inversión por faena y la salud DTE **salieron de Adquisiciones** al
   nacer Finanzas, en vez de quedar en las dos vistas.
2. El costo de combustible y la deuda vencida **salieron de Flota** por lo mismo.
3. El cumplimiento PDTP **salió de la fila de tiles** del Resumen al ganar su
   medidor radial: eran la misma cifra dos veces en la misma pantalla. La ranura
   de cumplimiento cae ahora en "Por recibir", y la tarjeta de detalle
   (`PdtpComplianceCard`) se mudó a la vista de Prevención.

## 4. Lo que quedó fuera

| Tema | Estado |
|---|---|
| Período de la facturación de venta | `getBillingSummary` toma un `YYYY-MM`. Con trimestre o año elegidos, Finanzas usa el mes de inicio de la ventana y lo declara en su nota. Soportar trimestre real es un cambio en `lib/services/billing/queries.ts`, fuera de este plan. |
| Multi-moneda en "Antigüedad de la deuda" | El gráfico toma `byCurrency[0]` y declara la moneda en el detalle de cada tramo. Con dos monedas activas hay que partirlo en un gráfico por moneda. |
| `dashboard-domain-sections.tsx` | Queda en ~640 líneas con seis secciones. Partirlo en `sections/<dominio>-section.tsx` —uno por archivo, como ya hace Finanzas— es deuda declarada, no entra acá. |
| Modo oscuro | No existe en el producto (`color-scheme: light`); el tile hero y el medidor están hechos para claro. |

## 5. Verificación

- `npm run typecheck` — limpio
- `npm run lint` — 0 errores (5 advertencias preexistentes, ninguna en el tablero)
- `npm test` — **3718 pasan**, 174 saltados, 0 fallan
- `npm run test:e2e -- e2e/dashboard.spec.ts e2e/densidad-kpi.spec.ts` — **42 pasan**, 0 fallan
- `npm run check:bundle-budget` — 171 rutas, peor caso `/combustibles/facturas`
  2,42 MB de 3,00 MB de presupuesto: recharts sigue fuera del chunk inicial
- `npm run screenshots` — 27 capturas de tablero (9 vistas × desktop/móvil +
  variantes), donde antes había 2

## 6. Nota sobre los e2e

La primera corrida de `dashboard.spec.ts` falló **los 26 tests**, incluidos los
que este trabajo no toca. La causa no era el código: el formulario de login había
caído a un `GET` con las credenciales en la URL, que es la firma del clic antes
de hidratar. Se reproducía porque el servidor de desarrollo seguía corriendo en
paralelo y cargaba la máquina. Con el puerto libre, la corrida es limpia.

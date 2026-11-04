# Recorrido en navegador — mejoras menores de gráficos (K.5)

**Fecha:** 2026-11-04 · **Código:** rama `feat/graficos-mejoras` @ `f8a3306aa` · **Datos:** `bodega_dev` (clon de producción del 2026-11-02 con datos `mock-*`, más 8 solicitudes `QA_` SOL-0064..SOL-0071 sembradas para Aprobaciones) · **Usuario:** cuenta QA, rol administrador.

## Alcance

Recorrido asistido con Playwright (Chromium del repo) contra `next dev` en `:3002`, en escritorio (1440 px), con axe (WCAG 2.0/2.1 A y AA), errores de consola, respuestas HTTP ≥ 400 y desborde horizontal. Se agregaron interacciones puntuales: hover y clic en la matriz MIPER, descarga del Excel de «Ver datos» y `/flota` a 390 px.

**Rutas:** `/aprobaciones`, `/prevencion/miper/[id]?tab=resumen`, `/prevencion/inspecciones`, `/combustibles/cuadratura/estanques`, `/combustibles/revisar`, `/analitica`, `/seguimiento/[itemId]`, `/compras/dte`, `/facturacion`, `/mantencion/panel`, `/dashboard`, `/combustibles/consumo/litros`, `/flota` (móvil).

**No se recorrió:** los anchos de 390 y 320 px fuera de `/flota` (el recorrido anterior cubrió esos anchos para las mismas pantallas, y el servidor de desarrollo se reiniciaba por memoria); el Excel de cada pantalla, salvo inspecciones; `/dashboard` cargó durante un reinicio del servidor por memoria y no se repitió.

## Resultado técnico

- **axe:** 0 violaciones en las 12 rutas de escritorio.
- **Desborde horizontal:** 0 px.
- **Consola y red:** sin errores atribuibles a las pantallas. Los `ERR_EMPTY_RESPONSE` de `/dashboard` coinciden con el aviso «Server is approaching the used memory threshold, restarting» del servidor de desarrollo.

## Lo verificado (PASS)

| # | Pantalla | Qué se vio |
|---|---|---|
| P-11 | `/aprobaciones` | La barra de antigüedad con datos: 8 ítems, 2 por tramo, gris → rojo, frase «8 ítems esperan tu decisión; 2 llevan más de 7 días» |
| P-3 | MIPER | El hover en una celda muestra los 3 peligros más frecuentes y «y 23 peligros más»; el clic lleva a `?celda=P2xC2`, con el chip «Celda: probabilidad Media × consecuencia Media» y 74 riesgos, igual que la cifra de la celda |
| P-4 | `/prevencion/inspecciones` | «Hallazgos que siguen abiertos» apilado por gravedad, en su propio gráfico debajo del cumplimiento |
| P-2 | `/prevencion/inspecciones` | «Ver datos» → Excel descarga `inspecciones_cumplimiento_ponderado_y_hallazgos_abiertos_por_2026-11-04.xlsx` |
| P-5 | `/combustibles/cuadratura/estanques` | «Nivel en el tiempo» con nivel, entradas, salidas y el resto del mes en curso sombreado; los estanques sin movimiento se nombran en una frase |
| P-6 | `/combustibles/revisar` | La línea punteada del cambio de regla (24 ago) y su explicación bajo el gráfico |
| P-7 | `/analitica` | «Ítems más lentos (10)» bajo los plazos, con enlace a la solicitud y al seguimiento |
| P-7 | `/seguimiento/[itemId]` | «Plazos por etapa»: fechas por tramo, «Más lento» en Llegada, total 31 días |
| — | `/compras/dte` | La leyenda de conciliación sólo nombra los cuatro estados presentes |
| P-9 | `/flota` a 390 px | Las tarjetas muestran Km/Hr |

## Hallazgos

| # | Tipo | Pantalla | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | Mejora | `/combustibles/cuadratura/estanques` | El eje de salidas usa marcas no redondas (206, 456): sale del máximo del período | Abierto (menor) |
| 2 | Automatización | `e2e/export-volume.spec.ts:87` | En la E2E completa, `dte_libro_compras` devolvió HTML en vez de xlsx una vez; la misma ruta pasó 3 líneas antes y la spec pasó 33 de 33 al repetirla 3 veces. La rama no toca `/api/reportes/export`, auth ni el proxy | Intermitente, sin cambio |

## Verificación automatizada (sobre `f8a3306aa`)

- `typecheck`, `lint` (1 aviso ajeno: `lib/mantencion/client/ot-model.ts`), `test:fast` y `test:pglite`: en verde.
- `test:e2e` completa: 1.079 pasan, 1 falla (hallazgo 2) y 5 no corren. `e2e/export-volume.spec.ts` con `--repeat-each=3`: 33 de 33.

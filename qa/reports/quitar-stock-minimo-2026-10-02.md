# Verificación: retiro del stock mínimo y de la columna Estado (2026-10-02)

Recorrido de navegador **dirigido**: no es una auditoría completa. Cubre las
pantallas que leían `worksite_stock.min_stock` y nada más.

- Entorno: `next dev` en :3001 contra `bodega_dev`, sesión QA
  (`playwright/.auth/monkeytest.json`), Chromium de `@playwright/test`.
- Rama: `feat/quitar-stock-minimo`.

## PASS (verificado en pantalla)

| Ruta | Qué se comprobó |
|---|---|
| `/bodega` (1440 px) | Columnas: Producto · En bodega · Por recibir · Último movimiento. No hay "Estado" ni "Mínimo", ni el selector "Filtrar por estado de stock", ni texto con "mínimo". El encabezado muestra "Productos con stock" y "Movimientos · 30 d", sin "Bajo mínimo". |
| `/bodega` → Registrar movimiento | La hoja ofrece Devolución, Conteo físico, Ajuste, Baja y Traslado. Ya no está "Definir stock mínimo". |
| `/bodega?stock=low` | Un enlace viejo carga con 200, sin chip "Estado" y sin filtrar nada. |
| `/bodega` (390 px) | Las tarjetas móviles muestran En bodega, Por recibir y Último movimiento, sin "Mínimo" ni badge "Bajo mínimo". |
| `/dashboard` | La fila de KPIs no tiene "Stock crítico" y el lateral no tiene la alerta "productos con stock crítico". |
| `/dashboard?vista=bodega` | Sin "Stock crítico", "Stock en alerta" ni "Mayor déficit de stock". Quedan "Entregas de EPP" y "Productos en rotación". |
| `/analitica` | Sin la tabla "Stock crítico" ni "productos bajo mínimo" en el KPI de alertas. |

Sin errores de consola y sin respuestas 5xx en todo el recorrido.

## AUTOMATION WARNING / COVERAGE GAP

- El gráfico "EPP entregado por trabajador" del tablero de Bodega no aparece en
  `bodega_dev` porque no hay entregas en el mes: el componente devuelve `null`
  sin filas, como antes del cambio. Su presencia con datos no se observó.
- Las descargas Excel (stock por faena, rotación, analítica) se verificaron con
  pruebas automatizadas, no descargándolas desde el navegador.
- El badge de Bodega del menú lateral se retiró en código; el recorrido sólo
  confirma que no aparece con el usuario QA.

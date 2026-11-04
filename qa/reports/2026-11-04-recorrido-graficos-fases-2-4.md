# Recorrido en navegador — gráficos, fases 2 a 4

**Fecha:** 2026-11-04 · **Código:** `main` @ `bc8df84ad` (correcciones en `6fe3dc96c`) · **Datos:** `bodega_dev` (clon de producción del 2026-11-02 con datos simulados `mock-*`) · **Usuario:** cuenta QA, rol administrador.

## Alcance

Recorrido asistido con Playwright (Chromium del repo) contra `next dev` en `:3002`. Tres anchos por pantalla: escritorio 1440 px, móvil 390 px y angosto 320 px. Se usó axe (WCAG 2.0/2.1 A y AA) en escritorio y se registraron los errores de consola, las respuestas HTTP ≥ 400 y el desborde horizontal. Los pliegues de gráficos se abrieron antes de capturar.

**Pantallas cubiertas (22 rutas × 3 anchos):**

| Área | Rutas |
|---|---|
| Analítica y abastecimiento | `/analitica`, `/reportes`, `/compras/dte` |
| Bodega | `/bodega`, `/bodega/guias` |
| Prevención | `/prevencion/inspecciones`, `/prevencion/alcotest`, `/prevencion/ppa`, `/prevencion/pdtp/pdtp-2026-v1/cierres`, `/prevencion/cphs`, `/prevencion/emergencias`, `/prevencion/cgrd`, `/prevencion/higiene` |
| Combustible y flota | `/combustibles`, `/combustibles/consumo/litros`, `/combustibles/consumo/motor-en-vacio`, `/combustibles/consumo/equipos/[id]`, `/flota` |
| Tablero | `/dashboard?vista=flota`, `?vista=finanzas`, `?vista=gobierno` |

**Sin recorrer:** `/prevencion/capacitacion` con axe (3.925 tarjetas: axe agota la memoria; ya se recorrió el 2026-11-03), la descarga real del Excel de «Ver datos», el clic en cada tramo y banda (cubierto por pruebas unitarias y PGlite, no por E2E), y `/aprobaciones` con datos (la cola del clon está vacía).

## Resultado técnico

- **axe:** 0 violaciones en las 22 rutas.
- **Consola y red:** sin errores atribuibles a las pantallas. Hubo `ERR_CONNECTION_RESET` cuando el servidor de desarrollo se reinició por memoria; esas rutas se repitieron y cargaron bien.
- **Desborde horizontal:** 0 px en los tres anchos.
- **Bajo 360 px:** `DenseChart` reemplazó el Pareto de `/analitica` y la dispersión de motor en vacío por su lista.

## Hallazgos y estado

| # | Tipo | Pantalla | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | Defecto | `/combustibles/consumo/litros` | Con el mes en curso, la frase decía «98 % menos que octubre» y los tiles «↓97,7 %»: comparaban 4 días contra un mes completo | Corregido: sin variación mientras el período sigue en curso |
| 2 | UX | `/combustibles/consumo/litros` | «vs. período anterior» se cortaba en los tiles de origen | Corregido: la variación va en su propia línea |
| 3 | UX | `/dashboard?vista=finanzas` | «Antigüedad de la deuda» quedaba sola en media fila con un hueco al lado | Corregido: la última celda simple, si queda sola, ocupa la fila |
| 4 | UX | `/combustibles/consumo/equipos/[id]` | Sin horas de motor, el gráfico diario dibujaba ejes vacíos | Corregido: estado vacío con explicación |
| 5 | Defecto | `/bodega/guias` | La mediana se mostraba «11,888 d» | Corregido: «11,9 días» |
| 6 | Defecto | `/prevencion/ppa` | «1.1 puntos bajo septiembre», con punto decimal | Corregido: coma decimal, con prueba |
| 7 | Inconsistencia | `/analitica` | La leyenda del Pareto nombraba «Otros proveedores» sin esa barra | Corregido |
| 8 | Inconsistencia | Combustible, PDTP | Tres `toFixed` previos (tooltip de rendimiento, motivo de anomalía, cantidades del PDTP) daban punto decimal | Corregido |
| 9 | Mejora | `/compras/dte` | La leyenda de conciliación lista estados sin datos en la ventana | Abierto (menor) |
| 10 | Mejora | `/analitica` | Las áreas usan curvas suavizadas; entre meses con hueco el trazo puede insinuar valores que no existen | Abierto (menor) |
| 11 | Cobertura | `/bodega` | Todo el stock sale «sin consumo» en el clon: no hay salidas en 90 días | Dato, no defecto |
| 12 | Cobertura | `/prevencion/pdtp/.../cierres` | Estado vacío: el programa 2026 está en borrador | Dato (Fase 0b.1) |

## Verificación

- E2E completa sobre `2d02e4995`: 1.071 pruebas pasan, 4 fallan y 4 no corren. Las 4 fallas están corregidas en `bc8df84ad` y sus specs pasan (22 de 22).
- Las correcciones de este recorrido tienen pruebas dirigidas en verde (Consumo 90, tablero 466, PPA 84, Analítica 7, Guías 11, PDTP y combustibles 1.292, guardia de gráficos incluida).
- No se volvió a correr la suite completa después de `6fe3dc96c`. Los cambios son locales y cada uno tiene su prueba.

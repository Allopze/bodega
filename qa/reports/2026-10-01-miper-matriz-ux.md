# Verificación — rediseño de la grilla de la matriz MIPER (2026-10-01)

Alcance: pestaña **Matriz** de `/prevencion/miper/[id]` (commit `b407c2f0`).
Recorrido asistido **acotado** a esa pestaña; no es una auditoría de la aplicación.

## Datos usados

- Desarrollo (`next dev` :3001, `bodega_dev`). La base no tenía ninguna MIPER: se importó
  el RE-04 de Biodiversa (`docs/Prevención Biodiversa/5. MATRIZ DE RIESGOS/…`) como
  borrador **Oficina Central 2099**, motivo `QA_ importación…` → 222 filas cargadas.
  Queda en `bodega_dev` (`riskmatrix-7fJbp_csGgyQu8qUbYbiC`); se puede descartar desde la UI.
- La edición de prueba (Peligro del riesgo 212 + « QA_») se revirtió al valor original.

## PASS (verificado en navegador)

| Comprobación | Evidencia |
|---|---|
| A 1920 px la evaluación completa (P, C, MR, ¿Controlado?, Medidas) cabe sin desplazar | captura a 1920 px |
| Texto completo con salto de línea; valores repetidos atenuados | captura |
| Columnas fijas calzan con su columna (N° 281–361, Actividad 361–521, Tarea 521–681, Peligro 681) | medición `getBoundingClientRect` |
| Cabecera fija al bajar y columnas fijas con borde al desplazar a la derecha | captura con desplazamiento |
| Pendiente marcado en la celda («Medidas» en rojo) + contador en N° | captura |
| Franja → filtro: Importante 42/222, +Moderado 120/222, chip removible, «Quitar filtros» | script |
| Filtrar desde la pestaña Programa vuelve a Matriz | script |
| «Con pendientes» filtra | script |
| Edición + Enter: guarda, persiste tras recargar, foco baja a la fila siguiente visible | script |
| Editar Actividad con agrupación + Tab: el foco sigue en la Tarea de la misma fila | script |
| Móvil 390 px: sin desborde horizontal; tarjetas sin cambios | captura |
| Sin errores de consola ni respuestas ≥400 (salvo avatar dicebear, ruido conocido) | script |

## Pruebas automatizadas

- `vitest` MIPER + `components/prevention`: 19 archivos, 95 pruebas, verde.
- E2E MIPER, primera corrida (6 specs): 19 pasan, **2 fallan** → regresión real: la marca
  «Modificada» se ocultaba en la 2ª ronda de revisión (se comparaba contra la versión
  aprobada en vez de contra `reviewBaselineSnapshot`) y había quedado sólo como ícono.
  Corregido.
- Segunda corrida (escenario, flujo, interacciones): 16/16 pasan.
- Tercera corrida (programa, controles, matriz) con el código final: 14/14 pasan.
- Regresión nueva en `prevencion-miper-interacciones.spec.ts`: el borde derecho de «Tarea»
  (fija) coincide con el izquierdo de «Peligro».
- `typecheck` y `eslint` de los archivos tocados: limpios.

## Defecto encontrado y corregido de paso

PRODUCT BUG (preexistente): la tabla usaba `min-w-[2400px]` con `table-fixed`. Sin `width`
explícito el navegador vuelve al reparto por contenido, los anchos declarados no se respetan
y las columnas fijas (`left-*`) quedan desalineadas: son los cortes de línea que se ven en la
captura original. Ahora el ancho de la tabla es la suma exacta de las columnas.

## COVERAGE GAP

- Vista de solo lectura y vista de revisión (Jefa/Legal) en la grilla: sólo las cubren las
  E2E, no se recorrieron a mano.
- Pantallas de menos de 1600 px: Medidas queda fuera de la vista sin desplazar (esperado).

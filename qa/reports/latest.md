# Índice de auditorías QA

`AGENTS.md` reserva este archivo para el resultado humano más reciente del pipeline de QA.
Hasta el 2026-09-12 contenía el informe de **trazabilidad** del 2026-09-04 bajo este
nombre: un informe de alcance acotado a un módulo, presentado como si fuera el resultado
global y anclado al commit `da582cfc`. Leerlo como estado del producto llevaba a creer
cubierto lo que nunca se recorrió.

Este archivo es ahora un índice. Cada informe se lee bajo su propio alcance.

| Fecha | Informe | Alcance |
|---|---|---|
| 2026-09-12 | [AUDITORIA_INTEGRAL_CHOME_2026-09-12.md](../../AUDITORIA_INTEGRAL_CHOME_2026-09-12.md) | Integral: repositorio y entorno local/efímero. E2E detenida a los 45 min con 126 pruebas sin ejecutar — no es certificación de release |
| 2026-09-04 | [trazabilidad-2026-09-04.md](trazabilidad-2026-09-04.md) | Módulo de trazabilidad de bodega, commit `da582cfc` |
| 2026-09-03 | [auditoria-ti-2026-09-03.md](auditoria-ti-2026-09-03.md) | Módulo de TI |

## Cómo se actualiza

Al cerrar una auditoría, versionar el informe en `qa/reports/` con la fecha en el nombre y
agregar su fila acá, diciendo explícitamente qué quedó **sin** recorrer. Una auditoría
interrumpida se registra como interrumpida: el contrato pide distinguir rutas descubiertas,
flujos autenticados y estados condicionales, y una corrida parcial no cubre los tres.

No renombrar un informe de módulo a `latest.md`: fue exactamente esa confusión la que hizo
pasar un recorrido de un módulo por un resultado de producto.

# Retiro de Aramco — verificación 2026-11-01

## Alcance

Retiro de la integración y limpieza de datos de combustibles, con pruebas en un
checkout aislado, una copia restaurada y verificaciones específicas después del
corte de producción. No es una auditoría completa de la aplicación.

## Comprobaciones

- Pasaron `typecheck` y `lint` completos, React Doctor (sin hallazgos en 56
  archivos), 404 pruebas de interfaz y pruebas dirigidas de cron, fuentes,
  conciliación, panel, anomalías y alcance.
- Las pruebas PGlite cubrieron lotes mixtos y vacíos, totales, preservación de
  Copec y DTE, bloqueo de dependencias y rollback ante fallo de auditoría. El
  guard del corte pasó 12 pruebas sobre PostgreSQL 16, incluyendo concurrencia,
  pérdida de sesión e interrupción.
- La imagen de producción se construyó con memoria limitada. En un contenedor
  con base de prueba respondió el healthcheck y pasaron tres recorridos Chromium
  autenticados de Fuentes, Integraciones y presencia del control Copec.
- El respaldo definitivo de producción se restauró en una base aislada antes de
  aplicar la limpieza y migración. Tras el corte hay cero corridas, ajustes,
  medio y proveedor Aramco identificados; permanecen los 8 DTE de Esmax. La
  entrada de auditoría registra a `allopze@gmail.com`.
- Aplicación, cron y programador de respaldos usan la imagen nueva, están sanos,
  y sus entornos no contienen variables `ARAMCO_*`. El cron Aramco está ausente.
  El healthcheck local y público respondió correctamente.
- La sincronización real de Copec del 1 de noviembre, 17:27 hora de Chile,
  terminó con respuesta HTTP 200. Cuatro corridas de febrero a mayo de 2026
  procesaron 12 archivos: 2.051 filas recibidas y 2.016 aceptadas. La corrida de
  noviembre quedó parcial, con cero archivos y cobertura `unknown` para sus
  cuatro combinaciones de canal y producto.

## Advertencias y cobertura pendiente

- La sesión QA disponible no fue válida en producción; las pantallas se
  verificaron con navegador autenticado en la imagen y base de prueba, no con
  sesión autenticada en producción.
- La corrida parcial del mes en curso de Copec requiere investigación separada;
  el éxito global del cron no certifica esa cobertura.
- La limpieza conserva archivos Excel compartidos con otros proveedores; esos
  archivos pueden seguir conteniendo filas históricas de Esmax. En el inventario
  de producción no había operaciones ni archivos Aramco asociados.
- La herramienta de limpieza bloquea dependencias complejas que todavía no puede
  recalcular con seguridad. No se hizo una auditoría completa ni una suite E2E
  completa de la aplicación.
- La imagen previa sigue disponible para recuperación, pero no debe iniciarse
  contra el esquema nuevo: la migración y la limpieza no se revierten al cambiar
  la imagen. El respaldo definitivo está bajo la carpeta privada del corte.

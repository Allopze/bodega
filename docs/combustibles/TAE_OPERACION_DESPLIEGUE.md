# TAE: operación y despliegue

## Alcance operativo

TAE registra cargas físicas realizadas en terreno. Copec TCT aporta consumos mensuales descargados desde **Informes > Informes de consumo > período > Buscar > Descargar detalle > Exportar Excel**. El proceso debe repetirse para **Diésel** y **BlueMax (AdBlue)**.

Los dos canales no son documentos espejo: la conciliación muestra cobertura y litros acumulados por mes, faena y equipo. TAE aún no clasifica producto, por lo que sus litros permanecen separados de Diésel y BlueMax TCT.

## Preparación de producción

1. Respaldar la base de datos y el almacenamiento de evidencias.
2. Configurar `DATABASE_URL`, `AUTH_SECRET`, el almacenamiento persistente y, si se requiere ajustar la carga OCR, `TAE_OCR_MAX_CONCURRENT`.
3. Construir la misma revisión que se desplegará con `npm ci` y `npm run build`.
4. Aplicar cambios de base con `npm run db:migrate`. No usar `db:push` ni modificar el journal de Drizzle.
5. Sincronizar permisos con `npm run db:sync-rbac` para incorporar `tae_view`, `tae_review`, `tae_manage_config`, `tae_import` y `tae_export`.
6. Reiniciar la aplicación y sus workers con almacenamiento persistente montado.

## Puesta en marcha

1. Abrir `/combustibles/tae/configuracion`, crear los puntos de carga y generar sus accesos QR.
2. Probar un QR desde un teléfono: activación, cuatro fotografías, envío conectado y envío sin red con sincronización posterior.
3. Importar `CONTROL_MANUAL_COMBUSTIBLES_UNIFICADO.xlsx` primero como reporte. Revisar faenas, equipos, conductores, supervisores, continuidad de sellos y la fila inválida antes de confirmar.
4. Descargar desde Copec TCT cada mes y producto por separado. Importar los Excel desde `/combustibles/importar` y verificar que la fuente quede como `Copec TCT Diesel` o `Copec TCT BlueMax`.
5. Revisar `/combustibles/tae/conciliacion`; resolver los registros sin equipo asociado y exportar el Excel de control.

## Verificación posterior

- Un usuario de faena sólo puede leer y operar su alcance.
- La repetición del mismo histórico TAE queda bloqueada por hash.
- El detalle conserva cuatro evidencias y el historial de revisión.
- El OCR no impide guardar cuando una lectura requiere revisión manual.
- La cola offline conserva orden FIFO y no pierde formularios al recargar.
- La conciliación separa TAE, Diésel TCT y BlueMax TCT.
- Las exportaciones se descargan como `.xlsx`.

## Recuperación

Si la aplicación falla después del despliegue, conservar la base y las evidencias, volver a la imagen anterior y revisar los logs antes de reintentar. Las migraciones son acumulativas: no editar ni revertir archivos SQL existentes; cualquier corrección de esquema debe generarse como una migración nueva.

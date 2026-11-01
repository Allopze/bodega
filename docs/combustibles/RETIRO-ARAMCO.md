# Retiro de Aramco: procedimiento de datos

Este procedimiento conserva los DTE y demás documentos compartidos. Antes de
usarlo, deshabilitar el cron y la sincronización manual de Aramco y esperar a
que termine cualquier ejecución en curso. La aplicación antigua no debe volver
al servicio tras la limpieza, pues podría volver a crear sus registros.

1. Comprobar que `DATABASE_URL` apunta a la base correcta sin mostrar su valor.
   Crear un respaldo de la base y de sus archivos de evidencia; verificar que
   el respaldo puede recuperarse en un entorno aislado. Conservar su identificador.
2. En un entorno de mantenimiento con Node 22, las dependencias del repositorio
   y acceso a la base seleccionada, ejecutar el inventario de solo lectura:

   ```bash
   npx tsx scripts/retire-aramco.ts
   ```

   El resultado contiene identificadores, cantidades, `blockers` y `hash`, sin
   contraseñas ni valores de ajustes. Repetir el inventario inmediatamente
   antes de aplicar. Si `blockers` es distinto de cero, **no ejecutar** la
   limpieza: requiere análisis y tratamiento específico de los registros.
3. Con `blockers: 0`, responsable activo y respaldo verificado, ejecutar:

   ```bash
   npx tsx scripts/retire-aramco.ts --apply \
     --actor allopze@gmail.com \
     --backup-ref 'IDENTIFICADOR-DEL-RESPALDO-VERIFICADO' \
     --inventory-hash 'HASH-DEL-INVENTARIO'
   ```

   El script verifica el correo de usuario activo y el hash dentro de una
   transacción serializable. Si cambian los identificadores o cantidades, aborta.
   La referencia de respaldo es una declaración del operador: el script no
   verifica por sí mismo la restauración. La eliminación y la bitácora se
   confirman juntas. No registra valores de credenciales.
4. Aplicar las migraciones **después** de la limpieza; la migración nueva
   rechazará corridas o lecturas Aramco que aún existan. Desplegar la aplicación
   y el cron nuevos y comprobar tanto la ausencia de Aramco como el funcionamiento
   de Copec. Repetir el inventario y comprobar los DTE compartidos.

El script cubre el estado inventariado y también elimina filas de operaciones
asociadas mediante la ficha verificada de Esmax, siempre que no tengan cargas
proyectadas, revisiones ni anomalías y que el lote no tenga filas rechazadas.
Conserva otras filas del lote y recalcula sus totales y fechas. Si el lote queda
sin filas, lo marca como revertido y lo identifica en la bitácora, permitiendo
importaciones futuras. El XLSX original compartido se conserva y puede seguir
conteniendo filas históricas de Esmax. El inventario incluye identificadores y hashes
de las filas de los lotes afectados para detectar cambios antes de aplicar.

Si detecta transacciones del proveedor, lecturas, archivos, conciliaciones,
cuentas de combustible, entradas de medios, operaciones con identidad ambigua,
proyecciones de cargas, rechazos, revisiones o anomalías, aborta sin cambios.
Esos casos requieren tratamiento específico y no se limpian automáticamente.
También bloquea proveedores identificados solo por nombre, `fs-esmax` con RUT
diferente o ausente y medios candidatos configurados con otro proveedor. No borra
documentos DTE ni catálogos de proveedores generales. La migración elimina el
medio sembrado solo en una base sin usuarios y deja una traza técnica; en una
base existente exige la limpieza auditada previa.

La imagen standalone actual no incluye `tsx` ni este script. Ejecutarlo desde
un entorno de mantenimiento que tenga el código y acceso explícito a la base;
no imprimir ni copiar la cadena de conexión en informes o bitácoras.

## Corte protegido en una base existente

`scripts/aramco-cutover-cli.ts` combina el inventario, la limpieza auditada y
el migrador Drizzle bajo `aramco-cutover-guard.mjs`. Exige PostgreSQL 16 primario,
el nombre de la base, el identificador del clúster y el rol esperados; `--apply`
además exige el hash del inventario, responsable, referencia de respaldo y
`--services-stopped`. El operador debe verificar de forma independiente el
respaldo recuperable y que los procesos de aplicación, cron y respaldo estén
detenidos: las opciones son declaraciones, no sustituyen esas comprobaciones.

El guard rechaza conexiones de negocio mientras dura el corte. Si se interrumpe
o falla después de iniciarlo, puede dejar `ALLOW_CONNECTIONS` desactivado. No
reiniciar la versión anterior ni restaurar un respaldo sobre escrituras nuevas:
conectarse a la base administrativa `postgres`, revisar el estado de la
auditoría y la migración, y reabrir la base solo después de resolver el fallo.
El test del guard requiere una base PostgreSQL local desechable y vacía indicada
en `ARAMCO_CUTOVER_TEST_DATABASE_URL`.

# Control Operacional: Flota y Mantenciones

Las pantallas `Flota` y `Mantenciones` (ubicadas dentro del menú *Control Operacional*) permiten gestionar el parque de vehículos y maquinarias de la empresa, su ficha técnica, historial de costos y mantenimiento preventivo/correctivo.

## 1. Módulo de Flota (`/flota`)

La pantalla `Flota` muestra el catálogo maestro de vehículos, camionetas, maquinaria pesada y equipos menores.

### Información del vehículo

- **Datos generales**: Patente/Identificador, marca, modelo, año, número de chasis/VIN y tipo de equipo.
- **Asignación operacional**: Faena asignada, centro de costo e imputación.
- **Indicadores de uso**: Último kilometraje u horómetro registrado, costo operacional acumulado y consumo medio de combustible.
- **Documentación del vehículo**: Revisión técnica, permiso de circulación, seguro obligatorio (SOAP) y padrón.

### Cómo registrar un nuevo vehículo

1. Abre el menú lateral y selecciona `Control Operacional > Flota`.
2. Presiona el botón `Nuevo vehículo` o `Gestionar vehículos`.
3. Completa los datos requeridos (Patente, tipo de equipo, faena, capacidad de estanque y rendimiento esperado).
4. Presiona `Guardar vehículo`.

---

## 2. Módulo de Mantenciones (`/mantenciones`)

La pantalla `Mantenciones` se utiliza para planificar, registrar y hacer seguimiento a los trabajos de mantenimiento preventivo, correctivo y pautas de servicio de la flota.

### Tipos de mantenciones

- **Preventiva**: Revisiones periódicas por pauta de kilometraje u horas de motor (ej. *10.000 km*, *250 hrs*).
- **Correctiva**: Reparación de fallas mecánicas, eléctricas o estructurales detectadas en terreno.
- **Emergencia**: Intervenciones no programadas ante detención del equipo.

### Cómo registrar una mantención

1. Ingresa a `Control Operacional > Mantenciones`.
2. En la barra de acciones superior, presiona `Nueva mantención`.
3. Se desplegará el panel de registro:
   - Selecciona el **Vehículo** por patente o número interno.
   - Indica el **Taller / Proveedor de servicio** responsable.
   - Asigna la **Faena** y el **Centro de Costo** al que se imputará el gasto.
   - Especifica fecha, tipo de mantención, kilometraje u horómetro al momento del ingreso.
   - Escribe el detalle de las labores realizadas o repuestos sustituidos.
   - Indica el valor total de la prestación si aplica.
4. Presiona `Guardar mantención`.

---

## Coordinación entre Flota, Mantenciones y Combustibles

- **Historial consolidado**: Al ingresar a la ficha de un vehículo en `Flota`, podrás revisar el historial completo de mantenciones efectuadas y las cargas de combustible registradas en `Combustibles`.
- **Actualización de lectura**: Cada vez que se registra una mantención o una carga de combustible, la lectura de odómetro o horómetro del vehículo en `Flota` se actualiza automáticamente.

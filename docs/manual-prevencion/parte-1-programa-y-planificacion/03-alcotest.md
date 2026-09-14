# Capítulo 03: Controles de Alcotest y Envíos Mensuales (DO-48)

> **Marco Normativo:** Procedimiento Operativo Corporativo DO-48, Reglamento Interno de Orden, Higiene y Seguridad (RIOHS) y DS 44.  
> **Ruta en Plataforma:** Menú > Prevención > **Alcotest** (`/prevencion/alcotest`).  
> **Actividades PDTP Asociadas:** N° 30 (Control terreno PRF), N° 31 (Control terreno Línea de Mando) y N° 32 (Envío mensual consolidado).

---

## 1. Importancia del Control de Alcotest en Faena

La conducción de camiones, grúas y maquinaria pesada exige una política de **tolerancia cero al consumo de alcohol y sustancias ilícitas**. 

El submódulo de Alcotest permite gestionar todo el ciclo preventivo en la faena:
1. Registro diario de controles aleatorios, preventivos o por sospecha fundada.
2. Protocolo de contingencia ante resultados positivos.
3. Generación del reporte formal de envío mensual para cumplir el compromiso con la Gerencia y el PDTP.

---

## 2. Paso a Paso: Cómo Registrar un Control Individual

```
[Ir a /prevencion/alcotest]
            │
            ▼
[Presionar "Nuevo Control"]
            │
            ▼
1. Seleccionar Faena y Trabajador (por RUT o Nombre)
2. Seleccionar Motivo del Control
3. Ingresar Código del Alcotest y Fecha
4. Marcar Resultado (0.0 g/l o Positivo)
            │
            ▼
[Presionar "Guardar Control"]
```

### Paso 1: Ingreso al Formulario
En `/prevencion/alcotest`, haz clic en **"Nuevo control de alcotest"**.

### Paso 2: Datos del Control y del Trabajador
*   **Faena:** Selecciona la faena donde se realiza la prueba.
*   **Trabajador:** Escribe el RUT o apellido del trabajador. El sistema buscará en la dotación activa de la faena.
*   **Motivo del Control:** Elige entre las opciones normadas:
    *   *Aleatorio de inicio de turno* (rutina preventiva).
    *   *Sospecha fundada* (por comportamiento o signos visibles).
    *   *Post-incidente* (obligatorio ante cualquier colisión o accidente de equipo).
    *   *Reintegro de turno*.
*   **Identificador del Equipo:** Ingresa el número de serie o código interno del alcotest (asegúrate de que tenga calibración vigente).

### Paso 3: Resultado de la Medición
*   **Negativo (`0.0 g/l`):** Si la pantalla del equipo marca cero, selecciona `0.0 g/l`. El trabajador queda inmediatamente habilitado para continuar su turno.
*   **Positivo (`> 0.0 g/l`):** Si el alcotest detecta cualquier traza de alcohol:
    1. Marca `Positivo` e ingresa el valor exacto marcado en pantalla (ej. `0.25 g/l`).
    2. **Activa de inmediato el Protocolo DO-48:**
       * Retira al trabajador de la conducción o manejo de maquinaria de forma inmediata y respetuosa.
       * Informa de inmediato al Jefe de Terreno y Administrador de Contrato.
       * Realiza la contraprueba reglamentaria después de 15 minutos en presencia de un testigo o representante del CPHS.
       * Registra las observaciones y deriva a centro de salud si corresponde según el RIOHS.

### Paso 4: Guardar
Presiona **"Guardar registro"**. El control quedará almacenado en la bitácora auditable de la faena.

---

## 3. Envío Mensual Consolidado (Actividad PDTP N° 32)

Realizar los controles diarios no es suficiente para acreditar la actividad N° 32 del programa preventivo: **la norma exige el cierre y envío mensual del expediente**.

### Cómo Realizar el Envío Mensual a Fin de Mes:
1. Entre los días 25 y 30 de cada mes, ingresa a `/prevencion/alcotest`.
2. En la parte superior verás el botón **"Registrar envío mensual"**.
3. El sistema consolidará automáticamente todos los controles realizados durante el mes en tu faena:
   * Total de controles ejecutados.
   * Total de resultados negativos y positivos.
   * Porcentaje de cobertura de la dotación.
4. Confirma los datos y presiona **"Firmar y Registrar Envío"**.
5. **Resultado Inmediato:** La celda de la actividad **N° 32** en el Programa de Trabajo Preventivo (`/prevencion/pdtp`) se pintará de **verde**.

> [!WARNING]
> Si no ejecutas este paso antes del último día hábil del mes, la actividad N° 32 quedará en estado vencido (rojo), aunque hayas realizado controles todos los días.

# Control Operacional: Combustibles

El módulo de `Combustibles` (ubicado dentro de la sección *Control Operacional*) gestiona el registro de cargas, control de consumo, conciliación bancaria/operativa, auditoría de anomalías y costos por vehículo y faena.

## Sub-módulos y funcionalidades

- [Bitácora e Importación de cargas](./combustibles/cargas.md): Registro individual e importación masiva de vouchers de combustible.
- [Vehículos y rendimiento](./combustibles/vehiculos.md): Ficha de equipos, capacidad de estanque y rendimiento esperado (km/l u hora/l).
- [Conciliación TAE](./combustibles/tae.md): Conciliación de cartolas electrónicas de proveedores (Copec, Shell, Enex).
- [Detección de anomalías](./combustibles/anomalias.md): Reglas de alerta ante exceso de estanque, odómetro inconsistente o cargas sospechosas.
- [Facturas de combustible](./combustibles/facturas.md): Asociación de documentos tributarios con vales y guías recibidas.
- [Control de sellos](./combustibles/sellos.md): Custodia y trazabilidad de precintos numerados de seguridad en estanques.
- [Proveedores de combustible](./combustibles/proveedores.md): Catálogo de distribuidores y precios pactados.
- [Cuenta corriente](./combustibles/cuenta-corriente.md): Control de saldos y créditos por estación de servicio.
- [Reportes de combustible](./combustibles/reportes.md): Consolidado de consumo, costos por centro de costo y exportación a Excel.

## Organización de la pantalla principal

Al entrar a `Combustibles` verás los filtros superiores de **Periodo**, **Faena** y **Tipo de vehículo**, junto a tres pestañas de navegación:

1. **Resumen**: Indicadores clave de rendimiento (KPIs), gasto total en litros/pesos, tendencia diaria y alertas activas.
2. **Análisis**: Gráficos interactivos de consumo por faena, dispersión de eficiencia, evolución por equipo y ranking de rendimiento por patente.
3. **Registros**: Bitácora paginada con el detalle completo de cargas.

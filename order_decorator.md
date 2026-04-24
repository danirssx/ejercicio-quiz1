**FE DE ERRATA: Abajo en el enunciado se aplica corrección. No se hace llamada a super.process(), se hace llamada del decorado con delegación recursiva, es decir, se invoca el método process() del decorado.**

Considere que es parte del equipo backend de una plataforma de e-commerce de alto tráfico. Cuando se recibe un pedido (una orden), debe pasar por un **_pipeline_ de validaciones y enriquecimientos** antes de persistirse: detección de fraude, cálculo de impuestos según el país, aplicación de descuentos acumulativos, _logging_ estructurado para auditoría (trazas para auditoría) y _rate-limiting_ por cliente.

El equipo actual usa muchos if/else anidados. Cada vez que se agrega un nuevo requerimiento, regla o solicitud (ej. Agregar soporte para aplicar cupones de descuento), se rompe algo en el sistema. Tu misión es rediseñar el _pipeline_usando el **patrón Decorador** de forma que cada responsabilidad sea _composable_, testeable de forma aislada y extensible sin modificar el código existente (es decir, cumpla con OCP de SOLID). Debe hacer uso del patrón Decorador, no puede sustituirlo por otro.

La clase **BaseOrderProcessor** implementa **OrderProcessor** (ver abajo, al final del enunciado los tres tipos o _interfaces_ del problema). Debe calcular el **subtotalUsd** sumando **quantity** × **unitPriceUsd** de cada ítem, inicializar **taxUsd**, **discountUsd** y **riskScore** en 0, y poblar **auditTrail** y **processedAt**. No aplica lógica adicional.

Cada decorador recibe un **OrderProcessor** (su decorado) en su constructor, llama a **process()** del decorado y se invoca mediante delegación recursiva el método **process()** de su decorado y genera un nuevo resultado con las modificaciones pertinentes que deba aplicar el decorador (**el objeto orden siempre es inmutable)**. **Todos deben agregar una entrada descriptiva al auditTrail (registros para auditoría)**. Algunos decoradores deben ser resilientes mientras otros deben fallar fuerte, es decir, **algunos pueden lanzar excepciones mientras que otros pueden avanzar con la aplicación del siguiente decorador (si existe)**. **Por otro lado, las dependencias externas (FraudService, CouponService) son servicios externos asíncronos e inestables.**

1. **TaxDecorator** — aplica el porcentaje correcto según **shippingCountry**: US → 8.25 %, MX → 16 %, DE → 19 %, resto → 0 %. Calcula el impuesto sobre el **subtotalUsd** ya descontado (si existe descuento previo).

2. **CouponDecorator** — recibe un **CouponService** (interfaz que tú defines) que **resuelve el valor del cupón de forma asíncrona**. Si **couponCode** está presente, aplica el descuento. Debe ser resiliente: **si el servicio falla, el pedido continúa con descuento 0** y lo registra en el **auditTrail**.

3. **FraudDetectionDecorator** — recibe un **FraudService** (interfaz) y asigna el **riskScore**. Si el score ≥ 75, lanza un **FraudRiskError** (error personalizado que tú defines) con el **orderId** y el **riskScore**.

4. **RateLimitDecorator** — recibe un **RateLimitStore** (interfaz) que registra y consulta cuántos pedidos ha procesado un **customerId** en la última ventana de tiempo. Si supera el límite configurado, lanza **RateLimitExceededError**. El límite y la ventana son inyectables.

En relación con la composición de decoradores, crea una función _factory_ **buildOrderPipeline** que reciba todas las dependencias y retorne un **OrderProcessor** compuesto en este orden:

**Flujo del Chain por decirlo así, tomarlo en cuenta para el `buildOrderPipeline`**
RateLimit → FraudDetection → Coupon → Tax → Base

### Pregunta a justificar, mejor de último
Justifica por escrito el orden elegido. ¿Cambiaría el resultado si **Tax** se aplica antes que **Coupon**? ¿Por qué importa el orden de **RateLimit**?

### Hacer casos de prueba de último
Debe enunciar todos los casos de pruebas para cada uno de los decoradores y del _pipeline_. Se prohíbe la verificación de detalles de implementación en las pruebas tal como se discutió en clases.

``` typescript
export interface Order {

  id: string;

  customerId: string;

  items: Array<{ sku: string; quantity: number; unitPriceUsd: number }>;

  shippingCountry: string;   // ISO-3166 alpha-2, e.g. "US", "MX", "DE"

  couponCode?: string;

}

export interface ProcessedOrder extends Order {

  subtotalUsd: number;

  taxUsd: number;

  discountUsd: number;

  totalUsd: number;

  riskScore: number;         // 0-100; ≥75 → pedido bloqueado

  auditTrail: string[];      // log de cada decorador ejecutado

  processedAt: string;       // ISO-8601

}

export interface OrderProcessor {

  process(order: Order): Promise<ProcessedOrder>; 

}
```

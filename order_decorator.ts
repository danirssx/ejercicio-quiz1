export interface Order {
  id: string;
  customerId: string;
  items: Array<{ sku: string; quantity: number; unitPriceUsd: number }>;
  shippingCountry: string;
  couponCode?: string;
}

export interface ProcessedOrder {
  subtotalUsd: number;
  taxUsd: number;
  discountUsd: number;
  totalUsd: number;
  riskScore: number; // 0-100; ≥75 → pedido bloqueado
  auditTrail: string[]; // log de cada decorador ejecutado
  processedAt: string;
}

// Estructura principal del Decorador de la Orden

export interface OrderProcessor {
  process(order: Order): Promise<ProcessedOrder>;
}

export class BaseOrderProcessor implements OrderProcessor {
  // La función process se va a encargar de lidiar directamente con la lógica de calcular el subtotal de cada item y además incializara alguna de las variables.
  async process(order: Order): Promise<ProcessedOrder> {
    const subtotalUsd = order.items
      .map((item) => item.quantity * item.unitPriceUsd)
      .reduce((acc, curr) => acc + curr, 0);

    return {
      subtotalUsd,
      taxUsd: 0,
      discountUsd: 0,
      totalUsd: 0,
      riskScore: 0,
      auditTrail: ["Procesado el subtotal de la orden"],
      processedAt: new Date().toISOString(),
    };
  }
}

// Decorador Central

abstract class OrderDecorator implements OrderProcessor {
  protected wrappee: OrderProcessor; // protected para que los decoradores concretos puedan acceder

  constructor(wrappee: OrderProcessor) {
    this.wrappee = wrappee;
  }

  // Lo declaramos abstracto porque la idea es que los decoradores que lo extiendan desarrollen su propia lógica
  abstract process(order: Order): Promise<ProcessedOrder>;
}

// Interfaces de los servicios externos
export interface RateLimitScore {
  rateLimit(customerId: string): Promise<number>;
}

export interface FraudService {
  evaluateRisk(order: Order): Promise<number>;
}

export interface CouponService {
  applyCoupon(couponCode: string, subTotalUsd: number): Promise<number>;
}

// Decoradores Concretos

// Decorador del Rate Limit
export class RateLimitDecorator extends OrderDecorator {
  private readonly rateLimitScore: RateLimitScore;
  private limit: number;

  constructor(
    wrappee: OrderProcessor,
    rateLimitScore: RateLimitScore,
    limit: number,
  ) {
    super(wrappee);
    this.rateLimitScore = rateLimitScore;
    this.limit = limit;
  }

  async process(order: Order): Promise<ProcessedOrder> {
    const count = await this.rateLimitScore.rateLimit(order.customerId);
    if (count >= this.limit) {
      throw new RateLimitExceededError(order.customerId);
    }
    const result = await this.wrappee.process(order);
    return {
      ...result,
      auditTrail: [
        ...result.auditTrail,
        `RateLimit check comprobado por ${order.customerId} (${count}/${this.limit})`,
      ],
    };
  }
}

export class FraudDetectionDecorator extends OrderDecorator {
  private readonly fraudService: FraudService;
  constructor(wrappee: OrderProcessor, fraudService: FraudService) {
    super(wrappee);
    this.fraudService = fraudService;
  }

  async process(order: Order): Promise<ProcessedOrder> {
    const risk = await this.fraudService.evaluateRisk(order);
    if (risk >= 75) {
      throw new FraudRiskError(order.id, risk);
    }
    const result = await this.wrappee.process(order);
    return {
      ...result,
      riskScore: risk,
      auditTrail: [
        ...result.auditTrail,
        `FraudDetection: orden #${order.id} aprobada con riskScore ${risk}`,
      ],
    };
  }
}

export class CouponDecorator extends OrderDecorator {
  private readonly couponService: CouponService;

  constructor(wrappee: OrderProcessor, couponService: CouponService) {
    super(wrappee);
    this.couponService = couponService;
  }

  async process(order: Order): Promise<ProcessedOrder> {
    const result = await this.wrappee.process(order);

    if (!order.couponCode) {
      return {
        ...result,
        discountUsd: 0,
        totalUsd: result.subtotalUsd + result.taxUsd,
        auditTrail: [
          ...result.auditTrail,
          "CouponDecorator: sin cupón, descuento omitido",
        ],
      };
    }

    try {
      const discount = await this.couponService.applyCoupon(
        order.couponCode,
        result.subtotalUsd,
      );
      return {
        ...result,
        discountUsd: discount,
        totalUsd: result.subtotalUsd - discount + result.taxUsd,
        auditTrail: [
          ...result.auditTrail,
          `CouponDecorator: cupón "${order.couponCode}" aplicado, descuento $${discount}`,
        ],
      };
    } catch {
      return {
        ...result,
        discountUsd: 0,
        totalUsd: result.subtotalUsd + result.taxUsd,
        auditTrail: [
          ...result.auditTrail,
          `CouponDecorator: fallo al aplicar cupón "${order.couponCode}", continuando con descuento 0`,
        ],
      };
    }
  }
}

// Strategy Pattern para el cálculo de impuestos

interface TaxStrategy {
  calculate(subTotalUsd: number): number;
}

class UsStrategy implements TaxStrategy {
  calculate(subTotalUsd: number): number {
    return subTotalUsd * 0.0825;
  }
}

class MxStrategy implements TaxStrategy {
  calculate(subTotalUsd: number): number {
    return subTotalUsd * 0.16;
  }
}

class DeStrategy implements TaxStrategy {
  calculate(subTotalUsd: number): number {
    return subTotalUsd * 0.19;
  }
}

class RestTaxStrategy implements TaxStrategy {
  calculate(subTotalUsd: number): number {
    return 0;
  }
}

export class TaxContext {
  private strategy: TaxStrategy;
  private country: string = "";

  private selectStrategy(): TaxStrategy {
    switch (this.country) {
      case "US":
        return new UsStrategy();
      case "MX":
        return new MxStrategy();
      case "DE":
        return new DeStrategy();
      default:
        return new RestTaxStrategy();
    }
  }

  calculate(country: string, subtotalUsd: number): number {
    this.country = country;
    this.strategy = this.selectStrategy();
    return this.strategy.calculate(subtotalUsd);
  }
}

export class TaxDecorator extends OrderDecorator {
  private readonly taxContext: TaxContext;

  constructor(wrappee: OrderProcessor, taxContext: TaxContext) {
    super(wrappee);
    this.taxContext = taxContext;
  }

  async process(order: Order): Promise<ProcessedOrder> {
    const result = await this.wrappee.process(order);
    const taxBase = result.subtotalUsd - result.discountUsd;
    const taxUsd = this.taxContext.calculate(order.shippingCountry, taxBase);
    const totalUsd = result.subtotalUsd - result.discountUsd + taxUsd;
    return {
      ...result,
      taxUsd,
      totalUsd,
      auditTrail: [
        ...result.auditTrail,
        `TaxDecorator: impuesto ${order.shippingCountry} ($${taxUsd}) sobre base $${taxBase}`,
      ],
    };
  }
}

// Factory
interface PipelineDeps {
  fraudService: FraudService;
  couponService: CouponService;
  rateLimitScore: RateLimitScore;
  rateLimitMax: number;
}

export function buildOrderPipeline(deps: PipelineDeps): OrderProcessor {
  const base = new BaseOrderProcessor();

  // referente al decorador del cupon
  const coupon = new CouponDecorator(base, deps.couponService);

  // referente al decorador de los Taxes
  const taxContext = new TaxContext();
  const tax = new TaxDecorator(coupon, taxContext);

  // referente al decorador del FraudLimit
  const fraud = new FraudDetectionDecorator(tax, deps.fraudService);

  // referente al decorador del RateLimit
  const rate = new RateLimitDecorator(
    fraud,
    deps.rateLimitScore,
    deps.rateLimitMax,
  );

  return rate;
}

// Errores personalizados

export class FraudRiskError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly riskScore: number,
  ) {
    super(`Order ${orderId} blocked: riskScore ${riskScore} >= 75`);
    this.name = "FraudRiskError";
  }
}

export class RateLimitExceededError extends Error {
  constructor(public readonly customerId: string) {
    super(`Rate limit exceeded for customer ${customerId}`);
    this.name = "RateLimitExceededError";
  }
}

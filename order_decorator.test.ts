import { vi, describe, it, expect } from "vitest";
import type {
  Order,
  FraudService,
  CouponService,
  RateLimitScore,
} from "./order_decorator.ts";
import {
  BaseOrderProcessor,
  RateLimitDecorator,
  FraudDetectionDecorator,
  CouponDecorator,
  TaxDecorator,
  TaxContext,
  FraudRiskError,
  RateLimitExceededError,
  buildOrderPipeline,
} from "./order_decorator.ts";

// Órdenes de prueba

const orderUS: Order = {
  id: "order-001",
  customerId: "cust-abc",
  items: [
    { sku: "PROD-1", quantity: 2, unitPriceUsd: 50 }, // $100
    { sku: "PROD-2", quantity: 1, unitPriceUsd: 25 }, // $25
  ],
  shippingCountry: "US",
};

const orderMX: Order = {
  id: "order-002",
  customerId: "cust-abc",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 100 }], // $100
  shippingCountry: "MX",
};

const orderDE: Order = {
  id: "order-003",
  customerId: "cust-abc",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 100 }], // $100
  shippingCountry: "DE",
};

const orderOtherCountry: Order = {
  id: "order-004",
  customerId: "cust-abc",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 100 }], // $100
  shippingCountry: "AR",
};

const orderWithCoupon: Order = {
  id: "order-005",
  customerId: "cust-abc",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 100 }], // $100
  shippingCountry: "US",
  couponCode: "SAVE10",
};

const orderNoCoupon: Order = {
  id: "order-006",
  customerId: "cust-abc",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 100 }], // $100
  shippingCountry: "US",
};

const orderHighRisk: Order = {
  id: "order-007",
  customerId: "cust-risky",
  items: [{ sku: "PROD-X", quantity: 10, unitPriceUsd: 999 }],
  shippingCountry: "US",
};

const orderRateLimitedCustomer: Order = {
  id: "order-008",
  customerId: "cust-spammer",
  items: [{ sku: "PROD-1", quantity: 1, unitPriceUsd: 50 }],
  shippingCountry: "US",
};

// Data Genérica de los servicios

const fraudServiceOk: FraudService = {
  evaluateRisk: vi.fn().mockResolvedValue(30),
};

const fraudServiceBlocked: FraudService = {
  evaluateRisk: vi.fn().mockResolvedValue(80),
};

const couponServiceOk: CouponService = {
  applyCoupon: vi.fn().mockResolvedValue(10),
};

const couponServiceFailing: CouponService = {
  applyCoupon: vi
    .fn()
    .mockRejectedValue(new Error("Coupon service unavailable")),
};

const rateLimitOk: RateLimitScore = {
  rateLimit: vi.fn().mockResolvedValue(1),
};

const rateLimitExceeded: RateLimitScore = {
  rateLimit: vi.fn().mockResolvedValue(5),
};

// Tests aplicados

describe("TaxDecorator", () => {
  it("aplica impuesto del 8.25% para órdenes con destino US", async () => {
    const pipeline = new TaxDecorator(
      new BaseOrderProcessor(),
      new TaxContext(),
    );
    const result = await pipeline.process(orderUS); // subtotal $125

    expect(result.taxUsd).toBeCloseTo(10.31);
  });

  it("aplica impuesto del 16% para órdenes con destino MX", async () => {
    const pipeline = new TaxDecorator(
      new BaseOrderProcessor(),
      new TaxContext(),
    );
    const result = await pipeline.process(orderMX); // subtotal $100

    expect(result.taxUsd).toBeCloseTo(16);
  });

  it("aplica impuesto del 19% para órdenes con destino DE", async () => {
    const pipeline = new TaxDecorator(
      new BaseOrderProcessor(),
      new TaxContext(),
    );
    const result = await pipeline.process(orderDE); // subtotal $100

    expect(result.taxUsd).toBeCloseTo(19);
  });

  it("aplica 0% de impuesto para países sin tasa definida", async () => {
    const pipeline = new TaxDecorator(
      new BaseOrderProcessor(),
      new TaxContext(),
    );
    const result = await pipeline.process(orderOtherCountry); // AR

    expect(result.taxUsd).toBe(0);
  });

  it("calcula el impuesto sobre el subtotal menos el descuento cuando hay cupón", async () => {
    // coupon descuenta $10 → base imponible queda en $90
    const pipeline = new TaxDecorator(
      new CouponDecorator(new BaseOrderProcessor(), couponServiceOk),
      new TaxContext(),
    );
    const result = await pipeline.process(orderWithCoupon); // subtotal $100, descuento $10, país US

    expect(result.taxUsd).toBeCloseTo(7.43); // 90 × 8.25%
  });

  it("agrega una entrada al auditTrail", async () => {
    const pipeline = new TaxDecorator(
      new BaseOrderProcessor(),
      new TaxContext(),
    );
    const result = await pipeline.process(orderUS);

    expect(result.auditTrail.some((e) => e.includes("Tax"))).toBe(true);
  });
});

describe("CouponDecorator", () => {
  it("aplica el descuento del servicio cuando hay couponCode", async () => {
    // couponServiceOk resuelve $10
    const pipeline = new CouponDecorator(
      new BaseOrderProcessor(),
      couponServiceOk,
    );
    const result = await pipeline.process(orderWithCoupon);

    expect(result.discountUsd).toBe(10); // couponServiceOk resuelve 10
  });

  it("establece discountUsd en 0 cuando no hay couponCode", async () => {
    const pipeline = new CouponDecorator(
      new BaseOrderProcessor(),
      couponServiceOk,
    );
    const result = await pipeline.process(orderNoCoupon);

    expect(result.discountUsd).toBe(0);
  });

  it("establece discountUsd en 0 y continúa cuando el servicio de cupones falla", async () => {
    // couponServiceFailing lanza error
    const pipeline = new CouponDecorator(
      new BaseOrderProcessor(),
      couponServiceFailing,
    );
    const result = await pipeline.process(orderWithCoupon);

    expect(result.discountUsd).toBe(0);
  });

  it("registra en auditTrail si el cupón fue aplicado, omitido o falló", async () => {
    const pipeline = new CouponDecorator(
      new BaseOrderProcessor(),
      couponServiceOk,
    );
    const result = await pipeline.process(orderWithCoupon);

    expect(result.auditTrail.some((e) => e.includes("Coupon"))).toBe(true);
  });
});

describe("FraudDetectionDecorator", () => {
  it("asigna el riskScore y continúa cuando el puntaje es menor a 75", async () => {
    // fraudServiceOk resuelve 30
    const pipeline = new FraudDetectionDecorator(
      new BaseOrderProcessor(),
      fraudServiceOk,
    );
    const result = await pipeline.process(orderUS);

    expect(result.riskScore).toBe(30); // fraudServiceOk resuelve 30
  });

  it("lanza FraudRiskError cuando el puntaje de riesgo es mayor o igual a 75", async () => {
    // fraudServiceBlocked resuelve 80
    const pipeline = new FraudDetectionDecorator(
      new BaseOrderProcessor(),
      fraudServiceBlocked,
    );

    await expect(pipeline.process(orderHighRisk)).rejects.toThrow(
      FraudRiskError,
    );
  });

  it("agrega una entrada al auditTrail al aprobar la orden", async () => {
    const pipeline = new FraudDetectionDecorator(
      new BaseOrderProcessor(),
      fraudServiceOk,
    );
    const result = await pipeline.process(orderUS);

    expect(result.auditTrail.some((e) => e.includes("Fraud"))).toBe(true);
  });
});

describe("RateLimitDecorator", () => {
  it("permite el paso de la orden cuando el contador está por debajo del límite", async () => {
    // rateLimitOk resuelve count=1, limit=3
    const pipeline = new RateLimitDecorator(
      new BaseOrderProcessor(),
      rateLimitOk,
      3,
    );
    const result = await pipeline.process(orderUS);

    expect(result.subtotalUsd).toBe(125); // orderUS: 2×50 + 1×25
  });

  it("lanza RateLimitExceededError cuando el contador supera el límite configurado", async () => {
    // rateLimitExceeded resuelve count=5, limit=3
    const pipeline = new RateLimitDecorator(
      new BaseOrderProcessor(),
      rateLimitExceeded,
      3,
    );

    await expect(pipeline.process(orderRateLimitedCustomer)).rejects.toThrow(
      RateLimitExceededError,
    );
  });

  it("agrega una entrada al auditTrail al procesar con éxito", async () => {
    const pipeline = new RateLimitDecorator(
      new BaseOrderProcessor(),
      rateLimitOk,
      3,
    );
    const result = await pipeline.process(orderUS);

    expect(result.auditTrail.some((e) => e.includes("Rate"))).toBe(true);
  });
});

describe("buildOrderPipeline (integration)", () => {
  const deps = {
    fraudService: fraudServiceOk,
    couponService: couponServiceOk,
    rateLimitScore: rateLimitOk,
    rateLimitMax: 3,
  };

  it("Procesando  una orden directa básica y retorna un ProcessedOrder", async () => {
    const pipeline = buildOrderPipeline(deps);
    const result = await pipeline.process(orderUS);
    // coupon es 10
    // order us = 0.0825
    expect(result.totalUsd).toBeCloseTo(135.31); // 125 + 10.31 (sin cupón, descuento = 0)
    expect(result.subtotalUsd).toBe(125);
    expect(result.taxUsd).toBeCloseTo(10.31);
  });

  it("procesa una orden válida de extremo a extremo y retorna un ProcessedOrder", async () => {
    const pipeline = buildOrderPipeline(deps);
    const result = await pipeline.process(orderUS);

    expect(result.subtotalUsd).toBe(125); // orderUS: 2×50 + 1×25, sin cupón
    expect(result.taxUsd).toBeCloseTo(10.31); // 125 × 8.25%
  });

  it("propaga RateLimitExceededError antes de cualquier otro procesamiento", async () => {
    const pipeline = buildOrderPipeline({
      ...deps,
      rateLimitScore: rateLimitExceeded,
    });

    await expect(pipeline.process(orderRateLimitedCustomer)).rejects.toThrow(
      RateLimitExceededError,
    );
  });

  it("propaga FraudRiskError después de que pasa el control de rate limit", async () => {
    const pipeline = buildOrderPipeline({
      ...deps,
      fraudService: fraudServiceBlocked,
    });

    await expect(pipeline.process(orderHighRisk)).rejects.toThrow(
      FraudRiskError,
    );
  });

  it("aplica el descuento del cupón y luego el impuesto sobre la base reducida", async () => {
    // Coupon es la capa más interna: corre primero → descuento $10 → base imponible $90 → tax US 8.25%
    const pipeline = buildOrderPipeline(deps);
    const result = await pipeline.process(orderWithCoupon);

    expect(result.discountUsd).toBe(10);
    expect(result.taxUsd).toBeCloseTo(7.43); // 90 × 8.25% (Coupon corre antes que Tax)
  });

  it("continúa con discountUsd en 0 cuando el servicio de cupones falla", async () => {
    const pipeline = buildOrderPipeline({
      ...deps,
      couponService: couponServiceFailing,
    });
    const result = await pipeline.process(orderWithCoupon);

    expect(result.discountUsd).toBe(0);
  });
});

// Builds the structured, minimal input the model receives. Every value comes from the deterministic engines or the shipment record.
// Field names for the core block follow the AI spec: produceType, temperature, humidity, transitMinutes,
// remainingShelfLifeHours, riskLevel, degradationFactors.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); // user-typed strings: strip control chars and tag brackets

export function buildAiInput({ shipment, temperature, humidity, shelfLife, risk, plan }) {
  const t = risk.thresholds;
  return {
    shipmentId: shipment.id,
    produceType: clean(shipment.produceType),
    route: `${clean(shipment.origin)} to ${clean(shipment.destination)}`,
    quantityKg: shipment.quantity,
    temperature,
    humidity,
    transitMinutes: Math.round(shelfLife.elapsedHours * 60),
    baselineShelfLifeHours: shipment.baselineShelfLifeHours,
    remainingShelfLifeHours: shelfLife.remainingHours,
    riskLevel: risk.level,
    degradationFactors: shelfLife.factors,
    degradationMultiplier: shelfLife.degradationMultiplier,
    factorContribution: { temperaturePct: shelfLife.contributionSharePct.temperature, humidityPct: shelfLife.contributionSharePct.humidity, transitPct: shelfLife.contributionSharePct.transit },
    riskBands: { criticalBelowHours: t.highAtOrAboveHours, highBelowHours: t.mediumAtOrAboveHours, mediumUpToHours: t.lowAboveHours },
    liquidationPlan: plan?.required
      ? { markdownPct: plan.markdownPct, originalPricePerKg: plan.originalPricePerKg, markdownPricePerKg: plan.markdownPricePerKg, sellWithinHours: plan.sellWithinHours }
      : null,
  };
}

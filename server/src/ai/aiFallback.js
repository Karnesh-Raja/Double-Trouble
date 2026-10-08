// DETERMINISTIC FALLBACK. Used when there is no API key, the provider fails or times out, or the model output fails validation.
// Pure template over the same input the model would have seen, so the dashboard always has a useful, correct answer.
// The fallback text must itself pass validateAiOutput (a test enforces this).
const LEAD = {
  CRITICAL: (p, h) => `${p} shipment has entered critical spoilage risk with about ${h}h of shelf life left.`,
  HIGH: (p, h) => `${p} shipment is at high spoilage risk with about ${h}h of shelf life left.`,
  MEDIUM: (p, h) => `${p} shipment is losing shelf life faster than normal, with about ${h}h left.`,
  LOW: (p, h) => `${p} shipment is within normal limits with about ${h}h of shelf life left.`,
};

export function fallbackAnalysis(input) {
  const { produceType: p, riskLevel: level, remainingShelfLifeHours: h, degradationFactors: factors, degradationMultiplier: mult, riskBands: b, liquidationPlan: plan, quantityKg: qty } = input;
  const bandText = level === 'CRITICAL' ? `below the ${b.criticalBelowHours}h critical threshold` : level === 'HIGH' ? `below the ${b.highBelowHours}h high-risk threshold` : level === 'MEDIUM' ? `at or below the ${b.mediumUpToHours}h watch threshold` : `above the ${b.mediumUpToHours}h watch threshold`;
  const drivers = (factors || []).join(', ').toLowerCase();
  const sellBy = plan ? `${plan.sellWithinHours}h` : null;

  const recommendedAction = plan
    ? `${level === 'CRITICAL' ? 'Initiate urgent retailer liquidation' : 'Schedule retailer liquidation'} at ${plan.markdownPct}% markdown (${plan.markdownPricePerKg} per kg, down from ${plan.originalPricePerKg}) and sell within ${sellBy}. Restore cooling if the cause is temperature.`
    : 'Continue monitoring. No markdown is required at this risk level.';
  const retailerMessage = plan
    ? `${level === 'CRITICAL' ? 'Urgent lot' : 'Lot'} of ${p.toLowerCase()} (${qty} kg) available at ${plan.markdownPricePerKg} per kg (${plan.markdownPct}% off) with limited shelf life of about ${h}h. Please order within ${sellBy}.`
    : `Lot of ${p.toLowerCase()} (${qty} kg) is in transit with about ${h}h of shelf life remaining. No action needed.`;

  return {
    summary: LEAD[level](p, h),
    riskExplanation: `Remaining shelf life is ${h}h, ${bandText}. Main factors: ${drivers}. The produce is ageing ${mult}x faster than normal.`,
    recommendedAction,
    retailerMessage,
    urgency: level,
  };
}

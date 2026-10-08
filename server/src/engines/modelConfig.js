// SINGLE SOURCE OF TRUTH for every number used by the shelf-life and risk engines.
// No thresholds or multipliers live anywhere else. Tune the model here, nowhere else.
// Units: temperature in C, humidity in %, transit in minutes, shelf life in hours.
export const MODEL_CONFIG = {
  version: '1.0.0',

  // TEMPERATURE STRESS (strongest factor). Added stress = sum over bands of (degrees inside band x stressPerC).
  temperature: {
    optimalMaxC: 4,            // at or below this: no stress
    coldChainLimitC: 8,        // above this the shipment is out of cold-chain compliance
    freezingBelowC: 0,         // below this: freezing damage
    freezingStressPerC: 0.5,
    bands: [
      { label: 'warm',   fromC: 4,  toC: 8,        stressPerC: 0.3 }, // 4-8C: slightly warm
      { label: 'abuse',  fromC: 8,  toC: 12,       stressPerC: 1.0 }, // 8-12C: out of cold chain
      { label: 'severe', fromC: 12, toC: Infinity, stressPerC: 1.5 }, // above 12C: severe heat abuse
    ],
  },

  // HUMIDITY STRESS: free inside the ideal band, mild penalty for moderate deviation, double for severe.
  humidity: {
    idealMinPct: 70,
    idealMaxPct: 80,
    moderateDeviationPts: 10,  // up to 10 points outside the band = "moderate"; beyond = "severe"
    moderateStressPerPt: 0.05,
    severeStressPerPt: 0.10,
  },

  // TRANSIT STRESS: a normal journey is free; every extra hour adds a small LINEAR penalty, capped.
  transit: {
    graceMinutes: 180,
    stressPerExtraHour: 0.2,
    maxStress: 0.5,            // cap: transit alone can never destroy a shipment
  },

  // Illustrative per-produce temperature sensitivity (1.0 = reference). Unknown produce uses "default".
  produceProfiles: {
    default:      { temperatureSensitivity: 1.0 },
    tomatoes:     { temperatureSensitivity: 1.0 },
    mangoes:      { temperatureSensitivity: 0.8 },
    strawberries: { temperatureSensitivity: 1.25 },
    spinach:      { temperatureSensitivity: 1.3 },
  },

  // RISK LEVELS by remaining hours: > low = LOW, >= medium = MEDIUM, >= high = HIGH, otherwise CRITICAL.
  risk: { lowAboveHours: 72, mediumAtOrAboveHours: 48, highAtOrAboveHours: 24 },

  // Input plausibility limits (defence in depth; the API validates first).
  limits: { temperatureC: [-30, 60], humidityPct: [0, 100], transitMinutesMax: 86400, baselineHoursMax: 2000 },

  rounding: { hours: 1, stress: 3, percent: 1 },
};

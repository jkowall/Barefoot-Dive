export const ZHL16C_MODEL_ID = "zhl-16c-ostc" as const;
export const ZHL16C_MODEL_VERSION = "decotengu-0.14.1-coefficients-v1";
export const ZHL16C_COEFFICIENT_HASH = "zhl16c-ostc-decotengu-0.14.1";

/**
 * ZH-L16C coefficient set exposed by DecoTengu 0.14.1 and attributed there
 * to OSTC firmware. Values are deliberately kept as exact decimal literals.
 */
export const ZHL16C_N2_A = [
  1.2599, 1, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4,
  0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248, 0.2327,
] as const;

export const ZHL16C_N2_B = [
  0.505, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891,
  0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653,
] as const;

export const ZHL16C_HE_A = [
  1.7424, 1.383, 1.1919, 1.0458, 0.922, 0.8205, 0.7305, 0.6502,
  0.595, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176, 0.5172, 0.5119,
] as const;

export const ZHL16C_HE_B = [
  0.4245, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553,
  0.8757, 0.8903, 0.8997, 0.9073, 0.9122, 0.9171, 0.9217, 0.9267,
] as const;

export const ZHL16C_N2_HALF_LIFE_MINUTES = [
  4, 8, 12.5, 18.5, 27, 38.3, 54.3, 77,
  109, 146, 187, 239, 305, 390, 498, 635,
] as const;

export const ZHL16C_HE_HALF_LIFE_MINUTES = [
  1.51, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11,
  41.2, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03,
] as const;

export const ZHL16C_COMPARTMENT_COUNT = 16;


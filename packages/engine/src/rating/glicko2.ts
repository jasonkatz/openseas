/**
 * Glicko-2 (Glickman, 2013). Pure. Ratings are stored on the Glicko-2 internal scale and
 * displayed on the classic 1500/350 scale. Floating point here is fine: ratings are computed only
 * by the server and are never part of a replay comparison.
 */

export interface Rating {
  /** Display-scale rating, 1500 for a newcomer. */
  readonly rating: number;
  /** Display-scale rating deviation, 350 for a newcomer. */
  readonly deviation: number;
  /** Volatility, 0.06 for a newcomer. */
  readonly volatility: number;
}

export interface RatingResult {
  readonly opponent: Rating;
  /** 1 win, 0.5 draw, 0 loss. */
  readonly score: number;
}

export const NEW_RATING: Rating = { rating: 1500, deviation: 350, volatility: 0.06 };

const SCALE = 173.7178;
const EPSILON = 1e-6;

const toMu = (r: number): number => (r - 1500) / SCALE;
const toPhi = (rd: number): number => rd / SCALE;
const g = (phi: number): number => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number): number => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * Apply one rating period of results. `tau` constrains volatility change; 0.5 is a sane default
 * for puzzle rounds. With no results only the deviation grows.
 */
export function updateRating(player: Rating, results: readonly RatingResult[], tau = 0.5): Rating {
  const mu = toMu(player.rating);
  const phi = toPhi(player.deviation);
  const sigma = player.volatility;

  if (results.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, deviation: Math.min(350, phiStar * SCALE), volatility: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const res of results) {
    const muJ = toMu(res.opponent.rating);
    const phiJ = toPhi(res.opponent.deviation);
    const gj = g(phiJ);
    const e = E(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (res.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Illinois algorithm for the new volatility.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPSILON && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    rating: muPrime * SCALE + 1500,
    deviation: Math.min(350, phiPrime * SCALE),
    volatility: sigmaPrime,
  };
}

/**
 * Duty puzzles are rated against performance thresholds (DESIGN.md 3.6). Each threshold is a
 * virtual opponent with a fixed rating; a round beats every threshold its score reaches.
 */
export interface ScoreThreshold {
  readonly score: number;
  readonly rating: number;
}

export function dutyResults(score: number, thresholds: readonly ScoreThreshold[], deviation = 60): RatingResult[] {
  return thresholds.map((t) => ({
    opponent: { rating: t.rating, deviation, volatility: 0.06 },
    score: score >= t.score ? 1 : 0,
  }));
}

export interface RatingTier {
  readonly key: string;
  /** Minimum display rating for this tier. */
  readonly min: number;
}

/** Players only ever see a tier; the number is hidden. */
export function tierFor(rating: number, tiers: readonly RatingTier[]): RatingTier {
  let best = tiers[0];
  if (!best) throw new Error("no rating tiers");
  for (const t of tiers) if (rating >= t.min && t.min >= best.min) best = t;
  return best;
}

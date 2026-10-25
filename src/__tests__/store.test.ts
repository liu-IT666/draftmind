import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS } from '../engine/scorer';
import { migrateWeights } from '../store';

describe('saved weights', () => {
  it('moves untouched phase-1 defaults to the new defaults and keeps custom values', () => {
    const saved = { meta: 1, proficiency: 2.5, counter: 1, synergy: 0.6, compFit: 0.8, flex: 0.4, deny: 1.4, exposure: 0.4, scarcity: 0.5, threat: 0.5 };
    const w = migrateWeights(saved, 1);
    expect(w.proficiency).toBe(2.5);
    expect(w.deny).toBe(1.4);
    expect(w.meta).toBe(DEFAULT_WEIGHTS.meta);
    expect(w.lookahead).toBe(DEFAULT_WEIGHTS.lookahead);
  });

  it('keeps every saved value from the current version', () => {
    const saved = { ...DEFAULT_WEIGHTS, meta: 0.1 };
    expect(migrateWeights(saved, 2)).toEqual(saved);
  });
});

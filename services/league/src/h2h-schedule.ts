/**
 * Round-robin H2H schedule generation using the circle (polygon) method.
 *
 * Given n members, produces (n-1) rounds (or n-1 if n is even) where every
 * member plays every other member exactly once before any repeat.
 *
 * The algorithm is PURE: given a fixed member list, it always produces the
 * same deterministic schedule.
 */

export interface H2HFixture {
  round: number;
  teamA: string;
  teamB: string;
  pairId: string;
}

/**
 * Build a deterministic pairId from two team IDs.
 * Sorted alphabetically and joined with '#' for consistent ordering.
 */
export function buildPairId(teamA: string, teamB: string): string {
  return [teamA, teamB].sort().join('#');
}

/**
 * Generate a single round-robin schedule using the circle method.
 *
 * Circle method:
 *  - Pin one member at position 0 (or a BYE if odd count).
 *  - Rotate the remaining members through positions 1..n-1.
 *  - In each round, pair position 0 with position n-1, position 1 with n-2, etc.
 *
 * @param memberIds - Array of fantasy team IDs in the league (order matters for determinism)
 * @returns Array of H2HFixture objects representing the full round-robin
 */
export function generateRoundRobinSchedule(memberIds: string[]): H2HFixture[] {
  if (memberIds.length < 2) {
    return [];
  }

  // Sort member IDs for deterministic output regardless of input order
  const sorted = [...memberIds].sort();

  // If odd number of members, add a BYE placeholder
  const participants = sorted.length % 2 !== 0 ? [...sorted, '__BYE__'] : [...sorted];

  const n = participants.length;
  const totalRounds = n - 1;
  const fixtures: H2HFixture[] = [];

  // Circle method: pin the first participant, rotate the rest
  // `rotating` contains members at indices 1..(n-1) that rotate each round
  const fixed = participants[0];
  const rotating = participants.slice(1);

  for (let round = 1; round <= totalRounds; round++) {
    // In each round, pair:
    //   fixed vs rotating[n-2] (the last element)
    //   rotating[0] vs rotating[n-3]
    //   rotating[1] vs rotating[n-4]
    //   ... etc.

    const lastIdx = rotating.length - 1;

    // First pairing: fixed vs last in rotating array
    const opponent = rotating[lastIdx];
    if (fixed !== '__BYE__' && opponent !== '__BYE__') {
      const pairId = buildPairId(fixed, opponent);
      fixtures.push({ round, teamA: fixed, teamB: opponent, pairId });
    }

    // Remaining pairings: rotating[i] vs rotating[lastIdx - 1 - i]
    for (let i = 0; i < Math.floor(rotating.length / 2); i++) {
      const a = rotating[i];
      const b = rotating[lastIdx - 1 - i];
      if (a !== '__BYE__' && b !== '__BYE__') {
        const pairId = buildPairId(a, b);
        fixtures.push({ round, teamA: a, teamB: b, pairId });
      }
    }

    // Rotate: move last element to position 0
    rotating.unshift(rotating.pop()!);
  }

  return fixtures;
}

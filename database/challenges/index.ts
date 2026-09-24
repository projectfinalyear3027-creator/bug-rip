import { ChallengeDef } from './types.ts';
import { EASY_CHALLENGES } from './easyChallenges.ts';
import { MEDIUM_CHALLENGES } from './mediumChallenges.ts';
import { HARD_CHALLENGES } from './hardChallenges.ts';
import { EXTREME_CHALLENGES } from './extremeChallenges.ts';

export * from './types.ts';
export { EASY_CHALLENGES } from './easyChallenges.ts';
export { MEDIUM_CHALLENGES } from './mediumChallenges.ts';
export { HARD_CHALLENGES } from './hardChallenges.ts';
export { EXTREME_CHALLENGES } from './extremeChallenges.ts';

export const OFFICIAL_CHALLENGES: ChallengeDef[] = [
  ...EASY_CHALLENGES,
  ...MEDIUM_CHALLENGES,
  ...HARD_CHALLENGES,
  ...EXTREME_CHALLENGES,
];

export interface InventoryIntegrityResult {
  valid: boolean;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  extremeCount: number;
  totalCount: number;
  errors: string[];
}

export function verifyChallengeInventoryIntegrity(challengesList: ChallengeDef[] = OFFICIAL_CHALLENGES): InventoryIntegrityResult {
  const errors: string[] = [];

  const easyList = challengesList.filter((c) => c.difficulty === 'EASY');
  const mediumList = challengesList.filter((c) => c.difficulty === 'MEDIUM');
  const hardList = challengesList.filter((c) => c.difficulty === 'HARD');
  const extremeList = challengesList.filter((c) => c.difficulty === 'EXTREME');

  if (easyList.length !== 15) {
    errors.push(`Easy count violation: Expected exactly 15, found ${easyList.length}`);
  }
  if (mediumList.length !== 10) {
    errors.push(`Medium count violation: Expected exactly 10, found ${mediumList.length}`);
  }
  if (hardList.length !== 10) {
    errors.push(`Hard count violation: Expected exactly 10, found ${hardList.length}`);
  }
  if (extremeList.length !== 10) {
    errors.push(`Extreme count violation: Expected exactly 10, found ${extremeList.length}`);
  }
  if (challengesList.length !== 45) {
    errors.push(`Total inventory violation: Expected exactly 45, found ${challengesList.length}`);
  }

  // Check unique IDs
  const idSet = new Set<string>();
  for (const c of challengesList) {
    if (idSet.has(c.id)) {
      errors.push(`Duplicate challenge ID detected: ${c.id}`);
    }
    idSet.add(c.id);
  }

  // Check unique Slugs
  const slugSet = new Set<string>();
  for (const c of challengesList) {
    if (slugSet.has(c.slug)) {
      errors.push(`Duplicate challenge slug detected: ${c.slug}`);
    }
    slugSet.add(c.slug);
  }

  // Check unique Titles
  const titleSet = new Set<string>();
  for (const c of challengesList) {
    if (titleSet.has(c.title.toLowerCase())) {
      errors.push(`Duplicate challenge title detected: "${c.title}"`);
    }
    titleSet.add(c.title.toLowerCase());
  }

  // Check unique Starter Codes
  const starterCodeSet = new Set<string>();
  for (const c of challengesList) {
    const trimmed = c.starterCode.trim();
    if (starterCodeSet.has(trimmed)) {
      errors.push(`Duplicate starterCode detected in challenge: ${c.id}`);
    }
    starterCodeSet.add(trimmed);
  }

  // Check unique Flags
  const flagSet = new Set<string>();
  for (const c of challengesList) {
    if (flagSet.has(c.flag)) {
      errors.push(`Duplicate flag detected in challenge ${c.id}: ${c.flag}`);
    }
    flagSet.add(c.flag);
  }

  // Check valid difficulties
  const validDifficulties = new Set(['EASY', 'MEDIUM', 'HARD', 'EXTREME']);
  for (const c of challengesList) {
    if (!validDifficulties.has(c.difficulty)) {
      errors.push(`Invalid difficulty "${c.difficulty}" for challenge ${c.id}`);
    }
  }

  // Check deterministic display order inside each difficulty
  const verifyOrder = (list: ChallengeDef[], diffName: string, expectedLen: number) => {
    const sorted = [...list].sort((a, b) => a.displayOrder - b.displayOrder);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].displayOrder !== i + 1) {
        errors.push(`${diffName} challenge ${sorted[i].id} has displayOrder ${sorted[i].displayOrder}, expected ${i + 1}`);
      }
    }
  };
  verifyOrder(easyList, 'EASY', 15);
  verifyOrder(mediumList, 'MEDIUM', 10);
  verifyOrder(hardList, 'HARD', 10);
  verifyOrder(extremeList, 'EXTREME', 10);

  // Check public test case uniqueness per challenge
  for (const c of challengesList) {
    if (!c.publicTestCases || c.publicTestCases.length === 0) {
      errors.push(`Challenge ${c.id} has no public test cases`);
      continue;
    }
    const inputSet = new Set<string>();
    const outputSet = new Set<string>();
    for (const tc of c.publicTestCases) {
      if (inputSet.has(tc.inputData)) {
        errors.push(`Challenge ${c.id} has duplicate public test case input: "${tc.inputData}"`);
      }
      inputSet.add(tc.inputData);

      if (outputSet.has(tc.expectedOutput)) {
        errors.push(`Challenge ${c.id} has duplicate public test case output: "${tc.expectedOutput}"`);
      }
      outputSet.add(tc.expectedOutput);

      if (!tc.explanation || !tc.explanation.trim()) {
        errors.push(`Challenge ${c.id} has public test case missing explanation`);
      }
    }

    if (!c.hiddenTestCases || c.hiddenTestCases.length === 0) {
      errors.push(`Challenge ${c.id} has no hidden test cases`);
    }
  }

  return {
    valid: errors.length === 0,
    easyCount: easyList.length,
    mediumCount: mediumList.length,
    hardCount: hardList.length,
    extremeCount: extremeList.length,
    totalCount: challengesList.length,
    errors,
  };
}

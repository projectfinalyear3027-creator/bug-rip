export interface TestCaseSeed {
  inputData: string;
  expectedOutput: string;
  explanation?: string;
}

export interface ChallengeDef {
  id: string;
  roundSlug: 'easy' | 'medium' | 'hard' | 'extreme';
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXTREME';
  title: string;
  slug: string;
  description: string;
  starterCode: string;
  solutionCode: string;
  adminNotes: string;
  score: number;
  displayOrder: number;
  validationType: 'EXACT_OUTPUT' | 'TEST_CASE_VALIDATION' | 'CUSTOM_VALIDATOR';
  flag: string;
  publicTestCases: TestCaseSeed[];
  hiddenTestCases: TestCaseSeed[];
}

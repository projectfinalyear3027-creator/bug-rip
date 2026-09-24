/**
 * BUG RIP - Immutable Competition Rules Verification Tests
 * 
 * Verifies the foundational rules mathematically and functionally:
 * 1. Winner Ranking Rule: Solved Count > Score > Earliest Timestamp
 * 2. Team Size Rule: 1 or 2 registered members ONLY
 * 3. Same-Problem Submission Race: Only first valid solve counts
 * 4. Difficulty Progression: Unlocks based on unique solve thresholds
 * 5. Concurrent Session Limits
 */

import {
  calculateUnlockedDifficulties,
  compareTeamsForLeaderboard,
  processSubmissionRace,
  rankLeaderboard,
  validateConcurrentSessionLimit,
  validateTeamSize,
  verifyTeamCredentials,
} from '../backend/rules/competitionRules';
import {
  ChallengeDifficulty,
  LeaderboardEntry,
  TeamProgress,
} from '../backend/types/competition';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    testsFailed++;
  }
}

console.log('====================================================');
console.log('BUG RIP: Running Competition Rules Unit Tests');
console.log('====================================================');

// -----------------------------------------------------------------------------
// Test 1: Winner Rule - Primary Metric (Problems Solved)
// -----------------------------------------------------------------------------
console.log('\n[Suite 1: Winner Rule & Tiebreaker Logic]');

const teamAlpha: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-alpha',
  teamName: 'Team Alpha',
  connectedMemberCount: 2,
  registeredMemberCount: 2,
  problemsSolved: 20, // 20 solves
  score: 200,         // 200 points
  lastSolveTimestamp: 1700003000,
};

const teamBeta: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-beta',
  teamName: 'Team Beta',
  connectedMemberCount: 1,
  registeredMemberCount: 1,
  problemsSolved: 19, // 19 solves
  score: 350,         // Higher score (350 points), but fewer solves!
  lastSolveTimestamp: 1700001000,
};

// Solved count must strictly dominate score
const comparisonSolvedVsScore = compareTeamsForLeaderboard(teamAlpha, teamBeta);
assert(
  comparisonSolvedVsScore < 0,
  'Team with 20 solves ranks ABOVE team with 19 solves even if 19-solve team has higher score',
);

// -----------------------------------------------------------------------------
// Test 2: Winner Rule - Secondary Metric (Score)
// -----------------------------------------------------------------------------
const teamGamma: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-gamma',
  teamName: 'Team Gamma',
  connectedMemberCount: 2,
  registeredMemberCount: 2,
  problemsSolved: 15,
  score: 300,
  lastSolveTimestamp: 1700004000,
};

const teamDelta: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-delta',
  teamName: 'Team Delta',
  connectedMemberCount: 2,
  registeredMemberCount: 2,
  problemsSolved: 15,
  score: 250,
  lastSolveTimestamp: 1700002000,
};

const comparisonScoreTie = compareTeamsForLeaderboard(teamGamma, teamDelta);
assert(
  comparisonScoreTie < 0,
  'Teams with equal solves are broken by higher score (300 pts ranks above 250 pts)',
);

// -----------------------------------------------------------------------------
// Test 3: Winner Rule - Final Tiebreaker (Earliest Timestamp)
// -----------------------------------------------------------------------------
const teamEpsilon: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-eps',
  teamName: 'Team Epsilon',
  connectedMemberCount: 1,
  registeredMemberCount: 1,
  problemsSolved: 12,
  score: 180,
  lastSolveTimestamp: 1700001200, // Finished earlier
};

const teamZeta: LeaderboardEntry = {
  rank: 0,
  teamId: 'team-zeta',
  teamName: 'Team Zeta',
  connectedMemberCount: 2,
  registeredMemberCount: 2,
  problemsSolved: 12,
  score: 180,
  lastSolveTimestamp: 1700001800, // Finished later
};

const comparisonTimeTie = compareTeamsForLeaderboard(teamEpsilon, teamZeta);
assert(
  comparisonTimeTie < 0,
  'Teams with equal solves and equal score are broken by earliest achievement time',
);

const ranked = rankLeaderboard([teamBeta, teamDelta, teamAlpha, teamZeta, teamGamma, teamEpsilon]);
assert(ranked[0].teamId === 'team-alpha', 'Rank 1 correctly awarded to Team Alpha (20 solves)');
assert(ranked[1].teamId === 'team-beta', 'Rank 2 correctly awarded to Team Beta (19 solves)');
assert(ranked[2].teamId === 'team-gamma', 'Rank 3 correctly awarded to Team Gamma (15 solves, 300 pts)');
assert(ranked[3].teamId === 'team-delta', 'Rank 4 correctly awarded to Team Delta (15 solves, 250 pts)');
assert(ranked[4].teamId === 'team-eps', 'Rank 5 correctly awarded to Team Epsilon (earlier time)');
assert(ranked[5].teamId === 'team-zeta', 'Rank 6 correctly awarded to Team Zeta (later time)');

// -----------------------------------------------------------------------------
// Test 4: Team Size Limits (1-3 members)
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Team Size Limits & CSV Sourcing]');

assert(validateTeamSize(1).valid === true, '1-member team is valid');
assert(validateTeamSize(2).valid === true, '2-member team is valid');
assert(validateTeamSize(3).valid === true, '3-member team is valid');
assert(validateTeamSize(0).valid === false, '0-member team is rejected');
assert(validateTeamSize(4).valid === false, '4-member team is rejected (4+ member rule forbidden)');
assert(validateTeamSize(5).valid === false, '5-member team is rejected');

// Session limits
assert(validateConcurrentSessionLimit(0, 1) === true, '1-member team can start 1st session');
assert(validateConcurrentSessionLimit(1, 1) === false, '1-member team blocked from 2nd simultaneous session');
assert(validateConcurrentSessionLimit(1, 2) === true, '2-member team can start 2nd simultaneous session');
assert(validateConcurrentSessionLimit(2, 2) === false, '2-member team blocked from 3rd simultaneous session');
assert(validateConcurrentSessionLimit(2, 3) === true, '3-member team can start 3rd simultaneous session');
assert(validateConcurrentSessionLimit(3, 3) === false, '3-member team blocked from 4th simultaneous session');

// -----------------------------------------------------------------------------
// Test 5: Same-Problem Submission Race Condition
// -----------------------------------------------------------------------------
console.log('\n[Suite 3: Same-Problem Submission Race Protection]');

const initialProgress: TeamProgress = {
  teamId: 'team-alpha',
  solvedChallengeIds: [],
  problemsSolved: 0,
  totalScore: 0,
  lastSolveTimestamp: 0,
  unlockedDifficulties: [ChallengeDifficulty.EASY],
  solveHistory: [],
};

// First member submits challenge EASY-01
const firstSubmission = processSubmissionRace(
  initialProgress,
  'EASY-01',
  10,
  1700001000,
  'session-member-1',
);

assert(firstSubmission.result.accepted === true, 'First submission is accepted');
assert(firstSubmission.updatedProgress.problemsSolved === 1, 'First submission increments problemsSolved to 1');
assert(firstSubmission.updatedProgress.totalScore === 10, 'First submission awards 10 points');

// Second member submits the exact same challenge moments later
const secondSubmission = processSubmissionRace(
  firstSubmission.updatedProgress,
  'EASY-01',
  10,
  1700001005,
  'session-member-2',
);

assert(
  secondSubmission.result.accepted === false,
  'Second submission of same problem is rejected',
);
assert(
  secondSubmission.result.alreadySolvedByTeammate === true,
  'Second submission flagged as already solved by teammate',
);
assert(
  secondSubmission.result.message.includes('already been completed'),
  'Clear duplicate completion message returned',
);
assert(
  secondSubmission.updatedProgress.problemsSolved === 1,
  'Solved count does NOT increase duplicate times',
);
assert(
  secondSubmission.updatedProgress.totalScore === 10,
  'Total score does NOT increase duplicate times',
);

// -----------------------------------------------------------------------------
// Test 6: Difficulty Progression & Return to Earlier Difficulties
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: Difficulty Progression & Retention]');

const zeroSolves = {
  [ChallengeDifficulty.EASY]: 0,
  [ChallengeDifficulty.MEDIUM]: 0,
  [ChallengeDifficulty.HARD]: 0,
  [ChallengeDifficulty.EXTREME]: 0,
};

const defaultUnlocked = calculateUnlockedDifficulties(zeroSolves);
assert(
  defaultUnlocked.length === 1 && defaultUnlocked[0] === ChallengeDifficulty.EASY,
  'Easy is the sole difficulty unlocked at start',
);

// 4 solves in Easy unlocks Medium
const fourEasySolves = { ...zeroSolves, [ChallengeDifficulty.EASY]: 4 };
const mediumUnlocked = calculateUnlockedDifficulties(fourEasySolves);
assert(
  mediumUnlocked.includes(ChallengeDifficulty.EASY) &&
  mediumUnlocked.includes(ChallengeDifficulty.MEDIUM),
  'Medium unlocks upon reaching 4 unique Easy solves, AND Easy remains unlocked',
);

// 3 solves in Medium unlocks Hard
const threeMedSolves = { ...fourEasySolves, [ChallengeDifficulty.MEDIUM]: 3 };
const hardUnlocked = calculateUnlockedDifficulties(threeMedSolves);
assert(
  hardUnlocked.includes(ChallengeDifficulty.HARD) &&
  hardUnlocked.includes(ChallengeDifficulty.EASY) &&
  hardUnlocked.includes(ChallengeDifficulty.MEDIUM),
  'Hard unlocks upon reaching 3 Medium solves, with all previous tiers retained',
);

// Admin override unlocks all
const adminOverride = calculateUnlockedDifficulties(zeroSolves, undefined, { unlockAll: true });
assert(adminOverride.length === 4, 'Admin override unlocks all 4 difficulties simultaneously');

// -----------------------------------------------------------------------------
// Test 7: Credential Verification (Normalization)
// -----------------------------------------------------------------------------
console.log('\n[Suite 5: Team Credential Verification]');

assert(
  verifyTeamCredentials('  team alpha  ', 'ALPHA729', 'Team Alpha', 'ALPHA729') === true,
  'Credentials match with case-insensitivity and trimmed whitespace on team name',
);
assert(
  verifyTeamCredentials('Team Alpha', 'WRONG_CODE', 'Team Alpha', 'ALPHA729') === false,
  'Rejects invalid team code',
);
assert(
  verifyTeamCredentials('Team Beta', 'ALPHA729', 'Team Alpha', 'ALPHA729') === false,
  'Rejects mismatched team name and code',
);

console.log('\n====================================================');
console.log(`TEST RESULTS: ${testsPassed} Passed, ${testsFailed} Failed`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('All immutable competition rules verified successfully.\n');
}

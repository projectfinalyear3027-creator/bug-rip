/**
 * BUG RIP - Challenge Repository
 * Provides full CRUD and read access to rounds, challenges, and test cases.
 * Ensures hidden test cases and flag secrets are never exposed to public participants.
 */

import { eq, and, asc, sql, ilike, or } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  rounds,
  challenges,
  challengeTestCases,
  challengeFlags,
} from '../../src/db/schema.ts';

export class ChallengeRepository {
  /**
   * Fetch all rounds (active and inactive) sorted by display order
   */
  async getAllRounds() {
    return await db
      .select()
      .from(rounds)
      .orderBy(asc(rounds.displayOrder));
  }

  /**
   * Fetch all active rounds sorted by display order
   */
  async getRounds() {
    return await db
      .select()
      .from(rounds)
      .where(eq(rounds.isActive, true))
      .orderBy(asc(rounds.displayOrder));
  }

  /**
   * Get round by ID
   */
  async getRoundById(roundId: string) {
    const res = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);
    return res[0] || null;
  }

  /**
   * Get round by slug
   */
  async getRoundBySlug(slug: string) {
    const res = await db
      .select()
      .from(rounds)
      .where(eq(rounds.slug, slug.trim().toLowerCase()))
      .limit(1);
    return res[0] || null;
  }

  /**
   * Create a new round
   */
  async createRound(data: {
    name: string;
    slug: string;
    displayOrder: number;
    unlockRequiredSolves?: number;
    isActive?: boolean;
  }) {
    const res = await db
      .insert(rounds)
      .values({
        name: data.name.trim(),
        slug: data.slug.trim().toLowerCase(),
        displayOrder: data.displayOrder,
        unlockRequiredSolves: data.unlockRequiredSolves ?? 0,
        isActive: data.isActive ?? true,
      })
      .returning();
    return res[0];
  }

  /**
   * Update an existing round
   */
  async updateRound(
    roundId: string,
    data: Partial<{
      name: string;
      slug: string;
      displayOrder: number;
      unlockRequiredSolves: number;
      isActive: boolean;
    }>
  ) {
    const updateData: any = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.slug !== undefined) updateData.slug = data.slug.trim().toLowerCase();
    if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
    if (data.unlockRequiredSolves !== undefined) updateData.unlockRequiredSolves = data.unlockRequiredSolves;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const res = await db
      .update(rounds)
      .set(updateData)
      .where(eq(rounds.id, roundId))
      .returning();
    return res[0] || null;
  }

  /**
   * Get round metrics including active and total challenge counts
   */
  async getRoundMetrics() {
    const allRounds = await this.getAllRounds();
    const metrics = [];

    for (const r of allRounds) {
      const counts = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          active: sql<number>`COUNT(*) FILTER (WHERE ${challenges.isActive} = true)::int`,
        })
        .from(challenges)
        .where(eq(challenges.roundId, r.id));

      metrics.push({
        round: r,
        totalChallengesCount: counts[0]?.total ?? 0,
        activeChallengesCount: counts[0]?.active ?? 0,
      });
    }

    return metrics;
  }

  /**
   * Get active challenges count in a specific round
   */
  async getActiveChallengesCountByRound(roundId: string): Promise<number> {
    const res = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(challenges)
      .where(
        and(eq(challenges.roundId, roundId), eq(challenges.isActive, true))
      );
    return res[0]?.count ?? 0;
  }

  /**
   * List active challenges, optionally filtered by round
   */
  async getChallenges(roundId?: string) {
    const whereConditions = [eq(challenges.isActive, true)];
    if (roundId) {
      whereConditions.push(eq(challenges.roundId, roundId));
    }

    return await db
      .select({
        id: challenges.id,
        roundId: challenges.roundId,
        title: challenges.title,
        slug: challenges.slug,
        description: challenges.description,
        starterCode: challenges.starterCode,
        score: challenges.score,
        displayOrder: challenges.displayOrder,
        validationType: challenges.validationType,
        timeLimitMs: challenges.timeLimitMs,
        memoryLimitMb: challenges.memoryLimitMb,
        maxOutputBytes: challenges.maxOutputBytes,
        maxSourceBytes: challenges.maxSourceBytes,
        isActive: challenges.isActive,
      })
      .from(challenges)
      .where(and(...whereConditions))
      .orderBy(asc(challenges.displayOrder));
  }

  /**
   * List all challenges (active & inactive) for admin with optional filtering & search
   */
  async getAllChallenges(filters?: {
    roundId?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const conditions = [];

    if (filters?.roundId) {
      conditions.push(eq(challenges.roundId, filters.roundId));
    }
    if (filters?.isActive !== undefined) {
      conditions.push(eq(challenges.isActive, filters.isActive));
    }
    if (filters?.search && filters.search.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(challenges.title, term),
          ilike(challenges.id, term),
          ilike(challenges.slug, term)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return await db
      .select({
        id: challenges.id,
        roundId: challenges.roundId,
        title: challenges.title,
        slug: challenges.slug,
        description: challenges.description,
        starterCode: challenges.starterCode,
        score: challenges.score,
        displayOrder: challenges.displayOrder,
        validationType: challenges.validationType,
        timeLimitMs: challenges.timeLimitMs,
        memoryLimitMb: challenges.memoryLimitMb,
        maxOutputBytes: challenges.maxOutputBytes,
        maxSourceBytes: challenges.maxSourceBytes,
        isActive: challenges.isActive,
        solutionCode: challenges.solutionCode,
        adminNotes: challenges.adminNotes,
        createdAt: challenges.createdAt,
        updatedAt: challenges.updatedAt,
      })
      .from(challenges)
      .where(whereClause)
      .orderBy(asc(challenges.displayOrder));
  }

  /**
   * Get challenge by ID with STRICT PARTICIPANT PROJECTION.
   * SELECTs only public participant-safe fields.
   * Prohibits selecting solution_code, admin_notes, hidden tests, or flags.
   */
  async getParticipantChallengeById(challengeId: string) {
    const res = await db
      .select({
        id: challenges.id,
        roundId: challenges.roundId,
        title: challenges.title,
        slug: challenges.slug,
        description: challenges.description,
        starterCode: challenges.starterCode,
        score: challenges.score,
        displayOrder: challenges.displayOrder,
        validationType: challenges.validationType,
        timeLimitMs: challenges.timeLimitMs,
        memoryLimitMb: challenges.memoryLimitMb,
        maxOutputBytes: challenges.maxOutputBytes,
        maxSourceBytes: challenges.maxSourceBytes,
        isActive: challenges.isActive,
      })
      .from(challenges)
      .where(and(eq(challenges.id, challengeId), eq(challenges.isActive, true)))
      .limit(1);

    return res[0] || null;
  }

  /**
   * Get challenge by ID (Internal / Admin use only)
   */
  async getChallengeById(challengeId: string) {
    const res = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    return res[0] || null;
  }

  /**
   * Create a new challenge
   */
  async createChallenge(data: {
    id: string;
    roundId: string;
    title: string;
    slug: string;
    description: string;
    starterCode: string;
    solutionCode?: string;
    adminNotes?: string;
    score: number;
    displayOrder?: number;
    validationType?: any;
    timeLimitMs?: number;
    memoryLimitMb?: number;
    maxOutputBytes?: number;
    maxSourceBytes?: number;
    isActive?: boolean;
    testCases?: Array<{
      inputData: string;
      expectedOutput: string;
      isHidden?: boolean;
      testType?: string;
    }>;
    flagVerifier?: string;
  }) {
    const inserted = await db
      .insert(challenges)
      .values({
        id: data.id.trim(),
        roundId: data.roundId,
        title: data.title.trim(),
        slug: data.slug.trim().toLowerCase(),
        description: data.description,
        starterCode: data.starterCode,
        solutionCode: data.solutionCode ?? null,
        adminNotes: data.adminNotes ?? null,
        score: data.score,
        displayOrder: data.displayOrder ?? 0,
        validationType: data.validationType ?? 'EXACT_OUTPUT',
        timeLimitMs: data.timeLimitMs ?? 3000,
        memoryLimitMb: data.memoryLimitMb ?? 256,
        maxOutputBytes: data.maxOutputBytes ?? 65536,
        maxSourceBytes: data.maxSourceBytes ?? 32768,
        isActive: data.isActive ?? true,
      })
      .returning();

    const created = inserted[0];

    // Insert test cases if provided
    if (data.testCases && data.testCases.length > 0) {
      await db.insert(challengeTestCases).values(
        data.testCases.map((tc, idx) => ({
          challengeId: created.id,
          testType: tc.testType ?? 'STANDARD',
          inputData: tc.inputData,
          expectedOutput: tc.expectedOutput,
          isHidden: tc.isHidden ?? false,
          displayOrder: idx + 1,
        }))
      );
    }

    // Insert flag if provided
    if (data.flagVerifier) {
      await db.insert(challengeFlags).values({
        challengeId: created.id,
        flagVerifier: data.flagVerifier,
      });
    }

    return created;
  }

  /**
   * Update challenge fields
   */
  async updateChallenge(
    challengeId: string,
    data: Partial<{
      roundId: string;
      title: string;
      slug: string;
      description: string;
      starterCode: string;
      solutionCode: string;
      adminNotes: string;
      score: number;
      displayOrder: number;
      validationType: any;
      timeLimitMs: number;
      memoryLimitMb: number;
      maxOutputBytes: number;
      maxSourceBytes: number;
      isActive: boolean;
    }>
  ) {
    const updateData: any = { updatedAt: new Date() };
    if (data.roundId !== undefined) updateData.roundId = data.roundId;
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.slug !== undefined) updateData.slug = data.slug.trim().toLowerCase();
    if (data.description !== undefined) updateData.description = data.description;
    if (data.starterCode !== undefined) updateData.starterCode = data.starterCode;
    if (data.solutionCode !== undefined) updateData.solutionCode = data.solutionCode;
    if (data.adminNotes !== undefined) updateData.adminNotes = data.adminNotes;
    if (data.score !== undefined) updateData.score = data.score;
    if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
    if (data.validationType !== undefined) updateData.validationType = data.validationType;
    if (data.timeLimitMs !== undefined) updateData.timeLimitMs = data.timeLimitMs;
    if (data.memoryLimitMb !== undefined) updateData.memoryLimitMb = data.memoryLimitMb;
    if (data.maxOutputBytes !== undefined) updateData.maxOutputBytes = data.maxOutputBytes;
    if (data.maxSourceBytes !== undefined) updateData.maxSourceBytes = data.maxSourceBytes;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const res = await db
      .update(challenges)
      .set(updateData)
      .where(eq(challenges.id, challengeId))
      .returning();

    return res[0] || null;
  }

  /**
   * Activate or deactivate a challenge
   */
  async setChallengeActive(challengeId: string, isActive: boolean) {
    const res = await db
      .update(challenges)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(challenges.id, challengeId))
      .returning();
    return res[0] || null;
  }

  /**
   * Get test cases for a challenge (public only by default)
   */
  async getTestCases(challengeId: string, includeHidden: boolean = false) {
    if (includeHidden) {
      return await db
        .select()
        .from(challengeTestCases)
        .where(eq(challengeTestCases.challengeId, challengeId))
        .orderBy(asc(challengeTestCases.displayOrder), asc(challengeTestCases.id));
    }

    return await db
      .select({
        id: challengeTestCases.id,
        challengeId: challengeTestCases.challengeId,
        testType: challengeTestCases.testType,
        inputData: challengeTestCases.inputData,
        expectedOutput: challengeTestCases.expectedOutput,
        displayOrder: challengeTestCases.displayOrder,
        explanation: challengeTestCases.explanation,
      })
      .from(challengeTestCases)
      .where(
        and(
          eq(challengeTestCases.challengeId, challengeId),
          eq(challengeTestCases.isHidden, false)
        )
      )
      .orderBy(asc(challengeTestCases.displayOrder), asc(challengeTestCases.id));
  }

  /**
   * Add a test case to a challenge
   */
  async addTestCase(data: {
    challengeId: string;
    inputData: string;
    expectedOutput: string;
    isHidden?: boolean;
    testType?: string;
    displayOrder?: number;
  }) {
    const res = await db
      .insert(challengeTestCases)
      .values({
        challengeId: data.challengeId,
        inputData: data.inputData,
        expectedOutput: data.expectedOutput,
        isHidden: data.isHidden ?? false,
        testType: data.testType ?? 'STANDARD',
        displayOrder: data.displayOrder ?? 0,
      })
      .returning();
    return res[0];
  }

  /**
   * Internal server-side flag verifier lookup
   */
  async getFlagVerifier(challengeId: string) {
    const res = await db
      .select()
      .from(challengeFlags)
      .where(eq(challengeFlags.challengeId, challengeId))
      .limit(1);

    return res[0] || null;
  }
}

export const challengeRepository = new ChallengeRepository();


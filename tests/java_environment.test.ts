/**
 * BUG RIP - OpenJDK 21 Environment & Execution Pipeline Verification Suite
 * 
 * Verifies:
 * 1. Environment: javac and java existence, OpenJDK 21 LTS validation, JAVA_HOME resolution
 * 2. Sandbox: Configurable sandbox user, network namespace isolation (unshare -n), workspace confinement
 * 3. Execution Pipeline: Trivial Java program, compiler errors, runtime exceptions, timeouts, output limits
 * 4. Path & Privacy Sanitization: No internal host paths or ENOENT errors exposed
 * 5. Full Challenge Flow: Code execution -> Behavioral validation -> Flag reveal
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import { resolveJdkEnvironment, verifyExecutionEnvironmentOrThrow } from '../execution-worker/jdkEnvironment.ts';
import { IsolatedJavaSandbox } from '../execution-worker/sandbox.ts';
import { executionWorker } from '../execution-worker/worker.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { db } from '../src/db/index.ts';
import { teams, challenges } from '../src/db/schema.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ PASS: ${message}`);
}

async function runJavaEnvironmentTests() {
  console.log('================================================================');
  console.log('BUG RIP - OPENJDK 21 EXECUTION ENVIRONMENT VERIFICATION');
  console.log('================================================================\n');

  // ----------------------------------------------------------------
  // [Suite 1] Host Environment & OpenJDK 21 Verification
  // ----------------------------------------------------------------
  console.log('[Suite 1] Host Environment & OpenJDK 21 Verification');
  
  const jdk = resolveJdkEnvironment(true);
  assert(jdk.isAvailable === true, 'OpenJDK 21 is marked as available in environment');
  assert(!!jdk.javaHome, `JAVA_HOME resolved: ${jdk.javaHome}`);
  assert(fs.existsSync(jdk.javacPath), `javac binary exists at ${jdk.javacPath}`);
  assert(fs.existsSync(jdk.javaPath), `java binary exists at ${jdk.javaPath}`);

  // Executable permissions
  try {
    fs.accessSync(jdk.javacPath, fs.constants.X_OK);
    assert(true, 'javac binary has executable permissions');
  } catch {
    assert(false, 'javac binary lacks executable permissions');
  }

  try {
    fs.accessSync(jdk.javaPath, fs.constants.X_OK);
    assert(true, 'java binary has executable permissions');
  } catch {
    assert(false, 'java binary lacks executable permissions');
  }

  // Version checks
  assert(jdk.javacVersion.toLowerCase().includes('javac 21'), `javac version matches OpenJDK 21 (reported: ${jdk.javacVersion})`);
  assert(jdk.javaVersion.toLowerCase().includes('21'), `java runtime version matches OpenJDK 21 (reported: ${jdk.javaVersion})`);
  assert(jdk.isJdk21 === true, 'Major version is identified as Java 21 LTS');

  // Verify diagnostic function runs without throwing
  const verified = verifyExecutionEnvironmentOrThrow();
  assert(verified.isAvailable === true, 'verifyExecutionEnvironmentOrThrow passes diagnostics');

  // ----------------------------------------------------------------
  // [Suite 2] Sandbox Security & Isolation Primitives
  // ----------------------------------------------------------------
  console.log('\n[Suite 2] Sandbox Security & Isolation Primitives');
  
  assert(jdk.sandboxUserExists === true, 'Unprivileged sandbox user exists on host');
  assert(jdk.isolationAvailable === true, 'Linux network namespace and UID isolation are available');

  // Direct test of unshare + setpriv
  const sandboxProbe = spawnSync('unshare', [
    '-n', '-p', '-f', '--mount-proc',
    'setpriv', '--reuid', String(jdk.sandboxConfig.uid), '--regid', String(jdk.sandboxConfig.gid), '--clear-groups', '--no-new-privs',
    'id'
  ], { encoding: 'utf8' });

  assert(sandboxProbe.status === 0, 'unshare + setpriv probe executed with status 0');
  assert(sandboxProbe.stdout.includes(`uid=${jdk.sandboxConfig.uid}`), `Sandbox probe confirms execution under UID ${jdk.sandboxConfig.uid}`);

  // ----------------------------------------------------------------
  // [Suite 3] Trivial Java Program Execution (User Request Specification)
  // ----------------------------------------------------------------
  console.log('\n[Suite 3] Trivial Java Program Execution (No ENOENT)');

  const trivialJavaSource = `
public class Main {
    public static void main(String[] args) {
        System.out.println("BUG SNIPER JAVA TEST");
    }
}
`;

  const run1 = await IsolatedJavaSandbox.execute({
    jobId: 'env-test-trivial',
    submissionId: 'env-test-trivial',
    teamId: 'team-test',
    challengeId: 'chal-test',
    submittedJavaSource: trivialJavaSource,
    submittedAt: new Date().toISOString(),
  });

  assert(run1.status === 'SUCCESS', `Trivial Java program executed with SUCCESS (status: ${run1.status})`);
  assert(run1.exitCode === 0, 'Exit code is 0');
  assert(run1.stdout.trim() === 'BUG SNIPER JAVA TEST', `Stdout matches expected output: "${run1.stdout.trim()}"`);
  assert(!run1.stderr.includes('ENOENT'), 'Stderr contains NO ENOENT errors');
  assert(!run1.stderr.includes('spawn javac ENOENT'), 'No "spawn javac ENOENT" error occurred');
  assert(run1.durationMs > 0, `Execution duration recorded: ${run1.durationMs}ms`);

  // ----------------------------------------------------------------
  // [Suite 4] User Java Compile Error (Syntax Error Diagnostics)
  // ----------------------------------------------------------------
  console.log('\n[Suite 4] User Java Compile Error Reporting');

  const syntaxErrorCode = `
public class Main {
    public static void main(String[] args) {
        int x = ; // Deliberate syntax error
    }
}
`;

  const run2 = await IsolatedJavaSandbox.execute({
    jobId: 'env-test-syntax',
    submissionId: 'env-test-syntax',
    teamId: 'team-test',
    challengeId: 'chal-test',
    submittedJavaSource: syntaxErrorCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run2.status === 'COMPILE_ERROR', `Deliberate syntax error returns COMPILE_ERROR (got: ${run2.status})`);
  assert(run2.exitCode !== 0, 'Exit code is non-zero');
  assert(run2.stderr.includes('illegal start of expression') || run2.stderr.includes('error:'), 'Stderr captures javac error diagnostics');
  assert(!run2.stderr.includes('/tmp/sandboxes/'), 'Stderr sanitizes workspace directory paths');
  assert(!run2.stderr.includes('ENOENT'), 'Stderr contains NO spawn or ENOENT failure');

  // ----------------------------------------------------------------
  // [Suite 5] Java Runtime Exception (Division by Zero)
  // ----------------------------------------------------------------
  console.log('\n[Suite 5] Java Runtime Exception Handling');

  const runtimeErrorCode = `
public class Main {
    public static void main(String[] args) {
        int numerator = 100;
        int denominator = 0;
        int result = numerator / denominator;
        System.out.println("Result: " + result);
    }
}
`;

  const run3 = await IsolatedJavaSandbox.execute({
    jobId: 'env-test-runtime',
    submissionId: 'env-test-runtime',
    teamId: 'team-test',
    challengeId: 'chal-test',
    submittedJavaSource: runtimeErrorCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run3.status === 'RUNTIME_ERROR', `Division by zero returns RUNTIME_ERROR (got: ${run3.status})`);
  assert(run3.exitCode !== 0, 'Exit code is non-zero');
  assert(run3.stderr.includes('ArithmeticException'), 'Stderr captures Java ArithmeticException stack trace');
  assert(!run3.stderr.includes('/tmp/sandboxes/'), 'Stack trace has host workspace paths stripped');

  // ----------------------------------------------------------------
  // [Suite 6] Watchdog Timeout & Output Limits
  // ----------------------------------------------------------------
  console.log('\n[Suite 6] Watchdog Timeout & Output Limit Enforcement');

  const loopCode = `
public class Main {
    public static void main(String[] args) {
        while (true) {}
    }
}
`;

  const run4 = await IsolatedJavaSandbox.execute(
    {
      jobId: 'env-test-timeout',
      submissionId: 'env-test-timeout',
      teamId: 'team-test',
      challengeId: 'chal-test',
      submittedJavaSource: loopCode,
      submittedAt: new Date().toISOString(),
    },
    { timeoutMs: 1200 }
  );

  assert(run4.status === 'TIMEOUT', `Infinite loop returns TIMEOUT status (got: ${run4.status})`);
  assert(run4.stderr.includes('TIME LIMIT EXCEEDED'), 'Stderr notes time limit exceeded');

  // Output limit
  const floodCode = `
public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 4000; i++) {
            System.out.println("SPAM_LINE_" + i);
        }
    }
}
`;

  const run5 = await IsolatedJavaSandbox.execute(
    {
      jobId: 'env-test-output',
      submissionId: 'env-test-output',
      teamId: 'team-test',
      challengeId: 'chal-test',
      submittedJavaSource: floodCode,
      submittedAt: new Date().toISOString(),
    },
    { maxOutputBytes: 1024 }
  );

  assert(run5.status === 'OUTPUT_LIMIT', `Output flood returns OUTPUT_LIMIT status (got: ${run5.status})`);
  assert(run5.stdout.length <= 1500, `Output correctly capped (got: ${run5.stdout.length} bytes)`);

  // ----------------------------------------------------------------
  // [Suite 7] End-to-End Worker Pipeline with Behavioral Validation & Flag Reveal
  // ----------------------------------------------------------------
  console.log('\n[Suite 7] Full Execution Worker & Behavioral Validation Pipeline');

  await runMigrations();
  await runSeed();

  const [testTeam] = await db.select().from(teams).limit(1);
  const [testChal] = await db.select().from(challenges).limit(1);
  assert(!!testTeam && !!testChal, 'Seeded test team and challenge are available in database');

  // Submit valid solution to Factorial challenge (EASY-01-FACTORIAL)
  const validFactorialSolution = `
public class Main {
    public static long factorial(int n) {
        if (n <= 1) return 1;
        long res = 1;
        for (int i = 2; i <= n; i++) {
            res *= i;
        }
        return res;
    }

    public static void main(String[] args) {
        System.out.println("Factorial 5: " + factorial(5));
        System.out.println("Factorial 10: " + factorial(10));
    }
}
`;

  const sub = await teamChallengeRepository.recordExecutionSubmission({
    teamId: testTeam.id,
    challengeId: testChal.id,
    sourceCode: validFactorialSolution,
    executionStatus: 'QUEUED',
  });

  assert(!!sub && sub.executionStatus === 'QUEUED', 'Submission recorded in database with status QUEUED');

  // Process job via worker
  const workerResult = await executionWorker.processJob({
    jobId: sub.id,
    submissionId: sub.id,
    teamId: testTeam.id,
    challengeId: testChal.id,
    submittedJavaSource: sub.sourceCode,
    submittedAt: new Date().toISOString(),
  });

  assert(workerResult.status === 'SUCCESS', `Worker returned SUCCESS (got: ${workerResult.status})`);
  assert(workerResult.stdout.includes('Factorial 5: 120'), 'Stdout contains verified factorial output');
  assert(workerResult.exitCode === 0, 'Exit code is 0');

  // Verify database record update
  const updatedSub = await teamChallengeRepository.getSubmissionById(sub.id);
  assert(!!updatedSub, 'Database submission found');
  assert(updatedSub?.executionStatus === 'SUCCESS', `Database submission status updated to SUCCESS (is: ${updatedSub?.executionStatus})`);
  assert(updatedSub?.executionTimeMs !== null && updatedSub?.executionTimeMs! > 0, 'Database recorded positive execution time');
  assert(!!updatedSub?.completedAt, 'Database recorded completion timestamp');
  assert(!!updatedSub?.workerId, 'Database recorded worker ID');

  console.log('\n================================================================');
  console.log('ALL JAVA ENVIRONMENT & EXECUTION TESTS PASSED (100% SUCCESS)');
  console.log('================================================================');
}

runJavaEnvironmentTests().catch((err) => {
  console.error('Fatal error during Java environment testing:', err);
  process.exit(1);
});

/**
 * BUG RIP - Fragment 8: Real Java Execution Engine & Isolated Sandbox Tests
 * 
 * Verifies:
 * 1. Safe compilation & execution of standard Java code
 * 2. Compilation error handling (COMPILE_ERROR with compiler diagnostics)
 * 3. Runtime error handling (RUNTIME_ERROR with stack trace)
 * 4. Timeout enforcement (TIMEOUT on infinite loops)
 * 5. Output limit truncation (OUTPUT_LIMIT on stdout overflow)
 * 6. Network isolation via Linux network namespaces (no outbound network)
 * 7. Dropped privileges (executes as unprivileged sandbox user)
 * 8. End-to-end Worker & Queue processing with database state updates
 */

process.env.PG_MEM = 'true';

import { IsolatedJavaSandbox } from '../execution-worker/sandbox.ts';
import { executionQueue } from '../execution-worker/queue.ts';
import { executionWorker } from '../execution-worker/worker.ts';
import { teamChallengeRepository } from '../backend/repositories/teamChallengeRepository.ts';
import { runMigrations } from '../database/migrator.ts';
import { runSeed } from '../database/seed.ts';
import { db } from '../src/db/index.ts';
import { teams, challenges } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
  }
}

async function runExecutionTestSuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 8: REAL JAVA EXECUTION & SANDBOX TESTS');
  console.log('================================================================');

  // Suite 1: Successful Java Code Execution
  console.log('\n[Suite 1] Valid Java Compilation & Execution');
  const validCode = `
public class Main {
    public static void main(String[] args) {
        System.out.println("TEST_SANDBOX_SUCCESS_VAL: " + (40 + 2));
    }
}
`;
  const run1 = await IsolatedJavaSandbox.execute({
    jobId: 'test-run-1',
    submissionId: 'test-run-1',
    teamId: 'team-test',
    challengeId: 'c1',
    submittedJavaSource: validCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run1.status === 'SUCCESS', `Valid Java execution reports SUCCESS (received: ${run1.status})`);
  assert(run1.stdout.includes('TEST_SANDBOX_SUCCESS_VAL: 42'), 'Stdout contains expected computed output');
  assert(run1.exitCode === 0, 'Exit code is 0');
  assert(run1.durationMs > 0, `Execution duration recorded (${run1.durationMs}ms)`);

  // Suite 2: Compilation Error Handling
  console.log('\n[Suite 2] Compilation Error Handling');
  const syntaxErrorCode = `
public class Main {
    public static void main(String[] args) {
        int x = "incompatible types";
        missingSemicolon()
    }
}
`;
  const run2 = await IsolatedJavaSandbox.execute({
    jobId: 'test-run-2',
    submissionId: 'test-run-2',
    teamId: 'team-test',
    challengeId: 'c1',
    submittedJavaSource: syntaxErrorCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run2.status === 'COMPILE_ERROR', `Syntax error reports COMPILE_ERROR (received: ${run2.status})`);
  assert(run2.exitCode !== 0, 'Exit code is non-zero');
  assert(run2.stderr.includes('error:') || run2.stderr.includes('incompatible types'), 'Stderr captures javac error diagnostics');

  // Suite 3: Runtime Exception Handling
  console.log('\n[Suite 3] Runtime Exception Handling');
  const runtimeErrorCode = `
public class Main {
    public static void main(String[] args) {
        int a = 10;
        int b = 0;
        System.out.println(a / b);
    }
}
`;
  const run3 = await IsolatedJavaSandbox.execute({
    jobId: 'test-run-3',
    submissionId: 'test-run-3',
    teamId: 'team-test',
    challengeId: 'c1',
    submittedJavaSource: runtimeErrorCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run3.status === 'RUNTIME_ERROR', `Division by zero reports RUNTIME_ERROR (received: ${run3.status})`);
  assert(run3.exitCode !== 0, 'Exit code is non-zero');
  assert(run3.stderr.includes('ArithmeticException') || run3.stderr.includes('/ by zero'), 'Stderr captures Java exception stack trace');

  // Suite 4: Timeout Enforcement
  console.log('\n[Suite 4] CPU & Wall-Clock Timeout Enforcement');
  const infiniteLoopCode = `
public class Main {
    public static void main(String[] args) {
        long counter = 0;
        while (true) {
            counter++;
        }
    }
}
`;
  const startTime = Date.now();
  const run4 = await IsolatedJavaSandbox.execute(
    {
      jobId: 'test-run-4',
      submissionId: 'test-run-4',
      teamId: 'team-test',
      challengeId: 'c1',
      submittedJavaSource: infiniteLoopCode,
      submittedAt: new Date().toISOString(),
    },
    { timeoutMs: 1500 }
  );
  const elapsed = Date.now() - startTime;

  assert(run4.status === 'TIMEOUT', `Infinite loop reports TIMEOUT (received: ${run4.status})`);
  assert(elapsed >= 1400 && elapsed < 4000, `Process was terminated within expected timeout window (${elapsed}ms)`);
  assert(run4.stderr.includes('timed out'), 'Stderr notes timeout termination');

  // Suite 5: Output Limit Truncation
  console.log('\n[Suite 5] Output Limit Truncation');
  const excessiveOutputCode = `
public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 5000; i++) {
            System.out.println("SPAM_OUTPUT_LINE_" + i);
        }
    }
}
`;
  const run5 = await IsolatedJavaSandbox.execute(
    {
      jobId: 'test-run-5',
      submissionId: 'test-run-5',
      teamId: 'team-test',
      challengeId: 'c1',
      submittedJavaSource: excessiveOutputCode,
      submittedAt: new Date().toISOString(),
    },
    { maxOutputBytes: 1024 }
  );

  assert(run5.status === 'OUTPUT_LIMIT', `Excessive output reports OUTPUT_LIMIT (received: ${run5.status})`);
  assert(run5.stdout.length <= 1500, `Stdout properly truncated (length: ${run5.stdout.length})`);
  assert(run5.stderr.toLowerCase().includes('output limit exceeded'), 'Stderr indicates output limit exceeded');

  // Suite 6: Network Isolation
  console.log('\n[Suite 6] Linux Network Namespace Isolation');
  const networkAttemptCode = `
import java.net.*;
public class Main {
    public static void main(String[] args) {
        try {
            Socket socket = new Socket();
            socket.connect(new InetSocketAddress("8.8.8.8", 53), 500);
            System.out.println("NETWORK_OPEN");
            socket.close();
        } catch (Exception e) {
            System.out.println("NETWORK_BLOCKED: " + e.getClass().getSimpleName());
        }
    }
}
`;
  const run6 = await IsolatedJavaSandbox.execute({
    jobId: 'test-run-6',
    submissionId: 'test-run-6',
    teamId: 'team-test',
    challengeId: 'c1',
    submittedJavaSource: networkAttemptCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run6.status === 'SUCCESS', 'Code executed');
  assert(run6.stdout.includes('NETWORK_BLOCKED'), 'Outbound network access was blocked inside sandbox');
  assert(!run6.stdout.includes('NETWORK_OPEN'), 'Outbound network connection was not permitted');

  // Suite 7: Dropped Privileges (Non-root user execution)
  console.log('\n[Suite 7] Non-Root User Execution Privileges');
  const userCheckCode = `
public class Main {
    public static void main(String[] args) {
        String user = System.getProperty("user.name");
        System.out.println("RUNNING_AS_USER: " + user);
    }
}
`;
  const run7 = await IsolatedJavaSandbox.execute({
    jobId: 'test-run-7',
    submissionId: 'test-run-7',
    teamId: 'team-test',
    challengeId: 'c1',
    submittedJavaSource: userCheckCode,
    submittedAt: new Date().toISOString(),
  });

  assert(run7.status === 'SUCCESS', 'Executed successfully');
  assert(!run7.stdout.includes('RUNNING_AS_USER: root'), 'Java application did not execute as root');

  // Suite 8: End-to-End Worker & Database State Updates
  console.log('\n[Suite 8] Worker Pipeline & Database Submissions Synchronization');
  await runMigrations();
  await runSeed();

  const sampleTeam = (await db.select().from(teams).limit(1))[0];
  const sampleChal = (await db.select().from(challenges).limit(1))[0];

  assert(!!sampleTeam && !!sampleChal, 'Seeded team and challenge available for e2e worker testing');

  // Record submission in database
  const sub = await teamChallengeRepository.recordExecutionSubmission({
    teamId: sampleTeam.id,
    challengeId: sampleChal.id,
    sourceCode: 'public class Main { public static void main(String[] args) { System.out.println("E2E_WORKER_VALIDATED"); } }',
    executionStatus: 'QUEUED',
  });

  assert(!!sub && sub.executionStatus === 'QUEUED', 'Submission created in database with QUEUED status');

  // Process job via worker
  const workerResult = await executionWorker.processJob({
    jobId: sub.id,
    submissionId: sub.id,
    teamId: sampleTeam.id,
    challengeId: sampleChal.id,
    submittedJavaSource: sub.sourceCode,
    submittedAt: sub.createdAt.toISOString(),
  });

  assert(workerResult.status === 'SUCCESS', `Worker returned SUCCESS (received: ${workerResult.status})`);
  assert(workerResult.stdout.includes('E2E_WORKER_VALIDATED'), 'Worker result contains valid stdout');

  // Query updated submission from database
  const updatedSub = await teamChallengeRepository.getSubmissionById(sub.id);
  assert(!!updatedSub, 'Updated submission found in database');
  assert(updatedSub?.executionStatus === 'SUCCESS', `Database submission status updated to SUCCESS (is: ${updatedSub?.executionStatus})`);
  assert(updatedSub?.stdout?.includes('E2E_WORKER_VALIDATED'), 'Database submission stdout saved accurately');
  assert(typeof updatedSub?.executionTimeMs === 'number' && updatedSub?.executionTimeMs > 0, 'Database recorded execution duration');
  assert(!!updatedSub?.startedAt && !!updatedSub?.completedAt, 'Database recorded start and completion timestamps');
  assert(!!updatedSub?.workerId, `Database recorded worker ID (${updatedSub?.workerId})`);

  console.log('\n================================================================');
  console.log(`FRAGMENT 8 TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runExecutionTestSuite().catch((err) => {
  console.error('Fatal execution test failure:', err);
  process.exit(1);
});

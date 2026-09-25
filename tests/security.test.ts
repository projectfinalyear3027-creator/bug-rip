/**
 * BUG RIP - Fragment 8 Security & Isolation Verification Suite
 * 
 * Deep verification covering:
 * 1. Production Redis vs Development In-Memory Queue Fallback
 * 2. Network Isolation (External, Localhost, PostgreSQL, Redis, Backend, Cloud Metadata, DNS)
 * 3. Privilege Isolation (Configurable UID/GID, no-new-privs, sudo denial)
 * 4. Filesystem Isolation (Parent directory listing, sensitive file denial, cross-workspace privacy)
 * 5. Process Cleanup (Watchdog termination, orphan processes, child processes)
 * 6. Resource Limits (CPU exhaustion, memory exhaustion, huge output, large source, long runtime)
 */

process.env.PG_MEM = 'true';

import { IsolatedJavaSandbox } from '../execution-worker/sandbox.ts';
import { ExecutionQueueManager } from '../execution-worker/queue.ts';
import fs from 'fs';
import { execSync } from 'child_process';

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

async function runSecuritySuite() {
  console.log('\n================================================================');
  console.log('BUG RIP - FRAGMENT 8: SECURITY & DEPLOYMENT VERIFICATION SUITE');
  console.log('================================================================');

  // -------------------------------------------------------------
  // Section 1: Redis / Queue Fallback Verification
  // -------------------------------------------------------------
  console.log('\n[Suite 1] Queue Architecture & Production Fallback Policy');

  // Test 1.1: Development environment allows in-memory fallback
  const devQueue = new ExecutionQueueManager();
  process.env.NODE_ENV = 'development';
  process.env.REDIS_URL = 'redis://127.0.0.1:59999'; // deliberately dead port
  const devInit = await devQueue.initialize();
  assert(devInit.mode === 'in-memory', 'Development environment gracefully falls back to in-memory queue when Redis is down');

  // Test 1.2: Production environment strictly forbids in-memory fallback
  const prodQueue = new ExecutionQueueManager();
  process.env.NODE_ENV = 'production';
  process.env.REDIS_URL = 'redis://127.0.0.1:59999'; // deliberately dead port
  let caughtProdError = false;
  try {
    await prodQueue.initialize();
  } catch (err: any) {
    caughtProdError = true;
    assert(
      err.message.includes('Redis is mandatory in production') || err.message.includes('CRITICAL INFRASTRUCTURE FAILURE'),
      `Production fail-fast thrown on unavailable Redis: ${err.message.substring(0, 70)}...`
    );
  }
  assert(caughtProdError, 'Production environment fails fast with clear infrastructure error when Redis is down');

  // Test 1.3: Production rejects EXECUTION_IN_MEMORY=true
  process.env.EXECUTION_IN_MEMORY = 'true';
  let caughtForceError = false;
  try {
    await prodQueue.initialize();
  } catch (err: any) {
    caughtForceError = true;
    assert(err.message.includes('forbidden in production'), 'Production rejects EXECUTION_IN_MEMORY=true override');
  }
  assert(caughtForceError, 'Production rejects explicit in-memory flag');

  // Clean up queue connections and reconnect timers
  await devQueue.close();
  await prodQueue.close();

  // Restore env
  process.env.NODE_ENV = 'development';
  delete process.env.EXECUTION_IN_MEMORY;
  delete process.env.REDIS_URL;

  // -------------------------------------------------------------
  // Section 2: Network Isolation Verification
  // -------------------------------------------------------------
  console.log('\n[Suite 2] Linux Network Namespace Isolation (unshare -n)');

  const networkProbeCode = `
import java.net.*;
public class Main {
    public static void main(String[] args) {
        // 1. External HTTP
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL("http://example.com").openConnection();
            conn.setConnectTimeout(500);
            conn.connect();
            System.out.println("EXT_HTTP: OPEN");
        } catch (Exception e) {
            System.out.println("EXT_HTTP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 2. External TCP (8.8.8.8)
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("8.8.8.8", 53), 500);
            System.out.println("EXT_TCP: OPEN");
        } catch (Exception e) {
            System.out.println("EXT_TCP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 3. Localhost HTTP (127.0.0.1:3000)
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL("http://127.0.0.1:3000/api/health").openConnection();
            conn.setConnectTimeout(500);
            conn.connect();
            System.out.println("LOCALHOST_HTTP: OPEN");
        } catch (Exception e) {
            System.out.println("LOCALHOST_HTTP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 4. Redis port (127.0.0.1:6379)
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", 6379), 500);
            System.out.println("REDIS_TCP: OPEN");
        } catch (Exception e) {
            System.out.println("REDIS_TCP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 5. PostgreSQL port (127.0.0.1:5432)
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", 5432), 500);
            System.out.println("PG_TCP: OPEN");
        } catch (Exception e) {
            System.out.println("PG_TCP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 6. Backend (0.0.0.0:3000)
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("0.0.0.0", 3000), 500);
            System.out.println("BACKEND_TCP: OPEN");
        } catch (Exception e) {
            System.out.println("BACKEND_TCP: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 7. DNS lookup
        try {
            InetAddress addr = InetAddress.getByName("google.com");
            System.out.println("DNS: RESOLVED " + addr.getHostAddress());
        } catch (Exception e) {
            System.out.println("DNS: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }

        // 8. Cloud metadata (169.254.169.254)
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("169.254.169.254", 80), 500);
            System.out.println("METADATA: OPEN");
        } catch (Exception e) {
            System.out.println("METADATA: BLOCKED (" + e.getClass().getSimpleName() + ")");
        }
    }
}
`;

  const netRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-net-test',
    submissionId: 'sec-net-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: networkProbeCode,
    submittedAt: new Date().toISOString(),
  });

  const netOut = netRes.stdout;
  assert(netOut.includes('EXT_HTTP: BLOCKED'), 'External HTTP connection is blocked');
  assert(netOut.includes('EXT_TCP: BLOCKED'), 'External TCP connection is blocked');
  assert(netOut.includes('LOCALHOST_HTTP: BLOCKED'), 'Localhost HTTP connection is blocked');
  assert(netOut.includes('REDIS_TCP: BLOCKED'), 'Redis port connection is blocked');
  assert(netOut.includes('PG_TCP: BLOCKED'), 'PostgreSQL port connection is blocked');
  assert(netOut.includes('BACKEND_TCP: BLOCKED'), 'Backend port connection is blocked');
  assert(netOut.includes('DNS: BLOCKED'), 'DNS host resolution is blocked');
  assert(netOut.includes('METADATA: BLOCKED'), 'Cloud metadata connection is blocked');

  // -------------------------------------------------------------
  // Section 3: Privilege Isolation Verification
  // -------------------------------------------------------------
  console.log('\n[Suite 3] Privilege Isolation (UID/GID & no-new-privs)');

  const privProbeCode = `
import java.io.*;
public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println("JAVA_USER: " + System.getProperty("user.name"));

        try {
            Process p = Runtime.getRuntime().exec(new String[]{"id"});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            System.out.println("ID_STR: " + r.readLine());
        } catch (Exception e) {
            System.out.println("ID_ERR: " + e.getMessage());
        }

        try {
            Process p = Runtime.getRuntime().exec(new String[]{"sudo", "-n", "id"});
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getErrorStream()));
            System.out.println("SUDO_STR: " + r.readLine());
        } catch (Exception e) {
            System.out.println("SUDO_BLOCKED: " + e.getMessage());
        }
    }
}
`;

  const privRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-priv-test',
    submissionId: 'sec-priv-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: privProbeCode,
    submittedAt: new Date().toISOString(),
  });

  const { getSandboxConfig } = await import('../execution-worker/jdkEnvironment');
  const sandboxConfig = getSandboxConfig();
  const privOut = privRes.stdout;
  assert(privOut.includes(`JAVA_USER: ${sandboxConfig.user}`), 'Java runtime identity is sandbox user');
  assert(privOut.includes(`uid=${sandboxConfig.uid}(${sandboxConfig.user}) gid=${sandboxConfig.gid}(${sandboxConfig.user})`), `Process executes as UID ${sandboxConfig.uid} / GID ${sandboxConfig.gid}`);
  assert(privOut.includes(`groups=${sandboxConfig.gid}(${sandboxConfig.user})`), 'Supplementary groups are stripped');
  assert(privOut.includes('SUDO_BLOCKED') || privOut.includes('Permission denied'), 'Privilege escalation via sudo is denied');

  // -------------------------------------------------------------
  // Section 4: Filesystem & Workspace Isolation
  // -------------------------------------------------------------
  console.log('\n[Suite 4] Filesystem & Cross-Workspace Isolation');

  const victimDir = '/tmp/sandboxes/exec-target-' + Math.random().toString(36).substring(7);
  fs.mkdirSync(victimDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(victimDir + '/flag.txt', 'SECRET_VICTIM_FLAG_987');

  const fsProbeCode = `
import java.io.*;
public class Main {
    public static void main(String[] args) {
        // Test parent /tmp/sandboxes listing
        File sandboxesDir = new File("/tmp/sandboxes");
        File[] list = sandboxesDir.listFiles();
        if (list == null) {
            System.out.println("PARENT_LISTING: ACCESS_DENIED");
        } else {
            System.out.println("PARENT_LISTING: ALLOWED (" + list.length + ")");
        }

        // Test reading /etc/shadow
        File shadow = new File("/etc/shadow");
        System.out.println("SHADOW_READ: " + shadow.canRead());

        // Test reading victim workspace
        File victim = new File("${victimDir}/flag.txt");
        System.out.println("VICTIM_READ: " + (victim.exists() && victim.canRead()));
    }
}
`;

  const fsRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-fs-test',
    submissionId: 'sec-fs-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: fsProbeCode,
    submittedAt: new Date().toISOString(),
  });

  fs.rmSync(victimDir, { recursive: true, force: true });

  const fsOut = fsRes.stdout;
  assert(fsOut.includes('PARENT_LISTING: ACCESS_DENIED'), 'Parent /tmp/sandboxes directory listing is denied');
  assert(fsOut.includes('SHADOW_READ: false'), 'Access to /etc/shadow is strictly blocked');
  assert(fsOut.includes('VICTIM_READ: false'), 'Direct reading of another execution workspace is blocked');

  // -------------------------------------------------------------
  // Section 5: Process Cleanup & Orphan Reaping
  // -------------------------------------------------------------
  console.log('\n[Suite 5] Process Tree Termination & Cleanup');

  // Hostile program: spawns detached sleep 77, parent exits immediately
  const orphanCode = `
public class Main {
    public static void main(String[] args) throws Exception {
        new ProcessBuilder("sleep", "77").start();
        System.out.println("PARENT_DONE");
    }
}
`;

  const procRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-proc-test',
    submissionId: 'sec-proc-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: orphanCode,
    submittedAt: new Date().toISOString(),
  }, { timeoutMs: 2500 });

  assert(procRes.stdout.includes('PARENT_DONE'), 'Parent process completed');

  // Verify sleep 77 was killed
  const survivingSleep = execSync('ps aux | grep "sleep 77" | grep -v grep || true').toString().trim();
  assert(survivingSleep === '', `No surviving orphan process detected (found: ${survivingSleep || 'none'})`);

  // -------------------------------------------------------------
  // Section 6: Resource Limits Enforcement
  // -------------------------------------------------------------
  console.log('\n[Suite 6] Resource Limits Enforcement');

  // 6.1 CPU Exhaustion
  const cpuRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-cpu-test',
    submissionId: 'sec-cpu-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: 'public class Main { public static void main(String[] args) { while(true) {} } }',
    submittedAt: new Date().toISOString(),
  }, { timeoutMs: 1500 });
  assert(cpuRes.status === 'TIMEOUT', `CPU exhaustion triggers TIMEOUT status (got: ${cpuRes.status})`);

  // 6.2 Memory Exhaustion
  const memRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-mem-test',
    submissionId: 'sec-mem-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: 'import java.util.*; public class Main { public static void main(String[] args) { List<byte[]> l = new ArrayList<>(); while(true) l.add(new byte[1024*1024]); } }',
    submittedAt: new Date().toISOString(),
  }, { timeoutMs: 5000 });
  assert(memRes.status === 'MEMORY_LIMIT', `Memory exhaustion triggers MEMORY_LIMIT status (got: ${memRes.status})`);

  // 6.3 Huge Output
  const outRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-out-test',
    submissionId: 'sec-out-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: 'public class Main { public static void main(String[] args) { for(int i=0; i<15000; i++) System.out.println("FLOOD_OUTPUT_LINE_" + i); } }',
    submittedAt: new Date().toISOString(),
  });
  assert(outRes.status === 'OUTPUT_LIMIT', `Huge output triggers OUTPUT_LIMIT status (got: ${outRes.status})`);

  // 6.4 Large Source
  const largeCode = 'public class Main { public static void main(String[] args) {} }' + ' // '.padEnd(60000, 'X');
  const srcRes = await IsolatedJavaSandbox.execute({
    jobId: 'sec-src-test',
    submissionId: 'sec-src-test',
    teamId: 'team-sec',
    challengeId: 'c1',
    submittedJavaSource: largeCode,
    submittedAt: new Date().toISOString(),
  });
  assert(srcRes.status === 'COMPILE_ERROR', `Oversized source triggers COMPILE_ERROR (got: ${srcRes.status})`);
  assert(srcRes.stderr.includes('SOURCE_CODE_TOO_LARGE'), 'Stderr contains SOURCE_CODE_TOO_LARGE error');

  console.log('\n================================================================');
  console.log(`SECURITY VERIFICATION COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSecuritySuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal security test error:', err);
    process.exit(1);
  });

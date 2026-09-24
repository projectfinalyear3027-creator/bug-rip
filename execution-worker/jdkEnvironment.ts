/**
 * BUG RIP - Execution Worker JDK & Sandbox Environment Diagnostics
 * 
 * Provides robust resolution, validation, and diagnostics of the OpenJDK 21
 * environment and sandbox security primitives:
 * - Controlled resolution of JAVA_HOME, javac, and java executables
 * - Verification of compiler presence (ensures full JDK, not just JRE)
 * - Major version compatibility check (OpenJDK 21 LTS)
 * - Safe automatic provisioning of OpenJDK 21 and sandbox user if missing and running as root
 * - Linux sandbox capability detection (unshare network namespace, setpriv UID 1001)
 * - Secure startup health diagnostics without exposing host internal paths to participants
 */

import fs from 'fs';
import path from 'path';
import { spawnSync, execSync } from 'child_process';

export interface JdkEnvironmentInfo {
  isAvailable: boolean;
  javaHome: string;
  javacPath: string;
  javaPath: string;
  javaVersion: string;
  javacVersion: string;
  majorVersion: number;
  isJdk21: boolean;
  isolationAvailable: boolean;
  sandboxUserExists: boolean;
  error?: string;
}

let cachedJdkInfo: JdkEnvironmentInfo | null = null;

/**
 * Common standard JDK candidate directories on Linux distributions
 */
const CANDIDATE_JAVA_HOMES = [
  process.env.JAVA_HOME,
  '/usr/lib/jvm/java-21-openjdk-amd64',
  '/usr/lib/jvm/java-21-openjdk',
  '/usr/lib/jvm/default-java',
  '/usr/lib/jvm/java-1.21.0-openjdk-amd64',
].filter(Boolean) as string[];

/**
 * Checks if a file exists and is executable
 */
function isExecutable(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely ensure the unprivileged sandbox user (UID 1001) exists if running as root
 */
export function ensureSandboxUser(): boolean {
  try {
    const isRoot = process.getuid ? process.getuid() === 0 : false;
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    const hasSandbox = passwd.includes('sandbox:') || fs.existsSync('/home/sandbox');
    if (hasSandbox) return true;

    if (isRoot) {
      try {
        execSync('useradd -u 1001 -U -m -s /bin/bash sandbox', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Safely ensures OpenJDK 21 is installed if running as root and currently missing
 */
export function ensureJdkInstalled(): boolean {
  try {
    const isRoot = process.getuid ? process.getuid() === 0 : false;
    if (!isRoot) return false;

    // Check if javac is already available
    const existingJavac = resolveBinary('javac');
    if (existingJavac) return true;

    console.log('[ExecutionWorker] OpenJDK 21 compiler not found. Automatically provisioning openjdk-21-jdk-headless...');
    execSync('DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-21-jdk-headless', {
      stdio: 'inherit',
    });
    return true;
  } catch (err: any) {
    console.error('[ExecutionWorker] Failed to auto-provision OpenJDK 21:', err?.message);
    return false;
  }
}

/**
 * Resolves an executable binary from candidate JAVA_HOMEs or current PATH
 */
function resolveBinary(name: 'javac' | 'java', preferredHome?: string): string | null {
  // 1. Check preferred JAVA_HOME
  if (preferredHome) {
    const binPath = path.join(preferredHome, 'bin', name);
    if (isExecutable(binPath)) return binPath;
  }

  // 2. Check candidate JAVA_HOMEs
  for (const home of CANDIDATE_JAVA_HOMES) {
    const binPath = path.join(home, 'bin', name);
    if (isExecutable(binPath)) return binPath;
  }

  // 3. Check system PATH locations
  const standardPaths = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/bin/${name}`,
  ];
  for (const p of standardPaths) {
    if (isExecutable(p)) return p;
  }

  // 4. Fall back to which command
  try {
    const res = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (res && isExecutable(res)) return res;
  } catch {}

  return null;
}

/**
 * Extracts version string by running `<binary> -version`
 */
function getBinaryVersion(binaryPath: string): string {
  try {
    const proc = spawnSync(binaryPath, ['-version'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return (proc.stderr || proc.stdout || '').trim().split('\n')[0] || 'Unknown';
  } catch (err: any) {
    return `Error: ${err?.message || 'Failed to inspect version'}`;
  }
}

/**
 * Resolves and validates the complete JDK 21 environment
 */
export function resolveJdkEnvironment(forceRefresh = false): JdkEnvironmentInfo {
  if (cachedJdkInfo && !forceRefresh) {
    return cachedJdkInfo;
  }

  // Ensure sandbox user is ready
  const sandboxUserExists = ensureSandboxUser();

  // Try locating javac and java
  let javacPath = resolveBinary('javac');
  let javaPath = resolveBinary('java');

  // If missing and running as root, attempt safe auto-provisioning
  if (!javacPath) {
    ensureJdkInstalled();
    javacPath = resolveBinary('javac');
    javaPath = resolveBinary('java');
  }

  if (!javacPath) {
    cachedJdkInfo = {
      isAvailable: false,
      javaHome: '',
      javacPath: '',
      javaPath: javaPath || '',
      javaVersion: javaPath ? getBinaryVersion(javaPath) : 'None',
      javacVersion: 'None (javac not found)',
      majorVersion: 0,
      isJdk21: false,
      isolationAvailable: false,
      sandboxUserExists,
      error: 'CRITICAL: Java Development Kit compiler (javac) is not found. An OpenJDK 21 JDK is required to compile participant code.',
    };
    return cachedJdkInfo;
  }

  if (!javaPath) {
    cachedJdkInfo = {
      isAvailable: false,
      javaHome: '',
      javacPath,
      javaPath: '',
      javaVersion: 'None',
      javacVersion: getBinaryVersion(javacPath),
      majorVersion: 0,
      isJdk21: false,
      isolationAvailable: false,
      sandboxUserExists,
      error: 'CRITICAL: Java runtime (java) is not found in the environment.',
    };
    return cachedJdkInfo;
  }

  // Derive canonical JAVA_HOME from javacPath
  let javaHome = '';
  try {
    const realJavac = fs.realpathSync(javacPath);
    javaHome = path.dirname(path.dirname(realJavac));
  } catch {
    javaHome = path.dirname(path.dirname(javacPath));
  }

  // If derived home does not contain bin/javac, check CANDIDATE_JAVA_HOMES
  if (!fs.existsSync(path.join(javaHome, 'bin', 'javac'))) {
    for (const cand of CANDIDATE_JAVA_HOMES) {
      if (fs.existsSync(path.join(cand, 'bin', 'javac'))) {
        javaHome = cand;
        break;
      }
    }
  }

  const javacVersion = getBinaryVersion(javacPath);
  const javaVersion = getBinaryVersion(javaPath);

  // Parse major version number (e.g., from "javac 21.0.12" or "openjdk version \"21.0.12\"")
  const match = javacVersion.match(/javac\s+([0-9]+)/) || javaVersion.match(/(?:openjdk|java)\s+(?:version\s+)?"?([0-9]+)/i);
  const majorVersion = match ? parseInt(match[1], 10) : 0;
  const isJdk21 = majorVersion === 21;

  // Check Linux network namespace isolation & setpriv
  let isolationAvailable = false;
  try {
    const isRoot = process.getuid ? process.getuid() === 0 : false;
    const hasUnshare = fs.existsSync('/usr/bin/unshare') || fs.existsSync('/bin/unshare');
    const hasSetpriv = fs.existsSync('/usr/bin/setpriv') || fs.existsSync('/bin/setpriv');
    isolationAvailable = isRoot && hasUnshare && hasSetpriv && sandboxUserExists;
  } catch {
    isolationAvailable = false;
  }

  cachedJdkInfo = {
    isAvailable: true,
    javaHome,
    javacPath,
    javaPath,
    javaVersion,
    javacVersion,
    majorVersion,
    isJdk21,
    isolationAvailable,
    sandboxUserExists,
  };

  return cachedJdkInfo;
}

/**
 * Startup diagnostic check for the execution worker service.
 * Verifies environment health and logs clear status.
 * Throws an explicit error during startup if JDK is unavailable.
 */
export function verifyExecutionEnvironmentOrThrow(): JdkEnvironmentInfo {
  const info = resolveJdkEnvironment(true);

  if (!info.isAvailable) {
    console.error('================================================================');
    console.error('[ExecutionWorker] CRITICAL: JAVA EXECUTION ENVIRONMENT NOT READY');
    console.error(`Error: ${info.error}`);
    console.error('================================================================');
    throw new Error(info.error || 'JDK 21 execution environment is unavailable.');
  }

  console.log('----------------------------------------------------------------');
  console.log('[ExecutionWorker] Java Execution Environment Verified:');
  console.log(`  • JAVA_HOME:        ${info.javaHome}`);
  console.log(`  • javac binary:     ${info.javacPath} (${info.javacVersion})`);
  console.log(`  • java runtime:     ${info.javaPath} (${info.javaVersion})`);
  console.log(`  • OpenJDK 21 LTS:   ${info.isJdk21 ? 'CONFIRMED' : 'WARNING (version: ' + info.majorVersion + ')'}`);
  console.log(`  • Sandbox Security: UID 1001 (sandbox: ${info.sandboxUserExists ? 'READY' : 'MISSING'}), unshare isolation: ${info.isolationAvailable ? 'ACTIVE' : 'FALLBACK'}`);
  console.log('----------------------------------------------------------------');

  return info;
}

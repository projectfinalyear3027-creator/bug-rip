/**
 * BUG RIP - Execution Worker JDK & Sandbox Environment Diagnostics
 * 
 * Provides robust resolution, validation, and diagnostics of the OpenJDK 21
 * environment and sandbox security primitives:
 * - Controlled resolution of JAVA_HOME, javac, and java executables
 * - Verification of compiler presence (ensures full JDK, not just JRE)
 * - Major version compatibility check (OpenJDK 21 LTS)
 * - Safe automatic provisioning of OpenJDK 21 and sandbox user if missing and running as root
 * - Linux sandbox capability detection (unshare network namespace, setpriv configurable UID/GID)
 * - Secure startup health diagnostics without exposing host internal paths to participants
 */

import fs from 'fs';
import path from 'path';
import { spawnSync, execSync } from 'child_process';
import { SandboxConfig, SandboxIdentityStatus } from './types.ts';

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
  sandboxConfig: SandboxConfig;
  sandboxIdentity: SandboxIdentityStatus;
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
 * Resolves the centralized sandbox identity configuration.
 * Defaults to sandbox user with UID 2001 and GID 2001, avoiding collisions with host UID 1001.
 */
export function getSandboxConfig(): SandboxConfig {
  const user = process.env.SANDBOX_USER?.trim() || 'sandbox';
  const rawUid = process.env.SANDBOX_UID?.trim();
  const rawGid = process.env.SANDBOX_GID?.trim();
  const uid = rawUid ? parseInt(rawUid, 10) : 2001;
  const gid = rawGid ? parseInt(rawGid, 10) : 2001;
  return {
    user,
    uid: isNaN(uid) ? 2001 : uid,
    gid: isNaN(gid) ? 2001 : gid,
  };
}

/**
 * Verifies that the ephemeral sandbox directory /tmp/sandboxes exists and has safe permissions.
 */
export function verifySandboxDirectory(dirPath = '/tmp/sandboxes'): {
  exists: boolean;
  isDir: boolean;
  writable: boolean;
  readable: boolean;
  stickyBit: boolean;
  modeOctal: string;
  error?: string;
} {
  try {
    if (!fs.existsSync(dirPath)) {
      return {
        exists: false,
        isDir: false,
        writable: false,
        readable: false,
        stickyBit: false,
        modeOctal: '',
        error: `Directory ${dirPath} does not exist`,
      };
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return {
        exists: true,
        isDir: false,
        writable: false,
        readable: false,
        stickyBit: false,
        modeOctal: '',
        error: `${dirPath} is not a directory`,
      };
    }
    const mode = stat.mode;
    const stickyBit = (mode & 0o1000) !== 0;
    const modeOctal = (mode & 0o7777).toString(8);
    let readable = true;
    let writable = true;
    try {
      fs.accessSync(dirPath, fs.constants.R_OK);
    } catch {
      readable = false;
    }
    try {
      fs.accessSync(dirPath, fs.constants.W_OK);
    } catch {
      writable = false;
    }
    return {
      exists: true,
      isDir: true,
      writable,
      readable,
      stickyBit,
      modeOctal,
    };
  } catch (err: any) {
    return {
      exists: false,
      isDir: false,
      writable: false,
      readable: false,
      stickyBit: false,
      modeOctal: '',
      error: err?.message,
    };
  }
}

/**
 * Verifies that the configured sandbox execution user exists, matches configured UID/GID,
 * and that /tmp/sandboxes is accessible.
 */
export function verifySandboxIdentity(): SandboxIdentityStatus {
  const config = getSandboxConfig();
  const dirCheck = verifySandboxDirectory('/tmp/sandboxes');
  let userExists = false;
  let actualUid: number | undefined;
  let actualGid: number | undefined;

  try {
    const uidOut = execSync(`id -u ${config.user} 2>/dev/null`, { encoding: 'utf8' }).trim();
    const gidOut = execSync(`id -g ${config.user} 2>/dev/null`, { encoding: 'utf8' }).trim();
    actualUid = parseInt(uidOut, 10);
    actualGid = parseInt(gidOut, 10);
    if (!isNaN(actualUid) && !isNaN(actualGid)) {
      userExists = true;
    }
  } catch {
    try {
      const passwd = fs.readFileSync('/etc/passwd', 'utf8');
      for (const line of passwd.split('\n')) {
        const parts = line.split(':');
        if (parts[0] === config.user && parts.length >= 4) {
          actualUid = parseInt(parts[2], 10);
          actualGid = parseInt(parts[3], 10);
          userExists = true;
          break;
        }
      }
    } catch {}
  }

  const uidMatches = userExists && actualUid === config.uid;
  const gidMatches = userExists && actualGid === config.gid;
  const directoryExists = dirCheck.exists && dirCheck.isDir;
  const directoryWritable = dirCheck.writable;
  const directoryStickyOrOwned = dirCheck.stickyBit || dirCheck.writable;

  let valid = userExists && uidMatches && gidMatches && directoryExists && directoryWritable;
  let error: string | undefined;

  if (!userExists) {
    error = `Configured sandbox user "${config.user}" does not exist in the system.`;
  } else if (!uidMatches) {
    error = `Configured sandbox user "${config.user}" UID mismatch: expected ${config.uid}, found ${actualUid}.`;
  } else if (!gidMatches) {
    error = `Configured sandbox user "${config.user}" GID mismatch: expected ${config.gid}, found ${actualGid}.`;
  } else if (!directoryExists) {
    error = `/tmp/sandboxes directory does not exist or is not a directory.`;
  } else if (!directoryWritable) {
    error = `/tmp/sandboxes directory is not writable.`;
  }

  return {
    user: config.user,
    configuredUid: config.uid,
    configuredGid: config.gid,
    userExists,
    actualUid,
    actualGid,
    uidMatches,
    gidMatches,
    directoryExists,
    directoryWritable,
    directoryStickyOrOwned,
    valid,
    error,
  };
}

/**
 * Safely ensure the unprivileged sandbox user exists with configured UID/GID if running as root
 */
export function ensureSandboxUser(): boolean {
  try {
    const config = getSandboxConfig();
    const isRoot = process.getuid ? process.getuid() === 0 : false;
    const status = verifySandboxIdentity();
    if (status.valid) return true;

    if (isRoot) {
      try {
        if (!status.userExists) {
          try {
            execSync(`groupadd -g ${config.gid} ${config.user} 2>/dev/null || true`, { stdio: 'ignore' });
          } catch {}
          execSync(
            `useradd -u ${config.uid} -g ${config.gid} -m -s /bin/bash ${config.user} 2>/dev/null || useradd -u ${config.uid} -m -s /bin/bash ${config.user}`,
            { stdio: 'ignore' }
          );
        } else if (!status.uidMatches || !status.gidMatches) {
          try {
            execSync(`groupmod -g ${config.gid} ${config.user} 2>/dev/null || true`, { stdio: 'ignore' });
          } catch {}
          execSync(`usermod -u ${config.uid} -g ${config.gid} ${config.user} 2>/dev/null || true`, { stdio: 'ignore' });
        }
        const updated = verifySandboxIdentity();
        return updated.valid;
      } catch {
        return false;
      }
    }
    return status.valid;
  } catch {
    return false;
  }
}

/**
 * Ensures the ephemeral sandbox directory /tmp/sandboxes exists with safe permissions
 */
export function ensureSandboxDirectory(): boolean {
  try {
    const dir = '/tmp/sandboxes';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o711 });
    }
    const isRoot = process.getuid ? process.getuid() === 0 : false;
    if (isRoot) {
      try {
        fs.chownSync(dir, 0, 0);
        fs.chmodSync(dir, 0o711);
      } catch {}
    }
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (err) {
    console.error('[ExecutionWorker] /tmp/sandboxes check failed:', err);
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
  const sandboxConfig = getSandboxConfig();
  const sandboxIdentity = verifySandboxIdentity();
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
      sandboxConfig,
      sandboxIdentity,
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
      sandboxConfig,
      sandboxIdentity,
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
    const hasUnshare = fs.existsSync('/usr/bin/unshare') || fs.existsSync('/bin/unshare');
    const hasSetpriv = fs.existsSync('/usr/bin/setpriv') || fs.existsSync('/bin/setpriv');
    if (hasUnshare && hasSetpriv && sandboxUserExists) {
      try {
        const probe = spawnSync(
          'unshare',
          [
            '-n',
            '-p',
            '-f',
            '--mount-proc',
            'setpriv',
            '--reuid',
            String(sandboxConfig.uid),
            '--regid',
            String(sandboxConfig.gid),
            '--clear-groups',
            '--no-new-privs',
            'true',
          ],
          { timeout: 2000 }
        );
        isolationAvailable = probe.status === 0;
      } catch {
        isolationAvailable = false;
      }
    }
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
    sandboxConfig,
    sandboxIdentity,
  };

  return cachedJdkInfo;
}

/**
 * Startup diagnostic check for the execution worker service.
 * Verifies environment health and logs clear status.
 * Throws an explicit error during startup if JDK or Linux sandbox primitives are unavailable.
 */
export function verifyExecutionEnvironmentOrThrow(): JdkEnvironmentInfo {
  const info = resolveJdkEnvironment(true);
  const isProduction = process.env.NODE_ENV === 'production';
  const config = getSandboxConfig();
  const identity = verifySandboxIdentity();
  const hasSandboxDir = ensureSandboxDirectory();

  if (!info.isAvailable) {
    console.error('================================================================');
    console.error('[ExecutionWorker] CRITICAL: JAVA EXECUTION ENVIRONMENT NOT READY');
    console.error(`Error: ${info.error}`);
    console.error('================================================================');
    throw new Error(info.error || 'JDK 21 execution environment is unavailable.');
  }

  // Preflight security verification for production deployments
  if (isProduction) {
    if (!info.isJdk21) {
      throw new Error(`CRITICAL SANDBOX PREFLIGHT ERROR: OpenJDK 21 LTS is mandatory in production (detected major version: ${info.majorVersion || 'unknown'}).`);
    }
    const hasUnshare = fs.existsSync('/usr/bin/unshare') || fs.existsSync('/bin/unshare');
    if (!hasUnshare) {
      throw new Error('CRITICAL SANDBOX PREFLIGHT ERROR: /usr/bin/unshare utility is missing. Linux network namespace isolation is mandatory.');
    }
    const hasSetpriv = fs.existsSync('/usr/bin/setpriv') || fs.existsSync('/bin/setpriv');
    if (!hasSetpriv) {
      throw new Error('CRITICAL SANDBOX PREFLIGHT ERROR: /usr/bin/setpriv utility is missing. Non-root unprivileged sandbox execution is mandatory.');
    }
    if (!identity.userExists) {
      throw new Error(`CRITICAL SANDBOX PREFLIGHT ERROR: Configured sandbox user "${config.user}" does not exist in the system.`);
    }
    if (!identity.uidMatches) {
      throw new Error(`CRITICAL SANDBOX PREFLIGHT ERROR: Sandbox user "${config.user}" UID mismatch: expected ${config.uid}, found ${identity.actualUid}.`);
    }
    if (!identity.gidMatches) {
      throw new Error(`CRITICAL SANDBOX PREFLIGHT ERROR: Sandbox user "${config.user}" GID mismatch: expected ${config.gid}, found ${identity.actualGid}.`);
    }
    if (!identity.directoryExists) {
      throw new Error('CRITICAL SANDBOX PREFLIGHT ERROR: /tmp/sandboxes directory does not exist or is not a directory.');
    }
    if (!identity.directoryWritable) {
      throw new Error('CRITICAL SANDBOX PREFLIGHT ERROR: /tmp/sandboxes directory is inaccessible or cannot be written to.');
    }
  }

  console.log('----------------------------------------------------------------');
  console.log('[ExecutionWorker] Java Execution Environment Verified:');
  console.log(`  • JAVA_HOME:        ${info.javaHome}`);
  console.log(`  • javac binary:     ${info.javacPath} (${info.javacVersion})`);
  console.log(`  • java runtime:     ${info.javaPath} (${info.javaVersion})`);
  console.log(`  • OpenJDK 21 LTS:   ${info.isJdk21 ? 'CONFIRMED' : 'WARNING (version: ' + info.majorVersion + ')'}`);
  console.log(`  • Sandbox Security: UID ${config.uid}:${config.gid} (${config.user}: ${identity.valid ? 'READY' : 'MISCONFIGURED'}), unshare isolation: ${info.isolationAvailable ? 'ACTIVE' : 'FALLBACK'}`);
  console.log(`  • Sandbox Dir:      /tmp/sandboxes (${hasSandboxDir ? 'READY' : 'ERROR'})`);
  console.log('----------------------------------------------------------------');

  return info;
}

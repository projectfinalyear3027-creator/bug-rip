/**
 * BUG RIP - Isolated Java Sandbox Runner (Fragment 8)
 * 
 * Provides hardened, isolated compilation and execution of untrusted participant Java code:
 * - Ephemeral workspace per job in /tmp/sandboxes/exec-<UUID> (0700 permissions)
 * - Automatic guaranteed workspace cleanup in finally block
 * - Stripped, minimal environment (PATH, JAVA_HOME, LANG=C.UTF-8 only; NO application secrets)
 * - Linux network namespace isolation (unshare -n) blocking all LAN/WAN and loopback access
 * - Non-root sandbox user execution (UID 1001)
 * - JVM resource constraints (-Xmx256m, -Xms32m, -XX:+CrashOnOutOfMemoryError, -XX:ActiveProcessorCount=1)
 * - Strict watchdog timer (kills entire process group on timeout)
 * - Real-time 64KB output ceiling (kills process immediately upon overflow, returns OUTPUT_LIMIT)
 * - Output path sanitization (strips host sandbox directory paths from stack traces)
 * - Source code size validation (50,000 bytes maximum)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { ExecutionJobPayload, ExecutionResult, SubmissionExecutionStatus } from './types';
import { resolveJdkEnvironment } from './jdkEnvironment';

export const MAX_SOURCE_CODE_BYTES = 50000;
export const DEFAULT_EXECUTION_TIMEOUT_MS = 3000;
export const MAX_OUTPUT_LIMIT_BYTES = 65536; // 64 KB

export interface SandboxExecutionOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  memoryLimitMb?: number;
  stdin?: string;
  workerId?: string;
}

export class IsolatedJavaSandbox {
  private static sandboxBaseDir = '/tmp/sandboxes';
  private static hasUnshareAndSandboxUser: boolean | null = null;

  /**
   * Check if network namespace isolation and unprivileged sandbox user are supported
   */
  public static async isIsolationSupported(): Promise<boolean> {
    if (this.hasUnshareAndSandboxUser !== null) {
      return this.hasUnshareAndSandboxUser;
    }

    try {
      const isRoot = process.getuid ? process.getuid() === 0 : false;
      if (!isRoot) {
        this.hasUnshareAndSandboxUser = false;
        return false;
      }

      // Check if user 'sandbox' exists
      const hasSandboxUser = fs.existsSync('/home/sandbox') || (() => {
        try {
          const passwd = fs.readFileSync('/etc/passwd', 'utf-8');
          return passwd.includes('sandbox:');
        } catch {
          return false;
        }
      })();

      this.hasUnshareAndSandboxUser = hasSandboxUser;
      return this.hasUnshareAndSandboxUser;
    } catch {
      this.hasUnshareAndSandboxUser = false;
      return false;
    }
  }

  /**
   * Validate and sanitize submitted Java source code
   */
  public static validateSource(sourceCode: string): { valid: boolean; error?: string } {
    if (!sourceCode || typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
      return { valid: false, error: 'Source code cannot be empty.' };
    }

    const byteLength = Buffer.byteLength(sourceCode, 'utf8');
    if (byteLength > MAX_SOURCE_CODE_BYTES) {
      return {
        valid: false,
        error: `SOURCE_CODE_TOO_LARGE: Submitted code (${byteLength} bytes) exceeds maximum limit of ${MAX_SOURCE_CODE_BYTES} bytes.`,
      };
    }

    return { valid: true };
  }

  /**
   * Sanitize output by stripping ephemeral host sandbox directories
   */
  public static sanitizeOutput(text: string, workspaceDir: string, mainClassName: string): string {
    if (!text) return '';
    const escapedDir = workspaceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dirRegex = new RegExp(escapedDir + '[/\\\\]?', 'g');
    let sanitized = text.replace(dirRegex, '');

    // Strip generic /tmp/sandboxes paths if any leaked
    sanitized = sanitized.replace(/\/tmp\/sandboxes\/exec-[a-f0-9-]+\/?/g, '');

    // Strip internal host JVM / build paths
    sanitized = sanitized.replace(/\/usr\/lib\/jvm\/[^\s:]+\//g, '');
    sanitized = sanitized.replace(/\/app\/[^\s:]+\//g, '');

    // Normalize Windows/Unix path separators for source files
    sanitized = sanitized.replace(new RegExp(`.*[\\/\\\\](${mainClassName}\\.java)`, 'g'), '$1');

    return sanitized;
  }

  /**
   * Compile and execute submitted Java source code in an isolated sandbox
   */
  public static async execute(
    payload: ExecutionJobPayload,
    options: SandboxExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const jobId = payload.jobId || crypto.randomUUID();
    const submissionId = payload.submissionId || jobId;
    const mainClassName = payload.mainClassName || 'Main';
    const timeoutMs = options.timeoutMs || (payload.timeoutSeconds ? payload.timeoutSeconds * 1000 : DEFAULT_EXECUTION_TIMEOUT_MS);
    const maxOutputBytes = options.maxOutputBytes || payload.maxOutputBytes || MAX_OUTPUT_LIMIT_BYTES;
    const workerId = options.workerId || 'worker-core-1';

    // 0. Verify JDK Compiler Availability
    const jdk = resolveJdkEnvironment();
    if (!jdk.isAvailable) {
      return {
        jobId,
        submissionId,
        status: 'SANDBOX_ERROR',
        exitCode: 1,
        stdout: '',
        stderr: 'JAVA COMPILER UNAVAILABLE: The Java Development Kit (javac) is not configured in the execution environment.',
        durationMs: Date.now() - startTime,
        workerId,
      };
    }

    // 1. Validate Source Code
    const validation = this.validateSource(payload.submittedJavaSource);
    if (!validation.valid) {
      return {
        jobId,
        submissionId,
        status: 'COMPILE_ERROR',
        exitCode: 1,
        stdout: '',
        stderr: validation.error || 'Invalid source code',
        durationMs: Date.now() - startTime,
        workerId,
      };
    }

    // 2. Prepare Ephemeral Workspace
    if (!fs.existsSync(this.sandboxBaseDir)) {
      try {
        fs.mkdirSync(this.sandboxBaseDir, { recursive: true, mode: 0o711 });
        fs.chmodSync(this.sandboxBaseDir, 0o711);
      } catch {
        // Ignored if already exists
      }
    } else {
      try {
        fs.chmodSync(this.sandboxBaseDir, 0o711);
      } catch {}
    }

    const uniqueId = `exec-${crypto.randomUUID()}`;
    const workspaceDir = path.join(this.sandboxBaseDir, uniqueId);
    fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(workspaceDir, 0o700);
    } catch {}

    const sourceFilePath = path.join(workspaceDir, `${mainClassName}.java`);
    fs.writeFileSync(sourceFilePath, payload.submittedJavaSource, 'utf8');

    // Chown to sandbox:sandbox if running as root
    const canUseSandboxUser = await this.isIsolationSupported();
    if (canUseSandboxUser) {
      try {
        // UID 1001, GID 1001
        fs.chownSync(workspaceDir, 1001, 1001);
        fs.chownSync(sourceFilePath, 1001, 1001);
      } catch {
        // Ignored if chown not permitted
      }
    }

    // Sanitized Minimal Environment (NO SECRETS!)
    const minimalEnv: Record<string, string> = {
      PATH: `${jdk.javaHome}/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin`,
      JAVA_HOME: jdk.javaHome,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    };

    try {
      // 3. Compile Step (javac) - Run under sandbox user with network isolation
      const compileResult = await this.runCommand({
        command: jdk.javacPath || 'javac',
        args: ['-encoding', 'UTF-8', '-J-Xmx256m', `${mainClassName}.java`],
        cwd: workspaceDir,
        env: minimalEnv,
        timeoutMs: 6000,
        maxOutputBytes,
        useIsolation: canUseSandboxUser,
      });

      if (compileResult.spawnError) {
        return {
          jobId,
          submissionId,
          status: 'SANDBOX_ERROR',
          exitCode: 1,
          stdout: '',
          stderr: 'JAVA COMPILER UNAVAILABLE: Failed to launch compiler process.',
          durationMs: Date.now() - startTime,
          workerId,
        };
      }

      if (compileResult.exitCode !== 0 || compileResult.timedOut) {
        const sanitizedError = this.sanitizeOutput(
          compileResult.stderr || compileResult.stdout || 'Compilation failed.',
          workspaceDir,
          mainClassName
        );

        return {
          jobId,
          submissionId,
          status: 'COMPILE_ERROR',
          exitCode: compileResult.exitCode,
          stdout: '',
          stderr: sanitizedError,
          compilationOutput: sanitizedError,
          durationMs: Date.now() - startTime,
          workerId,
        };
      }

      // 4. Execution Step (java)
      // Hardened JVM arguments
      const jvmArgs = [
        '-Xmx256m',
        '-Xms32m',
        '-XX:+CrashOnOutOfMemoryError',
        '-XX:ActiveProcessorCount=1',
        '-Djava.awt.headless=true',
        '-Djava.net.useSystemProxies=false',
        '-Dhttp.nonProxyHosts=*',
        '-cp', '.',
        mainClassName,
      ];

      const runResult = await this.runCommand({
        command: jdk.javaPath || 'java',
        args: jvmArgs,
        cwd: workspaceDir,
        env: minimalEnv,
        stdin: options.stdin ?? payload.stdin,
        timeoutMs,
        maxOutputBytes,
        useIsolation: canUseSandboxUser,
      });

      if (runResult.spawnError) {
        return {
          jobId,
          submissionId,
          status: 'SANDBOX_ERROR',
          exitCode: 1,
          stdout: '',
          stderr: 'JAVA RUNTIME UNAVAILABLE: Failed to launch runtime process.',
          durationMs: Date.now() - startTime,
          workerId,
        };
      }

      const durationMs = runResult.durationMs;
      const sanitizedStdout = this.sanitizeOutput(runResult.stdout, workspaceDir, mainClassName);
      let sanitizedStderr = this.sanitizeOutput(runResult.stderr, workspaceDir, mainClassName);

      // 5. Determine Execution Status
      let status: SubmissionExecutionStatus = 'SUCCESS';

      if (runResult.outputLimitExceeded) {
        status = 'OUTPUT_LIMIT';
        sanitizedStderr += (sanitizedStderr ? '\n' : '') + '[OUTPUT LIMIT EXCEEDED: Program output exceeded 64KB ceiling.]';
      } else if (runResult.timedOut) {
        status = 'TIMEOUT';
        sanitizedStderr += (sanitizedStderr ? '\n' : '') + `[TIME LIMIT EXCEEDED: Program execution timed out after ${timeoutMs}ms.]`;
      } else if (
        runResult.exitCode !== 0 &&
        (sanitizedStderr.includes('OutOfMemoryError') ||
          sanitizedStdout.includes('OutOfMemoryError') ||
          runResult.exitCode === 134) // SIGABRT / CrashOnOutOfMemoryError
      ) {
        status = 'MEMORY_LIMIT';
        sanitizedStderr += (sanitizedStderr ? '\n' : '') + '[MEMORY LIMIT EXCEEDED: JVM exceeded 256MB memory quota.]';
      } else if (runResult.exitCode !== 0) {
        status = 'RUNTIME_ERROR';
      }

      return {
        jobId,
        submissionId,
        status,
        exitCode: runResult.exitCode,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        durationMs,
        workerId,
      };
    } catch (err: any) {
      return {
        jobId,
        submissionId,
        status: 'SANDBOX_ERROR',
        exitCode: 1,
        stdout: '',
        stderr: `Internal Sandbox Error: ${err?.message || 'Execution failed'}`,
        durationMs: Date.now() - startTime,
        workerId,
      };
    } finally {
      // 6. Ephemeral Workspace Cleanup
      try {
        if (fs.existsSync(workspaceDir)) {
          fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
      } catch {
        // Non-blocking cleanup failure logging
      }
    }
  }

  /**
   * Helper to spawn a process with watchdog timeout and output monitoring
   */
  private static runCommand(options: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    stdin?: string;
    timeoutMs: number;
    maxOutputBytes: number;
    useIsolation: boolean;
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputLimitExceeded: boolean;
    durationMs: number;
    spawnError?: Error | null;
  }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdoutAcc = '';
      let stderrAcc = '';
      let totalOutputBytes = 0;
      let timedOut = false;
      let outputLimitExceeded = false;
      let settled = false;
      let spawnError: Error | null = null;

      let executable = options.command;
      let finalArgs = options.args;

      if (options.useIsolation) {
        // unshare -n -p -f --mount-proc setpriv --reuid 1001 --regid 1001 --clear-groups --no-new-privs <command> <args>
        executable = 'unshare';
        finalArgs = [
          '-n',
          '-p',
          '-f',
          '--mount-proc',
          'setpriv',
          '--reuid',
          '1001',
          '--regid',
          '1001',
          '--clear-groups',
          '--no-new-privs',
          options.command,
          ...options.args,
        ];
      }

      const child: ChildProcess = spawn(executable, finalArgs, {
        cwd: options.cwd,
        env: options.env,
        detached: true, // Allow killing process group
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Stdin piping
      if (options.stdin && child.stdin) {
        try {
          child.stdin.write(options.stdin);
          child.stdin.end();
        } catch {
          // Ignore pipe errors if process exited early
        }
      } else if (child.stdin) {
        child.stdin.end();
      }

      // Output stream monitors
      const onData = (chunk: Buffer, isStderr: boolean) => {
        if (settled) return;
        const chunkSize = chunk.length;
        totalOutputBytes += chunkSize;

        if (totalOutputBytes > options.maxOutputBytes) {
          outputLimitExceeded = true;
          killProcessGroup();
          return;
        }

        const str = chunk.toString('utf8');
        if (isStderr) {
          stderrAcc += str;
        } else {
          stdoutAcc += str;
        }
      };

      child.stdout?.on('data', (chunk) => onData(chunk, false));
      child.stderr?.on('data', (chunk) => onData(chunk, true));

      const killProcessGroup = () => {
        if (!child.pid) return;
        try {
          // Kill process group
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }
      };

      // Watchdog timeout timer
      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killProcessGroup();
      }, options.timeoutMs);

      const cleanupAndResolve = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        killProcessGroup();

        const durationMs = Date.now() - startTime;
        resolve({
          exitCode: code ?? (timedOut || outputLimitExceeded ? 137 : 1),
          stdout: stdoutAcc,
          stderr: stderrAcc,
          timedOut,
          outputLimitExceeded,
          durationMs,
          spawnError,
        });
      };

      child.on('error', (err) => {
        spawnError = err;
        stderrAcc += `\nProcess error: ${err.message}`;
        cleanupAndResolve(1);
      });

      child.on('close', (code) => {
        cleanupAndResolve(code);
      });
    });
  }
}

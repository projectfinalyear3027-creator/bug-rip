# BUG RIP - Isolated Java Execution Architecture

## 1. Security Threat Model

In BUG RIP, competitors write and execute untrusted Java code directly inside the browser. Untrusted code execution presents several critical risks:
* **Denial of Service:** Fork bombs (`Runtime.getRuntime().exec()`), infinite memory allocations (`new byte[1024*1024*1024]`), CPU saturation infinite loops (`while(true){}`).
* **Server Compromise & Escalation:** Unauthorized file system reads (`/etc/passwd`, `/app/secrets`), writing to disk, process snooping.
* **Network Tampering:** Reverse shells, port scanning intranet hosts, exfiltrating challenges to external servers.
* **Fake Flag Attacks:** Printing `DBG{FAKE}` or guessing flags without resolving the algorithmic defect.

---

## 2. Multi-Stage Pipeline

To protect the platform while allowing **unlimited participant runs**, execution is strictly decoupled from the main web application process:

```text
Browser (Monaco Editor)
       ↓ (POST /api/execute)
Backend API (Express / Node.js)
       ↓ (enqueue job)
BullMQ (Redis Execution Queue)
       ↓ (job popped)
Execution Worker Service (Node.js daemon)
       ↓ (spawn container / isolate)
Isolated OpenJDK 21 Sandbox
  ├── Ephemeral tmpfs (/workspace)
  ├── javac Compilation (3-second limit)
  ├── java Execution (5-second limit)
  └── Behavior Verification & Flag Extractor
       ↓ (collect stdout/stderr/exitCode)
Worker Sanitizer & Output Truncator (max 64KB)
       ↓
Backend Redis Pub/Sub / WebSocket
       ↓
Browser (Live Output Console)
```

---

## 3. Sandbox Hardening Measures

Each execution container is provisioned with the following parameters:
1. **No Network Access:** `--network none` (Java process cannot connect to LAN or WAN).
2. **Ephemeral tmpfs:** The compilation workspace is mounted in memory (`tmpfs: /tmp:rw,noexec,nosuid,size=32m`).
3. **Read-Only Rootfs:** `--read-only` root filesystem prevents any modification to binaries or libraries.
4. **PID Limits:** `--pids-limit 32` prevents fork bombs.
5. **Memory Quotas:** `-m 256m --memory-swap 256m` enforces hard ceiling on heap + JVM footprint.
6. **Execution Timeout:** Strict watchdog timer kills processes exceeding 8 seconds total.
7. **Non-Root Execution:** Unprivileged user `sandbox:sandbox` (UID 10001).
8. **Security Manager / JVM Arguments:**
   ```bash
   java -Xmx192m -Xms32m -XX:+UseSerialGC -Djava.security.manager=disallow -cp . Main
   ```

---

## 4. Fake Flag Defense & Behavior Validation

1. **Flag Obfuscation:** Challenge sources must never store raw strings like `String flag = "DBG{...}"`.
2. **Deterministic Flag Reconstruction:** The flag is mathematically or algorithmically reconstructed only when the core bug is repaired.
3. **Behavioral Assertions:** In addition to stdout comparison, test runners inject validation fixtures that verify internal state invariants before accepting a flag.

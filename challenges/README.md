# BUG RIP - Challenge Authoring & Flag Security Principles

## Core Concepts

BUG RIP challenges consist of intentionally broken Java programs designed for collegiate software engineering competitors.

### 1. The Broken Code Flow
1. Competitors receive starter Java source code containing a defect (e.g. concurrency race condition, off-by-one error, memory leak, arithmetic overflow, logic bug, regex denial of service, null pointer bypass).
2. Competitors inspect, debug, and patch the code in the browser.
3. Competitors execute the code repeatedly without penalty.
4. Correct code execution causes the program to satisfy verification requirements and reconstruct/reveal the hidden flag.
5. The competitor submits the flag.
6. The server validates the team, challenge state, event timer, and authenticity before awarding points.

---

## 2. Flag Security Guidelines

Because participants have full access to editable source code, plaintext flags are strictly forbidden:

```java
// ❌ FORBIDDEN: Raw plaintext flag in source
String flag = "DBG{FACTORIAL_SOLVED}";
```

Instead, use one of the following canonical reconstruction methods:

### Method A: Algorithmic Transformation
The flag bytes are XOR-decrypted or reconstructed using the correct calculated output of the algorithm.
```java
// ✅ RECOMMENDED: Flag is derived from correct mathematical output
long correctFactorial = calculate(20);
String flag = FlagReconstructor.fromResult(correctFactorial, SALT);
```

### Method B: State-Based Checksums
Flag fragments are unlocked as specific validation phases pass.

### Method C: Hidden Test Fixture Verification
The execution worker runs an automated validation suite alongside user code that confirms the fix works for edge cases, not just hardcoded values.

---

## 3. Difficulty Tiers & Initial Quotas

| Difficulty | Default Points | Typical Complexity | Target Unique Solves to Unlock Next |
|------------|----------------|--------------------|--------------------------------------|
| **EASY**   | 10 - 15 pts    | Off-by-one, syntax/type mismatch, simple logic error | 4 unique solves |
| **MEDIUM** | 25 - 40 pts    | Data structure bugs, recursion stack overflow, sorting/search defect | 3 unique solves |
| **HARD**   | 50 - 75 pts    | Concurrency, thread synchronisation, memory leaks, custom parser | 2 unique solves |
| **EXTREME**| 100 - 150 pts  | Bytecode/reflection tricks, cryptographic misuse, distributed state simulation | Final tier (0) |

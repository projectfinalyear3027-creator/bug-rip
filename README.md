# BUG RIP - Java Debugging Capture The Flag (CTF)

> **"FIND THE BUG. RUN THE CODE. RIP THE FLAG."**

BUG RIP is a timed, high-stakes Java debugging competition platform built specifically for college technical symposiums. Participants work in teams of 1 or 2 registered members to inspect, diagnose, and patch intentionally broken Java programs, causing the programs to reveal hidden flags upon successful compilation and correct runtime behavior.

---

## 1. Immutable Competition Rules

All software components, database constraints, queue workers, and UI interfaces build upon these fundamental, non-negotiable rules:

### A. The 60-Minute Event Timer
* The entire competition lasts **strictly 60 minutes**.
* There is one central, **server-authoritative competition timer**. It is not 60 minutes per problem or per round.
* When the organizer issues `START`, the 60-minute countdown begins.
* When `PAUSED`, the timer halts, and new code executions and flag submissions are blocked.
* When the timer reaches zero or `ENDED` is triggered, no further submissions are accepted.

### B. The Immutable Winner Rule
Ranking is calculated strictly in the following priority order:
1. **PRIMARY:** **Problems Solved** (Highest number of unique completed problems).
2. **SECONDARY:** **Total Score** (Points awarded per problem difficulty).
3. **FINAL TIEBREAKER:** **Earliest Achievement Time** (The team reaching that solved count/score first ranks higher).

*Consequence:* A team that solves 20 problems **always** ranks above a team that solves 19 problems, even if the 19-problem team accumulated more total points.

### C. Team Data and Credentials from CSV
* Participant and team records are imported exclusively from an event organizer CSV.
* **BUG RIP does not generate team codes.** The team code already exists in the CSV (e.g. `ALPHA729`, `BETA381`).
* Competitor entry requires **Team Name + Existing Unique Team Code**.
* Team code is the secret credential; team name provides additional identity verification (case-insensitive and trimmed).

### D. Team Size (1 or 2 Members)
* Teams consist of either **1 member** or **2 members** based on the imported CSV.
* Maximum concurrent sessions:
  * **1-member team:** 1 simultaneous session.
  * **2-member team:** 2 simultaneous sessions.
* The 3–4 member rule is permanently deprecated.

### E. Team as the Atomic Competition Unit
* Competition progress belongs exclusively to the **TEAM**, not separate individuals.
* Both teammates share:
  * Solved challenges list and count
  * Accumulated score
  * Unlocked difficulties
  * Real-time timer and event state
  * Public leaderboard ranking
* If Member 1 solves a problem, Member 2 immediately sees it marked as completed.

### F. Simultaneous Work & Same-Problem Race Condition
* Two members of a team may work concurrently on different problems or the same problem.
* If both members submit flags for the same problem at approximately the same time:
  * **Only the first valid completion is accepted and scored.**
  * The second submission is safely rejected with: *"This problem was just completed by another team member."*
  * The second submission never increments solved count, never awards duplicate points, and never duplicates unlocks.
  * This is enforced at the database transaction layer via unique constraints.

### G. Unlimited Code Execution
* Competitors may run their Java code **unlimited times**.
* There is no penalty or game attempt limit for failed runs.
* Infrastructure is protected via server-side timeouts (8s), memory caps (256MB), and execution queues.

### H. Four Progressive Difficulties & Solve Unlocks
* Initial tiers: **EASY**, **MEDIUM**, **HARD**, and **EXTREME**.
* Unlocking higher difficulties requires an administrator-configured number of **unique completed problems** in the current tier.
* Teams can **always return to earlier unlocked tiers** to solve remaining challenges.
* The administrator maintains override authority to unlock tiers globally or per-team.

### I. Hidden Flag & Fake Flag Defense
* Participants receive broken Java code in the Monaco Editor.
* Correcting the bug causes the program to mathematically or algorithmically reconstruct the flag in its output (e.g. `DBG{...}`).
* Raw flags are never stored in plaintext within source code.
* The backend independently validates code execution output and state assertions to prevent competitors from hardcoding fake `System.out.println("DBG{...}")` strings.

---

## 2. The Three Application Areas

BUG RIP consists of three dedicated, decoupled experiences:

### 1. Participant Application
* **Access:** Competitor browser (`/`).
* **Responsibilities:**
  * Team credential authentication (Team Name + Unique Team Code).
  * Pre-competition Waiting Room.
  * Coding Arena with Monaco Editor (syntax highlighting, indentation, shortcuts).
  * Problem selector filtered by unlocked difficulties.
  * Unlimited execution console (stdout, stderr, compilation errors).
  * Flag submission input and instant team-shared status updates.

### 2. Admin Control Center
* **Access:** Authorized event organizers (`/admin`).
* **Responsibilities:**
  * Master Event Controls: `START`, `PAUSE`, `RESUME`, `END`.
  * CSV Team & Participant Import with column mapping.
  * Live monitoring of all teams and connected sessions.
  * Challenge management and difficulty unlock threshold configuration.
  * Anti-cheat anomaly detection and live execution load metrics.
  * Audit logging and final result exports.

### 3. Public Live Scoreboard
* **Access:** Dedicated projector/TV route (`/live`).
* **Responsibilities:**
  * Real-time tournament ranking adhering strictly to the Solved > Score > Time rule.
  * Connected team indicators (`1/1`, `2/2`).
  * Real-time 60-minute countdown display.
  * Zero exposure of private data: hides Java source, flags, emails, phone numbers, and administrative tools.

---

## 3. High-Level System Architecture

```text
                               ┌──────────────────────────────────────────────┐
                               │             Client Applications              │
                               │  - Participant Arena  (React / Monaco)       │
                               │  - Admin Dashboard    (React / Real-time)    │
                               │  - Public Scoreboard  (/live - Projector)    │
                               └──────────────────────┬───────────────────────┘
                                                      │ HTTPS / WebSocket
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │           Backend API Gateway                │
                               │  - Express / Node.js 22                      │
                               │  - Auth & Session Guard (1-2 concurrent)     │
                               │  - Rules Engine & Leaderboard View           │
                               │  - Transactional Submission Coordinator      │
                               └──────────────┬──────────────┬────────────────┘
                                              │              │
                       PostgreSQL (Persist)   │              │ Enqueue Job
                                              ▼              ▼
                               ┌───────────────────┐  ┌───────────────────────┐
                               │  PostgreSQL 16    │  │    Redis 7 + BullMQ   │
                               │  - Teams & CSV    │  │  - Execution Queue    │
                               │  - Submissions    │  │  - Real-time Pub/Sub  │
                               │  - Unique Locks   │  └──────────┬────────────┘
                               │  - Event Timer    │             │ Pop Task
                               └───────────────────┘             ▼
                                                      ┌───────────────────────┐
                                                      │ Execution Worker Host │
                                                      │  - Node.js Daemon     │
                                                      │  - Container Manager  │
                                                      └──────────┬────────────┘
                                                                 │ Spawn Sandbox
                                                                 ▼
                                                      ┌───────────────────────┐
                                                      │ OpenJDK 21 Sandbox    │
                                                      │  - --network none     │
                                                      │  - Read-only Rootfs   │
                                                      │  - 256MB RAM / 8s max │
                                                      │  - Non-root sandbox   │
                                                      └───────────────────────┘
```

---

## 4. Development Phase Roadmap

* **Fragment 1 (Completed):**
  * System architecture, repository foundation, and immutable competition rules definition.
  * Canonical rules engine with unit test suite (Winner rule, team size, race conditions, unlocks).
  * Express API foundation (`/api/health`, `/api/competition/rules`, `/api/competition/config`, `/api/competition/status`).
  * Minimal configuration with zero runtime database, Redis, sandbox worker, or secret dependencies.
  * Architectural PostgreSQL schema definitions and isolated Java sandbox specifications documented for future fragments.
  * Frontend navigation shell displaying architecture diagnostics and live rules engine verification.

* **Fragment 2 (Current - Database & Backend Foundation):**
  * **Relational PostgreSQL Integration:** Drizzle ORM integrated with dual support for Network PostgreSQL (`DATABASE_URL` / `SQL_HOST`) and embedded zero-external-dependency PostgreSQL (`@electric-sql/pglite`).
  * **Canonical Database Schema:** 15 relational tables, custom PostgreSQL enums, and comprehensive foreign keys with cascading integrity:
    * `admin_users`: Organizer role-based access control (`ADMIN`, `SUPER_ADMIN`).
    * `teams`: The atomic competition unit with secret `team_code` imported from CSV.
    * `participants`: Individual student details from college symposium registrations.
    * `team_members`: 1-to-2 member constraints enforced via relational uniqueness and checks.
    * `rounds`: Difficulty tiers (Easy, Medium, Hard, Extreme) with unlock thresholds.
    * `challenges`: Java debugging problem catalog with time/memory resource limits.
    * `challenge_test_cases`: Public and hidden verification suites.
    * `challenge_flags`: Server-side flag verifiers (never leaked to public APIs).
    * `team_challenges`: Shared team progress with atomic solve protection `UNIQUE (team_id, challenge_id)`.
    * `sessions`: Active participant connections enforcing concurrency limits (1 for 1-member, 2 for 2-member).
    * `submissions`: Comprehensive Java code execution audit trail with unlimited attempt logging.
    * `flag_submissions`: Cryptographically hashed flag submission logs.
    * `anti_cheat_events`: Telemetry records for tab switches, blur events, and multi-session breaches.
    * `event_settings`: Authoritative single-row 60-minute competition configuration.
    * `audit_logs`: Traceable organizer actions and event lifecycle operations.
  * **Authoritative Leaderboard View (`leaderboard_view`):** Database-enforced canonical tiebreaker:
    1. `problems_solved DESC`
    2. `total_score DESC`
    3. `last_solve_timestamp ASC`
  * **Automated Migrations & Seeding:** Idempotent migration runner (`database/migrator.ts`) and development seed script (`database/seed.ts`).
  * **Repository & Service Layer:** Clean modular design with Zod request validation, domain error handling, and separation of data access from business logic.
  * **Health & Diagnostics API:** Live database connectivity, latency probe, and entity counts exposed via `/api/health` and `/api/competition/health/db`.

* **Fragment 3:**
  * Monaco Editor integration with Java language services.
  * BullMQ worker implementation with Docker-isolated OpenJDK 21 sandbox.
  * Real-time execution stream (compilation error feedback, runtime stdout/stderr).

* **Fragment 4:**
  * Challenge management engine with difficulty unlock thresholds (Easy -> Medium -> Hard -> Extreme).
  * Flag submission handler with atomic same-problem teammate race protection.
  * Live Scoreboard (`/live`) with real-time WebSocket leaderboard updates.

* **Fragment 5:**
  * Admin Control Center (event start/pause/resume/end, difficulty overrides, live monitoring).
  * Anti-cheat anomaly detectors (rapid submissions, copy-paste telemetry, multi-session policing).
  * Production hardening, CSV export of final symposium awards, and disaster recovery.

---

## 5. Database Architecture & Automatic Mode Selection

The platform features **automatic dual-engine database selection**:
* **`DATABASE_URL` absent (Default for Gemini AI Studio & local development)**: Automatically boots the embedded **PGlite** engine (`@electric-sql/pglite`) in zero-configuration mode. No external database, docker container, or credentials are required.
* **`DATABASE_URL` present (Production / Cloud deployment)**: Automatically connects to the designated external PostgreSQL cluster via connection pooling (`pg.Pool`).
* **Cloud SQL fallback**: If `SQL_HOST` is defined instead of `DATABASE_URL`, connects to Cloud SQL via standard parameters.

### Current Active Database Mode
* **Active Engine**: `PostgreSQL (Embedded Engine)`
* **Mode**: `EMBEDDED_PGLITE`
* **Zero-Config**: `true`
* **External DATABASE_URL**: Not required for development; completely optional until production deployment.

### Running Test Suites
```bash
# Run both Immutable Competition Rules and PGlite Database Foundation tests
npm test

# Run competition rules unit assertions only (33 assertions)
npm run test:rules

# Run database engine, schema, and repository tests only (44 assertions)
npm run test:db
```

### Development Teams Available in Seed Data
| Team Name | Team Code | Member Count | Registered Participants |
| :--- | :--- | :--- | :--- |
| **Development Team Alpha** | `DEV-ALPHA-001` | 2 Members | Arun Kumar, Ravi Teja |
| **Development Team Beta** | `DEV-BETA-002` | 1 Member | Priya Sharma |

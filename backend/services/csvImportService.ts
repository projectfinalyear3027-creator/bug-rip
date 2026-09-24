/**
 * BUG RIP - Solo Individual Participant CSV Import Service
 * 
 * Canonical Competition Model:
 * BUG RIP competition unit = INDIVIDUAL PARTICIPANT (SOLO COMPETITOR)
 * 
 * Rules:
 * 1. One CSV participant record = ONE independent BUG RIP competitor.
 * 2. Participants are NEVER grouped into teams.
 * 3. There is no concept of Team Name, Team Code, Unique Team Code, Team Members,
 *    or team roster in the active registration workflow.
 * 4. Required participant fields: Participant Name, Participant Code (or generated RIP-XXXX-XXXX).
 * 5. Optional participant fields: Email, Phone, College, External ID.
 * 6. Two-phase import: Phase 1 Validate -> Phase 2 Confirm with atomic transaction.
 * 7. Registration locked while competition is RUNNING or PAUSED.
 * 8. Zero teams or team rosters created in active participant registration.
 */

import crypto from 'crypto';
import { eq, and, sql, desc, count, inArray } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  teams,
  participants,
  teamMembers,
  eventSettings,
  auditLogs,
  adminUsers,
} from '../../src/db/schema.ts';
import { adminRepository } from '../repositories/adminRepository.ts';

export interface CsvParticipantRecord {
  rowNumber: number;
  name: string;
  email?: string;
  phone?: string;
  college?: string;
  participantCode: string;
  isCodeGenerated: boolean;
  externalParticipantId?: string;
  status: 'NEW' | 'UNCHANGED' | 'UPDATED' | 'CONFLICT';
  existingParticipantId?: string;
  warnings: string[];
  errors: string[];
}

/**
 * Backward compatibility type for any legacy callers
 */
export interface ParsedTeamRecord {
  teamName: string;
  teamCode: string;
  externalTeamId?: string;
  memberCount: number;
  members: Array<{
    name: string;
    email?: string;
    phone?: string;
    college?: string;
    externalParticipantId?: string;
    rowNumber: number;
  }>;
  status: 'NEW' | 'UNCHANGED' | 'UPDATED' | 'CONFLICT';
  existingTeamId?: string;
  warnings: string[];
  errors: string[];
  sourceRows: number[];
}

export interface CsvValidationResult {
  valid: boolean;
  canImport: boolean;
  registrationLocked: boolean;
  eventStatus: string;
  stats: {
    totalRows: number;
    totalParticipants: number;
    totalTeams: number; // 0 for solo competition
    oneMemberTeams: number;
    twoMemberTeams: number;
    threeMemberTeams: number;
    newParticipants: number;
    existingParticipants: number;
    unchangedParticipants: number;
    updatedParticipants: number;
    conflictParticipants: number;
    newTeams: number;
    existingTeams: number;
    unchangedTeams: number;
    updatedTeams: number;
    conflictTeams: number;
    errorCount: number;
    warningCount: number;
  };
  participants: CsvParticipantRecord[];
  teams: ParsedTeamRecord[]; // Preserved as empty array for solo competition
  errors: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>;
  warnings: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>;
}

export interface CsvImportConfirmationResult {
  success: boolean;
  message: string;
  stats: {
    participantsImported: number;
    teamsImported: number;
    newParticipants: number;
    updatedParticipants: number;
    unchangedParticipants: number;
    newTeams: number;
    updatedTeams: number;
    unchangedTeams: number;
    oneMemberTeams: number;
    twoMemberTeams: number;
    threeMemberTeams: number;
  };
  importedAt: string;
}

export class CsvImportService {
  private readonly MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  private readonly MAX_ROWS = 1000;

  /**
   * RFC 4180 compliant CSV line tokenizer and parser.
   * Handles commas, quotes, escaped quotes (""), newlines, and BOM.
   */
  public parseCsvRows(rawText: string): Array<{ rowNumber: number; fields: string[] }> {
    if (!rawText || typeof rawText !== 'string') return [];

    // Strip UTF-8 BOM if present
    const cleanText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;

    const rows: Array<{ rowNumber: number; fields: string[] }> = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let rowNumber = 1;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const nextChar = cleanText[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            currentField += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(this.sanitizeCell(currentField));
          currentField = '';
        } else if (char === '\r') {
          if (nextChar === '\n') {
            i++;
          }
          currentRow.push(this.sanitizeCell(currentField));
          currentField = '';
          if (currentRow.some((f) => f.trim().length > 0)) {
            rows.push({ rowNumber, fields: currentRow });
          }
          currentRow = [];
          rowNumber++;
        } else if (char === '\n') {
          currentRow.push(this.sanitizeCell(currentField));
          currentField = '';
          if (currentRow.some((f) => f.trim().length > 0)) {
            rows.push({ rowNumber, fields: currentRow });
          }
          currentRow = [];
          rowNumber++;
        } else {
          currentField += char;
        }
      }
    }

    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(this.sanitizeCell(currentField));
      if (currentRow.some((f) => f.trim().length > 0)) {
        rows.push({ rowNumber, fields: currentRow });
      }
    }

    return rows;
  }

  /**
   * Sanitizes cells against CSV Formula Injection (CWE-1236).
   */
  private sanitizeCell(val: string): string {
    const trimmed = val.trim();
    if (!trimmed) return '';
    if (/^[=+\-@\t\r]/.test(trimmed)) {
      if (/^[-+][0-9]+(\.[0-9]+)?$/.test(trimmed)) {
        return trimmed;
      }
      return `'${trimmed}`;
    }
    return trimmed;
  }

  private normalizeHeader(header: string): string {
    return header.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Secure cryptographic random individual participant code generator (e.g. RIP-XXXX-XXXX).
   */
  public generateParticipantCode(): string {
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `RIP-${randomHex.slice(0, 4)}-${randomHex.slice(4, 8)}`;
  }

  private mapColumns(headers: string[]) {
    const norm = headers.map((h) => this.normalizeHeader(h));

    const findIndex = (patterns: string[]): number => {
      for (const p of patterns) {
        const idx = norm.findIndex((h) => h === p || h.includes(p));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // Participant Name (also accepts student_name, full_name, competitor_name, name, or fallback team_name)
    const participantNameIdx = findIndex([
      'participantname',
      'studentname',
      'fullname',
      'competitorname',
      'name',
      'participant',
      'teamname',
      'team',
    ]);

    // Participant Code (also accepts code, access_code, ticket, passcode, or fallback team_code)
    const participantCodeIdx = findIndex([
      'participantcode',
      'competitorcode',
      'accesscode',
      'passcode',
      'uniquecode',
      'secretcode',
      'code',
      'ticket',
      'uniqueteamcode',
      'teamcode',
    ]);

    const emailIdx = findIndex(['email', 'emailaddress', 'mail']);
    const phoneIdx = findIndex(['phone', 'phonenumber', 'mobile', 'contact', 'contactnumber']);
    const collegeIdx = findIndex(['college', 'institution', 'collegename', 'university', 'school']);
    const externalParticipantIdIdx = findIndex(['participantid', 'rollno', 'regno', 'id', 'registrationnumber']);

    // Optional wide format multi-member columns if legacy CSV is supplied
    const member1NameIdx = findIndex(['member1name', 'participant1name', 'student1name', 'member1']);
    const member1EmailIdx = findIndex(['member1email', 'email1']);
    const member1PhoneIdx = findIndex(['member1phone', 'phone1']);
    const member1CollegeIdx = findIndex(['member1college', 'college1']);
    const member1CodeIdx = findIndex(['member1code', 'code1']);

    const member2NameIdx = findIndex(['member2name', 'participant2name', 'student2name', 'member2']);
    const member2EmailIdx = findIndex(['member2email', 'email2']);
    const member2PhoneIdx = findIndex(['member2phone', 'phone2']);
    const member2CollegeIdx = findIndex(['member2college', 'college2']);
    const member2CodeIdx = findIndex(['member2code', 'code2']);

    const member3NameIdx = findIndex(['member3name', 'participant3name', 'student3name', 'member3']);
    const member3EmailIdx = findIndex(['member3email', 'email3']);
    const member3PhoneIdx = findIndex(['member3phone', 'phone3']);
    const member3CollegeIdx = findIndex(['member3college', 'college3']);
    const member3CodeIdx = findIndex(['member3code', 'code3']);

    const isWideFormat = member1NameIdx !== -1 || member2NameIdx !== -1 || member3NameIdx !== -1;

    return {
      participantNameIdx,
      participantCodeIdx,
      emailIdx,
      phoneIdx,
      collegeIdx,
      externalParticipantIdIdx,
      isWideFormat,
      member1NameIdx,
      member1EmailIdx,
      member1PhoneIdx,
      member1CollegeIdx,
      member1CodeIdx,
      member2NameIdx,
      member2EmailIdx,
      member2PhoneIdx,
      member2CollegeIdx,
      member2CodeIdx,
      member3NameIdx,
      member3EmailIdx,
      member3PhoneIdx,
      member3CollegeIdx,
      member3CodeIdx,
    };
  }

  /**
   * Phase 1: Validate CSV text against solo competitor schema.
   * Every row represents ONE independent competitor.
   * No team groupings, no team size limits.
   */
  public async validateCsvImport(
    rawText: string,
    adminUserId?: string
  ): Promise<CsvValidationResult> {
    const errors: Array<{ row?: number; participantName?: string; teamName?: string; message: string }> = [];
    const warnings: Array<{ row?: number; participantName?: string; teamName?: string; message: string }> = [];

    if (!rawText || rawText.trim().length === 0) {
      errors.push({ message: 'Uploaded CSV is empty. Please select a valid participant CSV file.' });
      return this.emptyValidationResult(errors, warnings, 'NOT_STARTED', false);
    }

    if (Buffer.byteLength(rawText, 'utf8') > this.MAX_FILE_SIZE_BYTES) {
      errors.push({
        message: `File size exceeds 5MB limit (${(Buffer.byteLength(rawText, 'utf8') / (1024 * 1024)).toFixed(1)}MB detected).`,
      });
      return this.emptyValidationResult(errors, warnings, 'NOT_STARTED', false);
    }

    const eventRow = await db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
    const eventStatus = eventRow[0]?.status || 'NOT_STARTED';
    const isLocked = eventStatus === 'RUNNING' || eventStatus === 'PAUSED';

    if (isLocked) {
      errors.push({
        message: `REGISTRATION LOCKED: The competition is currently ${eventStatus}. Registration mutations are prohibited during competition.`,
      });
    }

    const parsedRows = this.parseCsvRows(rawText);
    if (parsedRows.length === 0) {
      errors.push({ message: 'No parseable rows found in CSV.' });
      return this.emptyValidationResult(errors, warnings, eventStatus, isLocked);
    }

    const headerRow = parsedRows[0];
    const dataRows = parsedRows.slice(1);

    if (dataRows.length === 0) {
      errors.push({ message: 'CSV contains only headers with no participant records.' });
      return this.emptyValidationResult(errors, warnings, eventStatus, isLocked);
    }

    const colMap = this.mapColumns(headerRow.fields);

    // Validate header presence: Must have participant name column
    if (!colMap.isWideFormat && colMap.participantNameIdx === -1) {
      errors.push({
        row: 1,
        message: 'Missing participant name column. Expected headers like "Participant Name", "Competitor Name", or "Name".',
      });
      return this.emptyValidationResult(errors, warnings, eventStatus, isLocked);
    }

    // Validate header presence: Must have participant code column
    if (!colMap.isWideFormat && colMap.participantCodeIdx === -1) {
      errors.push({
        row: 1,
        message: 'Missing mandatory "Participant Code" header column. Expected "Participant Code" or "Access Code".',
      });
      return this.emptyValidationResult(errors, warnings, eventStatus, isLocked);
    }

    // Load existing participants in DB for idempotency & status detection
    const existingDbParticipants = await db.select().from(participants);
    const dbParticipantByCode = new Map<string, typeof existingDbParticipants[0]>();
    const dbParticipantByEmail = new Map<string, typeof existingDbParticipants[0]>();
    for (const p of existingDbParticipants) {
      if (p.participantCode) dbParticipantByCode.set(p.participantCode.trim().toUpperCase(), p);
      if (p.email) dbParticipantByEmail.set(p.email.trim().toLowerCase(), p);
    }

    const participantList: CsvParticipantRecord[] = [];
    const seenCodesInCsv = new Map<string, number>(); // codeUpper -> rowNumber

    if (colMap.isWideFormat) {
      // Unroll wide-format rows into independent individual participants
      for (const r of dataRows) {
        const rowCollege = colMap.collegeIdx !== -1 ? (r.fields[colMap.collegeIdx] || '').trim() || undefined : undefined;
        const slots = [
          { nameIdx: colMap.member1NameIdx, emailIdx: colMap.member1EmailIdx, phoneIdx: colMap.member1PhoneIdx, collegeIdx: colMap.member1CollegeIdx, codeIdx: colMap.member1CodeIdx },
          { nameIdx: colMap.member2NameIdx, emailIdx: colMap.member2EmailIdx, phoneIdx: colMap.member2PhoneIdx, collegeIdx: colMap.member2CollegeIdx, codeIdx: colMap.member2CodeIdx },
          { nameIdx: colMap.member3NameIdx, emailIdx: colMap.member3EmailIdx, phoneIdx: colMap.member3PhoneIdx, collegeIdx: colMap.member3CollegeIdx, codeIdx: colMap.member3CodeIdx },
        ];

        let slotIdx = 0;
        for (const slot of slots) {
          slotIdx++;
          if (slot.nameIdx !== -1) {
            const name = (r.fields[slot.nameIdx] || '').trim();
            if (name) {
              const email = slot.emailIdx !== -1 ? (r.fields[slot.emailIdx] || '').trim() || undefined : undefined;
              const phone = slot.phoneIdx !== -1 ? (r.fields[slot.phoneIdx] || '').trim() || undefined : undefined;
              const college = slot.collegeIdx !== -1 ? (r.fields[slot.collegeIdx] || '').trim() || rowCollege : rowCollege;
              let code = slot.codeIdx !== -1 ? (r.fields[slot.codeIdx] || '').trim() : '';
              let isGenerated = false;
              if (!code) {
                code = this.generateParticipantCode();
                isGenerated = true;
              }

              this.processParticipantRow({
                rowNumber: r.rowNumber,
                name,
                email,
                phone,
                college,
                participantCode: code,
                isCodeGenerated: isGenerated,
                seenCodesInCsv,
                dbParticipantByCode,
                dbParticipantByEmail,
                participantList,
                errors,
                warnings,
              });
            }
          }
        }
      }
    } else {
      // Standard format: ONE row = ONE independent participant
      for (const r of dataRows) {
        const name = (colMap.participantNameIdx !== -1 ? r.fields[colMap.participantNameIdx] || '' : '').trim();
        let code = (colMap.participantCodeIdx !== -1 ? r.fields[colMap.participantCodeIdx] || '' : '').trim();
        const email = colMap.emailIdx !== -1 ? (r.fields[colMap.emailIdx] || '').trim() || undefined : undefined;
        const phone = colMap.phoneIdx !== -1 ? (r.fields[colMap.phoneIdx] || '').trim() || undefined : undefined;
        const college = colMap.collegeIdx !== -1 ? (r.fields[colMap.collegeIdx] || '').trim() || undefined : undefined;
        const externalParticipantId = colMap.externalParticipantIdIdx !== -1 ? (r.fields[colMap.externalParticipantIdIdx] || '').trim() || undefined : undefined;

        // Skip completely blank rows
        if (!name && !code && !email && !college) {
          continue;
        }

        // Validate required individual identity fields
        if (!name) {
          errors.push({
            row: r.rowNumber,
            message: `Row ${r.rowNumber}: Participant Name is required.`,
          });
          continue;
        }

        let isGenerated = false;
        if (!code) {
          errors.push({
            row: r.rowNumber,
            participantName: name,
            message: `Row ${r.rowNumber}: Participant Code is required for "${name}".`,
          });
          continue;
        }

        this.processParticipantRow({
          rowNumber: r.rowNumber,
          name,
          email,
          phone,
          college,
          participantCode: code,
          isCodeGenerated: isGenerated,
          externalParticipantId,
          seenCodesInCsv,
          dbParticipantByCode,
          dbParticipantByEmail,
          participantList,
          errors,
          warnings,
        });
      }
    }

    if (participantList.length === 0 && errors.length === 0) {
      errors.push({ message: 'No valid participant records found in the provided CSV file.' });
      return this.emptyValidationResult(errors, warnings, eventStatus, isLocked);
    }

    const newParticipantsCount = participantList.filter((p) => p.status === 'NEW').length;
    const unchangedParticipantsCount = participantList.filter((p) => p.status === 'UNCHANGED').length;
    const updatedParticipantsCount = participantList.filter((p) => p.status === 'UPDATED').length;
    const conflictParticipantsCount = participantList.filter((p) => p.status === 'CONFLICT').length;
    const existingParticipantsCount = participantList.filter((p) => p.status !== 'NEW').length;

    const isValid = errors.length === 0;
    const canImport = isValid && !isLocked && participantList.length > 0;

    // Record audit log for validation
    if (adminUserId) {
      try {
        await adminRepository.recordAuditLog({
          adminUserId,
          action: 'PARTICIPANT_IMPORT_VALIDATED',
          targetType: 'REGISTRATION_IMPORT',
          targetId: 'csv_validation',
          metadata: {
            totalParticipants: participantList.length,
            valid: isValid,
          },
        });
      } catch (err) {
        // Non-blocking audit failure
      }
    }

    return {
      valid: isValid,
      canImport,
      registrationLocked: isLocked,
      eventStatus,
      stats: {
        totalRows: parsedRows.length,
        totalParticipants: participantList.length,
        totalTeams: 0, // Solo competition: no teams
        oneMemberTeams: participantList.length,
        twoMemberTeams: 0,
        threeMemberTeams: 0,
        newParticipants: newParticipantsCount,
        existingParticipants: existingParticipantsCount,
        unchangedParticipants: unchangedParticipantsCount,
        updatedParticipants: updatedParticipantsCount,
        conflictParticipants: conflictParticipantsCount,
        newTeams: 0,
        existingTeams: 0,
        unchangedTeams: 0,
        updatedTeams: 0,
        conflictTeams: 0,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
      participants: participantList,
      teams: [], // Canonical solo model: 0 teams
      errors,
      warnings,
    };
  }

  private processParticipantRow(params: {
    rowNumber: number;
    name: string;
    email?: string;
    phone?: string;
    college?: string;
    participantCode: string;
    isCodeGenerated: boolean;
    externalParticipantId?: string;
    seenCodesInCsv: Map<string, number>;
    dbParticipantByCode: Map<string, any>;
    dbParticipantByEmail: Map<string, any>;
    participantList: CsvParticipantRecord[];
    errors: Array<{ row?: number; participantName?: string; message: string }>;
    warnings: Array<{ row?: number; participantName?: string; message: string }>;
  }) {
    const {
      rowNumber,
      name,
      email,
      phone,
      college,
      participantCode,
      isCodeGenerated,
      externalParticipantId,
      seenCodesInCsv,
      dbParticipantByCode,
      dbParticipantByEmail,
      participantList,
      errors,
      warnings,
    } = params;

    const codeUpper = participantCode.trim().toUpperCase();

    // Intra-CSV conflict: duplicate participant code in same CSV
    if (seenCodesInCsv.has(codeUpper)) {
      const prevRow = seenCodesInCsv.get(codeUpper);
      errors.push({
        row: rowNumber,
        participantName: name,
        message: `Row ${rowNumber}: Duplicate participant access code "${codeUpper}" within the uploaded CSV (previously seen at row ${prevRow}).`,
      });
      return;
    }
    seenCodesInCsv.set(codeUpper, rowNumber);

    let status: 'NEW' | 'UNCHANGED' | 'UPDATED' | 'CONFLICT' = 'NEW';
    let existingParticipantId: string | undefined;

    // Check against DB by participantCode
    const existingByCode = dbParticipantByCode.get(codeUpper);
    if (existingByCode) {
      existingParticipantId = existingByCode.id;
      const isUnchanged =
        existingByCode.status === 'ACTIVE' &&
        existingByCode.name.trim().toLowerCase() === name.trim().toLowerCase() &&
        (existingByCode.email || '').trim().toLowerCase() === (email || '').trim().toLowerCase() &&
        (existingByCode.college || '').trim().toLowerCase() === (college || '').trim().toLowerCase();

      status = isUnchanged ? 'UNCHANGED' : 'UPDATED';
    } else if (email && dbParticipantByEmail.has(email.toLowerCase())) {
      const existingByEmail = dbParticipantByEmail.get(email.toLowerCase());
      existingParticipantId = existingByEmail.id;
      status = 'UPDATED';
      warnings.push({
        row: rowNumber,
        participantName: name,
        message: `Participant with email "${email}" already registered. Code will be updated to "${codeUpper}".`,
      });
    }

    participantList.push({
      rowNumber,
      name,
      email,
      phone,
      college,
      participantCode: codeUpper,
      isCodeGenerated,
      externalParticipantId,
      status,
      existingParticipantId,
      warnings: [],
      errors: [],
    });
  }

  /**
   * Phase 2: Confirm and atomically persist independent solo participants.
   * Zero teams or team rosters created.
   */
  public async confirmCsvImport(
    rawText: string,
    adminUser: { id: string; username: string }
  ): Promise<CsvImportConfirmationResult> {
    const validation = await this.validateCsvImport(rawText, adminUser.id);

    if (validation.registrationLocked) {
      throw new Error(`COMPETITION_ACTIVE_LOCKED: Cannot import participants while competition is ${validation.eventStatus}.`);
    }

    if (!validation.valid || validation.errors.length > 0) {
      throw new Error(`IMPORT_VALIDATION_FAILED: ${validation.errors.map((e) => e.message).join(' | ')}`);
    }

    let importedParticipantCount = 0;
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    await db.transaction(async (tx) => {
      // Re-check competition lock inside transaction
      const ev = await tx.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1);
      if (ev[0]?.status === 'RUNNING' || ev[0]?.status === 'PAUSED') {
        throw new Error('COMPETITION_ACTIVE_LOCKED: Event status transitioned to active during import.');
      }

      for (const p of validation.participants) {
        const cleanCode = p.participantCode.trim().toUpperCase();
        const existing = await tx
          .select()
          .from(participants)
          .where(
            sql`UPPER(TRIM(${participants.participantCode})) = ${cleanCode}`
          )
          .limit(1);

        if (existing.length > 0) {
          if (existing[0].status === 'ACTIVE' && p.status === 'UNCHANGED') {
            unchangedCount++;
          } else {
            await tx
              .update(participants)
              .set({
                name: p.name,
                email: p.email || null,
                phone: p.phone || null,
                college: p.college || null,
                externalParticipantId: p.externalParticipantId || null,
                status: 'ACTIVE',
                updatedAt: new Date(),
              })
              .where(eq(participants.id, existing[0].id));

            // Also re-activate associated team if one exists
            const memberRows = await tx
              .select({ teamId: teamMembers.teamId })
              .from(teamMembers)
              .where(eq(teamMembers.participantId, existing[0].id));
            if (memberRows.length > 0) {
              const teamIds = memberRows.map((r) => r.teamId);
              await tx
                .update(teams)
                .set({ status: 'ACTIVE', updatedAt: new Date() })
                .where(inArray(teams.id, teamIds));
            }
            updatedCount++;
          }
        } else {
          await tx.insert(participants).values({
            name: p.name,
            email: p.email || null,
            phone: p.phone || null,
            college: p.college || null,
            participantCode: cleanCode,
            externalParticipantId: p.externalParticipantId || null,
            status: 'ACTIVE',
          });
          newCount++;
        }
        importedParticipantCount++;
      }

      // Record audit log
      try {
        await tx.insert(auditLogs).values({
          adminUserId: adminUser.id,
          action: 'PARTICIPANT_IMPORT_CONFIRMED',
          targetType: 'REGISTRATION_IMPORT',
          targetId: 'participant_csv',
          reason: `Imported ${importedParticipantCount} solo competitors.`,
          metadata: {
            participantsImported: importedParticipantCount,
            teamsImported: 0,
            importedBy: adminUser.username,
          },
        });
      } catch (err) {
        console.warn('Audit log write warning:', err);
      }
    });

    return {
      success: true,
      message: `Successfully imported ${importedParticipantCount} independent participants.`,
      stats: {
        participantsImported: importedParticipantCount,
        teamsImported: 0,
        newParticipants: newCount,
        updatedParticipants: updatedCount,
        unchangedParticipants: unchangedCount,
        newTeams: 0,
        updatedTeams: 0,
        unchangedTeams: 0,
        oneMemberTeams: importedParticipantCount,
        twoMemberTeams: 0,
        threeMemberTeams: 0,
      },
      importedAt: new Date().toISOString(),
    };
  }

  private emptyValidationResult(
    errors: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>,
    warnings: Array<{ row?: number; participantName?: string; teamName?: string; message: string }>,
    eventStatus: string,
    isLocked: boolean
  ): CsvValidationResult {
    return {
      valid: false,
      canImport: false,
      registrationLocked: isLocked,
      eventStatus,
      stats: {
        totalRows: 0,
        totalParticipants: 0,
        totalTeams: 0,
        oneMemberTeams: 0,
        twoMemberTeams: 0,
        threeMemberTeams: 0,
        newParticipants: 0,
        existingParticipants: 0,
        unchangedParticipants: 0,
        updatedParticipants: 0,
        conflictParticipants: 0,
        newTeams: 0,
        existingTeams: 0,
        unchangedTeams: 0,
        updatedTeams: 0,
        conflictTeams: 0,
        errorCount: errors.length,
        warningCount: warnings.length,
      },
      participants: [],
      teams: [],
      errors,
      warnings,
    };
  }

  /**
   * Retrieves overall registration statistics for admin monitoring.
   */
  public async getRegistrationStats(): Promise<{
    registeredTeams: number;
    registeredParticipants: number;
    oneMemberTeams: number;
    twoMemberTeams: number;
    threeMemberTeams: number;
    registrationLocked: boolean;
    lastImportTime: string | null;
  }> {
    const [teamRows, participantRows, eventRow, lastImportLog] = await Promise.all([
      db.select({ val: count() }).from(teams).where(eq(teams.status, 'ACTIVE')),
      db.select({ val: count() }).from(participants).where(eq(participants.status, 'ACTIVE')),
      db.select().from(eventSettings).where(eq(eventSettings.id, 1)).limit(1),
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'PARTICIPANT_IMPORT_CONFIRMED'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1),
    ]);

    const registeredTeams = Number(teamRows[0]?.val || 0);
    const registeredParticipants = Number(participantRows[0]?.val || 0);
    const eventStatus = eventRow[0]?.status || 'NOT_STARTED';
    const registrationLocked = eventStatus === 'RUNNING' || eventStatus === 'PAUSED';

    let lastImportTime = lastImportLog[0]?.createdAt ? lastImportLog[0].createdAt.toISOString() : null;
    if (!lastImportTime) {
      const legacyImportLog = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'PARTICIPANTS_IMPORTED'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      lastImportTime = legacyImportLog[0]?.createdAt ? legacyImportLog[0].createdAt.toISOString() : null;
    }

    return {
      registeredTeams,
      registeredParticipants,
      oneMemberTeams: registeredParticipants,
      twoMemberTeams: 0,
      threeMemberTeams: 0,
      registrationLocked,
      lastImportTime,
    };
  }
}

export const csvImportService = new CsvImportService();

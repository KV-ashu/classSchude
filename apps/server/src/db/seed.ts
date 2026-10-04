import { DEFAULT_TIMEZONE } from '@classsync/shared';
import { hashPassword } from '../auth/password';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AuditLog, Course, RawMessage, ScheduleChange, TimetableEntry, User } from '../models/index';
import { appendAuditLog } from '../repositories/audit-log.repository';
import { createCourse } from '../repositories/course.repository';
import {
  createManyTimetableEntries,
  lockBaseline,
} from '../repositories/timetable-entry.repository';
import { connectDatabase, disconnectDatabase } from './connection';

export const DEMO_ACCOUNT = {
  email: 'demo@classsync.app',
  password: 'demo1234',
  displayName: 'Demo Student',
  college: 'Example Institute of Technology',
} as const;

/** Courses mirror the subjects used by the simulated WhatsApp messages. */
const DEMO_COURSES = [
  { code: 'DBMS', name: 'Database Management Systems', aliases: ['Database', 'DBS'], defaultRoom: 'A-101' },
  { code: 'OS', name: 'Operating Systems', aliases: ['Operating System'], defaultRoom: 'B-202' },
  { code: 'CN', name: 'Computer Networks', aliases: ['Networks'], defaultRoom: 'B-204' },
  { code: 'ML', name: 'Machine Learning', aliases: ['ML'], defaultRoom: 'C-301' },
  { code: 'MATHS3', name: 'Mathematics III', aliases: ['Maths 3', 'Math3'], defaultRoom: 'A-204' },
  { code: 'DM', name: 'Discrete Mathematics', aliases: ['Discrete Maths'], defaultRoom: 'A-205' },
  { code: 'CNA', name: 'Computer Networks Lab', aliases: ['CN Lab'], defaultRoom: 'LAB-1' },
] as const;

/** [isoWeekday (1 = Monday), courseCode, start, end, kind] */
const DEMO_TIMETABLE: readonly (readonly [number, string, string, string, 'LECTURE' | 'LAB'])[] = [
  [1, 'DBMS', '11:00', '11:50', 'LECTURE'],
  [1, 'OS', '13:00', '13:50', 'LECTURE'],
  [2, 'DBMS', '09:00', '09:50', 'LECTURE'],
  [2, 'CNA', '14:00', '16:00', 'LAB'],
  [3, 'OS', '11:00', '11:50', 'LECTURE'],
  [3, 'ML', '15:00', '15:50', 'LECTURE'],
  [4, 'DBMS', '11:00', '11:50', 'LECTURE'],
  [4, 'MATHS3', '13:00', '13:50', 'LECTURE'],
  [5, 'CN', '10:00', '10:50', 'LECTURE'],
  [5, 'DM', '15:00', '15:50', 'LECTURE'],
  [5, 'CNA', '13:00', '15:00', 'LAB'],
  [6, 'ML', '10:00', '11:00', 'LECTURE'],
];

export interface SeedSummary {
  email: string;
  password: string;
  courses: number;
  entries: number;
  lockedEntries: number;
  version: number;
}

/**
 * Creates (or recreates) the demo account with a realistic, locked baseline
 * timetable. Re-running is safe: the previous demo data is removed first.
 */
export async function seedDemoData(): Promise<SeedSummary> {
  const existing = await User.findOne({ email: DEMO_ACCOUNT.email });
  if (existing) {
    // A demo reset intentionally bypasses the baseline immutability guards -
    // this is the one place where locked/audited data is ever removed.
    await TimetableEntry.collection.deleteMany({ userId: existing._id });
    await ScheduleChange.collection.deleteMany({ userId: existing._id });
    await RawMessage.collection.deleteMany({ userId: existing._id });
    await AuditLog.collection.deleteMany({ userId: existing._id });
    await Course.collection.deleteMany({ userId: existing._id });
    await User.deleteOne({ _id: existing._id });
  }

  const user = await User.create({
    email: DEMO_ACCOUNT.email,
    passwordHash: await hashPassword(DEMO_ACCOUNT.password),
    displayName: DEMO_ACCOUNT.displayName,
    college: DEMO_ACCOUNT.college,
    timezone: DEFAULT_TIMEZONE,
  });

  for (const course of DEMO_COURSES) {
    await createCourse({
      userId: user._id,
      code: course.code,
      name: course.name,
      aliases: [...course.aliases],
      defaultRoom: course.defaultRoom,
    });
  }

  const courses = await Course.find({ userId: user._id });
  const courseIdByCode = new Map(courses.map((course) => [course.code, course]));

  const entries = await createManyTimetableEntries(
    DEMO_TIMETABLE.map(([dayOfWeek, code, startTime, endTime, kind]) => {
      const course = courseIdByCode.get(code);
      if (!course) {
        throw new Error(`Seed course '${code}' was not created`);
      }
      return {
        userId: user._id,
        courseId: course._id,
        dayOfWeek,
        startTime,
        endTime,
        room: course.defaultRoom,
        kind,
        baselineVersion: 1,
      };
    }),
  );

  const lockedEntries = await lockBaseline(user._id, 1);

  await appendAuditLog({
    userId: user._id,
    actor: 'SYSTEM',
    action: 'BASELINE_IMPORTED',
    reason: 'demo seed data',
  });
  await appendAuditLog({
    userId: user._id,
    actor: 'SYSTEM',
    action: 'BASELINE_LOCKED',
    reason: `locked ${lockedEntries} entries of baseline v1`,
  });

  return {
    email: DEMO_ACCOUNT.email,
    password: DEMO_ACCOUNT.password,
    courses: courses.length,
    entries: entries.length,
    lockedEntries,
    version: 1,
  };
}

/** CLI entry: `npm run seed` (only runs when this file is executed directly). */
const invokedDirectly = /(?:^|[\\/])seed\.(?:ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  void (async () => {
    try {
      await connectDatabase({ uri: env.MONGODB_URI });
      const summary = await seedDemoData();
      logger.info({ ...summary, password: '[redacted]' }, 'demo data seeded');
      // The credentials are the point of a demo seed - print them plainly.
      process.stdout.write(
        [
          '',
          '  ClassSync demo data is ready.',
          `    email:    ${summary.email}`,
          `    password: ${summary.password}`,
          `    courses:  ${summary.courses} · entries: ${summary.entries} (locked: ${summary.lockedEntries})`,
          '',
          '  Start the app with `npm run dev` and sign in at http://localhost:5173',
          '',
        ].join('\n'),
      );
      await disconnectDatabase();
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'seeding failed');
      process.exit(1);
    }
  })();
}
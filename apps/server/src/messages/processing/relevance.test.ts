import { describe, expect, it } from 'vitest';
import { matchCourse, type CourseHint } from './course-matching';
import { evaluateRelevance } from './relevance';

const COURSES: CourseHint[] = [
  { id: '1', code: 'DBMS', name: 'Database Systems', aliases: ['Database'] },
  { id: '2', code: 'OS', name: 'Operating Systems', aliases: ['Operating System'] },
];

describe('local relevance filter', () => {
  it('keeps clear cancellations, shifts, room changes and online notices', () => {
    const relevant = [
      'DBMS class cancelled today',
      'kal DBMS cancel hai',
      'DBMS lecture shifted to 2 PM today',
      'OS lab moved from B-202 to A-104',
      'DBMS room changed to C-301 for todays class',
      'tomorrow DBMS will be held online',
      'ML lab rescheduled to Saturday 10 AM',
    ];

    for (const text of relevant) {
      expect(evaluateRelevance(text, COURSES).relevant, text).toBe(true);
    }
  });

  it('discards ordinary chatter before any LLM call', () => {
    const chatter = [
      'Does anyone have the DSA notes?',
      'Library closes at 5 PM on Saturdays',
      'Please share the attendance sheet',
      'OS internal marks viva schedule is out',
      'Staff meeting at 3 PM today',
      'hmm interesting',
    ];

    for (const text of chatter) {
      expect(evaluateRelevance(text, COURSES).relevant, text).toBe(false);
    }
  });

  it('drops a message that names a course but states no change', () => {
    const result = evaluateRelevance('DBMS notes are on the portal', COURSES);

    expect(result.relevant).toBe(false);
    expect(result.reason).toContain('intent');
  });

  it('keeps hedged and self-contradicting messages for the LLM to judge', () => {
    expect(evaluateRelevance('I think DBMS is cancelled', COURSES).relevant).toBe(true);
    expect(
      evaluateRelevance('Please ignore previous msg, DBMS is NOT cancelled', COURSES).relevant,
    ).toBe(true);
  });
});

describe('course matching', () => {
  it('matches codes, names and aliases', () => {
    expect(matchCourse('DBMS class cancelled', COURSES)?.hint.code).toBe('DBMS');
    expect(matchCourse('database systems lecture cancelled', COURSES)?.hint.code).toBe('DBMS');
    expect(matchCourse('Database lab is cancelled', COURSES)?.hint.code).toBe('DBMS');
  });

  it('tolerates typos in codes and course names', () => {
    expect(matchCourse('DBS cancelled', COURSES)?.hint.code).toBe('DBMS');
    expect(matchCourse('Operatng Systems class cancelled', COURSES)?.hint.code).toBe('OS');
  });

  it('returns null for unknown subjects', () => {
    expect(matchCourse('Maths 3 postponed to Monday', COURSES)).toBeNull();
    expect(matchCourse('', COURSES)).toBeNull();
  });
});
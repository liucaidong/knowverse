/** Shared wire contract: data is validated at the boundary, not trusted by its TS annotation. */
export type Level = 'foundation' | 'architecture' | 'practice';
export interface LessonSummary {
  readonly id: string;
  readonly title: string;
  readonly level: Level;
  readonly minutes: number;
}
export interface LessonsResponse { readonly revision: 1; readonly lessons: readonly LessonSummary[]; }
const levels = new Set<Level>(['foundation', 'architecture', 'practice']);
export function isLessonSummary(value: unknown): value is LessonSummary {
  if (typeof value !== 'object' || value === null) return false;
  const x = value as Record<string, unknown>;
  return typeof x.id === 'string' && x.id.length > 0 && typeof x.title === 'string'
    && levels.has(x.level as Level) && typeof x.minutes === 'number'
    && Number.isInteger(x.minutes) && x.minutes > 0;
}
export function parseLessonsResponse(value: unknown): LessonsResponse {
  if (typeof value !== 'object' || value === null) throw new TypeError('Invalid response: object expected');
  const x = value as Record<string, unknown>;
  if (x.revision !== 1 || !Array.isArray(x.lessons) || !x.lessons.every(isLessonSummary)) {
    throw new TypeError('Invalid response: contract mismatch');
  }
  return x as unknown as LessonsResponse;
}

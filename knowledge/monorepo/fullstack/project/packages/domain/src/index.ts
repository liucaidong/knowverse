import type { LessonsResponse, LessonSummary } from '@kv/contracts';
export const lessons: readonly LessonSummary[] = [
  { id: 'promise', title: 'Promise 微任务与解析过程', level: 'foundation', minutes: 35 },
  { id: 'boundaries', title: 'Monorepo 边界与依赖图', level: 'architecture', minutes: 28 },
  { id: 'delivery', title: '工程质量和 CI 验收', level: 'practice', minutes: 42 },
];
export function getLessons(): LessonsResponse { return { revision: 1, lessons: lessons.map(x => ({ ...x })) }; }
export function totalMinutes(items: readonly LessonSummary[]): number {
  return items.reduce((sum, item) => sum + item.minutes, 0);
}

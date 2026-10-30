import { validScore, type StudyEvent } from '@knowverse/contracts';
export function completedAverage(events: readonly StudyEvent[]): number {
  const done = events.filter((event) => event.state === 'fulfilled' && validScore(event.score));
  return done.length ? done.reduce((sum, e) => sum + e.score, 0) / done.length : 0;
}
export function toBadge(average: number): 'review' | 'pass' | 'master' {
  return average >= 90 ? 'master' : average >= 60 ? 'pass' : 'review';
}

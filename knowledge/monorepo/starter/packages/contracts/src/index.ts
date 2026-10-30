export type LessonState = 'pending' | 'fulfilled' | 'rejected';
export interface StudyEvent { readonly lessonId: string; readonly state: LessonState; readonly score: number }
export const validScore = (score: number): boolean => Number.isFinite(score) && score >= 0 && score <= 100;

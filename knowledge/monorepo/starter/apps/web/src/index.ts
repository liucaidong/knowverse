import { toBadge } from '@knowverse/domain';
// In a React application, this function is called by a view adapter.
export const renderScoreLabel = (score: number): string => `Progress: ${toBadge(score)}`;

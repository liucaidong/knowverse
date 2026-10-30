import type { StudyEvent } from '@knowverse/contracts';
// The RN adapter imports platform-neutral contracts only, never Node-only APIs.
export function renderMobileEvent(event: StudyEvent): string { return `${event.lessonId}: ${event.state}`; }

import { completedAverage } from '@knowverse/domain';
const average = completedAverage([
 { lessonId: 'promise-01', state: 'fulfilled', score: 90 },
 { lessonId: 'promise-02', state: 'pending', score: 0 }
]);
console.log('api adapter demo: average =', average);

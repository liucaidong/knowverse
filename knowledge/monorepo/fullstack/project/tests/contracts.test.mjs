import test from 'node:test';
import assert from 'node:assert/strict';
import { getLessons, totalMinutes } from '../packages/domain/dist/index.js';
import { parseLessonsResponse } from '../packages/contracts/dist/index.js';
test('wire contract accepts real domain response',()=>{
 const data=parseLessonsResponse(getLessons());assert.equal(data.lessons.length,3);
 assert.equal(totalMinutes(data.lessons),105);
});
test('wire contract rejects missing and malformed data',()=>{
 for(const value of [null,{}, {revision:1,lessons:[{id:'x',title:'T',level:'oops',minutes:0}]}]){
  assert.throws(()=>parseLessonsResponse(value),TypeError);
 }
});
test('domain provides defensive copies',()=>{
 const a=getLessons(),b=getLessons();assert.notStrictEqual(a.lessons,b.lessons);
});

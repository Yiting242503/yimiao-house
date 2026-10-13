import test from 'node:test';
import assert from 'node:assert/strict';
import { initialMeetings } from '../shared/seed.js';
import { acquaintanceDays, reunionDays, countdown, shanghaiToday, validDate } from '../shared/dates.js';
test('all fourteen fictional example ranges yield exactly 48 unique inclusive calendar dates',()=>{
  assert.equal(initialMeetings.length,14);assert.equal(reunionDays(initialMeetings),48);
  assert.equal(initialMeetings[0].start,'2020-01-01');assert.equal(initialMeetings[13].end,'2021-02-02');
});
test('overlap is counted once, including across month and year boundaries',()=>{
  assert.equal(reunionDays([{start:'2025-12-30',end:'2026-01-02'},{start:'2026-01-01',end:'2026-01-04'}]),6);
  assert.equal(reunionDays([{start:'2024-02-28',end:'2024-03-01'}]),3);
});
test('acquaintance starts with day 1 and uses Shanghai calendar boundaries',()=>{
  assert.equal(acquaintanceDays('2020-01-01','2020-01-01'),1);
  assert.equal(acquaintanceDays('2020-01-01','2022-01-03'),734);
  assert.equal(shanghaiToday(new Date('2022-01-02T16:00:00Z')),'2022-01-03');
  assert.equal(shanghaiToday(new Date('2022-01-02T15:59:59Z')),'2022-01-02');
  assert.equal(acquaintanceDays(''),null);assert.equal(acquaintanceDays('2027-01-01','2022-01-03'),0);
});
test('countdown handles missing, arrival and past dates',()=>{
  assert.equal(countdown('','2022-01-03').days,null);
  assert.equal(countdown('2022-01-04','2022-01-03').days,1);
  assert.match(countdown('2022-01-03','2022-01-03').text,/今天/);
  assert.match(countdown('2022-01-02','2022-01-03').text,/期待下一次/);
  assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2024-02-29'),true);
});

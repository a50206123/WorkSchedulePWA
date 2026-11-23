import { test } from "node:test";
import assert from "node:assert/strict";
import { getDemoTasks, taipeiYmd, addDays } from "./mock-data.js";
import {
  clipTimedTaskToDay,
  layoutDaySegments,
  getAllDayTasksForDate,
  layoutAllDayWeek,
  getWeekYmds,
  getMonthWeeks,
  monIndexOfYmd,
  shiftTimedTaskDate,
  resizeTimedTaskDate,
  shiftAllDayTaskDate,
  formatTaskDateSummary,
} from "./dates.js";

const TODAY = "2026-11-23"; // Monday
const tasks = getDemoTasks(new Date(`${TODAY}T12:00:00+08:00`));
const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));

test("示範資料含今日三筆重疊時段與無日期任務", () => {
  assert.equal(taipeiYmd(new Date(`${TODAY}T12:00:00+08:00`)), TODAY);
  assert.ok(byId["demo-2"] && byId["demo-3"] && byId["demo-15"]);
  assert.equal(byId["demo-9"].date, null);
  assert.equal(byId["demo-5"].date.start, addDays(TODAY, 1));
  assert.equal(byId["demo-5"].date.end, addDays(TODAY, 2));
  assert.equal(byId["demo-5"].date.hasTime, false);
});

test("今日上午三筆任務分成 3 欄並標記重疊", () => {
  const segs = ["demo-2", "demo-15", "demo-3", "demo-4"]
    .map((id) => clipTimedTaskToDay(byId[id], TODAY))
    .filter(Boolean);
  const { items, overlapClusters } = layoutDaySegments(segs);
  const morning = items.filter((s) => s.task.id !== "demo-4");
  assert.equal(overlapClusters.length, 1);
  assert.equal(morning.length, 3);
  assert.equal(Math.max(...morning.map((s) => s.colCount)), 3);
  assert.ok(morning.every((s) => s.isOverlapping));
  const report = items.find((s) => s.task.id === "demo-4");
  assert.equal(report.colCount, 1);
  assert.equal(report.isOverlapping, false);
});

test("跨午夜任務在兩日正確裁切", () => {
  const today = clipTimedTaskToDay(byId["demo-14"], TODAY);
  const next = clipTimedTaskToDay(byId["demo-14"], addDays(TODAY, 1));
  assert.equal(today.startMin, 22 * 60);
  assert.equal(today.endMin, 24 * 60);
  assert.equal(today.continuesAfter, true);
  assert.equal(next.startMin, 0);
  assert.equal(next.endMin, 90);
  assert.equal(next.continuesBefore, true);
});

test("跨多日整天含結束日，週視圖跨兩欄，月視圖週一起始", () => {
  const t1 = addDays(TODAY, 1);
  const t2 = addDays(TODAY, 2);
  assert.ok(getAllDayTasksForDate(tasks, t1).some((t) => t.id === "demo-5"));
  assert.ok(getAllDayTasksForDate(tasks, t2).some((t) => t.id === "demo-5"));
  assert.ok(!getAllDayTasksForDate(tasks, TODAY).some((t) => t.id === "demo-5"));

  const week = getWeekYmds(TODAY);
  assert.equal(week[0], TODAY); // 2026-11-23 是週一
  const { bars } = layoutAllDayWeek(tasks, week);
  const site = bars.find((b) => b.task.id === "demo-5");
  assert.ok(site);
  assert.equal(site.span, 2);
  assert.equal(site.startCol, 1);

  const weeks = getMonthWeeks(TODAY);
  assert.ok(weeks.length >= 4);
  assert.equal(monIndexOfYmd(weeks[0][0].ymd), 0);
  assert.ok(weeks[0][0].ymd);
});

test("拖曳平移維持時長，縮放最短 15 分鐘，整天單日 end 為 null", () => {
  const moved = shiftTimedTaskDate(byId["demo-2"].date, 0, 30);
  assert.equal(moved.start, "2026-11-23T09:30:00+08:00");
  assert.equal(moved.end, "2026-11-23T11:30:00+08:00");

  const resized = resizeTimedTaskDate(byId["demo-2"].date, TODAY, 9 * 60 + 10);
  // start 09:00, new end snapped? function uses newEndMinutes; min duration 15 so 09:15
  assert.equal(resized.start, "2026-11-23T09:00:00+08:00");
  assert.ok(resized.end.endsWith("+08:00"));

  const allDay = shiftAllDayTaskDate({ start: TODAY, end: null, hasTime: false }, 1);
  assert.equal(allDay.start, addDays(TODAY, 1));
  assert.equal(allDay.end, null);
  assert.equal(allDay.hasTime, false);
});

test("日期摘要格式", () => {
  assert.equal(formatTaskDateSummary(null), "無日期");
  assert.match(formatTaskDateSummary(byId["demo-1"].date), /整天/);
  assert.match(formatTaskDateSummary(byId["demo-2"].date), /09:00/);
});

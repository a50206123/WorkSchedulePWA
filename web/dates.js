/**
 * 日期、台北時區（Asia/Taipei）、時間軸裁切與重疊分欄演算法
 * 原則：
 * - 日期-only（YYYY-MM-DD）絕不經本機時區換算，一律使用純日曆 UTC 運算。
 * - 有時間區間一律以 Asia/Taipei（+08:00）解析與輸出。
 */

export const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
export const WEEKDAY_MON_FIRST = ["一", "二", "三", "四", "五", "六", "日"];
export const DEFAULT_TIMED_DURATION_MIN = 60;
export const MIN_TIMED_DURATION_MIN = 15;
export const SNAP_MINUTES = 15;

const taipeiFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function getTaipeiParts(date = new Date()) {
  const parts = {};
  for (const p of taipeiFormatter.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

export function getTaipeiTodayYmd(now = new Date()) {
  const p = getTaipeiParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function getTaipeiNowMinutes(now = new Date()) {
  const p = getTaipeiParts(now);
  return Number(p.hour) * 60 + Number(p.minute);
}

export function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

export function formatYmd(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDaysYmd(ymd, days) {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addMonthsYmd(ymd, deltaMonths) {
  const { y, m, d } = parseYmd(ymd);
  const targetFirst = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const ty = targetFirst.getUTCFullYear();
  const tm = targetFirst.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return formatYmd(ty, tm, Math.min(d, maxDay));
}

export function diffDaysYmd(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d);
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d);
  return Math.round((tb - ta) / 86400000);
}

export function compareYmd(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 回傳 0=週日 .. 6=週六 */
export function weekdayOfYmd(ymd) {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 回傳 0=週一 .. 6=週日 */
export function monIndexOfYmd(ymd) {
  const wd = weekdayOfYmd(ymd);
  return wd === 0 ? 6 : wd - 1;
}

export function startOfWeekMon(ymd) {
  return addDaysYmd(ymd, -monIndexOfYmd(ymd));
}

export function getWeekYmds(ymd) {
  const mon = startOfWeekMon(ymd);
  const out = [];
  for (let i = 0; i < 7; i++) {
    out.push(addDaysYmd(mon, i));
  }
  return out;
}

/**
 * 產生月視圖的週陣列，每週週一起始，包含前後月份補齊格。
 */
export function getMonthWeeks(ymd) {
  const { y, m } = parseYmd(ymd);
  const firstDay = formatYmd(y, m, 1);
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = formatYmd(y, m, lastDayNum);

  const gridStart = startOfWeekMon(firstDay);
  const gridEndMon = startOfWeekMon(lastDay);
  const gridEnd = addDaysYmd(gridEndMon, 6);

  const weeks = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const cur = addDaysYmd(cursor, i);
      const parsed = parseYmd(cur);
      days.push({
        ymd: cur,
        dayNum: parsed.d,
        inMonth: parsed.y === y && parsed.m === m,
      });
    }
    weeks.push(days);
    cursor = addDaysYmd(cursor, 7);
  }
  return weeks;
}

/** 將台北 YYYY-MM-DD 與 HH:MM 轉為帶 +08:00 的 ISO 字串 */
export function formatTaipeiIso(ymd, hm) {
  const [h, m] = hm.split(":").map((v) => String(Number(v)).padStart(2, "0"));
  return `${ymd}T${h}:${m}:00+08:00`;
}

/** 將時間戳轉為台北 ISO 字串（+08:00） */
export function msToTaipeiIso(ms) {
  const p = getTaipeiParts(new Date(ms));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00+08:00`;
}

/** 將任意 ISO 時間字串轉為台北 { ymd, hm, hour, minute, ms } */
export function parseTaipeiDateTime(iso) {
  if (!iso) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+08:00` : iso;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  const p = getTaipeiParts(d);
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hm: `${p.hour}:${p.minute}`,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    ms: d.getTime(),
  };
}

/** 某台北日的 00:00:00+08:00 時間戳 */
export function taipeiDayStartMs(ymd) {
  return new Date(`${ymd}T00:00:00+08:00`).getTime();
}

export function minutesToHm(totalMin) {
  const clamped = Math.max(0, Math.min(1440, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hmToMinutes(hm) {
  if (!hm || !hm.includes(":")) return 0;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function snapMinutes(mins, step = SNAP_MINUTES) {
  return Math.round(mins / step) * step;
}

/**
 * 將有時間的任務裁切至單一台北日 [0, 1440] 分鐘。
 * 若該日無交集回傳 null。
 */
export function clipTimedTaskToDay(task, dayYmd) {
  if (!task || !task.date || !task.date.hasTime || !task.date.start) return null;
  const startInfo = parseTaipeiDateTime(task.date.start);
  if (!startInfo) return null;

  const hasExplicitEnd = Boolean(task.date.end);
  let endMs;
  if (hasExplicitEnd) {
    const endInfo = parseTaipeiDateTime(task.date.end);
    endMs = endInfo ? endInfo.ms : startInfo.ms + DEFAULT_TIMED_DURATION_MIN * 60000;
    if (endMs <= startInfo.ms) {
      endMs = startInfo.ms + MIN_TIMED_DURATION_MIN * 60000;
    }
  } else {
    endMs = startInfo.ms + DEFAULT_TIMED_DURATION_MIN * 60000;
  }

  const dayStartMs = taipeiDayStartMs(dayYmd);
  const dayEndMs = dayStartMs + 86400000;

  if (endMs <= dayStartMs || startInfo.ms >= dayEndMs) return null;

  const clippedStartMs = Math.max(startInfo.ms, dayStartMs);
  const clippedEndMs = Math.min(endMs, dayEndMs);

  const startMin = (clippedStartMs - dayStartMs) / 60000;
  const endMin = (clippedEndMs - dayStartMs) / 60000;

  return {
    task,
    dayYmd,
    startMin,
    endMin,
    continuesBefore: startInfo.ms < dayStartMs,
    continuesAfter: endMs > dayEndMs,
    hasExplicitEnd,
    originalStartMs: startInfo.ms,
    originalEndMs: endMs,
  };
}

/**
 * 單日有時間區段的重疊分欄演算法：
 * 1. 依開始時間排序
 * 2. 以掃描線分成重疊叢集（連通分量）
 * 3. 叢集內貪婪分配欄位
 * 4. 計算 colIndex / colCount 與 isOverlapping
 */
export function layoutDaySegments(rawSegments) {
  if (!rawSegments || rawSegments.length === 0) {
    return { items: [], overlapClusters: [] };
  }

  const sorted = [...rawSegments].sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    const durA = a.endMin - a.startMin;
    const durB = b.endMin - b.startMin;
    if (durA !== durB) return durB - durA;
    return String(a.task.id).localeCompare(String(b.task.id));
  });

  // 步驟 2：掃描線分成重疊叢集
  const clusters = [];
  let current = [];
  let clusterMaxEnd = -1;

  for (const seg of sorted) {
    if (current.length === 0) {
      current = [seg];
      clusterMaxEnd = seg.endMin;
    } else if (seg.startMin < clusterMaxEnd) {
      current.push(seg);
      if (seg.endMin > clusterMaxEnd) clusterMaxEnd = seg.endMin;
    } else {
      clusters.push(current);
      current = [seg];
      clusterMaxEnd = seg.endMin;
    }
  }
  if (current.length > 0) clusters.push(current);

  const items = [];
  const overlapClusters = [];

  // 步驟 3 & 4：叢集內貪婪分配欄位
  for (const cluster of clusters) {
    const colEnds = [];
    const placed = [];

    for (const seg of cluster) {
      let colIndex = -1;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= seg.startMin) {
          colIndex = i;
          break;
        }
      }
      if (colIndex === -1) {
        colIndex = colEnds.length;
        colEnds.push(seg.endMin);
      } else {
        colEnds[colIndex] = seg.endMin;
      }
      placed.push({ ...seg, colIndex });
    }

    const colCount = colEnds.length;
    const clusterHasOverlap = cluster.length > 1;

    for (const seg of placed) {
      const isOverlapping =
        clusterHasOverlap &&
        placed.some(
          (other) =>
            other !== seg &&
            seg.startMin < other.endMin &&
            other.startMin < seg.endMin
        );
      items.push({
        ...seg,
        colCount,
        isOverlapping,
      });
    }

    if (clusterHasOverlap) {
      const startMin = Math.min(...cluster.map((s) => s.startMin));
      const endMin = Math.max(...cluster.map((s) => s.endMin));
      overlapClusters.push({
        dayYmd: cluster[0].dayYmd,
        startMin,
        endMin,
        segments: placed,
      });
    }
  }

  return { items, overlapClusters };
}

/** 判斷整天任務是否涵蓋特定日期（Notion 結束日為包含） */
export function isAllDayOnDate(task, dayYmd) {
  if (!task || !task.date || task.date.hasTime || !task.date.start) return false;
  const start = task.date.start.slice(0, 10);
  const end = task.date.end ? task.date.end.slice(0, 10) : start;
  return start <= dayYmd && dayYmd <= end;
}

/** 取得單日的所有整天任務 */
export function getAllDayTasksForDate(tasks, dayYmd) {
  return tasks
    .filter((t) => isAllDayOnDate(t, dayYmd))
    .sort((a, b) => {
      const sa = a.date.start.slice(0, 10);
      const sb = b.date.start.slice(0, 10);
      if (sa !== sb) return sa < sb ? -1 : 1;
      const ea = (a.date.end || a.date.start).slice(0, 10);
      const eb = (b.date.end || b.date.start).slice(0, 10);
      const spanDiff = diffDaysYmd(sb, eb) - diffDaysYmd(sa, ea);
      if (spanDiff !== 0) return spanDiff;
      return (a.title || "").localeCompare(b.title || "", "zh-Hant");
    });
}

/**
 * 計算一週（7 天 ymds）內的整天跨日橫條配置（lane 壓縮排列）。
 * 回傳 { bars: [{ task, startCol, endCol, span, lane, continuesLeft, continuesRight }], laneCount }
 */
export function layoutAllDayWeek(tasks, weekYmds) {
  if (!weekYmds || weekYmds.length === 0) return { bars: [], laneCount: 0 };
  const firstYmd = weekYmds[0];
  const lastYmd = weekYmds[weekYmds.length - 1];

  const raw = [];
  for (const task of tasks) {
    if (!task.date || task.date.hasTime || !task.date.start) continue;
    const tStart = task.date.start.slice(0, 10);
    const tEnd = task.date.end ? task.date.end.slice(0, 10) : tStart;
    if (tEnd < firstYmd || tStart > lastYmd) continue;

    const clippedStart = tStart < firstYmd ? firstYmd : tStart;
    const clippedEnd = tEnd > lastYmd ? lastYmd : tEnd;
    const startCol = diffDaysYmd(firstYmd, clippedStart);
    const endCol = diffDaysYmd(firstYmd, clippedEnd);

    raw.push({
      task,
      startCol,
      endCol,
      span: endCol - startCol + 1,
      continuesLeft: tStart < firstYmd,
      continuesRight: tEnd > lastYmd,
    });
  }

  raw.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    if (a.span !== b.span) return b.span - a.span;
    return (a.task.title || "").localeCompare(b.task.title || "", "zh-Hant");
  });

  const lanes = [];
  const bars = [];

  for (const bar of raw) {
    let laneIndex = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] < bar.startCol) {
        laneIndex = i;
        break;
      }
    }
    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(bar.endCol);
    } else {
      lanes[laneIndex] = bar.endCol;
    }
    bars.push({ ...bar, lane: laneIndex });
  }

  return { bars, laneCount: lanes.length };
}

/** 移動有時間任務（維持原時長），支援同時移動天數與分鐘數 */
export function shiftTimedTaskDate(dateObj, deltaDays, deltaMinutes) {
  const startInfo = parseTaipeiDateTime(dateObj.start);
  if (!startInfo) return dateObj;
  const shiftMs = (deltaDays * 1440 + deltaMinutes) * 60000;
  const newStartMs = startInfo.ms + shiftMs;

  if (dateObj.end) {
    const endInfo = parseTaipeiDateTime(dateObj.end);
    const durMs = endInfo && endInfo.ms > startInfo.ms
      ? endInfo.ms - startInfo.ms
      : DEFAULT_TIMED_DURATION_MIN * 60000;
    return {
      start: msToTaipeiIso(newStartMs),
      end: msToTaipeiIso(newStartMs + durMs),
      hasTime: true,
    };
  }

  return {
    start: msToTaipeiIso(newStartMs),
    end: null,
    hasTime: true,
  };
}

/** 調整有時間任務的結束時間（最短 15 分鐘） */
export function resizeTimedTaskDate(dateObj, dayYmd, newEndMinutes) {
  const startInfo = parseTaipeiDateTime(dateObj.start);
  if (!startInfo) return dateObj;
  const dayStartMs = taipeiDayStartMs(dayYmd);
  const minEndMs = startInfo.ms + MIN_TIMED_DURATION_MIN * 60000;
  const targetEndMs = Math.max(minEndMs, dayStartMs + newEndMinutes * 60000);
  return {
    start: msToTaipeiIso(startInfo.ms),
    end: msToTaipeiIso(targetEndMs),
    hasTime: true,
  };
}

/** 移動整天任務的天數（單日維持 end: null） */
export function shiftAllDayTaskDate(dateObj, deltaDays) {
  if (!dateObj || !dateObj.start) return dateObj;
  const newStart = addDaysYmd(dateObj.start.slice(0, 10), deltaDays);
  let newEnd = null;
  if (dateObj.end) {
    const candidate = addDaysYmd(dateObj.end.slice(0, 10), deltaDays);
    newEnd = candidate !== newStart ? candidate : null;
  }
  return {
    start: newStart,
    end: newEnd,
    hasTime: false,
  };
}

/** 畫面顯示格式 */
export function formatDayHeading(ymd) {
  const { y, m, d } = parseYmd(ymd);
  const wd = WEEKDAY_ZH[weekdayOfYmd(ymd)];
  return `${y}年${m}月${d}日（${wd}）`;
}

export function formatShortMd(ymd) {
  const { m, d } = parseYmd(ymd);
  return `${m}/${d}`;
}

export function formatShortMdWd(ymd) {
  const { m, d } = parseYmd(ymd);
  const wd = WEEKDAY_ZH[weekdayOfYmd(ymd)];
  return `${m}/${d}（${wd}）`;
}

export function formatWeekHeading(weekYmds) {
  const first = parseYmd(weekYmds[0]);
  const last = parseYmd(weekYmds[6]);
  if (first.y !== last.y) {
    return `${first.y}年${first.m}月${first.d}日–${last.y}年${last.m}月${last.d}日`;
  }
  return `${first.y}年${first.m}月${first.d}日–${last.m}月${last.d}日`;
}

export function formatMonthHeading(ymd) {
  const { y, m } = parseYmd(ymd);
  return `${y}年${m}月`;
}

export function formatSegmentTimeLabel(seg) {
  const startHm = seg.continuesBefore ? "00:00" : minutesToHm(seg.startMin);
  const endHm = seg.continuesAfter ? "24:00" : minutesToHm(seg.endMin);
  if (!seg.hasExplicitEnd && !seg.continuesBefore && !seg.continuesAfter) {
    return startHm;
  }
  return `${startHm}–${endHm}`;
}

export function formatTaskDateSummary(dateObj) {
  if (!dateObj || !dateObj.start) return "無日期";
  if (!dateObj.hasTime) {
    const start = dateObj.start.slice(0, 10);
    const end = dateObj.end ? dateObj.end.slice(0, 10) : null;
    if (end && end !== start) {
      return `${formatShortMd(start)}–${formatShortMd(end)} 整天`;
    }
    return `${formatShortMd(start)} 整天`;
  }
  const s = parseTaipeiDateTime(dateObj.start);
  if (!s) return "無日期";
  if (!dateObj.end) {
    return `${formatShortMd(s.ymd)} ${s.hm}`;
  }
  const e = parseTaipeiDateTime(dateObj.end);
  if (!e) return `${formatShortMd(s.ymd)} ${s.hm}`;
  if (s.ymd === e.ymd) {
    return `${formatShortMd(s.ymd)} ${s.hm}–${e.hm}`;
  }
  return `${formatShortMd(s.ymd)} ${s.hm} – ${formatShortMd(e.ymd)} ${e.hm}`;
}

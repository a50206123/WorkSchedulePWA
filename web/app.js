import { createDemoStore } from "./mock-data.js";
import {
  WEEKDAY_MON_FIRST,
  SNAP_MINUTES,
  MIN_TIMED_DURATION_MIN,
  getTaipeiTodayYmd,
  getTaipeiNowMinutes,
  addDaysYmd,
  addMonthsYmd,
  getWeekYmds,
  getMonthWeeks,
  formatTaipeiIso,
  parseTaipeiDateTime,
  minutesToHm,
  snapMinutes,
  clipTimedTaskToDay,
  layoutDaySegments,
  getAllDayTasksForDate,
  layoutAllDayWeek,
  shiftTimedTaskDate,
  resizeTimedTaskDate,
  shiftAllDayTaskDate,
  formatDayHeading,
  formatWeekHeading,
  formatMonthHeading,
  formatShortMd,
  formatShortMdWd,
  formatSegmentTimeLabel,
  formatTaskDateSummary,
  parseYmd,
} from "./dates.js";

/* ===== 儲存鍵與常數 ===== */
const STORAGE = {
  workerUrl: "np.workerUrl",
  appKey: "np.appKey",
  demoMode: "np.demoMode",
  mainView: "np.mainView",
  range: "np.range",
  groupBy: "np.groupBy",
};

const HOUR_HEIGHT = 52;
const STATUS_ORDER = ["事件", "待辦", "等待中", "進行中", "完成"];
const STATUS_COLORS = {
  事件: "#dc2626",
  待辦: "#57534e",
  等待中: "#7c3aed",
  進行中: "#2563eb",
  完成: "#16a34a",
};
const NOTION_COLOR_MAP = {
  red: "#dc2626",
  default: "#57534e",
  gray: "#57534e",
  purple: "#7c3aed",
  blue: "#2563eb",
  green: "#16a34a",
  orange: "#d97706",
  yellow: "#ca8a04",
  pink: "#db2777",
  brown: "#92400e",
};

/* ===== 狀態 ===== */
const demoStore = createDemoStore();

const state = {
  demoMode: initDemoMode(),
  workerUrl: cleanUrl(localStorage.getItem(STORAGE.workerUrl) || ""),
  appKey: localStorage.getItem(STORAGE.appKey) || "",
  mainView: readEnum(STORAGE.mainView, ["timeline", "list", "settings"], "timeline"),
  range: readEnum(STORAGE.range, ["day", "week", "month"], "day"),
  groupBy: readEnum(STORAGE.groupBy, ["status", "case"], "status"),
  focusDate: getTaipeiTodayYmd(),

  schema: null,
  tasks: [],
  loading: false,
  error: null,
  needsSetup: false,

  filters: {
    search: "",
    statuses: new Set(),
    caseFilter: "__all__",
    dateFilter: "all", // all | dated | undated
  },

  modal: {
    open: false,
    mode: "create", // create | edit
    taskId: null,
    saving: false,
    confirmArchive: false,
  },

  daySheetYmd: null,
  connTest: null, // { loading, ok, message, details }
  shouldAutoScroll: true,
};

let activeDrag = null;
let suppressClickUntil = 0;

/* ===== DOM 參考 ===== */
const $main = document.getElementById("app-main");
const $demoBadge = document.getElementById("demo-badge");
const $btnRefresh = document.getElementById("btn-refresh");
const $navTabs = [...document.querySelectorAll(".nav-tab")];

// 任務表單 DOM
const $taskModal = document.getElementById("task-modal");
const $modalTitle = document.getElementById("modal-title");
const $modalClose = document.getElementById("modal-close");
const $taskForm = document.getElementById("task-form");
const $formError = document.getElementById("form-error");
const $fTitle = document.getElementById("f-title");
const $fStatus = document.getElementById("f-status");
const $fCase = document.getElementById("f-case");
const $fAllDay = document.getElementById("f-allday");
const $fStartDate = document.getElementById("f-start-date");
const $fStartTime = document.getElementById("f-start-time");
const $fEndDate = document.getElementById("f-end-date");
const $fEndTime = document.getElementById("f-end-time");
const $wrapStartTime = document.getElementById("wrap-start-time");
const $wrapEndTime = document.getElementById("wrap-end-time");
const $btnClearDate = document.getElementById("btn-clear-date");
const $modalEditActions = document.getElementById("modal-edit-actions");
const $linkNotion = document.getElementById("link-notion");
const $btnArchive = document.getElementById("btn-archive");
const $archiveConfirmBar = document.getElementById("archive-confirm-bar");
const $btnArchiveCancel = document.getElementById("btn-archive-cancel");
const $btnArchiveConfirm = document.getElementById("btn-archive-confirm");
const $btnCancel = document.getElementById("btn-cancel");
const $btnSave = document.getElementById("btn-save");

// 當日清單彈窗 DOM
const $daySheet = document.getElementById("day-sheet");
const $daySheetTitle = document.getElementById("day-sheet-title");
const $daySheetBody = document.getElementById("day-sheet-body");
const $daySheetClose = document.getElementById("day-sheet-close");
const $daySheetAdd = document.getElementById("day-sheet-add");
const $daySheetGoto = document.getElementById("day-sheet-goto");

const $dragTooltip = document.getElementById("drag-tooltip");
const $toastRoot = document.getElementById("toast-root");

/* ===== 工具函式 ===== */
function initDemoMode() {
  const raw = localStorage.getItem(STORAGE.demoMode);
  if (raw === null) {
    localStorage.setItem(STORAGE.demoMode, "1");
    return true;
  }
  return raw === "1";
}

function readEnum(key, allowed, fallback) {
  const val = localStorage.getItem(key);
  return allowed.includes(val) ? val : fallback;
}

function cleanUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function caseSuffix(task) {
  return task && task.caseTitle ? `<span class="title-case">${escapeHtml(task.caseTitle)}</span>` : "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function getStatusColor(statusName, statusColor) {
  if (statusName && STATUS_COLORS[statusName]) return STATUS_COLORS[statusName];
  if (statusColor && NOTION_COLOR_MAP[statusColor]) return NOTION_COLOR_MAP[statusColor];
  return "#57534e";
}

function getOrderedStatusNames() {
  const fromSchema = state.schema?.properties?.["任務狀態"]?.options?.map((o) => o.name) || [];
  const fromTasks = state.tasks.map((t) => t.status).filter(Boolean);
  const all = new Set([...STATUS_ORDER, ...fromSchema, ...fromTasks]);
  const ordered = [];
  for (const name of STATUS_ORDER) {
    if (all.has(name)) {
      ordered.push(name);
      all.delete(name);
    }
  }
  for (const rest of all) ordered.push(rest);
  return ordered;
}

function getSchemaCases() {
  return state.schema?.cases || [];
}

function showToast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "toast-error" : type === "success" ? "toast-success" : ""}`;
  el.textContent = message;
  $toastRoot.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3600);
}

/* ===== API 客戶端（真實模式與示範模式） ===== */
function formatApiError(err, status) {
  if (err && err.friendlyMessage) return err.friendlyMessage;
  if (status === 401) return "驗證失敗（401）：請檢查設定頁的 App Key 是否正確。";
  if (status === 403) return "存取被拒（403）：Worker 的 ALLOWED_ORIGIN 可能尚未包含目前網站網址。";
  if (status === 404) return "找不到 API 端點（404）：請檢查 Worker 網址是否正確。";
  if (status >= 500) return `伺服器發生錯誤（${status}）：請確認 Worker 環境變數與 Notion 權限。`;
  if (err instanceof TypeError) {
    return "無法連線至 Worker：請檢查網址是否正確、網路是否正常，以及 CORS（ALLOWED_ORIGIN）設定。";
  }
  return err?.message || "發生未知錯誤，請稍後再試。";
}

function createRemoteClient(workerUrl, appKey) {
  const base = cleanUrl(workerUrl);

  async function request(path, method = "GET", body) {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-App-Key": appKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const wrapped = new Error(formatApiError(err));
      wrapped.friendlyMessage = formatApiError(err);
      throw wrapped;
    }

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }

    if (!res.ok) {
      const msg = data.error || formatApiError(null, res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.friendlyMessage = msg;
      throw err;
    }
    return data;
  }

  return {
    health: () => request("/health", "GET"),
    getSchema: () => request("/schema", "GET"),
    query: () => request("/query", "POST", {}),
    create: (body) => request("/tasks", "POST", body),
    update: (id, body) => request(`/tasks/${encodeURIComponent(id)}`, "PATCH", body),
    archive: (id) => request(`/tasks/${encodeURIComponent(id)}`, "DELETE"),
  };
}

function getClient() {
  if (state.demoMode) return demoStore;
  return createRemoteClient(state.workerUrl, state.appKey);
}

async function loadData({ silent = false } = {}) {
  if (!state.demoMode && (!state.workerUrl || !state.appKey)) {
    state.needsSetup = true;
    state.loading = false;
    state.error = null;
    state.tasks = [];
    state.schema = null;
    render();
    return;
  }

  state.needsSetup = false;
  if (!silent) {
    state.loading = true;
    state.error = null;
    render();
  }
  $btnRefresh.classList.add("is-spinning");

  try {
    const client = getClient();
    const [schema, queryRes] = await Promise.all([client.getSchema(), client.query()]);
    state.schema = schema;
    state.tasks = (queryRes.tasks || []).filter((t) => !t.archived);
    state.error = null;
  } catch (err) {
    state.error = formatApiError(err, err.status);
  } finally {
    state.loading = false;
    $btnRefresh.classList.remove("is-spinning");
    render();
  }
}

/* ===== 頂欄與切換 ===== */
function syncTopbar() {
  $demoBadge.hidden = !state.demoMode;
  for (const tab of $navTabs) {
    const active = tab.dataset.nav === state.mainView;
    tab.classList.toggle("is-active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
}

function setMainView(view) {
  state.mainView = view;
  if (view === "timeline" || view === "list") {
    localStorage.setItem(STORAGE.mainView, view);
  }
  if (view === "timeline") state.shouldAutoScroll = true;
  render();
}

function setRange(range) {
  state.range = range;
  localStorage.setItem(STORAGE.range, range);
  state.shouldAutoScroll = true;
  render();
}

function setGroupBy(groupBy) {
  state.groupBy = groupBy;
  localStorage.setItem(STORAGE.groupBy, groupBy);
  render();
}

function stepPeriod(dir) {
  if (state.range === "day") {
    state.focusDate = addDaysYmd(state.focusDate, dir);
  } else if (state.range === "week") {
    state.focusDate = addDaysYmd(state.focusDate, dir * 7);
  } else {
    state.focusDate = addMonthsYmd(state.focusDate, dir);
  }
  state.shouldAutoScroll = false;
  render();
}

function jumpToday() {
  state.focusDate = getTaipeiTodayYmd();
  state.shouldAutoScroll = true;
  render();
}

/* ===== 主渲染入口 ===== */
function render() {
  syncTopbar();

  if (state.mainView === "settings") {
    renderSettingsView();
    return;
  }

  if (state.needsSetup) {
    renderSetupGuide();
    return;
  }

  if (state.loading && !state.schema) {
    $main.innerHTML = `
      <div class="state-card">
        <div class="spinner" aria-hidden="true"></div>
        <h2>正在載入任務資料…</h2>
        <p>正在同步任務結構與排程清單，請稍候。</p>
      </div>
    `;
    return;
  }

  if (state.error && !state.schema) {
    $main.innerHTML = `
      <div class="state-card">
        <h2>無法載入資料</h2>
        <p>${escapeHtml(state.error)}</p>
        <div class="state-actions">
          <button type="button" class="btn btn-primary" data-action="retry-load">重新嘗試</button>
          <button type="button" class="btn btn-ghost" data-action="go-settings">前往設定</button>
        </div>
      </div>
    `;
    return;
  }

  if (state.mainView === "timeline") {
    renderTimelineView();
  } else {
    renderListView();
  }
}

function renderSetupGuide() {
  $main.innerHTML = `
    <div class="state-card">
      <h2>尚未完成連線設定</h2>
      <p>目前已關閉示範模式，請先到設定頁填入 Cloudflare Worker 網址與 App Key，或切回示範模式體驗介面。</p>
      <div class="state-actions">
        <button type="button" class="btn btn-primary" data-action="go-settings">前往設定連線</button>
        <button type="button" class="btn btn-ghost" data-action="enable-demo">啟用示範模式</button>
      </div>
    </div>
  `;
}

/* ===== 1. 時間軸視圖 ===== */
function renderTimelineView() {
  const datedTasks = state.tasks.filter((t) => t.date && t.date.start);
  const weekYmds = getWeekYmds(state.focusDate);
  let heading = "";
  if (state.range === "day") heading = formatDayHeading(state.focusDate);
  else if (state.range === "week") heading = formatWeekHeading(weekYmds);
  else heading = formatMonthHeading(state.focusDate);

  const errorInline = state.error
    ? `<div class="inline-alert inline-alert-error">同步提示：${escapeHtml(state.error)} <button type="button" class="text-btn" data-action="retry-load">重試</button></div>`
    : "";

  let bodyHtml = "";
  if (state.range === "day") {
    bodyHtml = buildDayViewHtml(datedTasks, state.focusDate);
  } else if (state.range === "week") {
    bodyHtml = buildWeekViewHtml(datedTasks, weekYmds);
  } else {
    bodyHtml = buildMonthViewHtml(datedTasks, state.focusDate);
  }

  $main.innerHTML = `
    <section class="timeline-section">
      ${errorInline}
      <div class="timeline-toolbar">
        <div class="toolbar-group">
          <div class="segmented" role="tablist" aria-label="時間範圍">
            <button type="button" class="seg-btn ${state.range === "day" ? "is-active" : ""}" data-range="day">日</button>
            <button type="button" class="seg-btn ${state.range === "week" ? "is-active" : ""}" data-range="week">週</button>
            <button type="button" class="seg-btn ${state.range === "month" ? "is-active" : ""}" data-range="month">月</button>
          </div>
          <div class="nav-cluster">
            <button type="button" data-action="prev-period" aria-label="上一期">上一期</button>
            <button type="button" data-action="today">今天</button>
            <button type="button" data-action="next-period" aria-label="下一期">下一期</button>
          </div>
        </div>

        <h2 class="range-heading tabular">${escapeHtml(heading)}</h2>

        <div class="toolbar-group">
          <button type="button" class="btn btn-primary" data-action="new-task-timeline">＋ 新增任務</button>
        </div>
      </div>

      ${bodyHtml}
    </section>
  `;

  if (state.shouldAutoScroll && (state.range === "day" || state.range === "week")) {
    autoScrollTimeline(datedTasks);
    state.shouldAutoScroll = false;
  }
}

function autoScrollTimeline(datedTasks) {
  const scroller = $main.querySelector(".time-scroll");
  if (!scroller) return;
  const targetDays = state.range === "day" ? [state.focusDate] : getWeekYmds(state.focusDate);
  let earliestMin = 7 * 60; // 預設 07:00
  for (const d of targetDays) {
    for (const task of datedTasks) {
      const seg = clipTimedTaskToDay(task, d);
      if (seg && seg.startMin < earliestMin && seg.startMin > 0) {
        earliestMin = seg.startMin;
      }
    }
  }
  const targetPx = Math.max(0, (earliestMin / 60) * HOUR_HEIGHT - 18);
  scroller.scrollTop = targetPx;
}

function buildOverlapBannerHtml(overlapClusters, showDayLabel) {
  if (!overlapClusters.length) return "";
  const rows = overlapClusters
    .map((cluster) => {
      const dayLabel = showDayLabel
        ? `<span class="overlap-day-label tabular">${escapeHtml(formatShortMdWd(cluster.dayYmd))}：</span>`
        : "";
      const chips = cluster.segments
        .map((seg) => {
          const color = getStatusColor(seg.task.status, seg.task.statusColor);
          const timeLabel = formatSegmentTimeLabel(seg);
          return `
            <button type="button" class="overlap-chip" data-open-task="${escapeHtml(seg.task.id)}">
              <span class="status-dot" style="--status-color:${color}"></span>
              <span>${escapeHtml(seg.task.title || "未命名任務")}</span>${caseSuffix(seg.task)}
              <span class="tabular" style="color:var(--text-muted)">${escapeHtml(timeLabel)}</span>
            </button>
          `;
        })
        .join("");
      return `<div class="overlap-group-row">${dayLabel}${chips}</div>`;
    })
    .join("");

  return `
    <div class="overlap-banner" role="alert">
      <div class="overlap-banner-head">
        <span class="overlap-banner-badge">時段重疊提醒</span>
        <span>偵測到 ${overlapClusters.length} 組重疊時段，已並排顯示</span>
      </div>
      <div class="overlap-list">${rows}</div>
    </div>
  `;
}

function buildHourGutterHtml() {
  let html = `<div class="time-gutter tabular">`;
  for (let h = 0; h < 24; h++) {
    const top = h * HOUR_HEIGHT;
    const label = `${String(h).padStart(2, "0")}:00`;
    html += `<div class="hour-label ${h === 0 ? "is-first" : ""}" style="top:${top}px">${label}</div>`;
  }
  html += `</div>`;
  return html;
}

function buildHourSlotsHtml(dayYmd) {
  let html = "";
  for (let h = 0; h < 24; h++) {
    html += `<div class="hour-slot" data-slot-date="${dayYmd}" data-slot-hour="${h}"></div>`;
  }
  return html;
}

function buildTimedBlocksHtml(items, dayYmd) {
  return items
    .map((seg) => {
      const durMin = Math.max(seg.endMin - seg.startMin, 15);
      const topPx = (seg.startMin / 60) * HOUR_HEIGHT;
      const heightPx = Math.max((durMin / 60) * HOUR_HEIGHT - 2, 22);
      const widthPct = 100 / seg.colCount;
      const leftPct = seg.colIndex * widthPct;
      const color = getStatusColor(seg.task.status, seg.task.statusColor);
      const isCompact = heightPx < 44;
      const isDone = seg.task.status === "完成";
      const timeLabel = formatSegmentTimeLabel(seg);
      const classes = [
        "event-block",
        seg.isOverlapping ? "is-overlap" : "",
        seg.continuesBefore ? "continues-before" : "",
        seg.continuesAfter ? "continues-after" : "",
        isCompact ? "is-compact" : "",
        isDone ? "is-done" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const resizeHtml = !seg.continuesAfter
        ? `<div class="resize-handle" data-resize-task="${escapeHtml(seg.task.id)}" data-resize-day="${dayYmd}" title="拖曳調整結束時間"></div>`
        : "";

      const metaHtml =
        false
          ? ""
          : "";

      return `
        <div
          class="${classes}"
          data-event-task="${escapeHtml(seg.task.id)}"
          data-event-day="${dayYmd}"
          data-start-min="${seg.startMin}"
          data-end-min="${seg.endMin}"
          style="--status-color:${color}; top:${topPx}px; height:${heightPx}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px);"
          title="${escapeHtml(`${seg.task.title} (${timeLabel})`)}"
        >
          <div class="event-block-head">
            <span class="event-title">${escapeHtml(seg.task.title || "未命名任務")}</span>${caseSuffix(seg.task)}
            ${seg.isOverlapping ? `<span class="overlap-tag">重疊</span>` : ""}
          </div>
          <div class="event-time tabular">${seg.continuesBefore ? "← " : ""}${escapeHtml(timeLabel)}${seg.continuesAfter ? " →" : ""}</div>
          ${metaHtml}
          ${resizeHtml}
        </div>
      `;
    })
    .join("");
}

function buildDayViewHtml(datedTasks, dayYmd) {
  const today = getTaipeiTodayYmd();
  const isToday = dayYmd === today;

  const allDayTasks = getAllDayTasksForDate(datedTasks, dayYmd);
  const rawSegments = datedTasks.map((t) => clipTimedTaskToDay(t, dayYmd)).filter(Boolean);
  const { items, overlapClusters } = layoutDaySegments(rawSegments);

  const overlapBanner = buildOverlapBannerHtml(overlapClusters, false);
  const allDayNotice =
    allDayTasks.length >= 2
      ? `<div class="allday-notice"><span>今日有 <strong class="tabular">${allDayTasks.length}</strong> 項整天行程，已並列於上方整天列。</span></div>`
      : "";

  const allDayChips = allDayTasks.length
    ? allDayTasks
        .map((t) => {
          const color = getStatusColor(t.status, t.statusColor);
          const caseText = "";
          return `
            <button type="button" class="allday-chip" data-open-task="${escapeHtml(t.id)}" style="--status-color:${color}">
              <span class="status-dot" style="--status-color:${color}"></span>
              <span class="allday-chip-title">${escapeHtml(t.title || "未命名任務")}</span>${caseSuffix(t)}
              ${caseText}
            </button>
          `;
        })
        .join("")
    : `<span class="allday-strip-empty">點此新增整天行程</span>`;

  const nowLineHtml = isToday
    ? `<div class="now-line" data-now-line style="top:${(getTaipeiNowMinutes() / 60) * HOUR_HEIGHT}px"><span class="now-dot"></span></div>`
    : "";

  return `
    ${overlapBanner}
    ${allDayNotice}
    <div class="calendar-card day-view">
      <div class="allday-strip">
        <div class="allday-strip-label">整天</div>
        <div class="allday-strip-items" data-allday-slot="${dayYmd}">
          ${allDayChips}
        </div>
      </div>

      <div class="time-scroll">
        <div class="day-grid" data-drag-grid="day">
          ${buildHourGutterHtml()}
          <div class="day-column ${isToday ? "is-today" : ""}" data-day-col="${dayYmd}">
            ${buildHourSlotsHtml(dayYmd)}
            <div class="day-events-layer">
              ${nowLineHtml}
              ${buildTimedBlocksHtml(items, dayYmd)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildWeekViewHtml(datedTasks, weekYmds) {
  const today = getTaipeiTodayYmd();
  const nowMin = getTaipeiNowMinutes();

  const allDayLayout = layoutAllDayWeek(datedTasks, weekYmds);
  const allOverlapClusters = [];
  const perDayLayouts = weekYmds.map((ymd) => {
    const segs = datedTasks.map((t) => clipTimedTaskToDay(t, ymd)).filter(Boolean);
    const layout = layoutDaySegments(segs);
    allOverlapClusters.push(...layout.overlapClusters);
    return layout;
  });

  // 檢查本週是否有單日多項整天行程（較輕提示）
  const multiAllDayDays = weekYmds
    .map((ymd) => ({ ymd, count: getAllDayTasksForDate(datedTasks, ymd).length }))
    .filter((x) => x.count >= 2);
  const allDayNotice = multiAllDayDays.length
    ? `<div class="allday-notice"><span>整天行程提示：${multiAllDayDays
        .map((x) => `${formatShortMdWd(x.ymd)} 有 ${x.count} 項`)
        .join("、")}。</span></div>`
    : "";

  const headerCells = weekYmds
    .map((ymd, idx) => {
      const { d } = parseYmd(ymd);
      const isToday = ymd === today;
      return `
        <div class="week-day-head ${isToday ? "is-today" : ""}" data-goto-day="${ymd}" title="切換至 ${formatDayHeading(ymd)}">
          <span class="week-wd">週${WEEKDAY_MON_FIRST[idx]}</span>
          <span class="week-date-num tabular">${d}</span>
        </div>
      `;
    })
    .join("");

  const allDayBgCells = weekYmds
    .map((ymd) => `<div class="week-allday-cell ${ymd === today ? "is-today" : ""}" data-allday-slot="${ymd}"></div>`)
    .join("");

  const allDayBarsHtml = allDayLayout.bars
    .map((bar) => {
      const color = getStatusColor(bar.task.status, bar.task.statusColor);
      const isDone = bar.task.status === "完成";
      const classes = [
        "allday-bar",
        bar.continuesLeft ? "continues-left" : "",
        bar.continuesRight ? "continues-right" : "",
        isDone ? "is-done" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <div
          class="${classes}"
          data-allday-drag="${escapeHtml(bar.task.id)}"
          data-start-col="${bar.startCol}"
          data-span="${bar.span}"
          style="--status-color:${color}; grid-column:${bar.startCol + 1} / span ${bar.span}; grid-row:${bar.lane + 1};"
          title="${escapeHtml(bar.task.title)}"
        >
          <span class="status-dot" style="--status-color:${color}"></span>
          <span class="allday-bar-title">${escapeHtml(bar.task.title || "未命名任務")}</span>${caseSuffix(bar.task)}
        </div>
      `;
    })
    .join("");

  const dayColumnsHtml = weekYmds
    .map((ymd, idx) => {
      const isToday = ymd === today;
      const nowLine = isToday
        ? `<div class="now-line" data-now-line style="top:${(nowMin / 60) * HOUR_HEIGHT}px"><span class="now-dot"></span></div>`
        : "";
      return `
        <div class="day-column ${isToday ? "is-today" : ""}" data-day-col="${ymd}" data-col-index="${idx}">
          ${buildHourSlotsHtml(ymd)}
          <div class="day-events-layer">
            ${nowLine}
            ${buildTimedBlocksHtml(perDayLayouts[idx].items, ymd)}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    ${buildOverlapBannerHtml(allOverlapClusters, true)}
    ${allDayNotice}
    <div class="calendar-card week-view">
      <div class="week-scroll-x">
        <div class="week-frame">
          <div class="week-header">
            <div class="week-corner">時間</div>
            ${headerCells}
          </div>

          <div class="week-allday-row">
            <div class="week-allday-label">整天</div>
            <div class="week-allday-area" data-week-allday-area>
              <div class="week-allday-bg">${allDayBgCells}</div>
              <div class="week-allday-bars" style="min-height:${Math.max(1, allDayLayout.laneCount) * 27 + 8}px;">
                ${allDayBarsHtml}
              </div>
            </div>
          </div>

          <div class="time-scroll">
            <div class="week-time-grid" data-drag-grid="week" data-week-start="${weekYmds[0]}">
              ${buildHourGutterHtml()}
              ${dayColumnsHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildMonthViewHtml(datedTasks, focusDate) {
  const today = getTaipeiTodayYmd();
  const weeks = getMonthWeeks(focusDate);
  const MAX_ITEMS_PER_CELL = 3;
  const MAX_VISIBLE_ALLDAY_LANES = 2;

  const wdHeader = WEEKDAY_MON_FIRST.map((w) => `<div class="month-wd-cell">週${w}</div>`).join("");

  // 統計本月（畫面涵蓋範圍內）重疊時段提醒
  const monthOverlapClusters = [];
  const weekRowsHtml = weeks
    .map((weekDays) => {
      const weekYmds = weekDays.map((d) => d.ymd);
      const { bars } = layoutAllDayWeek(datedTasks, weekYmds);

      const visibleBars = bars.filter((b) => b.lane < MAX_VISIBLE_ALLDAY_LANES);
      const hiddenAllDayCountByCol = new Array(7).fill(0);
      const visibleAllDayCountByCol = new Array(7).fill(0);

      for (const bar of bars) {
        for (let c = bar.startCol; c <= bar.endCol; c++) {
          if (bar.lane < MAX_VISIBLE_ALLDAY_LANES) visibleAllDayCountByCol[c]++;
          else hiddenAllDayCountByCol[c]++;
        }
      }

      const bgCells = weekDays
        .map(
          (d) =>
            `<div class="month-bg-cell ${d.inMonth ? "" : "is-other"} ${d.ymd === today ? "is-today" : ""}" data-month-slot="${d.ymd}"></div>`
        )
        .join("");

      const headCells = weekDays
        .map(
          (d) => `
          <div class="month-day-head">
            <button type="button" class="month-day-num tabular ${d.inMonth ? "" : "is-other"} ${d.ymd === today ? "is-today" : ""}" data-goto-day="${d.ymd}" title="切換至 ${formatDayHeading(d.ymd)}">
              ${d.dayNum}
            </button>
          </div>
        `
        )
        .join("");

      const barsHtml = visibleBars
        .map((bar) => {
          const color = getStatusColor(bar.task.status, bar.task.statusColor);
          const isDone = bar.task.status === "完成";
          const classes = [
            "allday-bar",
            bar.continuesLeft ? "continues-left" : "",
            bar.continuesRight ? "continues-right" : "",
            isDone ? "is-done" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `
            <div
              class="${classes}"
              data-open-task="${escapeHtml(bar.task.id)}"
              style="--status-color:${color}; grid-column:${bar.startCol + 1} / span ${bar.span}; grid-row:${bar.lane + 1};"
              title="${escapeHtml(bar.task.title)}"
            >
              <span class="status-dot" style="--status-color:${color}"></span>
              <span class="allday-bar-title">${escapeHtml(bar.task.title || "未命名任務")}</span>${caseSuffix(bar.task)}
            </div>
          `;
        })
        .join("");

      const timedColsHtml = weekDays
        .map((d, colIdx) => {
          const segs = datedTasks.map((t) => clipTimedTaskToDay(t, d.ymd)).filter(Boolean);
          const { items, overlapClusters } = layoutDaySegments(segs);
          if (d.inMonth && overlapClusters.length) {
            monthOverlapClusters.push(...overlapClusters);
          }

          const budget = Math.max(0, MAX_ITEMS_PER_CELL - visibleAllDayCountByCol[colIdx]);
          const visibleTimed = items.slice(0, budget);
          const hiddenTimedCount = Math.max(0, items.length - visibleTimed.length);
          const overflowCount = hiddenAllDayCountByCol[colIdx] + hiddenTimedCount;

          const itemsHtml = visibleTimed
            .map((seg) => {
              const color = getStatusColor(seg.task.status, seg.task.statusColor);
              const hm = seg.continuesBefore ? "00:00" : minutesToHm(seg.startMin);
              const isDone = seg.task.status === "完成";
              return `
                <button
                  type="button"
                  class="month-timed-item ${seg.isOverlapping ? "is-overlap" : ""} ${isDone ? "is-done" : ""}"
                  data-open-task="${escapeHtml(seg.task.id)}"
                  title="${escapeHtml(`${hm} ${seg.task.title}`)}"
                >
                  <span class="status-dot" style="--status-color:${color}"></span>
                  <span class="month-timed-time tabular">${hm}</span>
                  <span class="month-timed-title">${escapeHtml(seg.task.title || "未命名任務")}</span>${caseSuffix(seg.task)}
                </button>
              `;
            })
            .join("");

          const moreBtn =
            overflowCount > 0
              ? `<button type="button" class="month-more-btn tabular" data-open-day-sheet="${d.ymd}">還有 ${overflowCount} 項</button>`
              : "";

          return `<div class="month-timed-col">${itemsHtml}${moreBtn}</div>`;
        })
        .join("");

      return `
        <div class="month-week-row">
          <div class="month-week-bg">${bgCells}</div>
          <div class="month-week-head">${headCells}</div>
          ${visibleBars.length ? `<div class="month-week-allday">${barsHtml}</div>` : ""}
          <div class="month-week-timed">${timedColsHtml}</div>
        </div>
      `;
    })
    .join("");

  return `
    ${buildOverlapBannerHtml(monthOverlapClusters, true)}
    <div class="calendar-card month-view">
      <div class="month-weekdays">${wdHeader}</div>
      <div class="month-weeks">${weekRowsHtml}</div>
    </div>
  `;
}

/* ===== 2. 清單視圖 ===== */
function renderListView() {
  const orderedStatuses = getOrderedStatusNames();
  const cases = getSchemaCases();
  const f = state.filters;

  const filtered = state.tasks.filter((task) => {
    if (f.search.trim()) {
      const q = f.search.trim().toLowerCase();
      const hay = `${task.title || ""} ${task.caseTitle || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.statuses.size > 0 && !f.statuses.has(task.status || "")) {
      return false;
    }
    if (f.caseFilter === "__none__") {
      if (task.caseId) return false;
    } else if (f.caseFilter !== "__all__") {
      if (task.caseId !== f.caseFilter) return false;
    }
    if (f.dateFilter === "dated" && !(task.date && task.date.start)) return false;
    if (f.dateFilter === "undated" && task.date && task.date.start) return false;
    return true;
  });

  // 建立分組
  const groups = [];
  if (state.groupBy === "status") {
    const byStatus = new Map();
    for (const st of orderedStatuses) byStatus.set(st, []);
    for (const t of filtered) {
      const key = t.status || "未設定狀態";
      if (!byStatus.has(key)) byStatus.set(key, []);
      byStatus.get(key).push(t);
    }
    for (const [statusName, list] of byStatus.entries()) {
      if (f.statuses.size > 0 && !f.statuses.has(statusName) && list.length === 0) continue;
      groups.push({
        key: statusName,
        title: statusName,
        color: getStatusColor(statusName),
        tasks: list,
        quickAddPayload: { status: statusName === "未設定狀態" ? "待辦" : statusName, caseId: null },
      });
    }
  } else {
    const caseMap = new Map();
    for (const c of cases) {
      caseMap.set(c.id, { id: c.id, title: c.title, tasks: [] });
    }
    const uncategorized = [];
    for (const t of filtered) {
      if (t.caseId) {
        if (!caseMap.has(t.caseId)) {
          caseMap.set(t.caseId, { id: t.caseId, title: t.caseTitle || "未知案件", tasks: [] });
        }
        caseMap.get(t.caseId).tasks.push(t);
      } else {
        uncategorized.push(t);
      }
    }
    for (const c of caseMap.values()) {
      if (f.caseFilter !== "__all__" && f.caseFilter !== c.id) continue;
      groups.push({
        key: c.id,
        title: c.title,
        color: "#0f766e",
        tasks: c.tasks,
        quickAddPayload: { status: "待辦", caseId: c.id },
      });
    }
    if (f.caseFilter === "__all__" || f.caseFilter === "__none__") {
      groups.push({
        key: "__none__",
        title: "未分類",
        color: "#8a8278",
        tasks: uncategorized,
        quickAddPayload: { status: "待辦", caseId: null },
      });
    }
  }

  const hasActiveFilter =
    Boolean(f.search.trim()) ||
    f.statuses.size > 0 ||
    f.caseFilter !== "__all__" ||
    f.dateFilter !== "all";

  const statusChipsHtml = orderedStatuses
    .map((st) => {
      const active = f.statuses.has(st);
      const color = getStatusColor(st);
      return `
        <button type="button" class="filter-chip ${active ? "is-active" : ""}" data-toggle-status="${escapeHtml(st)}">
          <span class="status-dot" style="--status-color:${color}"></span>
          <span>${escapeHtml(st)}</span>
        </button>
      `;
    })
    .join("");

  const caseOptionsHtml = [
    `<option value="__all__" ${f.caseFilter === "__all__" ? "selected" : ""}>全部案件</option>`,
    ...cases.map(
      (c) =>
        `<option value="${escapeHtml(c.id)}" ${f.caseFilter === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`
    ),
    `<option value="__none__" ${f.caseFilter === "__none__" ? "selected" : ""}>未分類</option>`,
  ].join("");

  const groupsHtml =
    groups.length === 0
      ? `<div class="state-card"><h2>沒有符合條件的任務</h2><p>請調整搜尋或篩選條件後再試。</p></div>`
      : groups
          .map((g) => {
            const rowsHtml = g.tasks.length
              ? g.tasks
                  .map((t) => {
                    const color = getStatusColor(t.status, t.statusColor);
                    const dateText = formatTaskDateSummary(t.date);
                    const isEmptyDate = !(t.date && t.date.start);
                    const isDone = t.status === "完成";
                    return `
                      <button type="button" class="task-row ${isDone ? "is-done" : ""}" data-open-task="${escapeHtml(t.id)}">
                        <div class="task-row-main">
                          <span class="status-dot" style="--status-color:${color}" title="${escapeHtml(t.status || "")}"></span>
                          <span class="task-row-title">${escapeHtml(t.title || "未命名任務")}</span>${caseSuffix(t)}
                        </div>
                        <div class="task-row-meta">
                          <span class="date-pill tabular ${isEmptyDate ? "is-empty" : ""}">${escapeHtml(dateText)}</span>
                          
                        </div>
                      </button>
                    `;
                  })
                  .join("")
              : `<div class="group-empty">此分組目前沒有任務</div>`;

            return `
              <section class="group-card">
                <div class="group-head">
                  <div class="group-title-wrap">
                    <span class="status-dot" style="--status-color:${g.color}"></span>
                    <h3 class="group-title">${escapeHtml(g.title)}</h3>
                  </div>
                  <span class="group-count tabular">${g.tasks.length}</span>
                </div>
                <div class="task-rows">${rowsHtml}</div>
                <form class="quick-add-form" data-quick-add data-qa-status="${escapeHtml(g.quickAddPayload.status || "待辦")}" data-qa-case="${escapeHtml(g.quickAddPayload.caseId || "")}">
                  <input type="text" class="quick-add-input" placeholder="快速新增至「${escapeHtml(g.title)}」（無排程日期）…" aria-label="快速新增任務">
                  <button type="submit" class="btn btn-sm btn-ghost">新增</button>
                </form>
              </section>
            `;
          })
          .join("");

  $main.innerHTML = `
    <section class="list-view">
      <div class="list-toolbar">
        <div class="list-toolbar-top">
          <div class="toolbar-group">
            <span class="filter-label">分組依據</span>
            <div class="segmented" role="tablist" aria-label="分組依據">
              <button type="button" class="seg-btn ${state.groupBy === "status" ? "is-active" : ""}" data-groupby="status">任務狀態</button>
              <button type="button" class="seg-btn ${state.groupBy === "case" ? "is-active" : ""}" data-groupby="case">Case List</button>
            </div>
          </div>

          <div class="toolbar-group">
            <span class="filter-label tabular">顯示 ${filtered.length} / ${state.tasks.length} 項</span>
            <button type="button" class="btn btn-primary" data-action="new-task-list">＋ 新增任務</button>
          </div>
        </div>

        <div class="list-filters-row">
          <input
            type="search"
            id="list-search"
            class="input search-input"
            placeholder="搜尋任務標題…"
            value="${escapeHtml(f.search)}"
          >
          <select id="list-case-filter" class="input filter-select" aria-label="篩選案件">
            ${caseOptionsHtml}
          </select>
          <select id="list-date-filter" class="input filter-select" aria-label="篩選有無日期">
            <option value="all" ${f.dateFilter === "all" ? "selected" : ""}>全部日期狀態</option>
            <option value="dated" ${f.dateFilter === "dated" ? "selected" : ""}>僅有日期</option>
            <option value="undated" ${f.dateFilter === "undated" ? "selected" : ""}>僅無日期</option>
          </select>
          ${hasActiveFilter ? `<button type="button" class="btn btn-ghost btn-sm" data-action="clear-filters">清除篩選</button>` : ""}
        </div>

        <div class="status-filter-row">
          <span class="filter-label">狀態：</span>
          ${statusChipsHtml}
        </div>
      </div>

      <div class="group-list">${groupsHtml}</div>
    </section>
  `;
}

/* ===== 3. 設定視圖 ===== */
function renderSettingsView() {
  const connHtml = state.connTest
    ? `
      <div class="conn-result ${state.connTest.loading ? "" : state.connTest.ok ? "is-ok" : "is-error"}">
        <strong>${escapeHtml(state.connTest.message)}</strong>
        ${state.connTest.details ? `<div style="margin-top:4px">${escapeHtml(state.connTest.details)}</div>` : ""}
      </div>
    `
    : "";

  $main.innerHTML = `
    <section class="settings-view">
      <div class="settings-card">
        <div class="settings-toggle-row">
          <div>
            <h2>示範模式</h2>
            <p class="settings-desc" style="margin-bottom:0">
              開啟時使用內建虛構示範資料（含今日重疊時段、跨夜與多日行程），不連線到 Notion，可完整操作新增、編輯、拖曳與封存。
            </p>
          </div>
          <label class="switch" aria-label="切換示範模式">
            <input type="checkbox" id="set-demo-mode" ${state.demoMode ? "checked" : ""}>
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-card">
        <h2>Cloudflare Worker 連線設定</h2>
        <p class="settings-desc">關閉示範模式後，前端將透過你的 Cloudflare Worker 轉接 Notion API（2022-06-28）。</p>

        <form id="settings-form" novalidate>
          <div class="field">
            <label for="set-worker-url" class="field-label">Worker 網址</label>
            <input
              type="url"
              id="set-worker-url"
              class="input"
              placeholder="https://notion-planner-api.你的帳號.workers.dev"
              value="${escapeHtml(state.workerUrl)}"
              autocomplete="off"
            >
            <p class="field-hint">儲存時會自動移除結尾斜線。</p>
          </div>

          <div class="field">
            <label for="set-app-key" class="field-label">App Key（前端存取密鑰）</label>
            <div class="password-wrap">
              <input
                type="password"
                id="set-app-key"
                class="input"
                placeholder="輸入你在 Worker 設定的 APP_KEY"
                value="${escapeHtml(state.appKey)}"
                autocomplete="off"
              >
              <button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-key">顯示</button>
            </div>
            <p class="field-hint">此欄位為 Worker 的 APP_KEY（每次請求放入 X-App-Key 標頭），並非 Notion Integration Token。</p>
          </div>

          <div class="settings-actions">
            <button type="submit" class="btn btn-primary">儲存設定</button>
            <button type="button" class="btn btn-ghost" id="btn-test-conn" ${state.connTest?.loading ? "disabled" : ""}>
              ${state.connTest?.loading ? "測試中…" : "測試連線"}
            </button>
          </div>
        </form>

        ${connHtml}
      </div>

      <div class="security-box">
        <strong>金鑰與安全說明</strong>
        <ul>
          <li>Worker 網址與 App Key 只儲存在這台裝置瀏覽器的 <code>localStorage</code>，不會傳送給第三方。</li>
          <li>GitHub Pages 為公開靜態網站，請勿將 <code>NOTION_TOKEN</code> 或 <code>APP_KEY</code> 寫進專案程式碼或公開儲存庫。</li>
          <li>請在 Cloudflare Worker 的 <code>ALLOWED_ORIGIN</code> 設定你的 GitHub Pages 網域，以限制來源存取。</li>
        </ul>
      </div>
    </section>
  `;
}

async function runConnectionTest(urlInput, keyInput) {
  const url = cleanUrl(urlInput);
  const key = String(keyInput || "").trim();
  if (!url) {
    state.connTest = { loading: false, ok: false, message: "請先輸入 Worker 網址。" };
    renderSettingsView();
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    state.connTest = { loading: false, ok: false, message: "Worker 網址須以 https:// 或 http:// 開頭。" };
    renderSettingsView();
    return;
  }
  if (!key) {
    state.connTest = { loading: false, ok: false, message: "請先輸入 App Key。" };
    renderSettingsView();
    return;
  }

  state.connTest = { loading: true, ok: false, message: "正在檢查 Worker 健康狀態與 Notion 資料庫結構…" };
  renderSettingsView();

  const client = createRemoteClient(url, key);
  try {
    await client.health();
    const schema = await client.getSchema();
    const statusCount = schema?.properties?.["任務狀態"]?.options?.length || 0;
    const caseCount = schema?.cases?.length || 0;
    state.connTest = {
      loading: false,
      ok: true,
      message: "連線成功！已成功讀取 Notion 任務資料庫。",
      details: `資料庫：${schema.title || "任務"}｜API 版本：${schema.apiVersion || "2022-06-28"}｜狀態選項：${statusCount} 個｜Case List：${caseCount} 筆`,
    };
  } catch (err) {
    state.connTest = {
      loading: false,
      ok: false,
      message: "連線測試失敗",
      details: formatApiError(err, err.status),
    };
  }
  renderSettingsView();
}

/* ===== 4. 任務新增 / 編輯表單 ===== */
function populateFormSelects(selectedStatus, selectedCaseId) {
  const statuses = getOrderedStatusNames();
  $fStatus.innerHTML = statuses
    .map(
      (s) =>
        `<option value="${escapeHtml(s)}" ${s === selectedStatus ? "selected" : ""}>${escapeHtml(s)}</option>`
    )
    .join("");

  const cases = getSchemaCases();
  const options = [`<option value="">未分類（無案件）</option>`];
  let matched = !selectedCaseId;
  for (const c of cases) {
    const isSel = c.id === selectedCaseId;
    if (isSel) matched = true;
    options.push(
      `<option value="${escapeHtml(c.id)}" ${isSel ? "selected" : ""}>${escapeHtml(c.title)}</option>`
    );
  }
  if (!matched && selectedCaseId) {
    const fallbackTask = state.tasks.find((t) => t.caseId === selectedCaseId);
    options.push(
      `<option value="${escapeHtml(selectedCaseId)}" selected>${escapeHtml(fallbackTask?.caseTitle || "目前案件")}</option>`
    );
  }
  $fCase.innerHTML = options.join("");
}

function syncAllDayVisibility() {
  const isAllDay = $fAllDay.checked;
  $wrapStartTime.hidden = isAllDay;
  $wrapEndTime.hidden = isAllDay;
}

function openCreateModal(prefill = {}) {
  state.modal = {
    open: true,
    mode: "create",
    taskId: null,
    saving: false,
    confirmArchive: false,
  };

  $modalTitle.textContent = "新增任務";
  $formError.hidden = true;
  $archiveConfirmBar.hidden = true;
  $modalEditActions.hidden = true;
  $btnSave.disabled = false;
  $btnSave.textContent = "新增";

  $fTitle.value = prefill.title || "";
  populateFormSelects(prefill.status || "待辦", prefill.caseId || "");

  const isAllDay = Boolean(prefill.allDay);
  $fAllDay.checked = isAllDay;
  $fStartDate.value = prefill.startDate || "";
  $fStartTime.value = prefill.startTime || "";
  $fEndDate.value = prefill.endDate || "";
  $fEndTime.value = prefill.endTime || "";
  syncAllDayVisibility();

  $taskModal.hidden = false;
  setTimeout(() => $fTitle.focus(), 20);
}

function openEditModal(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  state.modal = {
    open: true,
    mode: "edit",
    taskId: task.id,
    saving: false,
    confirmArchive: false,
  };

  $modalTitle.textContent = "編輯任務";
  $formError.hidden = true;
  $archiveConfirmBar.hidden = true;
  $modalEditActions.hidden = false;
  $btnSave.disabled = false;
  $btnSave.textContent = "儲存變更";

  if (isSafeHttpUrl(task.url)) {
    $linkNotion.href = task.url;
    $linkNotion.hidden = false;
  } else {
    $linkNotion.hidden = true;
  }

  $fTitle.value = task.title || "";
  populateFormSelects(task.status || "待辦", task.caseId || "");

  if (!task.date || !task.date.start) {
    $fAllDay.checked = false;
    $fStartDate.value = "";
    $fStartTime.value = "";
    $fEndDate.value = "";
    $fEndTime.value = "";
  } else if (!task.date.hasTime) {
    $fAllDay.checked = true;
    $fStartDate.value = task.date.start.slice(0, 10);
    $fEndDate.value = task.date.end ? task.date.end.slice(0, 10) : task.date.start.slice(0, 10);
    $fStartTime.value = "";
    $fEndTime.value = "";
  } else {
    $fAllDay.checked = false;
    const s = parseTaipeiDateTime(task.date.start);
    const e = task.date.end ? parseTaipeiDateTime(task.date.end) : null;
    $fStartDate.value = s ? s.ymd : "";
    $fStartTime.value = s ? s.hm : "";
    $fEndDate.value = e ? e.ymd : "";
    $fEndTime.value = e ? e.hm : "";
  }
  syncAllDayVisibility();

  $taskModal.hidden = false;
  setTimeout(() => $fTitle.focus(), 20);
}

function closeTaskModal() {
  if (state.modal.saving) return;
  state.modal.open = false;
  $taskModal.hidden = true;
  $archiveConfirmBar.hidden = true;
}

function showFormError(msg) {
  $formError.textContent = msg;
  $formError.hidden = false;
}

function buildDateFromForm() {
  const startDate = $fStartDate.value.trim();
  const endDate = $fEndDate.value.trim();
  const allDay = $fAllDay.checked;

  if (!startDate) {
    if (endDate) {
      throw new Error("若要設定結束日期，請同時填寫開始日期。");
    }
    return null;
  }

  if (allDay) {
    if (endDate && endDate < startDate) {
      throw new Error("結束日期不可早於開始日期。");
    }
    const cleanEnd = endDate && endDate !== startDate ? endDate : null;
    return { start: startDate, end: cleanEnd, hasTime: false };
  }

  const startTime = $fStartTime.value.trim();
  const endTime = $fEndTime.value.trim();
  if (!startTime) {
    throw new Error("請填寫開始時間，或勾選「整天行程」。");
  }
  const startIso = formatTaipeiIso(startDate, startTime);

  if (endTime || (endDate && endDate !== startDate)) {
    const effEndDate = endDate || startDate;
    const effEndTime = endTime || startTime;
    const endIso = formatTaipeiIso(effEndDate, effEndTime);
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      throw new Error("結束時間必須晚於開始時間。");
    }
    return { start: startIso, end: endIso, hasTime: true };
  }

  return { start: startIso, end: null, hasTime: true };
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();
  if (state.modal.saving) return;
  $formError.hidden = true;

  const title = $fTitle.value.trim();
  if (!title) {
    showFormError("請填寫任務標題。");
    $fTitle.focus();
    return;
  }

  let datePayload;
  try {
    datePayload = buildDateFromForm();
  } catch (err) {
    showFormError(err.message);
    return;
  }

  const payload = {
    title,
    status: $fStatus.value || "待辦",
    caseId: $fCase.value || null,
    date: datePayload,
  };

  state.modal.saving = true;
  $btnSave.disabled = true;
  $btnSave.textContent = "儲存中…";

  try {
    const client = getClient();
    if (state.modal.mode === "create") {
      const res = await client.create(payload);
      if (res?.task) state.tasks = [res.task, ...state.tasks];
      showToast("已新增任務", "success");
    } else {
      const res = await client.update(state.modal.taskId, payload);
      if (res?.task) {
        state.tasks = state.tasks.map((t) => (t.id === state.modal.taskId ? res.task : t));
      }
      showToast("已儲存變更", "success");
    }
    state.modal.saving = false;
    closeTaskModal();
    render();
  } catch (err) {
    state.modal.saving = false;
    $btnSave.disabled = false;
    $btnSave.textContent = state.modal.mode === "create" ? "新增" : "儲存變更";
    showFormError(formatApiError(err, err.status));
  }
}

async function handleArchiveConfirm() {
  if (state.modal.saving || !state.modal.taskId) return;
  state.modal.saving = true;
  $btnArchiveConfirm.disabled = true;
  $btnArchiveConfirm.textContent = "封存中…";
  $btnSave.disabled = true;

  try {
    const client = getClient();
    await client.archive(state.modal.taskId);
    state.tasks = state.tasks.filter((t) => t.id !== state.modal.taskId);
    state.modal.saving = false;
    $btnArchiveConfirm.disabled = false;
    $btnArchiveConfirm.textContent = "確認封存";
    closeTaskModal();
    showToast("已封存任務", "success");
    render();
  } catch (err) {
    state.modal.saving = false;
    $btnArchiveConfirm.disabled = false;
    $btnArchiveConfirm.textContent = "確認封存";
    $btnSave.disabled = false;
    showFormError(formatApiError(err, err.status));
  }
}

/* ===== 月視圖當日清單彈窗 ===== */
function openDaySheet(ymd) {
  state.daySheetYmd = ymd;
  $daySheetTitle.textContent = formatDayHeading(ymd);

  const datedTasks = state.tasks.filter((t) => t.date && t.date.start);
  const allDay = getAllDayTasksForDate(datedTasks, ymd);
  const segs = datedTasks.map((t) => clipTimedTaskToDay(t, ymd)).filter(Boolean);
  const { items } = layoutDaySegments(segs);

  const parts = [];
  for (const t of allDay) {
    const color = getStatusColor(t.status, t.statusColor);
    parts.push(`
      <button type="button" class="day-sheet-item" data-sheet-task="${escapeHtml(t.id)}" style="--status-color:${color}">
        <span style="font-weight:600">${escapeHtml(t.title || "未命名任務")}</span>${caseSuffix(t)}
        <span class="date-pill tabular">整天</span>
      </button>
    `);
  }
  for (const seg of items) {
    const color = getStatusColor(seg.task.status, seg.task.statusColor);
    const label = formatSegmentTimeLabel(seg);
    parts.push(`
      <button type="button" class="day-sheet-item ${seg.isOverlapping ? "is-overlap" : ""}" data-sheet-task="${escapeHtml(seg.task.id)}" style="--status-color:${color}">
        <span style="display:flex;align-items:center;gap:6px;min-width:0">
          <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(seg.task.title || "未命名任務")}</span>${caseSuffix(seg.task)}
          ${seg.isOverlapping ? `<span class="overlap-tag">重疊</span>` : ""}
        </span>
        <span class="date-pill tabular">${escapeHtml(label)}</span>
      </button>
    `);
  }

  $daySheetBody.innerHTML = parts.length
    ? `<div class="day-sheet-list">${parts.join("")}</div>`
    : `<p style="color:var(--text-muted);margin:0">這一天目前沒有排程任務。</p>`;

  $daySheet.hidden = false;
}

function closeDaySheet() {
  state.daySheetYmd = null;
  $daySheet.hidden = true;
}

/* ===== 拖曳移動與調整結束時間（日／週視圖） ===== */
function showDragTooltip(x, y, text) {
  $dragTooltip.textContent = text;
  $dragTooltip.style.left = `${Math.min(window.innerWidth - 150, x + 14)}px`;
  $dragTooltip.style.top = `${Math.max(12, y - 34)}px`;
  $dragTooltip.hidden = false;
}

function hideDragTooltip() {
  $dragTooltip.hidden = true;
}

function startPointerInteraction(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;

  // 1. 調整結束時間手把
  const resizeEl = e.target.closest("[data-resize-task]");
  if (resizeEl) {
    const taskId = resizeEl.dataset.resizeTask;
    const dayYmd = resizeEl.dataset.resizeDay;
    const block = resizeEl.closest(".event-block");
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || !block) return;

    e.preventDefault();
    e.stopPropagation();

    activeDrag = {
      kind: "resize",
      pointerId: e.pointerId,
      taskId,
      task,
      dayYmd,
      block,
      startY: e.clientY,
      origStartMin: Number(block.dataset.startMin),
      origEndMin: Number(block.dataset.endMin),
      currentEndMin: Number(block.dataset.endMin),
      moved: false,
    };
    block.setPointerCapture?.(e.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return;
  }

  // 2. 拖曳時間區塊
  const blockEl = e.target.closest("[data-event-task]");
  if (blockEl) {
    const taskId = blockEl.dataset.eventTask;
    const dayYmd = blockEl.dataset.eventDay;
    const task = state.tasks.find((t) => t.id === taskId);
    const grid = blockEl.closest("[data-drag-grid]");
    if (!task || !grid) return;

    const mode = grid.dataset.dragGrid; // day | week
    const colEl = blockEl.closest(".day-column");
    const colWidth = colEl ? colEl.getBoundingClientRect().width : 0;

    activeDrag = {
      kind: "move-timed",
      mode,
      pointerId: e.pointerId,
      taskId,
      task,
      dayYmd,
      block: blockEl,
      colWidth,
      startX: e.clientX,
      startY: e.clientY,
      origStartMin: Number(blockEl.dataset.startMin),
      origEndMin: Number(blockEl.dataset.endMin),
      deltaDays: 0,
      deltaMin: 0,
      moved: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return;
  }

  // 3. 週視圖整天橫條按日移動
  const allDayBar = e.target.closest("[data-allday-drag]");
  if (allDayBar) {
    const taskId = allDayBar.dataset.alldayDrag;
    const task = state.tasks.find((t) => t.id === taskId);
    const area = allDayBar.closest("[data-week-allday-area]");
    if (!task || !area) return;

    const colWidth = area.getBoundingClientRect().width / 7;
    activeDrag = {
      kind: "move-allday",
      pointerId: e.pointerId,
      taskId,
      task,
      bar: allDayBar,
      colWidth,
      startX: e.clientX,
      startY: e.clientY,
      deltaDays: 0,
      moved: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }
}

function onPointerMove(e) {
  if (!activeDrag) return;

  const dx = e.clientX - (activeDrag.startX ?? e.clientX);
  const dy = e.clientY - (activeDrag.startY ?? e.clientY);

  if (!activeDrag.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    activeDrag.moved = true;
    if (activeDrag.kind === "resize") {
      activeDrag.block.classList.add("is-resizing");
    } else if (activeDrag.kind === "move-timed") {
      activeDrag.block.classList.add("is-dragging");
    } else if (activeDrag.kind === "move-allday") {
      activeDrag.bar.classList.add("is-dragging");
    }
  }

  e.preventDefault();

  if (activeDrag.kind === "resize") {
    const rawDeltaMin = (dy / HOUR_HEIGHT) * 60;
    const snappedEnd = snapMinutes(activeDrag.origEndMin + rawDeltaMin, SNAP_MINUTES);
    const minEnd = activeDrag.origStartMin + MIN_TIMED_DURATION_MIN;
    const clampedEnd = Math.max(minEnd, Math.min(1440, snappedEnd));
    activeDrag.currentEndMin = clampedEnd;

    const heightPx = Math.max(((clampedEnd - activeDrag.origStartMin) / 60) * HOUR_HEIGHT - 2, 22);
    activeDrag.block.style.height = `${heightPx}px`;
    showDragTooltip(
      e.clientX,
      e.clientY,
      `${minutesToHm(activeDrag.origStartMin)}–${minutesToHm(clampedEnd)}`
    );
    return;
  }

  if (activeDrag.kind === "move-timed") {
    const rawDeltaMin = (dy / HOUR_HEIGHT) * 60;
    const snappedDeltaMin = snapMinutes(rawDeltaMin, SNAP_MINUTES);
    const deltaDays =
      activeDrag.mode === "week" && activeDrag.colWidth > 0
        ? Math.round(dx / activeDrag.colWidth)
        : 0;

    activeDrag.deltaMin = snappedDeltaMin;
    activeDrag.deltaDays = deltaDays;

    const translateY = (snappedDeltaMin / 60) * HOUR_HEIGHT;
    const translateX = deltaDays * activeDrag.colWidth;
    activeDrag.block.style.transform = `translate(${translateX}px, ${translateY}px)`;

    const previewDate = shiftTimedTaskDate(activeDrag.task.date, deltaDays, snappedDeltaMin);
    const s = parseTaipeiDateTime(previewDate.start);
    const en = previewDate.end ? parseTaipeiDateTime(previewDate.end) : null;
    const label = s
      ? `${formatShortMd(s.ymd)} ${s.hm}${en ? `–${en.hm}` : ""}`
      : "";
    showDragTooltip(e.clientX, e.clientY, label);
    return;
  }

  if (activeDrag.kind === "move-allday") {
    const deltaDays = activeDrag.colWidth > 0 ? Math.round(dx / activeDrag.colWidth) : 0;
    activeDrag.deltaDays = deltaDays;
    activeDrag.bar.style.transform = `translateX(${deltaDays * activeDrag.colWidth}px)`;
    const preview = shiftAllDayTaskDate(activeDrag.task.date, deltaDays);
    const text = preview.end
      ? `${formatShortMd(preview.start)}–${formatShortMd(preview.end)}`
      : formatShortMd(preview.start);
    showDragTooltip(e.clientX, e.clientY, `${text} 整天`);
  }
}

async function onPointerUp() {
  if (!activeDrag) return;
  const drag = activeDrag;
  cleanupDragListeners();
  hideDragTooltip();

  if (!drag.moved) {
    // 非拖曳：視為點擊
    if (drag.kind === "move-timed" || drag.kind === "move-allday") {
      openEditModal(drag.taskId);
    }
    return;
  }

  suppressClickUntil = Date.now() + 250;

  let nextDate = null;
  if (drag.kind === "resize") {
    if (drag.currentEndMin === drag.origEndMin) {
      render();
      return;
    }
    nextDate = resizeTimedTaskDate(drag.task.date, drag.dayYmd, drag.currentEndMin);
  } else if (drag.kind === "move-timed") {
    if (drag.deltaDays === 0 && drag.deltaMin === 0) {
      render();
      return;
    }
    nextDate = shiftTimedTaskDate(drag.task.date, drag.deltaDays, drag.deltaMin);
  } else if (drag.kind === "move-allday") {
    if (drag.deltaDays === 0) {
      render();
      return;
    }
    nextDate = shiftAllDayTaskDate(drag.task.date, drag.deltaDays);
  }

  if (!nextDate) {
    render();
    return;
  }

  // 樂觀更新，失敗則還原並提示
  const prevTasks = state.tasks;
  state.tasks = state.tasks.map((t) => (t.id === drag.taskId ? { ...t, date: nextDate } : t));
  render();

  try {
    const client = getClient();
    const res = await client.update(drag.taskId, { date: nextDate });
    if (res?.task) {
      state.tasks = state.tasks.map((t) => (t.id === drag.taskId ? res.task : t));
      render();
    }
    showToast("已更新排程時間", "success");
  } catch (err) {
    state.tasks = prevTasks;
    render();
    showToast(`更新失敗，已還原：${formatApiError(err, err.status)}`, "error");
  }
}

function onPointerCancel() {
  if (!activeDrag) return;
  cleanupDragListeners();
  hideDragTooltip();
  render();
}

function cleanupDragListeners() {
  activeDrag = null;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
}

/* ===== 事件繫結 ===== */
for (const tab of $navTabs) {
  tab.addEventListener("click", () => setMainView(tab.dataset.nav));
}

$btnRefresh.addEventListener("click", () => loadData({ silent: false }));

// 主區域事件委派（點擊）
$main.addEventListener("click", (e) => {
  if (Date.now() < suppressClickUntil) return;

  const target = e.target;

  const rangeBtn = target.closest("[data-range]");
  if (rangeBtn) {
    setRange(rangeBtn.dataset.range);
    return;
  }

  const groupBtn = target.closest("[data-groupby]");
  if (groupBtn) {
    setGroupBy(groupBtn.dataset.groupby);
    return;
  }

  const actionEl = target.closest("[data-action]");
  if (actionEl) {
    const act = actionEl.dataset.action;
    if (act === "prev-period") stepPeriod(-1);
    else if (act === "next-period") stepPeriod(1);
    else if (act === "today") jumpToday();
    else if (act === "retry-load") loadData();
    else if (act === "go-settings") setMainView("settings");
    else if (act === "enable-demo") {
      state.demoMode = true;
      localStorage.setItem(STORAGE.demoMode, "1");
      loadData();
    } else if (act === "clear-filters") {
      state.filters.search = "";
      state.filters.statuses.clear();
      state.filters.caseFilter = "__all__";
      state.filters.dateFilter = "all";
      render();
    } else if (act === "new-task-timeline") {
      if (state.range === "month") {
        openCreateModal({ allDay: true, startDate: state.focusDate, endDate: state.focusDate });
      } else {
        openCreateModal({
          allDay: false,
          startDate: state.focusDate,
          startTime: "09:00",
          endDate: state.focusDate,
          endTime: "10:00",
        });
      }
    } else if (act === "new-task-list") {
      openCreateModal({ allDay: false });
    }
    return;
  }

  const toggleStatusEl = target.closest("[data-toggle-status]");
  if (toggleStatusEl) {
    const st = toggleStatusEl.dataset.toggleStatus;
    if (state.filters.statuses.has(st)) state.filters.statuses.delete(st);
    else state.filters.statuses.add(st);
    render();
    return;
  }

  const openTaskEl = target.closest("[data-open-task]");
  if (openTaskEl) {
    openEditModal(openTaskEl.dataset.openTask);
    return;
  }

  const daySheetEl = target.closest("[data-open-day-sheet]");
  if (daySheetEl) {
    openDaySheet(daySheetEl.dataset.openDaySheet);
    return;
  }

  const gotoDayEl = target.closest("[data-goto-day]");
  if (gotoDayEl) {
    state.focusDate = gotoDayEl.dataset.gotoDay;
    setRange("day");
    return;
  }

  // 點擊日／週空白整天列
  const allDaySlot = target.closest("[data-allday-slot]");
  if (allDaySlot && !target.closest("[data-open-task]") && !target.closest("[data-allday-drag]")) {
    const ymd = allDaySlot.dataset.alldaySlot;
    openCreateModal({ allDay: true, startDate: ymd, endDate: ymd });
    return;
  }

  // 點擊月視圖空白格
  const monthSlot = target.closest("[data-month-slot]");
  if (monthSlot) {
    const ymd = monthSlot.dataset.monthSlot;
    openCreateModal({ allDay: true, startDate: ymd, endDate: ymd });
    return;
  }

  // 點擊日／週空白時間格（預設 1 小時）
  const slotEl = target.closest("[data-slot-date]");
  if (slotEl) {
    const ymd = slotEl.dataset.slotDate;
    const hour = Number(slotEl.dataset.slotHour);
    const startMin = hour * 60;
    const endMin = startMin + 60;
    const endDate = endMin >= 1440 ? addDaysYmd(ymd, 1) : ymd;
    const endHm = minutesToHm(endMin >= 1440 ? endMin - 1440 : endMin);
    openCreateModal({
      allDay: false,
      startDate: ymd,
      startTime: minutesToHm(startMin),
      endDate,
      endTime: endHm,
    });
    return;
  }

  // 設定頁按鈕
  if (target.id === "btn-toggle-key") {
    const input = document.getElementById("set-app-key");
    if (input) {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      target.textContent = showing ? "顯示" : "隱藏";
    }
    return;
  }

  if (target.id === "btn-test-conn") {
    const url = document.getElementById("set-worker-url")?.value || "";
    const key = document.getElementById("set-app-key")?.value || "";
    runConnectionTest(url, key);
  }
});

// 拖曳 pointerdown 委派
$main.addEventListener("pointerdown", startPointerInteraction);

// 清單篩選與設定變更委派
$main.addEventListener("input", (e) => {
  if (e.target.id === "list-search") {
    state.filters.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const nextInput = document.getElementById("list-search");
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(pos, pos);
    }
  }
});

$main.addEventListener("change", (e) => {
  if (e.target.id === "list-case-filter") {
    state.filters.caseFilter = e.target.value;
    render();
    return;
  }
  if (e.target.id === "list-date-filter") {
    state.filters.dateFilter = e.target.value;
    render();
    return;
  }
  if (e.target.id === "set-demo-mode") {
    state.demoMode = e.target.checked;
    localStorage.setItem(STORAGE.demoMode, state.demoMode ? "1" : "0");
    state.connTest = null;
    if (state.demoMode) {
      showToast("已切換至示範模式", "success");
      loadData();
    } else if (!state.workerUrl || !state.appKey) {
      state.needsSetup = true;
      showToast("已關閉示範模式，請填入 Worker 網址與 App Key");
      renderSettingsView();
    } else {
      showToast("已關閉示範模式，正在同步真實資料");
      loadData();
    }
  }
});

// 表單送出委派（清單快速新增、設定儲存）
$main.addEventListener("submit", async (e) => {
  const qaForm = e.target.closest("[data-quick-add]");
  if (qaForm) {
    e.preventDefault();
    const input = qaForm.querySelector(".quick-add-input");
    const btn = qaForm.querySelector("button[type='submit']");
    const title = (input?.value || "").trim();
    if (!title) return;

    const status = qaForm.dataset.qaStatus || "待辦";
    const caseId = qaForm.dataset.qaCase || null;

    input.disabled = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "新增中…";
    }
    try {
      const client = getClient();
      const res = await client.create({ title, status, caseId, date: null });
      if (res?.task) state.tasks = [res.task, ...state.tasks];
      showToast("已快速新增任務", "success");
      render();
    } catch (err) {
      input.disabled = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "新增";
      }
      showToast(`新增失敗：${formatApiError(err, err.status)}`, "error");
    }
    return;
  }

  if (e.target.id === "settings-form") {
    e.preventDefault();
    const url = cleanUrl(document.getElementById("set-worker-url")?.value || "");
    const key = (document.getElementById("set-app-key")?.value || "").trim();

    if (url && !/^https?:\/\//i.test(url)) {
      state.connTest = {
        loading: false,
        ok: false,
        message: "Worker 網址格式不正確，請以 https:// 或 http:// 開頭。",
      };
      renderSettingsView();
      return;
    }

    state.workerUrl = url;
    state.appKey = key;
    localStorage.setItem(STORAGE.workerUrl, url);
    localStorage.setItem(STORAGE.appKey, key);
    showToast("設定已儲存在本裝置瀏覽器", "success");

    if (!state.demoMode) {
      if (url && key) {
        await loadData();
        if (state.error) {
          showToast(`同步失敗：${state.error}`, "error");
        } else {
          showToast("已同步 Notion 任務資料", "success");
        }
      } else {
        state.needsSetup = true;
        renderSettingsView();
      }
    }
  }
});

// 任務表單互動
$taskForm.addEventListener("submit", handleTaskFormSubmit);
$modalClose.addEventListener("click", closeTaskModal);
$btnCancel.addEventListener("click", closeTaskModal);
$taskModal.addEventListener("click", (e) => {
  if (e.target === $taskModal) closeTaskModal();
});

$fAllDay.addEventListener("change", () => {
  if ($fAllDay.checked) {
    if (!$fStartDate.value) $fStartDate.value = state.focusDate;
    if (!$fEndDate.value) $fEndDate.value = $fStartDate.value;
  } else if ($fStartDate.value && !$fStartTime.value) {
    $fStartTime.value = "09:00";
    $fEndDate.value = $fStartDate.value;
    $fEndTime.value = "10:00";
  }
  syncAllDayVisibility();
});

$btnClearDate.addEventListener("click", () => {
  $fAllDay.checked = false;
  $fStartDate.value = "";
  $fStartTime.value = "";
  $fEndDate.value = "";
  $fEndTime.value = "";
  syncAllDayVisibility();
});

$btnArchive.addEventListener("click", () => {
  $archiveConfirmBar.hidden = false;
});
$btnArchiveCancel.addEventListener("click", () => {
  $archiveConfirmBar.hidden = true;
});
$btnArchiveConfirm.addEventListener("click", handleArchiveConfirm);

// 當日清單彈窗互動
$daySheetClose.addEventListener("click", closeDaySheet);
$daySheet.addEventListener("click", (e) => {
  if (e.target === $daySheet) closeDaySheet();
});
$daySheetBody.addEventListener("click", (e) => {
  const item = e.target.closest("[data-sheet-task]");
  if (item) {
    const id = item.dataset.sheetTask;
    closeDaySheet();
    openEditModal(id);
  }
});
$daySheetAdd.addEventListener("click", () => {
  const ymd = state.daySheetYmd || state.focusDate;
  closeDaySheet();
  openCreateModal({ allDay: true, startDate: ymd, endDate: ymd });
});
$daySheetGoto.addEventListener("click", () => {
  const ymd = state.daySheetYmd || state.focusDate;
  closeDaySheet();
  state.focusDate = ymd;
  setRange("day");
});

// Esc 關閉彈窗
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$daySheet.hidden) closeDaySheet();
    else if (state.modal.open) closeTaskModal();
  }
});

// 每分鐘更新現在時間線位置
setInterval(() => {
  const lines = document.querySelectorAll("[data-now-line]");
  if (!lines.length) return;
  const topPx = (getTaipeiNowMinutes() / 60) * HOUR_HEIGHT;
  for (const line of lines) {
    line.style.top = `${topPx}px`;
  }
}, 60000);

// 註冊 Service Worker（僅 https 或 localhost）
if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* ===== 啟動 ===== */
loadData();

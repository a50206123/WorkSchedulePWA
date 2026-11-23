/** 示範資料（虛構，不含真實案件或任務內容） */

const STATUS = [
  { name: "事件", color: "red" },
  { name: "待辦", color: "default" },
  { name: "等待中", color: "purple" },
  { name: "進行中", color: "blue" },
  { name: "完成", color: "green" },
];

const CASES = [
  { id: "demo-case-a", title: "示範案件甲", url: null },
  { id: "demo-case-b", title: "示範案件乙", url: null },
  { id: "demo-case-internal", title: "內部事務", url: null },
];

export function taipeiParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return parts;
}

export function taipeiYmd(date = new Date()) {
  const p = taipeiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function timed(ymd, startHm, endYmd, endHm) {
  return {
    start: `${ymd}T${startHm}:00+08:00`,
    end: `${endYmd}T${endHm}:00+08:00`,
    hasTime: true,
  };
}

export function getDemoSchema() {
  return {
    apiVersion: "2022-06-28",
    databaseId: "demo-db",
    dataSourceId: "demo-ds",
    title: "任務",
    properties: {
      任務項目: { type: "title", name: "任務項目" },
      任務狀態: { type: "status", name: "任務狀態", options: STATUS },
      日期: { type: "date", name: "日期" },
      "💼 Case List": { type: "relation", name: "💼 Case List" },
    },
    cases: CASES,
  };
}

export function getDemoTasks(now = new Date()) {
  const today = taipeiYmd(now);
  const t1 = addDays(today, 1);
  const t2 = addDays(today, 2);
  const t4 = addDays(today, 4);
  const lastWeek = addDays(today, -4);
  const nextMon = (() => {
    const wd = new Date(`${today}T12:00:00+08:00`).getDay();
    const ahead = wd === 0 ? 1 : 8 - wd;
    return addDays(today, ahead);
  })();
  const monthStart = `${today.slice(0, 8)}03`;
  const monthMid = addDays(today, -7);

  const mk = (id, title, status, date, caseId, statusColor) => ({
    id,
    title,
    status,
    statusColor: statusColor || STATUS.find((s) => s.name === status)?.color || "default",
    date,
    caseId: caseId || null,
    caseTitle: CASES.find((c) => c.id === caseId)?.title || null,
    url: `https://www.notion.so/demo/${id}`,
    archived: false,
    lastEditedTime: `${today}T08:00:00.000Z`,
  });

  return [
    mk("demo-1", "內部會議準備", "進行中", { start: today, end: null, hasTime: false }, "demo-case-a"),
    mk("demo-2", "結構審查討論", "進行中", timed(today, "09:00", today, "11:00"), "demo-case-a"),
    mk("demo-3", "與業主通話", "事件", timed(today, "10:00", today, "11:30"), "demo-case-b"),
    mk("demo-4", "撰寫進度報告", "待辦", timed(today, "14:00", today, "16:00"), "demo-case-a"),
    mk("demo-5", "現場勘查", "等待中", { start: t1, end: t2, hasTime: false }, "demo-case-b"),
    mk("demo-6", "繪製變更圖", "待辦", timed(t1, "09:30", t1, "12:00"), "demo-case-a"),
    mk("demo-7", "進度檢討", "事件", timed(t2, "15:00", t2, "17:00"), "demo-case-internal"),
    mk("demo-8", "週報整理", "待辦", { start: t4, end: null, hasTime: false }, "demo-case-internal"),
    mk("demo-9", "整理參考資料", "待辦", null, "demo-case-a"),
    mk("demo-10", "待確認事項", "等待中", null, null),
    mk("demo-11", "提交前次修正", "完成", { start: lastWeek, end: null, hasTime: false }, "demo-case-b"),
    mk("demo-12", "設計原則討論", "待辦", timed(nextMon, "10:00", nextMon, "12:00"), "demo-case-a"),
    mk("demo-13", "啟動會議", "完成", timed(monthMid, "13:30", monthMid, "15:00"), "demo-case-a"),
    mk("demo-14", "跨夜資料核對", "進行中", timed(today, "22:00", t1, "01:30"), "demo-case-internal"),
    mk("demo-15", "上午同步會議", "事件", timed(today, "09:30", today, "10:30"), "demo-case-internal"),
  ];
}

export function createDemoStore(now = new Date()) {
  let tasks = getDemoTasks(now);
  const schema = getDemoSchema();
  let seq = 100;
  return {
    schema,
    async getSchema() {
      return schema;
    },
    async query() {
      return { tasks: tasks.map((t) => ({ ...t, date: t.date ? { ...t.date } : null })) };
    },
    async create(body) {
      const id = `demo-${++seq}`;
      const task = {
        id,
        title: (body.title || "").trim(),
        status: body.status || "待辦",
        statusColor: STATUS.find((s) => s.name === (body.status || "待辦"))?.color || "default",
        date: body.date ? { ...body.date } : null,
        caseId: body.caseId || null,
        caseTitle: CASES.find((c) => c.id === body.caseId)?.title || null,
        url: `https://www.notion.so/demo/${id}`,
        archived: false,
        lastEditedTime: new Date().toISOString(),
      };
      tasks = [task, ...tasks];
      return { task };
    },
    async update(id, body) {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx < 0) throw new Error("找不到這項任務");
      const prev = tasks[idx];
      const next = { ...prev };
      if (body.title !== undefined) next.title = body.title;
      if (body.status !== undefined) {
        next.status = body.status;
        next.statusColor = STATUS.find((s) => s.name === body.status)?.color || "default";
      }
      if (body.date !== undefined) next.date = body.date ? { ...body.date } : null;
      if (body.caseId !== undefined) {
        next.caseId = body.caseId || null;
        next.caseTitle = CASES.find((c) => c.id === body.caseId)?.title || null;
      }
      if (body.archived === true) {
        tasks = tasks.filter((t) => t.id !== id);
        return { task: { ...next, archived: true } };
      }
      next.lastEditedTime = new Date().toISOString();
      tasks = tasks.map((t) => (t.id === id ? next : t));
      return { task: next };
    },
    async archive(id) {
      tasks = tasks.filter((t) => t.id !== id);
      return { ok: true, archived: true, id };
    },
  };
}

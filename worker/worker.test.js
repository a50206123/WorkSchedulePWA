import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { parseTask, buildProperties, formatTaipei, hasTimeInStart, isOriginAllowed, corsHeaders, resetCaseCache, PROP } from "./worker.js";

const ENV = {
  NOTION_TOKEN: "test-notion-token",
  APP_KEY: "test-app-key",
  DATABASE_ID: "db-task-1111",
  DATA_SOURCE_ID: "ds-task-2222",
  CASE_LIST_DATABASE_ID: "db-case-3333",
  ALLOWED_ORIGIN: "http://localhost:4173,https://example.github.io",
};

function notionDatabase() {
  return {
    title: [{ plain_text: "任務" }],
    properties: {
      任務項目: { type: "title", title: {} },
      任務狀態: {
        type: "status",
        status: {
          options: [
            { name: "事件", color: "red" },
            { name: "待辦", color: "default" },
            { name: "等待中", color: "purple" },
            { name: "進行中", color: "blue" },
            { name: "完成", color: "green" },
          ],
        },
      },
      日期: { type: "date", date: {} },
      "💼 Case List": { type: "relation", relation: { database_id: "db-case-3333" } },
    },
  };
}

function casePage(id, title) {
  return {
    id,
    url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    properties: {
      案件編號: { type: "title", title: [{ plain_text: title, text: { content: title } }] },
    },
  };
}

function taskPage(overrides = {}) {
  const id = overrides.id || "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const title = overrides.title ?? "示範任務";
  const status = overrides.status ?? { name: "進行中", color: "blue" };
  const date = overrides.date === undefined
    ? { start: "2026-11-23T09:00:00.000+08:00", end: "2026-11-23T11:00:00.000+08:00" }
    : overrides.date;
  const caseId = overrides.caseId === undefined ? "case-id-001" : overrides.caseId;
  return {
    id,
    url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    archived: false,
    last_edited_time: "2026-11-23T01:00:00.000Z",
    properties: {
      任務項目: { type: "title", title: [{ plain_text: title, text: { content: title } }] },
      任務狀態: { type: "status", status },
      日期: { type: "date", date },
      "💼 Case List": { type: "relation", relation: caseId ? [{ id: caseId }] : [] },
    },
  };
}

function stubFetch(routes) {
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes.find((r) => r.test(method, String(url), init));
    if (!handler) {
      throw new Error(`未預期的 fetch：${key}`);
    }
    const result = await handler.handle(method, String(url), init);
    const status = result.status ?? 200;
    const body = result.body === undefined ? {} : result.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return typeof body === "string" ? body : JSON.stringify(body);
      },
    };
  };
}

async function call(path, { method = "GET", body, key = ENV.APP_KEY, origin = "http://localhost:4173", env = ENV } = {}) {
  const headers = new Headers();
  if (key !== null) headers.set("X-App-Key", key);
  if (origin) headers.set("Origin", origin);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return worker.fetch(request, env);
}

function defaultRoutes() {
  return [
    {
      test: (m, u) => m === "GET" && u.includes("/v1/databases/db-task-1111") && !u.includes("/query"),
      handle: async () => ({ body: notionDatabase() }),
    },
    {
      test: (m, u) => m === "POST" && u.includes("/v1/databases/db-case-3333/query"),
      handle: async () => ({
        body: {
          results: [casePage("case-id-001", "示範案件甲"), casePage("case-id-002", "示範案件乙")],
          has_more: false,
        },
      }),
    },
    {
      test: (m, u) => m === "POST" && u.includes("/v1/databases/db-task-1111/query"),
      handle: async (_m, _u, init) => {
        const body = JSON.parse(init.body || "{}");
        if (!body.start_cursor) {
          return {
            body: {
              results: [
                taskPage({ id: "page-1", title: "上午會議", caseId: "case-id-001" }),
                taskPage({
                  id: "page-2",
                  title: "整天行程",
                  date: { start: "2026-11-23", end: null },
                  caseId: "case-id-002",
                }),
              ],
              has_more: true,
              next_cursor: "cursor-2",
            },
          };
        }
        return {
          body: {
            results: [
              taskPage({
                id: "page-3",
                title: "無日期草稿",
                date: null,
                caseId: null,
                status: { name: "待辦", color: "default" },
              }),
            ],
            has_more: false,
          },
        };
      },
    },
    {
      test: (m, u) => m === "POST" && u.endsWith("/v1/pages"),
      handle: async (_m, _u, init) => {
        const body = JSON.parse(init.body || "{}");
        const title = body.properties[PROP.title].title[0].text.content;
        const statusName = body.properties[PROP.status]?.status?.name || "待辦";
        const date = body.properties[PROP.date]?.date ?? null;
        const caseId = body.properties[PROP.case]?.relation?.[0]?.id ?? null;
        return {
          status: 200,
          body: taskPage({
            id: "new-page-id",
            title,
            status: { name: statusName, color: "blue" },
            date,
            caseId,
          }),
        };
      },
    },
    {
      test: (m, u) => m === "PATCH" && /\/v1\/pages\/.+/.test(u),
      handle: async (_m, u, init) => {
        const body = JSON.parse(init.body || "{}");
        const id = u.split("/").pop();
        if (body.archived) {
          return { body: { id, archived: true } };
        }
        const title = body.properties?.[PROP.title]?.title?.[0]?.text?.content || "已更新";
        const date = body.properties?.[PROP.date]?.date;
        return {
          body: taskPage({
            id,
            title,
            date: date === undefined ? { start: "2026-11-24", end: null } : date,
            caseId: body.properties?.[PROP.case]?.relation?.[0]?.id ?? "case-id-001",
          }),
        };
      },
    },
  ];
}

beforeEach(() => {
  resetCaseCache();
  stubFetch(defaultRoutes());
});

test("未帶或錯的 App Key 回 401", async () => {
  const miss = await call("/schema", { key: null });
  assert.equal(miss.status, 401);
  const bad = await call("/schema", { key: "wrong" });
  assert.equal(bad.status, 401);
  const body = await bad.json();
  assert.match(body.error, /App Key/);
});

test("不被允許的 Origin 回 403", async () => {
  const res = await call("/schema", { origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("OPTIONS 預檢在允許來源時成功", async () => {
  const res = await call("/schema", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:4173");
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /X-App-Key/);
});

test("OPTIONS 對不允許來源回 403", async () => {
  const res = await call("/schema", { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("GET /schema 回傳屬性、狀態選項與案件清單", async () => {
  const res = await call("/schema");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.apiVersion, "2022-06-28");
  assert.equal(body.properties["任務狀態"].type, "status");
  assert.deepEqual(
    body.properties["任務狀態"].options.map((o) => o.name),
    ["事件", "待辦", "等待中", "進行中", "完成"]
  );
  assert.equal(body.properties["💼 Case List"].type, "relation");
  assert.equal(body.cases.length, 2);
  assert.equal(body.cases[0].title, "示範案件甲");
});

test("POST /query 會處理分頁並解析案件名稱與日期", async () => {
  const res = await call("/query", { method: "POST", body: {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tasks.length, 3);

  const timed = body.tasks.find((t) => t.id === "page-1");
  assert.equal(timed.title, "上午會議");
  assert.equal(timed.date.hasTime, true);
  assert.equal(timed.date.start, "2026-11-23T09:00:00+08:00");
  assert.equal(timed.date.end, "2026-11-23T11:00:00+08:00");
  assert.equal(timed.caseTitle, "示範案件甲");

  const allDay = body.tasks.find((t) => t.id === "page-2");
  assert.equal(allDay.date.hasTime, false);
  assert.equal(allDay.date.start, "2026-11-23");
  assert.equal(allDay.caseTitle, "示範案件乙");

  const none = body.tasks.find((t) => t.id === "page-3");
  assert.equal(none.date, null);
  assert.equal(none.caseId, null);
});

test("POST /tasks 會建立任務並寫入 +08:00", async () => {
  let captured;
  const routes = defaultRoutes();
  routes[3] = {
    test: (m, u) => m === "POST" && u.endsWith("/v1/pages"),
    handle: async (_m, _u, init) => {
      captured = JSON.parse(init.body);
      return defaultRoutes()[3].handle(_m, _u, init);
    },
  };
  stubFetch(routes);

  const res = await call("/tasks", {
    method: "POST",
    body: {
      title: "新任務",
      status: "待辦",
      date: {
        start: "2026-11-23T14:00",
        end: "2026-11-23T16:00",
        hasTime: true,
      },
      caseId: "case-id-002",
    },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.task.title, "新任務");
  assert.equal(captured.parent.database_id, ENV.DATABASE_ID);
  assert.equal(captured.properties["日期"].date.start, "2026-11-23T14:00:00+08:00");
  assert.equal(captured.properties["日期"].date.end, "2026-11-23T16:00:00+08:00");
  assert.equal(captured.properties["💼 Case List"].relation[0].id, "case-id-002");
});

test("缺少標題的新增會回 400", async () => {
  const res = await call("/tasks", { method: "POST", body: { status: "待辦" } });
  assert.equal(res.status, 400);
});

test("PATCH /tasks/:id 可更新標題與整天日期", async () => {
  let captured;
  const routes = defaultRoutes();
  routes[4] = {
    test: (m, u) => m === "PATCH" && /\/v1\/pages\/.+/.test(u),
    handle: async (_m, u, init) => {
      captured = JSON.parse(init.body);
      return defaultRoutes()[4].handle(_m, u, init);
    },
  };
  stubFetch(routes);

  const res = await call("/tasks/page-1", {
    method: "PATCH",
    body: {
      title: "改名",
      date: { start: "2026-11-24", end: "2026-11-25", hasTime: false },
    },
  });
  assert.equal(res.status, 200);
  assert.equal(captured.properties["任務項目"].title[0].text.content, "改名");
  assert.deepEqual(captured.properties["日期"].date, {
    start: "2026-11-24",
    end: "2026-11-25",
  });
});

test("DELETE /tasks/:id 會封存頁面", async () => {
  let captured;
  const routes = defaultRoutes();
  routes[4] = {
    test: (m, u) => m === "PATCH" && u.includes("/pages/page-1"),
    handle: async (_m, _u, init) => {
      captured = JSON.parse(init.body);
      return { body: { id: "page-1", archived: true } };
    },
  };
  stubFetch(routes);
  const res = await call("/tasks/page-1", { method: "DELETE" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.archived, true);
  assert.equal(captured.archived, true);
});

test("parseTask 與日期工具", () => {
  assert.equal(hasTimeInStart("2026-11-23"), false);
  assert.equal(hasTimeInStart("2026-11-23T09:00:00+08:00"), true);
  assert.equal(formatTaipei(new Date("2026-11-23T01:00:00.000Z")), "2026-11-23T09:00:00+08:00");

  const parsed = parseTask(
    taskPage({ date: { start: "2026-11-23", end: "2026-11-25" }, caseId: "case-id-001" }),
    new Map([["case-id-001", "示範案件甲"]])
  );
  assert.equal(parsed.date.hasTime, false);
  assert.equal(parsed.date.end, "2026-11-25");
  assert.equal(parsed.caseTitle, "示範案件甲");
});

test("buildProperties 整天單日不送 end", () => {
  const props = buildProperties(
    { title: "x", date: { start: "2026-11-23", end: "2026-11-23", hasTime: false } },
    { partial: false }
  );
  assert.deepEqual(props["日期"].date, { start: "2026-11-23", end: null });
});

test("isOriginAllowed 與 CORS", () => {
  assert.equal(isOriginAllowed("http://localhost:4173", ENV), true);
  assert.equal(isOriginAllowed("https://example.github.io", ENV), true);
  assert.equal(isOriginAllowed("https://nope.com", ENV), false);
  const headers = corsHeaders("http://localhost:4173", ENV);
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:4173");
});

test("GET /health 不需 App Key", async () => {
  const res = await call("/health", { key: null });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

/**
 * Notion 工作排程 API 轉接（Cloudflare Worker）
 * Notion API 版本：2022-06-28（databases query、pages create/update）
 *
 * Secrets：NOTION_TOKEN、APP_KEY
 * Vars：DATABASE_ID、DATA_SOURCE_ID、CASE_LIST_DATABASE_ID、ALLOWED_ORIGIN
 */

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

const PROP = {
  title: "任務項目",
  status: "任務狀態",
  date: "日期",
  case: "💼 Case List",
};

const CASE_TITLE_PROP = "案件編號";
const CASE_CACHE_TTL_MS = 5 * 60 * 1000;

const caseCache = {
  byId: new Map(),
  list: null,
  fetchedAt: 0,
};

export { PROP, CASE_TITLE_PROP, NOTION_VERSION, parseTask, buildProperties, formatTaipei, hasTimeInStart, corsHeaders, isOriginAllowed };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      const allowed = isOriginAllowed(origin, env);
      if (!allowed) {
        return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (!isOriginAllowed(origin, env) && origin) {
      return json({ error: "來源不被允許" }, 403, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health" && request.method === "GET") {
      return json({ ok: true, version: NOTION_VERSION }, 200, cors);
    }

    const appKey = request.headers.get("X-App-Key") || "";
    if (!env.APP_KEY || appKey !== env.APP_KEY) {
      return json({ error: "未授權：請檢查 App Key" }, 401, cors);
    }

    try {
      if (path === "/schema" && request.method === "GET") {
        return json(await handleSchema(env), 200, cors);
      }
      if (path === "/query" && request.method === "POST") {
        const body = await readJson(request);
        return json(await handleQuery(env, body), 200, cors);
      }
      if (path === "/tasks" && request.method === "POST") {
        const body = await readJson(request);
        return json(await handleCreate(env, body), 201, cors);
      }

      const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1]);
        if (request.method === "PATCH") {
          const body = await readJson(request);
          return json(await handleUpdate(env, id, body), 200, cors);
        }
        if (request.method === "DELETE") {
          return json(await handleArchive(env, id), 200, cors);
        }
      }

      return json({ error: "找不到這個端點" }, 404, cors);
    } catch (err) {
      const status = err.status && Number.isInteger(err.status) ? err.status : 500;
      const message = err.publicMessage || err.message || "伺服器錯誤";
      return json({ error: message, details: err.details || undefined }, status, cors);
    }
  },
};

function isOriginAllowed(origin, env) {
  if (!origin) return true;
  const raw = (env && env.ALLOWED_ORIGIN) || "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*")) return true;
  return list.includes(origin);
}

function corsHeaders(origin, env) {
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-App-Key",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isOriginAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("JSON 格式不正確");
    err.status = 400;
    err.publicMessage = "JSON 格式不正確";
    throw err;
  }
}

async function notion(env, method, path, body) {
  if (!env.NOTION_TOKEN) {
    const err = new Error("尚未設定 NOTION_TOKEN");
    err.status = 500;
    err.publicMessage = "伺服器尚未設定 Notion 金鑰";
    throw err;
  }
  if (!env.DATABASE_ID) {
    const err = new Error("尚未設定 DATABASE_ID");
    err.status = 500;
    err.publicMessage = "伺服器尚未設定資料庫編號";
    throw err;
  }

  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!res.ok) {
    const err = new Error(data.message || `Notion API ${res.status}`);
    err.status = res.status;
    err.publicMessage = data.message || `Notion 回傳錯誤（${res.status}）`;
    err.details = data.code || undefined;
    throw err;
  }
  return data;
}

async function handleSchema(env) {
  const db = await notion(env, "GET", `/databases/${env.DATABASE_ID}`);
  const properties = normalizeSchemaProperties(db.properties || {});
  const cases = await loadCases(env, true);
  return {
    apiVersion: NOTION_VERSION,
    databaseId: env.DATABASE_ID,
    dataSourceId: env.DATA_SOURCE_ID || null,
    title: plainTitle(db.title) || "任務",
    properties,
    cases,
  };
}

function normalizeSchemaProperties(raw) {
  const out = {};
  for (const [name, prop] of Object.entries(raw)) {
    const item = { type: prop.type, name };
    if (prop.type === "status" && prop.status) {
      item.options = (prop.status.options || []).map((o) => ({
        name: o.name,
        color: o.color || "default",
      }));
      item.groups = prop.status.groups || undefined;
    }
    if (prop.type === "select" && prop.select) {
      item.options = (prop.select.options || []).map((o) => ({
        name: o.name,
        color: o.color || "default",
      }));
    }
    if (prop.type === "relation") {
      item.relationDatabaseId = (prop.relation && prop.relation.database_id) || null;
    }
    out[name] = item;
  }
  return out;
}

async function handleQuery(env, _body) {
  const pages = await paginate(env, `/databases/${env.DATABASE_ID}/query`, {});
  await loadCases(env, false);
  const missing = new Set();
  const tasks = pages.map((page) => parseTask(page, caseCache.byId, missing));
  if (missing.size) {
    await resolveCases(env, [...missing]);
    for (const task of tasks) {
      if (task.caseId && !task.caseTitle) {
        const found = caseCache.byId.get(task.caseId);
        if (found) task.caseTitle = found;
      }
    }
  }
  return { tasks };
}

async function handleCreate(env, body) {
  const properties = buildProperties(body, { partial: false });
  const page = await notion(env, "POST", "/pages", {
    parent: { database_id: env.DATABASE_ID },
    properties,
  });
  await loadCases(env, false);
  const missing = new Set();
  const task = parseTask(page, caseCache.byId, missing);
  if (missing.size) await resolveCases(env, [...missing]);
  if (task.caseId && !task.caseTitle) {
    const found = caseCache.byId.get(task.caseId);
    if (found) task.caseTitle = found;
  }
  return { task };
}

async function handleUpdate(env, id, body) {
  const properties = buildProperties(body, { partial: true });
  const payload = { properties };
  if (body.archived === true || body.archived === false) {
    payload.archived = body.archived;
  }
  const page = await notion(env, "PATCH", `/pages/${id}`, payload);
  await loadCases(env, false);
  const missing = new Set();
  const task = parseTask(page, caseCache.byId, missing);
  if (missing.size) await resolveCases(env, [...missing]);
  if (task.caseId && !task.caseTitle) {
    const found = caseCache.byId.get(task.caseId);
    if (found) task.caseTitle = found;
  }
  return { task };
}

async function handleArchive(env, id) {
  const page = await notion(env, "PATCH", `/pages/${id}`, { archived: true });
  return { ok: true, archived: true, id: page.id };
}

async function paginate(env, path, body) {
  const results = [];
  let cursor;
  do {
    const payload = { ...body, page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const data = await notion(env, "POST", path, payload);
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function loadCases(env, force) {
  const now = Date.now();
  if (!force && caseCache.list && now - caseCache.fetchedAt < CASE_CACHE_TTL_MS) {
    return caseCache.list;
  }
  const dbId = env.CASE_LIST_DATABASE_ID;
  if (!dbId) {
    caseCache.list = [];
    caseCache.fetchedAt = now;
    return caseCache.list;
  }
  const pages = await paginate(env, `/databases/${dbId}/query`, {});
  const list = pages.map((p) => {
    const title = extractTitle(p.properties && p.properties[CASE_TITLE_PROP]) || "未命名案件";
    caseCache.byId.set(p.id, title);
    caseCache.byId.set(p.id.replace(/-/g, ""), title);
    return { id: p.id, title, url: p.url || null };
  });
  caseCache.list = list;
  caseCache.fetchedAt = now;
  return list;
}

async function resolveCases(env, ids) {
  for (const id of ids) {
    if (caseCache.byId.has(id)) continue;
    try {
      const page = await notion(env, "GET", `/pages/${id}`);
      const title =
        extractTitle(page.properties && page.properties[CASE_TITLE_PROP]) ||
        extractAnyTitle(page.properties) ||
        "未命名案件";
      caseCache.byId.set(id, title);
      caseCache.byId.set(id.replace(/-/g, ""), title);
    } catch {
      caseCache.byId.set(id, "未知案件");
    }
  }
}

export function resetCaseCache() {
  caseCache.byId = new Map();
  caseCache.list = null;
  caseCache.fetchedAt = 0;
}

function parseTask(page, byId, missing) {
  const props = page.properties || {};
  const title = extractTitle(props[PROP.title]) || "";
  const statusObj = props[PROP.status] && props[PROP.status].status;
  const dateObj = props[PROP.date] && props[PROP.date].date;
  const relations = (props[PROP.case] && props[PROP.case].relation) || [];
  const caseId = relations[0] ? relations[0].id : null;
  let caseTitle = null;
  if (caseId) {
    caseTitle = (byId && (byId.get(caseId) || byId.get(caseId.replace(/-/g, "")))) || null;
    if (!caseTitle && missing) missing.add(caseId);
  }

  return {
    id: page.id,
    title,
    status: statusObj ? statusObj.name : null,
    statusColor: statusObj ? statusObj.color || "default" : null,
    date: normalizeDate(dateObj),
    caseId,
    caseTitle,
    url: page.url || null,
    archived: Boolean(page.archived),
    lastEditedTime: page.last_edited_time || null,
  };
}

function normalizeDate(dateObj) {
  if (!dateObj || !dateObj.start) return null;
  const hasTime = hasTimeInStart(dateObj.start);
  const start = hasTime ? formatTaipei(new Date(dateObj.start)) : dateObj.start.slice(0, 10);
  let end = null;
  if (dateObj.end) {
    end = hasTime || hasTimeInStart(dateObj.end)
      ? formatTaipei(new Date(dateObj.end))
      : dateObj.end.slice(0, 10);
  }
  return { start, end, hasTime };
}

function hasTimeInStart(start) {
  return typeof start === "string" && start.includes("T");
}

function formatTaipei(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function buildProperties(body, { partial }) {
  const properties = {};

  if (!partial || body.title !== undefined) {
    const title = (body.title || "").trim();
    if (!partial && !title) {
      const err = new Error("請填寫任務標題");
      err.status = 400;
      err.publicMessage = "請填寫任務標題";
      throw err;
    }
    if (body.title !== undefined) {
      properties[PROP.title] = {
        title: title ? [{ text: { content: title } }] : [],
      };
    }
  }

  if (body.status !== undefined) {
    properties[PROP.status] = body.status
      ? { status: { name: body.status } }
      : { status: null };
  }

  if (body.date !== undefined) {
    properties[PROP.date] = { date: toNotionDate(body.date) };
  }

  if (body.caseId !== undefined) {
    properties[PROP.case] = {
      relation: body.caseId ? [{ id: body.caseId }] : [],
    };
  }

  if (!partial && !properties[PROP.title]) {
    const err = new Error("請填寫任務標題");
    err.status = 400;
    err.publicMessage = "請填寫任務標題";
    throw err;
  }

  return properties;
}

function toNotionDate(date) {
  if (!date || !date.start) return null;
  const hasTime = Boolean(date.hasTime);
  const start = hasTime ? ensureTaipeiOffset(date.start) : date.start.slice(0, 10);
  let end = null;
  if (date.end) {
    end = hasTime || hasTimeInStart(date.end)
      ? ensureTaipeiOffset(date.end)
      : date.end.slice(0, 10);
    if (!hasTime && end === start) end = null;
    if (hasTime && end === start) end = null;
  }
  return { start, end };
}

function ensureTaipeiOffset(value) {
  if (typeof value !== "string") return formatTaipei(new Date(value));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00+08:00`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error("日期格式不正確");
    err.status = 400;
    err.publicMessage = "日期格式不正確";
    throw err;
  }
  return formatTaipei(d);
}

function extractTitle(prop) {
  if (!prop) return "";
  const arr = prop.title || prop.rich_text;
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text || (t.text && t.text.content) || "").join("");
}

function extractAnyTitle(properties) {
  if (!properties) return "";
  for (const prop of Object.values(properties)) {
    if (prop && prop.type === "title") return extractTitle(prop);
  }
  return "";
}

function plainTitle(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text || (t.text && t.text.content) || "").join("");
}

# 工作排程（Notion 任務庫 PWA）

以 Notion 任務資料庫為資料來源的工作排程漸進式網頁應用（PWA），提供「時間軸（日／週／月）」、「清單（依狀態或 Case List 分組與篩選）」及重疊時段提醒功能。

## 架構說明

- **前端（`web/`）**：純靜態 HTML / CSS / ES Modules（無建置步驟），部署於 **GitHub Pages**。
- **後端轉接（`worker/`）**：**Cloudflare Worker** 轉接 Notion API（版本 `2022-06-28`）。
  - **為什麼需要 Worker？** 瀏覽器無法直接呼叫 Notion API（CORS 限制），且 GitHub Pages 為公開靜態網站，絕不可將 `NOTION_TOKEN` 寫進前端或公開儲存庫。

---

## 首次部署與設定步驟（給 YuChen）

### 步驟 1：建立 Notion Integration 並分享資料庫

1. 前往 [Notion Integrations](https://www.notion.so/my-integrations) 建立一個新的 **Internal Integration（內部整合）**。
2. 記下產生的 **Internal Integration Secret**（即 `NOTION_TOKEN`，開頭通常為 `ntn_` 或 `secret_`）。
3. 在 Notion 開啟以下兩個資料庫，分別點右上角 `...` → **Connections（連結）** → 加入你剛建立的 Integration，並確認權限為 **Can edit**（否則無法新增或修改任務）：
   - **「🎟️ 任務」資料庫**
   - **「💼 Case List」資料庫**

---

### 步驟 2：部署 Cloudflare Worker

請擇一使用 **方式 A（命令列 Wrangler）** 或 **方式 B（Cloudflare 儀表板）**。

#### 方式 A：使用 Wrangler CLI（建議）

1. 切換到 `worker` 目錄並登入 Cloudflare：
   ```bash
   cd worker
   npx wrangler login
   ```
2. 檢查 `worker/wrangler.toml` 內的 `[vars]` 設定：
   - `DATABASE_ID = "33d5ab5563a680218a90dd786aa20ab3"`
   - `DATA_SOURCE_ID = "33d5ab5563a68031973f000bfe8abd0a"`
   - `CASE_LIST_DATABASE_ID = "33b5ab5563a680b0a2abd7802fc107ca"`
   - 將 `ALLOWED_ORIGIN` 改成你的 GitHub Pages 網址（不含結尾斜線，若需本機測試可用逗號一併加上 `http://localhost:4173`），例如：
     ```toml
     ALLOWED_ORIGIN = "https://你的帳號.github.io,http://localhost:4173"
     ```
3. 設定兩組機密變數（Secrets，不會寫進程式碼）：
   ```bash
   npx wrangler secret put NOTION_TOKEN
   npx wrangler secret put APP_KEY
   ```
   - `NOTION_TOKEN`：步驟 1 複製的 Notion Integration Secret。
   - `APP_KEY`：自己設定一組給前端驗證用的長隨機密鑰（**不是** Notion Token）。
4. 部署並記下產出的 Worker 網址（例如 `https://notion-planner-api.你的帳號.workers.dev`）：
   ```bash
   npx wrangler deploy
   ```

#### 方式 B：使用 Cloudflare 儀表板手動部署

1. 登入 Cloudflare Dashboard → **Workers & Pages** → **Create** → 建立一個新的 Worker。
2. 進入編輯程式碼畫面，將本專案 `worker/worker.js` 的完整內容貼上並儲存。
3. 前往該 Worker 的 **Settings → Variables and Secrets**：
   - 新增 **Variables（明文變數）**：
     - `DATABASE_ID`：`33d5ab5563a680218a90dd786aa20ab3`
     - `DATA_SOURCE_ID`：`33d5ab5563a68031973f000bfe8abd0a`
     - `CASE_LIST_DATABASE_ID`：`33b5ab5563a680b0a2abd7802fc107ca`
     - `ALLOWED_ORIGIN`：`https://你的帳號.github.io,http://localhost:4173`
   - 新增 **Secrets（加密變數）**：
     - `NOTION_TOKEN`：你的 Notion Integration Secret
     - `APP_KEY`：自己設定給前端用的密鑰
4. 點擊 **Deploy**，記下 Worker 網址。

---

### 步驟 3：發佈前端至 GitHub Pages

1. 將專案推送至 GitHub 儲存庫（`main` 或 `master` 分支）。
2. 在 GitHub 儲存庫前往 **Settings → Pages**。
3. 在 **Build and deployment → Source** 選擇 **GitHub Actions**。
   - 專案已內附 `.github/workflows/pages.yml`，每次 push 會自動將 `web/` 目錄發佈到 GitHub Pages。
4. （替代方案）若你想改用分支的 `/docs` 資料夾發佈：請將 `web/` 內的所有檔案複製到專案根目錄的 `docs/`，並在 Settings → Pages 選擇 Deploy from a branch → `/docs`。

---

### 步驟 4：在網站設定頁完成連線

1. 開啟發佈後的 GitHub Pages 網址（首次造訪預設為「示範模式」）。
2. 點擊頂欄「**設定**」分頁：
   - 貼上步驟 2 取得的 **Worker 網址**（結尾斜線會自動移除）。
   - 貼上你設定的 **App Key**。
   - 點擊「**儲存設定**」並按「**測試連線**」，確認顯示連線成功與資料庫資訊。
   - 將「**示範模式**」開關關閉，即可開始同步並操作真實的 Notion 任務庫。

---

### 步驟 5：本機預覽與測試

示範模式不需要部署 Worker 即可完整體驗所有功能（含今日重疊時段、跨夜與跨日行程、拖曳改時間、新增編輯與封存）：

```bash
# 啟動本機靜態伺服器（擇一）
npm start
# 或
npx serve web -l 4173
```

開啟瀏覽器造訪 `http://localhost:4173`。

執行 Worker 單元測試：

```bash
npm test
```

---

### 步驟 6：安全注意事項

- **絕對不要**將 `NOTION_TOKEN`、`APP_KEY` 或 `.dev.vars` 提交到 Git 儲存庫。
- `wrangler.toml` 中的 `DATABASE_ID`、`DATA_SOURCE_ID`、`CASE_LIST_DATABASE_ID` 為資料庫識別碼，非存取金鑰；實際憑證務必僅透過 `wrangler secret put` 或 Cloudflare 儀表板 Secrets 設定。
- 前端設定頁輸入的 Worker 網址與 App Key 僅儲存在該裝置瀏覽器的 `localStorage`（鍵名 `np.workerUrl`、`np.appKey`），不會寫入程式或送往其他網域。
- 請確認 `ALLOWED_ORIGIN` 僅列出你信任的來源網址，避免設為 `*`。

---

## API 端點一覽（Cloudflare Worker）

除 `/health` 外，所有端點皆須於請求標頭帶入 `X-App-Key: <APP_KEY>` 與 `Content-Type: application/json`。

| 方法 | 路徑 | 說明 | 請求內容 / 回應格式 |
| --- | --- | --- | --- |
| `GET` | `/health` | 健康檢查（不需 App Key） | 回應 `{ ok: true, version: "2022-06-28" }` |
| `GET` | `/schema` | 讀取任務庫結構與 Case List | 回應 `{ apiVersion, databaseId, title, properties, cases: [{ id, title, url }] }` |
| `POST` | `/query` | 查詢所有未封存任務 | Body `{}` → 回應 `{ tasks: [{ id, title, status, statusColor, date, caseId, caseTitle, url, archived }] }` |
| `POST` | `/tasks` | 新增任務 | Body `{ title, status, date, caseId }` → 回應 `{ task }`（狀態碼 201） |
| `PATCH` | `/tasks/:id` | 局部更新任務 | Body `{ title?, status?, date?, caseId?, archived? }` → 回應 `{ task }` |
| `DELETE` | `/tasks/:id` | 封存任務 | 回應 `{ ok: true, archived: true, id }` |

### 日期格式約定（固定時區 `Asia/Taipei`）

- **有時間**：`{ start: "2026-11-23T09:00:00+08:00", end: "2026-11-23T11:00:00+08:00", hasTime: true }`
- **整天**：`{ start: "2026-11-23", end: "2026-11-25" | null, hasTime: false }`（結束日為包含；單日行程 `end` 送 `null`）
- **無日期**：`null`（僅顯示於清單，不出現在時間軸）

---

## Notion 欄位對照表

| 前端欄位 | Notion 資料庫 | Notion 屬性名稱 | Notion 屬性型別 |
| --- | --- | --- | --- |
| 任務標題（`title`） | 🎟️ 任務 | `任務項目` | `title` |
| 任務狀態（`status`） | 🎟️ 任務 | `任務狀態` | `status`（事件、待辦、等待中、進行中、完成等） |
| 排程日期（`date`） | 🎟️ 任務 | `日期` | `date` |
| 所屬案件（`caseId` / `caseTitle`） | 🎟️ 任務 | `💼 Case List` | `relation` |
| 案件顯示名稱 | 💼 Case List | `案件編號` | `title` |
"# WorkSchedulePWA" 

# GitHub Star Agent

Local-first GitHub star 管理应用：获取你的 starred 仓库，利用 WASM 向量库 LunaVDB + 大模型为仓库生成摘要与标签，支持自然语言语义搜索、过滤与增量同步。

## 功能
- GitHub PAT/OAuth 登录，增量同步 starred 仓库（仅抓最新几页，自动早停）。
- 本地 IndexedDB 存储仓库数据；WASM LunaVDB 快照保存在浏览器，重启秒级恢复。
- AI 生成摘要/标签 + 向量 embedding，支持自然语言搜索。
- 过滤/排序：语言、标签、最新、Star 数、已索引优先。
- shadcn UI，卡片化展示，Infinite Scroll。

## 快速开始
1. `npm install` 然后 `npm run dev` 启动。
2. 进入 `Settings`：
   - 填入 GitHub Personal Access Token（最少 `read:user` + `public_repo` 即可读取 Stars）。
   - 填入 OpenAI 兼容 API Key 和可选 Base URL（默认为官方 https://api.openai.com/v1）。
3. 回到 Dashboard：
   - 点击 `Sync Stars` 拉取最新 Stars（首次全量，后续仅最新几页增量）。
   - 点击 `Index All` 生成 AI 摘要/标签并向量化，索引进度在顶部显示。
4. 使用顶部搜索框输入自然语言描述，配合语言/标签筛选与排序快速找到仓库。

## 开发说明
- 技术栈：React + TypeScript + Vite + Dexie + shadcn/ui + LunaVDB (WASM)。
- 数据表：`repositories`、`syncState`、`settings`、`vectorStore`（包含向量快照与版本号）。
- 若想重建向量库，可清理 IndexedDB 或 bump `VECTOR_SNAPSHOT_VERSION` 后重新索引。

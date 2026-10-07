# 美女运镜 · 每日清单

通过两条参考视频及相关推荐发现作品，自动筛选单条点赞、原视频时长和竖屏比例。每天选 20 条直接展示，优先 1 万赞以上；数量不足时显示实际数量。页面使用樱花粉主题。

[打开镜头日记](https://mjy0808.github.io/DouyinBeautySearch/)

## 采集规则

- 原视频高大于宽，优先 9:16；
- 总时长不超过 15 秒；
- 单条点赞至少 5,000，优先 10,000 以上；
- 按参考作品的相关推荐发现相似风格；
- 标注 AI 内容或明确未成年标签的作品不收录；
- 按已展示视频 ID 跨日去重。

通过基础条件就直接进入每日清单，不需要人工确认或模型接口。程序不判断画面中的人物和运镜。

## 页面

每日清单、作者/标题搜索、点赞筛选、排序、原视频链接、当前浏览器收藏、CSV 导出和历史日期。每条记录显示采集时间。浏览器实际画面只取一张封面，不下载视频文件。

## 独立自动化

GitHub Actions 在北京时间 **09:17、11:17** 采集并发布，支持手动运行。当天达到 20 条时跳过；数量不足或来源受阻时继续尝试。GitHub 定时触发可能延迟。

不需要打开 Codex，未安装本机定时任务。仓库公开，Pages 使用 GitHub Actions，Actions Variable `PAGES_ENABLED=true` 已启用。

`Publish saved report` 在页面文件变更时自动发布，也可手动运行。它恢复最近成功运行的报告和图片，用最新规则生成每日清单，再套用当前页面设计，避免重新发布旧格式或清空已有数据。

失败重试保留当天先前采集的视频及原采集时间；新的页面指标明确不符合条件时才移除。播放器等待 20 秒，普通加载失败重试一次，连续普通失败最多 6 页。遇到明确验证、登录要求或 HTTP 403 时停止本轮访问。失败摘要和截图保存在 `data/diagnostics/`。

Actions cache 保存状态、历史与封面；每次运行另有 60 天的数据和页面 artifact 备份。历史索引保留最近 60 个日报。

如需恢复备份，在每日工作流中填写 `restore_run_id`；勾选 `restore_only` 可仅恢复和发布。恢复会以该备份的历史状态为准，应选择覆盖需要保留日期的备份。

## 本地运行

要求 Node.js 22 或更新版本：

```bash
npm ci
npx playwright install chromium
npm test
npm run build
npm run serve
```

打开 `http://127.0.0.1:8077/`。

```bash
npm run collect
npm run collect -- --limit 10
npm run collect -- --probe --limit 6
```

本机可使用现有 Chrome：

```bash
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run collect
```

`npm run build` 自动转换旧格式存档，将达标记录并入每日清单；不重置已有日期、已展示 ID 或采集时间。没有任何模型依赖或模型调用费用。

## 数据

```text
seeds/manual.json       首份 20 条视频
seeds/frontier.json     发现起点
site/data/latest.json   最新日报
site/archive/*.json     历史日报
site/assets/            视频封面
data/state.json         去重、发现队列、历史状态
data/run-errors.json    本次来源失败信息
data/diagnostics/       来源诊断
```

- [Playwright CI 安装](https://playwright.dev/docs/ci)
- [GitHub schedule 触发规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

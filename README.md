# 美女运镜 · 每日精选

参考 `/Users/roy/Documents/SearchApp` 的独立日报方案：**GitHub Actions 每天采集，GitHub Pages 展示清单和历史日期**。运行时不需要打开 Codex，也不通过 Codex 的定时任务执行。

首份页面包含本聊天实际核验过的 20 条视频。随后每日从两条参考及相关推荐继续发现作品，按视频 ID 去重。

## 页面

- 精选清单、待核对候选、当前浏览器收藏；
- 原视频链接、作者、点赞、时长、竖屏比例、发布时间和核验时间；
- 搜索作者/标题/镜头特点，按点赞筛选，按点赞/时长/发布时间排序；
- CSV 导出与按日期查看历史日报；
- 手机和桌面布局；
- 候选的四个时点截图，便于检查人物和镜头变化。

默认要求：原视频竖屏（高大于宽，优先 9:16）、总时长不超过 15 秒、单条点赞至少 5,000，优先 10,000 以上。只收成年女性为主体且有镜头变化的真人内容。

## 当前自动化范围

用户目前没有视觉 API，因此自动采集会核对**单条点赞、播放器原始宽高和总时长**，为符合基础条件的新候选保存四个时点截图，放到页面“待核对”中。这些候选**不会自动冒充已核验的美女运镜精选**。

首份人工核验清单一直可通过历史日报查阅。以后接入视觉接口后，程序才会进一步审核成年女性主体、真人画面、镜头变化与参考风格，将审核通过的作品自动列入精选。审核不确定时不通过，数量不足时显示真实缺口。

不承诺每天必有 20 条满足全部要求的新作品；页面标明当天实收数量。访问需要验证码或没有可播放的公开视频时，记录失败，不绕过验证。截图来源是浏览器实际播放画面，不下载视频文件。

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

独立采集（不需要 Codex）：

```bash
npm run collect
# 调试时限制访问数量
npm run collect -- --limit 10
# 仅检查来源可访问性，不修改日报
npm run collect -- --probe --limit 6
```

本机可直接使用现有 Chrome：

```bash
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run collect
```

`npm run build` 在首次运行时导入已核验首份清单；已有历史时恢复最新日报，不会把每天的结果重置成首份清单。

## 每日任务与上线

`.github/workflows/daily-beauty.yml` 设置了北京时间 **09:17 主采集、11:17 备用采集**，支持 Actions 页面手动运行。当天已经凑齐已核验精选时跳过；仍在待核对、采集受阻或精选不足时，备用时段继续尝试。GitHub 的定时触发可能延迟，不保证准点。

1. 推送代码到默认分支 `main`，每日工作流即可注册。
2. Settings → Pages 中将 Source 设为 GitHub Actions。
3. Settings → Secrets and variables → Actions → Variables 添加 `PAGES_ENABLED=true`，启用页面发布。
4. 首次手动运行 `Daily beauty camera collection`，检查页面与采集结果。

仓库已公开，Pages 已配置为 GitHub Actions，`PAGES_ENABLED=true` 已启用。在线地址：[镜头日记](https://mjy0808.github.io/DouyinBeautySearch/)。每次运行的 HTML 页面及数据另存为 `beauty-site-*` / `beauty-data-*` artifact。

`Publish saved report` 可单独发布仓库中已有的页面，供首次上线或网页恢复使用，不等待新一轮采集。日常更新仍由每日采集工作流直接发布。

**来源实测：**2026-10-06，本机 Chrome 能读取抖音详情并采集候选；GitHub 托管运行器两次均返回 `VIDEO_UNAVAILABLE`，没有采到新候选。任务成功仅表示报告与备份流程完成，不表示抖音可访问。页面会明确显示采集受阻，并保留已核验首份清单；云端定时任务继续重试。

Actions cache 保存历史和缩略图，每次运行另有 60 天的报告/数据备份。历史索引保留最近 60 个日报。首次从零恢复时会显示首份核验清单；cache 被清理后可从 artifact 恢复 `data/`，避免历史去重状态丢失。

候选逐日按 ID 去重，不重复把前几天的候选当作当天新发现；同一天的备用采集可以重新检查未完成的候选。精选按已交付 ID 长期去重。

## 可选：以后接入视觉审核

只在仓库 Actions **Secret** 配置 `VISION_API_KEY`，不要提交密钥或在网页中填写。可选 Actions **Variables**：

| 名称 | 默认值 |
|---|---|
| `VISION_BASE_URL` | `https://api.openai.com/v1` |
| `VISION_MODEL` | `gpt-4.1-mini` |
| `VISION_API_MODE` | `responses`；兼容服务可改为 `chat` |

接口必须支持图像输入及 JSON Schema 输出。每次最多审核 60 条，访问最多 140 页，采集时间限制 1,100 秒，可在 `config.json` 调整。API 按所用服务计费；没有密钥时不请求、不产生模型调用费用。单次接口失败、输出为空或字段不合格不会放行作品。

本地可使用 Node.js 的 `--env-file` 参数加载自行保存的 `.env`：

```bash
node --env-file=.env src/cli.mjs
```

## 数据文件

```text
seeds/manual.json       首份人工核验的 20 条清单
seeds/frontier.json     从已访问公开相关推荐得到的发现起点
site/index.html         网页
site/data/latest.json   最新日报
site/archive/*.json     历史日报
data/state.json         交付去重、发现队列、历史快照
data/pending.json       仅基础条件达标的待核对候选
data/run-errors.json    本次来源/接口失败状态（无密钥）
```

## 验证依据

- [Playwright CI 安装](https://playwright.dev/docs/ci)
- [GitHub schedule 触发规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Pages 可用范围](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI 结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)

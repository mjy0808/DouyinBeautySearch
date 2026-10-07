export function parseCount(value) {
  const match = String(value ?? '').trim().replaceAll(',', '').match(/^(\d+(?:\.\d+)?)\s*([万亿wW]?)$/);
  if (!match) return null;
  return Math.round(Number(match[1]) * ({ 万: 10000, 亿: 100000000, w: 10000, W: 10000 }[match[2]] ?? 1));
}

export function dateInZone(now = new Date(), timezone = 'Asia/Shanghai') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validId(id) { return /^\d{18,20}$/.test(String(id)); }
export function videoUrl(id) {
  if (!validId(id)) throw new Error('Invalid video ID');
  return `https://www.douyin.com/video/${id}`;
}

export function parseDetail(body, id, media) {
  const start = body.search(/\n\d{2}:\d{2}\s*\/\s*\d{2}:\d{2}/);
  const detail = start >= 0 ? body.slice(start) : body;
  // These are the four counters immediately before 举报, not account totals.
  const stats = detail.match(/\n([^\n]+)\n([\d.,万亿]+)\n([\d.,万亿]+)\n([\d.,万亿]+)\n([\d.,万亿]+)\n举报/);
  const author = detail.match(/\n([^\n]+)\n\s*粉丝[\d.,万亿]+获赞/);
  const published = detail.match(/发布时间：([^\n]+)/);
  const beforeComments = detail.split('全部评论')[0];
  return {
    id, url: videoUrl(id), author: author?.[1]?.trim() ?? '', caption: stats?.[1]?.trim() ?? '',
    likes: parseCount(stats?.[2]), likes_display: stats?.[2] ?? '', published_at: published?.[1] ?? '',
    width: media?.width ?? 0, height: media?.height ?? 0, duration_seconds: media?.duration ?? 0,
    ai_label: /作品含\s*AI|疑似使用了\s*AI|(?:内容|作品)(?:由|为)\s*AI\s*生成/.test(beforeComments),
  };
}

export function metadataRejection(item, config) {
  if (!item.author || !item.caption || !item.published_at || !Number.isFinite(item.likes)) return '元数据不完整';
  if (!(item.width > 0 && item.height > item.width)) return '原视频不是竖屏';
  if (!(item.duration_seconds > 0 && item.duration_seconds <= config.maxDuration)) return '时长超限或无法核验';
  if (item.likes < config.minLikes) return '点赞未达门槛';
  if (item.ai_label) return '页面标注 AI 内容';
  if (/#(?:未成年|小学生|初中生|儿童)/.test(item.caption)) return '主体年龄不符合要求';
  return null;
}

export function rankItems(items, config) {
  return [...items].sort((a, b) =>
    Number(b.likes >= config.preferredLikes) - Number(a.likes >= config.preferredLikes)
    || String(b.published_at).localeCompare(String(a.published_at)) || b.likes - a.likes);
}

export function mergeItems(previous, current, config, excluded = new Set()) {
  const byId = new Map();
  for (const item of [...previous, ...current]) {
    if (!excluded.has(item.id) && !metadataRejection(item, config)) byId.set(item.id, item);
  }
  return rankItems([...byId.values()], config).slice(0, config.target);
}

export function validateConfig(config) {
  for (const key of ['target', 'minLikes', 'preferredLikes', 'maxDuration', 'retentionDays', 'maxPages', 'maxSeconds', 'pageTimeoutMs']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`Invalid config: ${key}`);
  }
  if (!Number.isInteger(config.target) || config.maxDuration > 15 || config.minLikes < 5000) throw new Error('Config weakens the requested limits');
  if (!config.referenceIds?.every(validId)) throw new Error('Invalid reference IDs');
  dateInZone(new Date(), config.timezone);
  return config;
}

import { mergeItems } from './core.mjs';

export function normalizeItem(item) {
  const result = {};
  for (const key of ['id','url','author','caption','likes','likes_display','published_at','width','height','duration_seconds','ai_label','aspect_ratio','thumbnail']) {
    if (item[key] !== undefined) result[key] = item[key];
  }
  result.collected_at = item.collected_at ?? item.verified_at ?? '';
  return result;
}

export function normalizeReport(report, config) {
  // Import saved records from the previous schema into the automatic daily list.
  const items = mergeItems([], [...(report.items ?? []), ...(report.candidates ?? [])].map(normalizeItem), config);
  const blocked = report.status === 'blocked' || report.collection_status === 'blocked';
  const status = items.length >= config.target ? 'complete' : blocked ? 'blocked' : 'partial';
  return {
    schema_version: 2, date: report.date, generated_at: report.generated_at,
    status, ...(blocked ? { collection_status: 'blocked' } : {}), target: config.target, items,
    criteria: { min_likes: config.minLikes, preferred_likes: config.preferredLikes, max_duration: config.maxDuration, portrait: true },
    stats: { pages: report.stats?.pages ?? 0, collected: report.stats?.collected ?? report.stats?.pending ?? items.length,
      retained: items.length, errors: report.stats?.errors ?? 0, thumbnail_errors: report.stats?.thumbnail_errors ?? 0,
      rejected: report.stats?.rejected ?? {} },
    notice: blocked ? `本次采集受阻，已保留 ${items.length} 条视频，稍后自动重试。`
      : status === 'complete' ? `已收集 ${items.length} 条视频。` : `已收集 ${items.length} 条，目标 ${config.target} 条。`,
    workflow_url: config.workflowUrl,
  };
}

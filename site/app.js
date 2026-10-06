const $ = id => document.getElementById(id);
let report, tab = 'selected', archive = [], visible = [];
let saved = {};
try { saved = JSON.parse(localStorage.getItem('frame-diary-saved') || '{}'); } catch {}
if (!saved || Array.isArray(saved) || typeof saved !== 'object') saved = {};
saved = Object.fromEntries(Object.entries(saved).filter(([id, item]) => /^\d{18,20}$/.test(id) && item && item.id === id));
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const url = item => `https://www.douyin.com/video/${item.id}`;
const count = value => Number(value) >= 10000 ? `${(Number(value) / 10000).toFixed(1)}万` : Number(value).toLocaleString('zh-CN');
const asset = value => /^assets\/[\d-]+\.jpg$/.test(value ?? '') ? value : null;
const validItems = values => (Array.isArray(values) ? values : []).filter(item => /^\d{18,20}$/.test(item?.id) && Number.isFinite(item.likes));
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 2200); }

async function loadJson(file) {
  const response = await fetch(file, { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取日报');
  return response.json();
}

function updateSummary() {
  const items = validItems(report.items), candidates = validItems(report.candidates);
  $('selectedCount').textContent = items.length;
  $('topLikes').textContent = items.length ? count(Math.max(...items.map(item => item.likes))) : '—';
  $('avgDuration').textContent = items.length ? `${(items.reduce((sum, item) => sum + item.duration_seconds, 0) / items.length).toFixed(1)}s` : '—';
  $('candidateCount').textContent = candidates.length;
  $('selectedBadge').textContent = items.length; $('candidateBadge').textContent = candidates.length;
  $('reportDate').textContent = report.date;
  document.querySelector('.edition').textContent = `DAILY FRAME / ${report.date.replaceAll('-', '.')}`;
  const generated = new Date(report.generated_at);
  $('updated').textContent = Number.isFinite(generated.getTime()) ? `最近更新 ${generated.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
  $('notice').classList.toggle('error', report.status === 'blocked' || report.collection_status === 'blocked');
  const stale = report.date !== new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  document.querySelector('.section-head h2').firstChild.textContent = stale ? '镜头清单 ' : '今日镜头清单 ';
  const messages = [];
  if (stale) messages.push(`当前查看 ${report.date} 的历史清单。`);
  if (report.status === 'seed') messages.push('首份 20 条为已核验清单。');
  if (report.collection_status || ['pending', 'partial', 'blocked'].includes(report.status)) messages.push(report.notice || '今日清单尚未完成。');
  if (candidates.length) messages.push(`新增 ${candidates.length} 条基础条件达标的候选，人物与运镜请在“待核对”中查看。`);
  $('notice').hidden = !messages.length; $('notice').textContent = messages.join(' ');
}

function card(item, index) {
  const pending = item.review_status === 'awaiting_visual_review';
  const image = asset(item.thumbnail);
  const verified = String(item.verified_at || '').slice(0, 10);
  return `<article class="card" data-id="${escape(item.id)}">
    <div class="cover"><a class="cover-link" href="${url(item)}" target="_blank" rel="noopener noreferrer" aria-label="在抖音打开 ${escape(item.author)} 的视频">${image ? `<img src="${image}" alt="${escape(item.author)} 的视频截图" loading="lazy">` : '<span class="cover-fallback">◈</span>'}<span class="play" aria-hidden="true">▶</span><span class="watch-hint">打开抖音 ↗</span></a>
      <span class="rank">${String(index + 1).padStart(2, '0')}</span><button class="save ${saved[item.id] ? 'saved' : ''}" data-action="save" aria-label="${saved[item.id] ? '取消收藏' : '收藏'} ${escape(item.author)} 的视频" aria-pressed="${!!saved[item.id]}">${saved[item.id] ? '♥' : '♡'}</button><span class="duration">${Number(item.duration_seconds).toFixed(1)}s · ${escape(item.aspect_ratio || '竖屏')}</span>
    </div><div class="card-body"><div class="author-row"><span class="author" title="${escape(item.author)}">${escape(item.author)}</span><span class="likes"><span>♡</span>${count(item.likes)}</span></div>
    <p class="caption" title="${escape(item.caption)}">${escape(item.caption)}</p><span class="camera ${pending ? 'pending' : ''}" title="${escape(item.camera_note || '人物与运镜尚待核对')}">${pending ? '待核对人物与运镜' : escape(item.camera_note || '镜头变化')}</span>
    <div class="card-bottom"><span>发布 ${escape(String(item.published_at || '').slice(5, 10))}</span><a href="${url(item)}" target="_blank" rel="noopener noreferrer">原视频 ↗</a></div>
    <div class="card-actions"><button data-action="${item.frame_images?.length ? 'preview' : 'copy'}">${item.frame_images?.length ? '查看镜头截图' : '复制视频链接'}</button><span title="${escape(item.verification || '基础指标自动核验')}" style="font-size:8px;color:#a18a9a">核验 ${escape(verified.slice(5))}</span></div></div></article>`;
}

function render() {
  $('savedBadge').textContent = Object.keys(saved).length;
  for (const [name, id] of [['selected', 'selectedTab'], ['candidate', 'candidateTab'], ['saved', 'savedTab']]) {
    $(id).classList.toggle('active', tab === name); $(id).setAttribute('aria-selected', String(tab === name));
  }
  let items = validItems(tab === 'selected' ? report.items : tab === 'candidate' ? report.candidates : Object.values(saved));
  const query = $('search').value.trim().toLowerCase(), minimum = Number($('likesFilter').value);
  items = items.filter(item => item.likes >= minimum && [item.author, item.caption, item.camera_note].join(' ').toLowerCase().includes(query));
  const sorting = $('sort').value;
  if (sorting === 'likes') items.sort((a, b) => b.likes - a.likes);
  if (sorting === 'duration') items.sort((a, b) => a.duration_seconds - b.duration_seconds);
  if (sorting === 'published') items.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  visible = items;
  $('resultLabel').textContent = tab === 'candidate' ? `${items.length} 条候选 · 已核对点赞、时长与原始竖屏比例，人物与运镜待核对` : `${items.length} 条视频 · ${tab === 'saved' ? '收藏仅保存在当前浏览器' : '按参考风格收集，点击封面查看原视频'}`;
  $('grid').innerHTML = items.map(card).join(''); $('empty').hidden = items.length > 0;
}

$('selectedTab').addEventListener('click', () => { tab = 'selected'; render(); });
$('candidateTab').addEventListener('click', () => { tab = 'candidate'; render(); });
$('savedTab').addEventListener('click', () => { tab = 'saved'; render(); });
for (const id of ['search', 'likesFilter', 'sort']) $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
$('reset').addEventListener('click', () => { $('search').value = ''; $('likesFilter').value = '0'; $('sort').value = 'default'; render(); });
$('grid').addEventListener('error', event => { if (event.target.tagName === 'IMG') { const placeholder = document.createElement('span'); placeholder.className = 'cover-fallback'; placeholder.textContent = '◈'; event.target.replaceWith(placeholder); } }, true);
$('grid').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const item = visible.find(value => value.id === button.closest('article').dataset.id); if (!item) return;
  if (button.dataset.action === 'save') {
    if (saved[item.id]) delete saved[item.id]; else saved[item.id] = item;
    try { localStorage.setItem('frame-diary-saved', JSON.stringify(saved)); } catch { toast('浏览器存储不可用，收藏仅在本次打开时保留'); }
    render();
  } else if (button.dataset.action === 'copy') {
    try { await navigator.clipboard.writeText(url(item)); toast('视频链接已复制'); } catch { toast('请通过“原视频”链接打开'); }
  } else {
    $('previewTitle').textContent = `${item.author} · ${item.caption}`;
    $('previewFrames').innerHTML = item.frame_images.filter(asset).map((image, index) => `<img src="${image}" alt="第 ${index + 1} 个时点的截图">`).join('');
    $('previewLink').href = url(item); $('preview').showModal();
  }
});
$('closePreview').addEventListener('click', () => $('preview').close());
$('preview').addEventListener('click', event => { if (event.target === $('preview')) { const box = $('preview').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('preview').close(); } });
$('dateSelect').addEventListener('change', async () => {
  try { report = await loadJson(`archive/${$('dateSelect').value}.json`); updateSummary(); render(); }
  catch { toast('该日期的日报暂时无法读取'); }
});
$('export').addEventListener('click', () => {
  const safeCell = value => { const string = String(value ?? ''); return `"${(/^[=+\-@\t\r]/.test(string) ? "'" : '') + string.replaceAll('"', '""')}"`; };
  const rows = [['作者', '标题', '时长（秒）', '单条点赞', '比例', '发布时间', '核验时间', '镜头说明', '审核状态', '视频链接'], ...visible.map(item => [item.author, item.caption, item.duration_seconds, item.likes, item.aspect_ratio, item.published_at, item.verified_at, item.camera_note, item.review_status === 'awaiting_visual_review' ? '人物与运镜待核对' : '已核验', url(item)])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(safeCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `镜头清单-${report.date}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

try {
  $('grid').innerHTML = '<div class="skeleton"></div>'.repeat(4);
  [report, archive] = await Promise.all([loadJson('data/latest.json'), loadJson('data/archive.json')]);
  archive = archive.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value.date));
  $('dateSelect').innerHTML = archive.map(value => `<option value="${value.date}">${value.date} · ${value.count} 条</option>`).join('');
  $('dateSelect').value = report.date;
  updateSummary(); render();
} catch {
  $('grid').innerHTML = ''; $('notice').hidden = false;
  $('notice').classList.add('error'); $('notice').textContent = '日报暂时无法读取，请刷新页面重试。'; $('updated').textContent = '读取失败';
}

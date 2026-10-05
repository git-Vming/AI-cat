// src/todo-window.js —— 阶段 5：今日待办 + 工作统计 窗口的渲染层
//
// ⚠️ 命名铁律：绝不写 `const aqi = window.aqi`（contextBridge 注入的全局 aqi 是不可配置属性，
// 同名 const 会抛 SyntaxError 让整份脚本不执行）。统一用 api。
//
// 注意：本文件是【窗口脚本】；同目录的 `src/todo.js` 是【待办解析纯函数模块】（被主进程 require），
// 两者用途不同，切勿混写（曾因同名覆盖出过问题）。

const api = window.aqi || null;

const elTodoSub = document.getElementById('todo-sub');
const elTodos = document.getElementById('todos');
const elBody = document.getElementById('stats-body');
const elFoot = document.getElementById('stats-foot');
const elResult = document.getElementById('result');
const btnClose = document.getElementById('btn-close');

let todos = [];
let curDate = '';
let curFrom = '';

function log(m) { try { if (api && api.log) api.log('[todo] ' + m); } catch (_) {} }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function pad2(n) { return String(n).padStart(2, '0'); }

function showResult(html, cls) {
  elResult.className = 'result' + (cls ? ' ' + cls : '');
  elResult.innerHTML = html || '';
}

// 分钟 → "HH:MM"；0 / 空 → "—"
function hm(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m <= 0) return '—';
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}
function cnt(n) { return String(Math.max(0, Math.round(n || 0))); }

// 表格行定义：[标签, 取值函数]
const ROWS = [
  ['工作天数', (r) => cnt(r.workDays)],
  ['工作时长', (r) => hm(r.totalMinutes)],
  ['平均每日工作时长', (r) => hm(r.avgMinutes)],
  ['工作日加班次数', (r) => cnt(r.weekdayOvertimeCount)],
  ['工作日加班时长', (r) => hm(r.weekdayOvertimeMinutes)],
  ['周末加班次数', (r) => cnt(r.weekendOvertimeCount)],
  ['周末加班时长', (r) => hm(r.weekendOvertimeMinutes)]
];
const COLS = ['today', 'week', 'month', 'total'];

// ---------- 今日待办 ----------
function renderTodos(data) {
  todos = Array.isArray(data && data.items) ? data.items : [];
  curDate = (data && data.date) || '';
  curFrom = (data && data.from) || '';

  const done = todos.filter((t) => t && t.completed).length;
  elTodoSub.textContent = todos.length
    ? `来自 ${curFrom} 的【明日待办】　已完成 ${done}/${todos.length}`
    : `来自 ${curFrom} 的【明日待办】`;

  if (!todos.length) {
    elTodos.innerHTML = '<div class="empty">'
      + `${esc(curFrom)} 的工作记录里没有【明日待办】条目。<br>`
      + '打开托盘 →「📁 工作记录（历史）」→ 在 '
      + `${esc(curFrom)}.txt 的【明日待办】里写下 1. / 2. / 3. 保存后，回到这里重新打开即可。`
      + '</div>';
    return;
  }

  elTodos.innerHTML = todos.map((t, i) => (
    '<label class="item">'
    + `<input type="checkbox" data-i="${i}"${t.completed ? ' checked' : ''}>`
    + `<span class="txt${t.completed ? ' done' : ''}">${esc(t.text)}</span>`
    + '</label>'
  )).join('');

  elTodos.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => toggle(Number(cb.dataset.i), !!cb.checked));
  });
}

async function toggle(index, done) {
  if (!api || !api.setTodo) return;
  try {
    const r = await api.setTodo({ date: curDate, index, done });
    if (r && r.ok) {
      renderTodos({ date: curDate, from: curFrom, items: r.items });
      showResult(done ? '☑ 已标记完成' : '已取消完成', 'ok');
      log(`todo ${index} -> ${done}`);
    } else {
      showResult('✘ 保存失败（' + ((r && r.reason) || 'unknown') + '）', 'err');
    }
  } catch (e) {
    showResult('✘ ' + (e && e.message), 'err');
  }
}

// ---------- 工作统计 ----------
function renderStats(s) {
  if (!s || !s.ranges) { elBody.innerHTML = ''; return; }
  const R = s.ranges;
  elBody.innerHTML = ROWS.map(([label, fn]) => {
    const tds = COLS.map((c) => `<td>${fn(R[c] || {})}</td>`).join('');
    return `<tr><th class="k">${label}</th>${tds}</tr>`;
  }).join('');

  elFoot.innerHTML = '累计 EXP：<b>' + (s.totalExp || 0).toFixed(1) + '</b>　'
    + '当前等级：<b>Lv.' + (s.level || 1) + '</b>（' + (s.exp || 0).toFixed(1) + '/' + (s.expPerLevel || 80) + '）　'
    + '连续工作：<b>' + (s.streak || 0) + ' 天</b>';
}

async function refresh() {
  if (!api) return;
  try {
    const [t, s] = await Promise.all([api.getTodos(), api.getStats()]);
    renderTodos(t);
    renderStats(s);
  } catch (e) {
    log('load failed: ' + (e && e.message));
    showResult('✘ 加载失败：' + (e && e.message), 'err');
  }
}

// ---------- 关闭 / 分区定位 ----------
btnClose.addEventListener('click', () => { if (api) api.closeTodo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && api) api.closeTodo(); });

// 托盘点「📊 工作统计」时滚动到统计区；点「📋 今日待办」时回到待办区。
// 同时重新拉一次数据 —— 窗口是复用的，这样每次打开都能看到最新（比如刚下工完）。
if (api && api.onFocusSection) {
  api.onFocusSection((sec) => {
    const el = document.getElementById(sec === 'stats' ? 'sec-stats' : 'sec-todo');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refresh();
  });
}

log('booted');
refresh();

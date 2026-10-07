// 菜单窗渲染层（阶段 8）：点击阿七弹出的功能菜单。
//
// 约定：本文件不是纯逻辑模块，而是【窗口脚本】——只被 menu.html 加载，不做 require。
// preload 注入的全局 `aqi` 不可重名，一律用别名 `api`（踩过的坑）。
const api = window.aqi || null;   // ← 别名，勿改回 aqi

function log(msg) {
  try { if (api && api.log) api.log(msg); } catch (_) {}
  try { console.log('[阿七菜单] ' + msg); } catch (_) {}
}
window.addEventListener('error', (e) =>
  log('ERROR: ' + (e.message || e.error) + ' @' + (e.lineno || 0)));
log('booted; aqi=' + (!!window.aqi));

const el = {
  name: document.getElementById('m-name'),
  lv: document.getElementById('m-lv'),
  expFill: document.getElementById('m-expfill'),
  expText: document.getElementById('m-exptext'),
  state: document.getElementById('m-state'),
  punch: document.getElementById('m-punch')
};
const items = Array.prototype.slice.call(document.querySelectorAll('.m-item[data-act]'));

function fmt(min) {
  const m = Math.max(0, Math.round(min || 0));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

let cur = null;
let liveTimer = null;

function render(s) {
  if (!s) return;
  cur = s;
  el.name.textContent = s.name || '阿七';
  el.lv.textContent = 'Lv.' + (s.level || 1);

  const need = s.expPerLevel || 80;
  const inLv = Math.max(0, Math.min(s.exp || 0, need));
  el.expFill.style.width = Math.max(0, Math.min(100, (inLv / need) * 100)).toFixed(1) + '%';
  el.expText.textContent = inLv.toFixed(1) + ' / ' + need;

  if (s.working) {
    const lunch = s.state === 'LUNCH_BREAK';
    el.state.textContent = lunch ? '🍱 午休中（自动）' : ('🟢 工作中 ' + fmt(s.liveMinutes) + '　+'
      + (s.liveExp || 0).toFixed(1) + ' EXP');
    el.punch.textContent = '🔴 下工';
    el.punch.dataset.mode = 'out';
    el.punch.style.display = '';
  } else if (s.completed) {
    el.state.textContent = '🔴 今日已下工　+' + (s.todayExp || 0).toFixed(1) + ' EXP';
    el.punch.textContent = '今日已完成';
    el.punch.dataset.mode = 'done';
    el.punch.style.display = 'none';
  } else {
    el.state.textContent = '🔴 休息中';
    el.punch.textContent = '🟢 上工';
    el.punch.dataset.mode = 'in';
    el.punch.style.display = '';
  }
}

async function refresh() {
  if (!api || !api.getStatus) return;
  try { render(await api.getStatus()); }
  catch (err) { log('refresh failed: ' + (err && err.message ? err.message : err)); }
}

// 工作中时每秒刷新，保持计时鲜活
function startLive() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(async () => {
    if (!api || !api.getStatus) return;
    try {
      const s = await api.getStatus();
      render(s);
      if (!s || !s.working) { clearInterval(liveTimer); liveTimer = null; }
    } catch (_) {}
  }, 1000);
}

el.punch.addEventListener('click', async () => {
  const mode = el.punch.dataset.mode;
  try {
    if (mode === 'in') { await api.punchIn(); }
    else if (mode === 'out') { await api.punchOut(); }
  } catch (err) { log('punch failed: ' + (err && err.message ? err.message : err)); }
  await refresh();
  startLive();
  if (api && api.closeMenu) api.closeMenu();   // 操作后收起菜单，回到桌面
});

items.forEach((b) => {
  b.addEventListener('click', () => {
    const act = b.dataset.act;
    log('menu action -> ' + act);
    if (api && api.menuAction) api.menuAction(act);
  });
});

// 菜单被隐藏时（主进程 hide）停掉定时器，省电
if (api && api.onMenuHidden) api.onMenuHidden(() => {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
});

// Esc 收起（菜单窗若可聚焦时生效；无法聚焦时不影响其它关闭方式）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && api && api.closeMenu) api.closeMenu();
});

refresh();
startLive();

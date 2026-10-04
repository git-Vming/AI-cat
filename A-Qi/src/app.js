// 渲染层：宠物显示、拖动、点击弹出状态卡（阶段 2：上工/下工 + 实时状态）
//
// ⚠️ 关键教训（阶段 2 拖动/点击全失效的根因）：
//   preload 用 contextBridge.exposeInMainWorld('aqi', …) 注入的全局 `aqi` 是「不可配置」属性；
//   在本脚本顶层再写 `const aqi = window.aqi` 会触发
//     SyntaxError: Identifier 'aqi' has already been declared
//   语法错误会让【整份脚本直接不执行】——于是拖动、点击弹卡、托盘反馈全部失效
//   （而黑猫是 CSS/SVG 画的，照样显示，极具迷惑性）。
//   因此本地引用统一改名为 `api`，绝不与全局名冲突。
const pet = document.getElementById('pet');
const card = document.getElementById('card');
const btnHide = document.getElementById('btn-hide');
const btnMain = document.getElementById('btn-main');
const elName = document.getElementById('name');
const elLv = document.getElementById('lv');
const elState = document.getElementById('state');
const elStats = document.getElementById('stats');
const expFill = document.getElementById('exp-fill');
const expText = document.getElementById('exp-text');
const toast = document.getElementById('toast');

const api = window.aqi || null;   // ← 别名，勿改回 aqi

// ===== 诊断日志：写入 <A-Qi>/diag.log，便于无 GUI 环境下定位问题 =====
function log(msg) {
  try { if (api && api.log) api.log(msg); } catch (_) {}
  try { console.log('[阿七] ' + msg); } catch (_) {}
}
window.addEventListener('error', (e) =>
  log('ERROR: ' + (e.message || e.error) + ' @' + (e.filename || '') + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  log('UNHANDLED_REJECTION: ' + ((r && r.message) || String(r)));
});
log('renderer booted; aqi=' + (!!window.aqi) +
    '; pet=' + (!!pet) + '; card=' + (!!card) + '; btnMain=' + (!!btnMain));

let cur = null;          // 最近一次状态
let liveTimer = null;    // 工作中的实时刷新
let toastTimer = null;

// ===== 交互：JS 拖动 + 单击判别 =====
// 设计要点：
//  1) 拖动位移用「屏幕坐标」计算（screenX/screenY 与窗口自身位置无关，位移才准确）。
//  2) 位移超过阈值(6px)才算拖动；否则松手即视为单击 → 弹/收卡片。
//  3) 用 pointerdown/pointerup + setPointerCapture，保证松手事件一定送达；
//     并额外挂 click 作为兜底，用标志位 pointerUpHandled 去重，避免一次点击触发两次。
const DRAG_THRESHOLD = 6;
let dragging = false;
let moved = false;
let downSX = 0, downSY = 0, lastSX = 0, lastSY = 0;
let pointerUpHandled = false; // 本次按键的点击是否已由 pointerup 处理（用于 click 兜底去重，避免一次点击触发两次）

function onPointerDown(e) {
  if (e.button !== 0) return; // 仅左键
  dragging = true; moved = false; pointerUpHandled = false;
  downSX = lastSX = e.screenX;
  downSY = lastSY = e.screenY;
  try { pet.setPointerCapture(e.pointerId); } catch (_) {}
  log('pointerdown x=' + e.screenX + ' y=' + e.screenY);
}

function onPointerMove(e) {
  if (!dragging) return;
  const sx = e.screenX, sy = e.screenY;
  if (!moved) {
    if (Math.hypot(sx - downSX, sy - downSY) > DRAG_THRESHOLD) {
      moved = true;
      log('drag start');
      if (api && api.drag) api.drag(sx - downSX, sy - downSY); // 一次补齐阈值滞后的位移
      lastSX = sx; lastSY = sy;
    }
    return;
  }
  const dx = sx - lastSX, dy = sy - lastSY;
  lastSX = sx; lastSY = sy;
  if (api && api.drag) api.drag(dx, dy);
}

function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  try { pet.releasePointerCapture(e.pointerId); } catch (_) {}
  log('pointerup moved=' + moved);
  if (!moved) { pointerUpHandled = true; toggleCard(); }
}

pet.addEventListener('pointerdown', onPointerDown);
pet.addEventListener('pointermove', onPointerMove);
pet.addEventListener('pointerup', onPointerUp);
pet.addEventListener('pointercancel', () => { dragging = false; log('pointercancel'); });
// 兜底：若某些环境下 pointerup 异常，click 仍能触发；用 pointerUpHandled 去重，避免一次点击触发两次
pet.addEventListener('click', () => {
  if (moved) { moved = false; return; }                       // 拖动结束后的 click 忽略
  if (pointerUpHandled) { pointerUpHandled = false; return; } // 本次点击已由 pointerup 处理，跳过
  toggleCard();
});

// ===== 卡片与状态渲染 =====
function fmt(min) {
  const m = Math.max(0, Math.round(min));
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

function render() {
  if (!cur) return;
  elName.textContent = cur.name || '阿七';
  elLv.textContent = cur.level || 1;

  // 经验条：固定 expPerLevel(=80) EXP 升一级（V-ming 2026-10-03 定稿）
  const need = cur.expPerLevel || 80;
  const inLv = Math.max(0, Math.min(cur.exp || 0, need));
  const pct = Math.max(0, Math.min(100, (inLv / need) * 100));
  expFill.style.width = pct.toFixed(1) + '%';
  expText.textContent = inLv.toFixed(1) + ' / ' + need;

  if (cur.working) {
    elState.textContent = cur.state === 'LUNCH_BREAK' ? '🍱 午休中（自动）' : '🟢 工作中';
    elStats.innerHTML =
      `上工：<b>${cur.startHM}</b><br>` +
      `已工作：<b>${fmt(cur.liveMinutes)}</b><br>` +
      `预计：<b>+${cur.liveExp.toFixed(1)} EXP</b>`;
    btnMain.textContent = '下工';
    btnMain.dataset.mode = 'out';
    btnMain.style.display = '';
  } else if (cur.completed) {
    elState.textContent = '🔴 今日已下工';
    elStats.innerHTML =
      `上下工：<b>${cur.startHM} → ${cur.endHM}</b><br>` +
      `今日工作：<b>${fmt(cur.totalMinutes)}</b><br>` +
      `今日 EXP：<b>+${(cur.todayExp || 0).toFixed(1)}</b>`;
    btnMain.textContent = '今日已完成';
    btnMain.dataset.mode = 'done';
    btnMain.style.display = 'none';
  } else {
    elState.textContent = '🔴 休息中';
    elStats.innerHTML = '';   // 等级在标题、进度在经验条，无需重复
    btnMain.textContent = '上工';
    btnMain.dataset.mode = 'in';
    btnMain.style.display = '';
  }
}

async function refresh() {
  try {
    cur = await api.getStatus();
    render();
  } catch (err) {
    log('refresh failed: ' + (err && err.message ? err.message : err));
  }
}

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

function openCard(msg) {
  card.classList.remove('hidden');
  log('openCard ' + (msg || ''));
  if (msg) showToast(msg);
  refresh();
  // 工作中时每秒刷新实时计时
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(async () => {
    try {
      cur = await api.getStatus();
      if (cur && cur.working) render();
      else if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    } catch (_) { /* 忽略瞬时错误 */ }
  }, 1000);
}

function closeCard() {
  card.classList.add('hidden');
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

function toggleCard() {
  if (card.classList.contains('hidden')) openCard();
  else closeCard();
}

// 单击卡片「非按钮区域」→ 收起卡片、回到宠物黑猫界面
// （卡片内两个按钮的 click 都调用了 e.stopPropagation()，不会冒泡到这里，故按钮不受影响）
card.addEventListener('click', () => {
  log('card blank click -> close');
  closeCard();
});

// ===== 卡片按钮 =====
btnMain.addEventListener('click', async (e) => {
  e.stopPropagation();
  const mode = btnMain.dataset.mode;
  try {
    if (mode === 'in') {
      const r = await api.punchIn();
      if (r.ok) showToast('上工成功，阿七陪你开工 💪');
      else showToast('今天已经上工啦');
    } else if (mode === 'out') {
      const r = await api.punchOut();
      if (r.ok) showToast(`下工结算 +${r.record.exp.toFixed(1)} EXP`);
      else showToast('还没上工哦');
    }
  } catch (err) {
    log('button action failed: ' + (err && err.message ? err.message : err));
  }
  await refresh();
});

btnHide.addEventListener('click', (e) => {
  e.stopPropagation();
  if (api && api.hideWindow) api.hideWindow();
});

// 主进程（托盘上工/下工）请求弹出卡片 → 给可见反馈
if (api && api.onOpenCard) api.onOpenCard(openCard);

// 初始化
if (!api) {
  log('window.aqi 桥未加载，交互将失效');
} else {
  refresh();
}

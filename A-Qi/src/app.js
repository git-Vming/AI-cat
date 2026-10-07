// 渲染层：阿七本体显示、拖动、点击开菜单、显隐淡入淡出
//
// 2026-10-07 改版（PM 指示）：
//   阿七本体改为【直接使用原画贴图】assets/pet/aqi.png（透明底立绘）。
//   本脚本**不再绘制、不再重绘、也不做任何表情/姿态映射与随机小动作** ——
//   PM 明确要求"先就贴图，不写动态"，且"不可以自己修改形象原画"。
//   原画 → 屏幕的链路只有一条：index.html 里的 <img src="../assets/pet/aqi.png">。
//   等形象确认无误后，再单独讨论怎么让它动起来。
//
// 保留（这些是交互，不是"动态"）：
//   · 拖动移动窗口 + 拖动结束记住位置（规格 §35）
//   · 左键单击 / 右键 → 菜单；气泡显示中单击优先关气泡（阶段 6 决策）
//   · 隐藏/显示淡出淡入（阶段 8）
//   · 宠物状态仍照旧接收，但只写入 data-state 供调试与后续使用，不做视觉变化
//
// ⚠️ 关键教训（阶段 2 拖动/点击全失效的根因）：
//   preload 用 contextBridge.exposeInMainWorld('aqi', …) 注入的全局 `aqi` 是「不可配置」属性；
//   在本脚本顶层再写 `const aqi = window.aqi` 会触发
//     SyntaxError: Identifier 'aqi' has already been declared
//   语法错误会让【整份脚本直接不执行】——于是拖动、点击、托盘反馈全部失效
//   （而图片照常显示，极具迷惑性）。
//   因此本地引用统一改名为 `api`，绝不与全局名冲突。
const pet = document.getElementById('pet');
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
log('renderer booted; aqi=' + (!!window.aqi) + '; pet=' + (!!pet));

// ===== 宠物状态（只记录，不做视觉变化）=====
// 状态仍由主进程 growth.computeState 判定后推来（IDLE/WORKING/HAPPY/SLEEP/…）。
// 当前形象是原画静态贴图，没有对应的各状态图，所以这里只把状态写进 DOM 属性，
// 方便排查、也为"下一步让它动起来"预留挂载点。
let curState = 'IDLE';
function setState(state) {
  const s = typeof state === 'string' && state ? state : 'IDLE';
  const changed = s !== curState;
  curState = s;
  if (pet) pet.dataset.state = s;
  if (changed) log('state -> ' + s);
}

// 升级通知：主进程侧本来就会弹升级气泡（announceLevelUp），这里只记录
if (api && api.onLevelUp) api.onLevelUp(() => log('level up notified'));

// ===== 交互：JS 拖动 + 单击判别（阶段 2 方案，保持不变）=====
//  1) 拖动位移用「屏幕坐标」计算（screenX/screenY 与窗口自身位置无关，位移才准确）。
//  2) 位移超过阈值(6px)才算拖动；否则松手即视为单击。
//  3) 用 pointerdown/pointerup + setPointerCapture，保证松手事件一定送达；
//     并额外挂 click 作为兜底，用标志位去重，避免一次点击触发两次。
const DRAG_THRESHOLD = 6;
let dragging = false;
let moved = false;
let downSX = 0, downSY = 0, lastSX = 0, lastSY = 0;
let pointerUpHandled = false;

function onPointerDown(e) {
  if (e.button !== 0) return; // 仅左键
  dragging = true; moved = false; pointerUpHandled = false;
  downSX = lastSX = e.screenX;
  downSY = lastSY = e.screenY;
  try { pet.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerMove(e) {
  if (!dragging) return;
  const sx = e.screenX, sy = e.screenY;
  if (!moved) {
    if (Math.hypot(sx - downSX, sy - downSY) > DRAG_THRESHOLD) {
      moved = true;
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
  if (!moved) { pointerUpHandled = true; handlePetClick(); }
  else if (api && api.savePosition) api.savePosition();   // 拖动结束 → 记住位置（规格 §35 位置记忆）
}

// 左键单击阿七：
//   ① 若旁边正显示提醒气泡 → 这一击用来关气泡（阶段 6 决策），不弹菜单；
//   ② 否则通知主进程切换菜单窗的显示/隐藏。
async function handlePetClick() {
  try {
    if (api && api.dismissBubble) {
      const hadBubble = await api.dismissBubble();
      if (hadBubble) { log('pet click -> dismissed bubble'); return; }
    }
  } catch (err) {
    log('dismissBubble failed: ' + (err && err.message ? err.message : err));
  }
  if (api && api.toggleMenu) api.toggleMenu();
}

pet.addEventListener('pointerdown', onPointerDown);
pet.addEventListener('pointermove', onPointerMove);
pet.addEventListener('pointerup', onPointerUp);
pet.addEventListener('pointercancel', () => { dragging = false; });
pet.addEventListener('click', () => {
  if (moved) { moved = false; return; }
  if (pointerUpHandled) { pointerUpHandled = false; return; }
  handlePetClick();
});
// 右键阿七也开菜单（设计板："点击阿七本体（右键或长按）弹出功能菜单"）
pet.addEventListener('contextmenu', (e) => { e.preventDefault(); if (api && api.openMenu) api.openMenu(); });

// ===== 主进程推来的宠物状态 =====
if (api && api.onPetState) api.onPetState((s) => setState(s));

// ===== 隐藏/显示：主进程发来淡出淡入指令（CSS 过渡，见 styles.css）=====
if (api && api.onWindowFade) {
  api.onWindowFade((dir) => {
    if (dir === 'out') document.body.classList.add('fade-out');
    else document.body.classList.remove('fade-out');
  });
}

// 初始化：仅记录状态（形象是静态贴图，无需绘制）
if (pet) pet.dataset.state = curState;
if (!api) log('window.aqi 桥未加载，交互将失效');
else if (api.getPetState) api.getPetState().then((s) => setState(s)).catch(() => {});

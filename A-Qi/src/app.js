// 渲染层：阿七本体显示、拖动、点击开菜单、表情/动作切换（阶段 8）
//
// ⚠️ 关键教训（阶段 2 拖动/点击全失效的根因）：
//   preload 用 contextBridge.exposeInMainWorld('aqi', …) 注入的全局 `aqi` 是「不可配置」属性；
//   在本脚本顶层再写 `const aqi = window.aqi` 会触发
//     SyntaxError: Identifier 'aqi' has already been declared
//   语法错误会让【整份脚本直接不执行】——于是拖动、点击、托盘反馈全部失效
//   （而阿七是 SVG/CSS 画的，照样显示，极具迷惑性）。
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
log('renderer booted; aqi=' + (!!window.aqi) + '; pet=' + (!!pet) +
    '; PetSvg=' + !!(window.PetSvg));

// ===== 宠物状态 → 表情/姿态 映射（纯表现层）=====
// 状态由主进程 growth.computeState 判定后推来（IDLE/WORKING/HAPPY/SLEEP/…）。
const STATE_LOOK = {
  IDLE:      { expr: 'normal',   pose: 'sit' },
  WORKING:   { expr: 'normal',   pose: 'work' },
  HAPPY:     { expr: 'happy',    pose: 'sit' },
  EATING:    { expr: 'happy',    pose: 'eat' },
  DRINKING:  { expr: 'normal',   pose: 'drink' },
  SLEEP:     { expr: 'sleepy',   pose: 'sleep' },
  REMINDING: { expr: 'surprise', pose: 'sit' },
  SAD:       { expr: 'sad',      pose: 'sit' },
  WALK:      { expr: 'normal',   pose: 'walk' },
  LEVELUP:   { expr: 'happy',    pose: 'levelup' }
};

// 工作状态下的随机行为（规格 §33：坐着/走动/看电脑/趴着/打哈欠/喝水/伸懒腰）
// 权重刻意让"看电脑"占多数，偶尔穿插小动作，不影响工作计时。
const WORK_ACTIONS = [
  { expr: 'normal',   pose: 'work'  },
  { expr: 'normal',   pose: 'work'  },
  { expr: 'normal',   pose: 'work'  },
  { expr: 'normal',   pose: 'sit'   },
  { expr: 'normal',   pose: 'walk'  },
  { expr: 'sleepy',   pose: 'sleep' },   // 打哈欠 / 趴一会儿
  { expr: 'normal',   pose: 'drink' }    // 喝口水
];

let curState = 'IDLE';
let curLook = { expr: null, pose: null };
let actionTimer = null;    // 随机动作回退计时
let randomTimer = null;    // 下一次随机动作

function applyLook(expr, pose) {
  const e = window.PetSvg && window.PetSvg.isExpression(expr) ? expr : 'normal';
  const p = window.PetSvg && window.PetSvg.isPose(pose) ? pose : 'sit';
  if (curLook.expr === e && curLook.pose === p) return;
  curLook = { expr: e, pose: p };
  if (!pet || !window.PetSvg) return;
  // 只在变化时重渲染，避免每秒重建 SVG 打断 CSS 动画
  pet.innerHTML = window.PetSvg.petSvg({ expression: e, pose: p, size: 150 });
  pet.dataset.anim = p;
  log('look -> ' + e + '/' + p);
}

function clearTimers() {
  if (actionTimer) { clearTimeout(actionTimer); actionTimer = null; }
  if (randomTimer) { clearTimeout(randomTimer); randomTimer = null; }
}

// 待机时的偶发小动作（歪头 / 走两步 / 打个盹），让阿七"活着"而不是一张静止图
const IDLE_ACTIONS = [
  { expr: 'tilt',   pose: 'sit'  },
  { expr: 'normal', pose: 'walk' },
  { expr: 'sleepy', pose: 'sleep' }
];

// 安排随机小动作：
//   工作中 —— 每 9~20 秒切一次（看电脑为主，穿插喝水/走动/打哈欠），4~7 秒后回到看电脑；
//   待机中 —— 每 25~50 秒偶发一次，3~6 秒后回到坐姿。
// 均只影响"长相"，不写任何数据，也就绝不影响工作计时（规格 §33）。
function scheduleRandomAction() {
  if (randomTimer) clearTimeout(randomTimer);
  const working = curState === 'WORKING';
  const idling = curState === 'IDLE';
  if (!working && !idling) return;

  const delay = working ? (9000 + Math.random() * 11000) : (25000 + Math.random() * 25000);
  randomTimer = setTimeout(() => {
    if (curState !== (working ? 'WORKING' : 'IDLE')) return;
    const pool = working ? WORK_ACTIONS : IDLE_ACTIONS;
    const a = pool[Math.floor(Math.random() * pool.length)];
    applyLook(a.expr, a.pose);
    const hold = working ? (4000 + Math.random() * 3000) : (3000 + Math.random() * 3000);
    actionTimer = setTimeout(() => {
      if (curState !== (working ? 'WORKING' : 'IDLE')) return;
      const base = STATE_LOOK[curState] || STATE_LOOK.IDLE;
      applyLook(base.expr, base.pose);
      scheduleRandomAction();
    }, hold);
  }, delay);
}

function setState(state) {
  const s = STATE_LOOK[state] ? state : 'IDLE';
  const changed = s !== curState;
  curState = s;
  clearTimers();
  const look = STATE_LOOK[s];
  applyLook(look.expr, look.pose);
  scheduleRandomAction();
  if (changed) log('state -> ' + s);
}

function playLevelUp() {
  // 升级：临时切到 levelup 姿态，播完回到当前状态
  clearTimers();
  applyLook('happy', 'levelup');
  actionTimer = setTimeout(() => { curLook = { expr: null, pose: null }; setState(curState); }, 1400);
}
if (api && api.onLevelUp) api.onLevelUp(playLevelUp);

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

// 初始化：先画一只待机阿七（主进程随后会推真实状态）
applyLook('normal', 'sit');
if (!api) log('window.aqi 桥未加载，交互将失效');
else if (api.getPetState) api.getPetState().then((s) => setState(s)).catch(() => {});

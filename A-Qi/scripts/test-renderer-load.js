// scripts/test-renderer-load.js
// 目的：没有 GUI 也能验证桌宠渲染层【真正执行】并覆盖关键行为。
//
// 2026-10-07 改版后覆盖：
//   ① 致命 SyntaxError：`const aqi = window.aqi` 与 contextBridge 注入的【不可配置】全局 `aqi`
//      同名 → 整份 app.js 一行都不执行（图片照常显示，极难察觉）。
//   ② 本体 = **原画贴图**（index.html 里的 <img src="../assets/pet/aqi.png">），
//      app.js **不绘制、不注入 SVG、不做表情/姿态映射、不做随机小动作**（PM：先就贴图、不写动态）。
//   ③ 交互不受影响：单击开菜单、拖动移动窗口且不误开菜单、拖动结束记住位置、右键开菜单、
//      气泡优先关闭、隐藏/显示淡入淡出。
//   ④ 结构常量：styles.css 里不得有任何 animation/@keyframes（形象必须是静止原画）。
//
// 做法：Node vm 造「全局 aqi 不可配置」的上下文（等价 contextBridge），加载真实 src/app.js。
//
// 运行：node scripts/test-renderer-load.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');

// ---------- 极简 DOM 桩 ----------
function makeEl(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id, __listeners: listeners, __parent: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c))
    },
    dataset: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {}
  };
}
function fire(el, type, ev) {
  ev = ev || {};
  if (!ev.stopPropagation) ev.stopPropagation = () => { ev.__stopped = true; };
  if (!ev.preventDefault) ev.preventDefault = () => {};
  let node = el;
  while (node) {
    const ls = node.__listeners[type] || [];
    for (const fn of ls.slice()) { fn(ev); if (ev.__stopped) return; }
    if (ev.__stopped) return;
    node = node.__parent;
  }
}

const els = { pet: makeEl('pet') };

// ---------- 桥桩 ----------
const calls = { drag: 0, savePosition: 0, toggleMenu: 0, openMenu: 0, levelUpCb: 0 };
let petStateCb = null;
let dismissResult = false;
const apiStub = {
  log: () => {},
  drag: () => { calls.drag++; },
  savePosition: () => { calls.savePosition++; },
  toggleMenu: () => { calls.toggleMenu++; },
  openMenu: () => { calls.openMenu++; },
  dismissBubble: async () => dismissResult,
  getPetState: async () => 'IDLE',
  onPetState: (cb) => { petStateCb = cb; },
  onLevelUp: (cb) => { calls.levelUpCb++; if (cb) cb; }
};

const win = { aqi: apiStub, addEventListener: () => {} };
const sandbox = {
  window: win,
  document: { getElementById: (id) => els[id] || null },
  console: { log: () => {}, error: () => {}, warn: () => {} },
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise
};
vm.createContext(sandbox);
// 关键：在上下文内部把 aqi 定义成不可配置的全局属性（等价 contextBridge 行为）
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: {}, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const petDown = (id, x, y) => fire(els.pet, 'pointerdown', { button: 0, pointerId: id, screenX: x, screenY: y });
const petMove = (id, x, y) => fire(els.pet, 'pointermove', { pointerId: id, screenX: x, screenY: y });
const petUp = (id, x, y) => fire(els.pet, 'pointerup', { pointerId: id, screenX: x, screenY: y });
const petClick = () => fire(els.pet, 'click', { button: 0 });
const tick = () => new Promise((r) => setImmediate(r));

// ---------- ① 证明该上下文能复现"与全局 aqi 冲突" ----------
let probeErr = '';
try { vm.runInContext('const aqi = 1;', sandbox, { filename: 'probe.js' }); }
catch (e) { probeErr = e.name + ': ' + e.message; }
check('上下文可复现 `const aqi` 与不可配置全局 aqi 的冲突（证明本测试有效）',
  /SyntaxError/.test(probeErr) && /already been declared/.test(probeErr), probeErr || '未报错');

// ---------- ② 加载真实 app.js ----------
const src = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
let loadErr = '';
try { vm.runInContext(src, sandbox, { filename: 'app.js' }); }
catch (e) { loadErr = e.name + ': ' + e.message; }
check('src/app.js 能正常执行（无 SyntaxError）', loadErr === '', loadErr || '');
check('src/app.js 顶层不再声明与全局冲突的 `aqi`',
  !/^\s*(?:const|let|var)\s+aqi\b/m.test(src), '仍存在同名声明');
check('src/app.js 使用 `api` 别名引用桥', /const\s+api\s*=\s*window\.aqi/.test(src));
check('src/app.js 已移除 F12 DevTools 入口（PM 要求）', !/openDevTools|F12/.test(src));

// ---------- ③ 本体是原画贴图：app.js 不做任何绘制 ----------
check('app.js 不再引用图片绘制模块 PetSvg / pet-svg',
  !/PetSvg|pet-svg/.test(src), '仍引用了 SVG 绘制模块');
check('app.js 不再注入任何 SVG / 不再写 innerHTML',
  !/innerHTML/.test(src) && !/petSvg\s*\(/.test(src));
check('app.js 不做表情/姿态映射（无 STATE_LOOK / 无随机小动作）',
  !/STATE_LOOK|WORK_ACTIONS|IDLE_ACTIONS|scheduleRandomAction/.test(src));
check('初始化后未向 #pet 注入任何内容（本体由 HTML 里的 <img> 承担）',
  els.pet.innerHTML === '', JSON.stringify(els.pet.innerHTML).slice(0, 60));
check('宠物状态写入 data-state 供调试（初始 IDLE）',
  els.pet.dataset.state === 'IDLE', String(els.pet.dataset.state));

(async function main() {
  // ---------- ④ 单击阿七 → 打开菜单 ----------
  petDown(1, 500, 400); petUp(1, 500, 400); petClick();
  await tick();
  check('单击阿七 → 通知主进程切换菜单（api.toggleMenu）', calls.toggleMenu === 1, 'calls=' + calls.toggleMenu);

  // ---------- ⑤ 拖动 → 下发位移，且不误开菜单 ----------
  petDown(2, 100, 100);
  petMove(2, 160, 140);      // 超过阈值 6px → 进入拖动
  petMove(2, 200, 180);
  petUp(2, 200, 180);
  petClick();                // 拖动结束后的 click 应被忽略
  await tick();
  check('拖动过程中下发窗口位移（api.drag）', calls.drag > 0, 'calls=' + calls.drag);
  check('拖动结束 → 记住桌面位置（api.savePosition）', calls.savePosition === 1, 'calls=' + calls.savePosition);
  check('拖动不会误触发菜单', calls.toggleMenu === 1, 'calls=' + calls.toggleMenu);

  // ---------- ⑥ 主进程推送宠物状态 → 只记录，不改形象 ----------
  petStateCb('WORKING');
  check('状态 WORKING → 记录到 data-state（形象不变）',
    els.pet.dataset.state === 'WORKING' && els.pet.innerHTML === '');
  petStateCb('SLEEP');
  check('状态 SLEEP → 记录到 data-state（形象不变）',
    els.pet.dataset.state === 'SLEEP' && els.pet.innerHTML === '');
  petStateCb('IDLE');
  check('状态 IDLE → 记录到 data-state', els.pet.dataset.state === 'IDLE');

  // ---------- ⑦ 升级通知 → 不改变形象（主进程侧负责弹升级气泡） ----------
  check('app.js 已订阅升级通知（保留主进程链路）', calls.levelUpCb === 1, 'calls=' + calls.levelUpCb);

  // ---------- ⑧ 右键阿七 → 打开菜单（设计板：右键或长按） ----------
  const beforeOpen = calls.openMenu;
  fire(els.pet, 'contextmenu', { preventDefault: () => {} });
  check('右键阿七 → 打开菜单（api.openMenu）', calls.openMenu === beforeOpen + 1, 'calls=' + calls.openMenu);

  // ---------- ⑨ 有提醒气泡时：这一击只关气泡，不开菜单 ----------
  dismissResult = true;
  const before = calls.toggleMenu;
  petDown(3, 500, 400); petUp(3, 500, 400); petClick();
  await tick();
  check('气泡显示中单击阿七 → 只关气泡、不弹菜单',
    calls.toggleMenu === before, 'toggleMenu=' + calls.toggleMenu + ' (期望 ' + before + ')');

  // ---------- ⑩ index.html：原画贴图 + 只加载 app.js ----------
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  check('index.html 引用 app.js', /app\.js/.test(html));
  check('index.html 不再加载 pet-svg.js（不再程序化绘制）', !/pet-svg\.js/.test(html));
  check('index.html 用 <img> 直接引用原画 assets/pet/aqi.png',
    /<img[^>]+src="\.\.\/assets\/pet\/aqi\.png"/.test(html), '未找到原画 img');
  check('原画文件确实存在（assets/pet/aqi.png）',
    fs.existsSync(path.join(ROOT, 'assets', 'pet', 'aqi.png')));
  check('index.html 不再包含旧状态卡（card 已由独立菜单窗取代）', !/id="card"/.test(html));
  const menuHtml = fs.readFileSync(path.join(ROOT, 'src', 'menu.html'), 'utf8');
  check('menu.html 引用的是窗口脚本 menu-window.js（不与纯逻辑同名）',
    /menu-window\.js/.test(menuHtml) && !/src="menu\.js"/.test(menuHtml));

  // ---------- ⑪ styles.css：形象必须是"静止原画"（PM：不写动态） ----------
  const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  check('styles.css 不含任何 @keyframes（无自写动画）', !/@keyframes/.test(css));
  check('styles.css 不含任何 animation 声明（不抖动、不呼吸、不摇晃）',
    !/(^|[^-])animation\s*:/.test(css), '仍存在 animation 声明');
  check('styles.css 用 object-fit: contain 显示原画（等比、不裁切、不变形）',
    /object-fit:\s*contain/.test(css));
  check('styles.css 保留了隐藏/显示过渡（阶段 8 已验收的交互）',
    /body\.fade-out\s+\.pet/.test(css));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();

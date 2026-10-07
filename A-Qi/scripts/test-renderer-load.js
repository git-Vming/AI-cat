// scripts/test-renderer-load.js
// 目的：没有 GUI 也能验证桌宠渲染层【真正执行】并覆盖关键行为（阶段 8 更新版）：
//   ① 致命 SyntaxError：`const aqi = window.aqi` 与 contextBridge 注入的【不可配置】全局 `aqi`
//      同名 → 整份 app.js 一行都不执行（界面照常显示，极难察觉）。
//   ② 阶段 8 新行为：阿七 SVG 注入、按宠物状态切换表情/姿态、单击开菜单、
//      拖动移动窗口且不误开菜单、拖动结束记住位置、升级动作、右键开菜单、气泡优先关闭。
//
// 做法：Node vm 造「全局 aqi 不可配置」的上下文（等价 contextBridge），
//   先加载真实 src/pet-svg.js，再加载真实 src/app.js，用极简 DOM 桩模拟 pointer/click。
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

// ---------- 极简 DOM 桩 ----------
function makeEl(id) {
  const listeners = {};
  const classes = new Set();
  const el = {
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
  return el;
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
const calls = { drag: 0, savePosition: 0, toggleMenu: 0, openMenu: 0 };
let petStateCb = null, levelUpCb = null;
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
  onLevelUp: (cb) => { levelUpCb = cb; }
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

// ---------- ② 加载真实 pet-svg.js + app.js ----------
const petSvgSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pet-svg.js'), 'utf8');
let svgErr = '';
try { vm.runInContext(petSvgSrc, sandbox, { filename: 'pet-svg.js' }); }
catch (e) { svgErr = e.name + ': ' + e.message; }
check('src/pet-svg.js 能在渲染上下文执行并挂到 window.PetSvg', svgErr === '' && !!win.PetSvg, svgErr || '');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
let loadErr = '';
try { vm.runInContext(src, sandbox, { filename: 'app.js' }); }
catch (e) { loadErr = e.name + ': ' + e.message; }
check('src/app.js 能正常执行（无 SyntaxError）', loadErr === '', loadErr || '');
check('src/app.js 顶层不再声明与全局冲突的 `aqi`',
  !/^\s*(?:const|let|var)\s+aqi\b/m.test(src), '仍存在同名声明');
check('src/app.js 使用 `api` 别名引用桥', /const\s+api\s*=\s*window\.aqi/.test(src));
check('src/app.js 已移除 F12 DevTools 入口（PM 要求）', !/openDevTools|F12/.test(src));

// ---------- ③ 初始：注入阿七 SVG ----------
check('初始化即注入阿七 SVG（待机姿态）',
  /<svg class="aqi-pet"/.test(els.pet.innerHTML) && /data-pose="sit"/.test(els.pet.innerHTML),
  els.pet.innerHTML.slice(0, 60));

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

  // ---------- ⑥ 主进程推送宠物状态 → 切换表情/姿态 ----------
  petStateCb('WORKING');
  check('状态 WORKING → 阿七切到“看电脑”姿态',
    /data-pose="work"/.test(els.pet.innerHTML) && /data-expr="normal"/.test(els.pet.innerHTML));
  petStateCb('SLEEP');
  check('状态 SLEEP → 闭眼 + 睡觉姿态',
    /data-pose="sleep"/.test(els.pet.innerHTML) && /data-expr="sleepy"/.test(els.pet.innerHTML));
  petStateCb('HAPPY');
  check('状态 HAPPY → 开心表情', /data-expr="happy"/.test(els.pet.innerHTML));
  petStateCb('IDLE');
  check('状态 IDLE → 回到待机坐姿',
    /data-pose="sit"/.test(els.pet.innerHTML) && /data-expr="normal"/.test(els.pet.innerHTML));

  // ---------- ⑦ 升级 → 播放升级动作 ----------
  levelUpCb();
  check('收到升级通知 → 播放升级动作（levelup 姿态）', /data-pose="levelup"/.test(els.pet.innerHTML));

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

  // ---------- ⑩ 结构断言：主窗口不再内联卡片，菜单由独立窗口承担 ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  check('index.html 引用 pet-svg.js 与 app.js', /pet-svg\.js/.test(html) && /app\.js/.test(html));
  check('index.html 不再包含旧状态卡（card 已由独立菜单窗取代）', !/id="card"/.test(html));
  const menuHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu.html'), 'utf8');
  check('menu.html 引用的是窗口脚本 menu-window.js（不与纯逻辑同名）',
    /menu-window\.js/.test(menuHtml) && !/src="menu\.js"/.test(menuHtml));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();

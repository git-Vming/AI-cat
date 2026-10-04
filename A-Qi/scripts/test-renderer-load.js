// scripts/test-renderer-load.js
// 目的：在没有 GUI 的情况下验证渲染层脚本能【真正执行】，并覆盖两类历史 BUG：
//   ① 致命 SyntaxError：`const aqi = window.aqi` 与 contextBridge 注入的
//      【不可配置】全局 `aqi` 同名冲突 → 整份 app.js 一行都不执行。
//   ② 交互行为：单击黑猫弹卡 / 再点收起 / 拖动移动窗口不误弹卡 /
//      单击卡片非按钮区域收起卡片 / 单击卡片按钮不收起卡片。
//
// 做法：用 Node vm 造「全局 aqi 不可配置」的上下文（等价 contextBridge），
//   跑真实 src/app.js，并用带冒泡的极简 DOM 桩模拟 pointer/click 事件。
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

// ---------- 极简 DOM 桩（支持事件冒泡 + stopPropagation） ----------
function makeEl(id) {
  const listeners = {};
  const classes = new Set();
  const el = {
    id, __listeners: listeners, __parent: null,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
    },
    dataset: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    setPointerCapture() {}, releasePointerCapture() {},
  };
  return el;
}

// 从元素向上冒泡派发事件；handler 调 stopPropagation() 即中断
function fire(el, type, ev) {
  ev = ev || {};
  if (!ev.stopPropagation) ev.stopPropagation = () => { ev.__stopped = true; };
  let node = el;
  while (node) {
    const ls = node.__listeners[type] || [];
    for (const fn of ls.slice()) { fn(ev); if (ev.__stopped) return; }
    if (ev.__stopped) return;
    node = node.__parent;
  }
}

const els = {};
['pet', 'card', 'btn-hide', 'btn-main', 'name', 'lv', 'state', 'stats', 'toast', 'exp-fill', 'exp-text']
  .forEach(id => { els[id] = makeEl(id); });
els['card'].classList.add('hidden');       // 卡片初始隐藏
els['toast'].classList.add('hidden');
// 父链：卡片内的元素属于卡片；黑猫独立
['btn-main', 'btn-hide', 'name', 'lv', 'state', 'stats', 'toast', 'exp-fill', 'exp-text']
  .forEach(id => { els[id].__parent = els['card']; });

const apiStub = {
  log: () => {}, drag: () => {},
  getStatus: async () => ({
    name: '阿七', level: 1, exp: 40, expPerLevel: 80, totalExp: 40,
    state: 'OFF_WORK', working: false,
  }),
  punchIn: async () => ({ ok: true, record: {} }),
  punchOut: async () => ({ ok: true, record: { exp: 0 } }),
  onOpenCard: () => {},
  hideWindow: () => {}, toggleWindow: () => {},
};

const win = { aqi: apiStub, addEventListener: () => {} };

const sandbox = {
  window: win,
  document: { getElementById: (id) => els[id] || null },
  console: { log: () => {}, error: () => {}, warn: () => {} },
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: () => 0, clearInterval: () => {},
  Date, Math, JSON, Promise,
};
vm.createContext(sandbox);

// 关键：在上下文内部把 aqi 定义成不可配置的全局属性（等价 contextBridge 行为）
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: {}, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const isHidden = () => els['card'].classList.contains('hidden');
const petDown = (id, x, y) => fire(els['pet'], 'pointerdown', { button: 0, pointerId: id, screenX: x, screenY: y });
const petMove = (id, x, y) => fire(els['pet'], 'pointermove', { pointerId: id, screenX: x, screenY: y });
const petUp = (id, x, y) => fire(els['pet'], 'pointerup', { pointerId: id, screenX: x, screenY: y });
const petClick = () => fire(els['pet'], 'click', { button: 0 });
const petClickOnce = (id, x, y) => { petDown(id, x, y); petUp(id, x, y); petClick(); };

// ---------- ① 证明该上下文能复现"与全局 aqi 冲突"（说明本测试有意义） ----------
let probeErr = '';
try { vm.runInContext('const aqi = 1;', sandbox, { filename: 'probe.js' }); }
catch (e) { probeErr = e.name + ': ' + e.message; }
check('上下文可复现 `const aqi` 与不可配置全局 aqi 的冲突（证明本测试有效）',
  /SyntaxError/.test(probeErr) && /already been declared/.test(probeErr), probeErr || '未报错');

// ---------- ② 执行真实的 app.js ----------
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
let loadErr = '';
try { vm.runInContext(src, sandbox, { filename: 'app.js' }); }
catch (e) { loadErr = e.name + ': ' + e.message; }
check('src/app.js 能正常执行（无 SyntaxError）', loadErr === '', loadErr || '');
check('src/app.js 顶层不再声明与全局冲突的 `aqi`',
  !/^\s*(?:const|let|var)\s+aqi\b/m.test(src), '仍存在同名声明');
check('src/app.js 已移除 F12 DevTools 入口（PM 要求）', !/openDevTools|F12/.test(src));

// ---------- ③ 单击黑猫 → 弹卡 ----------
petClickOnce(1, 500, 400);
check('单击黑猫后卡片显示', isHidden() === false, 'card.hidden=' + isHidden());

// ---------- ④ 再单击黑猫 → 收起 ----------
petClickOnce(2, 500, 400);
check('再次单击黑猫后卡片收起', isHidden() === true, 'card.hidden=' + isHidden());

// ---------- ⑤ 单击卡片「非按钮区域」→ 收起（PM 需求） ----------
petClickOnce(3, 500, 400);                 // 先弹卡
check('（前置）卡片已弹出', isHidden() === false);
fire(els['card'], 'click', { button: 0 }); // 点卡片空白处
check('单击卡片非按钮区域 → 卡片收起，回到宠物界面', isHidden() === true, 'card.hidden=' + isHidden());

// ---------- ⑥ 单击卡片「按钮」→ 不应被当作收起（按钮 stopPropagation） ----------
petClickOnce(4, 500, 400);                     // 弹卡
fire(els['btn-main'], 'click', { button: 0 }); // 点主按钮（上工/下工）
check('单击卡片按钮不会误收起卡片', isHidden() === false, 'card.hidden=' + isHidden());

// ---------- ⑦ 拖动 → 下发窗口位移，且不误弹卡 ----------
let dragCalls = 0;
apiStub.drag = () => { dragCalls++; };
petUp(4, 500, 400); // 收尾，保证卡片状态干净
if (!isHidden()) fire(els['card'], 'click', { button: 0 });
check('（前置）卡片已收起', isHidden() === true);
petDown(5, 100, 100);
petMove(5, 140, 130);
petMove(5, 180, 160);
petUp(5, 180, 160);
petClick();
check('拖动过程中确实下发了窗口位移（api.drag 被调用）', dragCalls > 0, 'calls=' + dragCalls);
check('拖动不应误触发弹卡', isHidden() === true, 'card.hidden=' + isHidden());

// ---------- ⑧ 经验条：40/80 → 宽度 50%、文案 "40.0 / 80" ----------
// render() 是在 refresh() 的微任务里跑的，等一拍再断言
setImmediate(() => {
  check('经验条宽度按 40/80 渲染为 50%',
    els['exp-fill'].style.width === '50.0%', String(els['exp-fill'].style.width));
  check('经验条文字为 “40.0 / 80”',
    els['exp-text'].textContent === '40.0 / 80', String(els['exp-text'].textContent));

  // ---------- ⑨ 结构：经验条须在标题下方、状态行上方；且已获得部分为绿色 ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const iTitle = html.indexOf('card-title');
  const iExp = html.indexOf('card-exp');
  const iState = html.indexOf('card-state');
  check('经验条位于标题下方、状态行上方（位置正确）',
    iTitle >= 0 && iExp > iTitle && iState > iExp, `title=${iTitle} exp=${iExp} state=${iState}`);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const m = css.match(/\.exp-fill\s*\{[^}]*\}/);
  const rule = m ? m[0].replace(/\s+/g, ' ') : '';
  check('经验条已获得部分为绿色（不再是橙色）',
    /#22c55e|#5ee08a|#4ade80|green/i.test(rule) && !/#ff9f43|#ffb866/.test(rule), rule || '未找到 .exp-fill 规则');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
});

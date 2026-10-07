// scripts/test-menu-window.js
// 目的：用 vm 造宿主环境验证「点击阿七弹出的功能菜单」渲染层能真正执行，
//   并覆盖：状态渲染、上工/下工按钮动态变化、菜单项回调、Esc 关闭、命名冲突防复发。
// 运行：node scripts/test-menu-window.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
const tick = () => new Promise((r) => setImmediate(r));

function makeEl(id) {
  const listeners = {};
  const el = {
    id, __listeners: listeners,
    dataset: {}, style: {}, textContent: '', innerHTML: '',
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  return el;
}
function fire(el, type, ev) {
  ev = ev || {};
  if (!ev.preventDefault) ev.preventDefault = () => {};
  (el.__listeners[type] || []).slice().forEach((fn) => fn(ev));
}

const MENU_ITEM_ACTS = ['records', 'todo', 'stats', 'growth', 'status', 'settings', 'hide'];

function loadEnv(status) {
  const els = {};
  ['m-name', 'm-lv', 'm-expfill', 'm-exptext', 'm-state', 'm-punch']
    .forEach((id) => { els[id] = makeEl(id); });
  const items = MENU_ITEM_ACTS.map((a) => { const e = makeEl('mi:' + a); e.dataset.act = a; return e; });

  const calls = { punchIn: 0, punchOut: 0, menuAction: [], closeMenu: 0 };
  const apiStub = {
    log: () => {},
    getStatus: async () => status,
    punchIn: async () => { calls.punchIn++; return { ok: true }; },
    punchOut: async () => { calls.punchOut++; return { ok: true }; },
    menuAction: (act) => { calls.menuAction.push(act); },
    closeMenu: () => { calls.closeMenu++; },
    onMenuHidden: () => {}
  };

  const docListeners = {};
  const sandbox = {
    window: { aqi: apiStub, addEventListener: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      querySelectorAll: (sel) => (String(sel).indexOf('data-act') >= 0 ? items : []),
      addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }
    },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(
    "Object.defineProperty(globalThis, 'aqi', { value: {}, writable: true, enumerable: true, configurable: false });",
    sandbox, { filename: 'define-aqi.js' });

  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu-window.js'), 'utf8');
  let err = '';
  try { vm.runInContext(code, sandbox, { filename: 'menu-window.js' }); }
  catch (e) { err = e.name + ': ' + e.message; }
  return { els, items, calls, docListeners, err, sandbox, code };
}

(async function main() {
  const rest = { name: '阿七', level: 3, exp: 40, expPerLevel: 80, working: false, completed: false, state: 'OFF_WORK' };

  // ---------- ① 上下文能复现冲突 ----------
  const env0 = loadEnv(rest);
  let probeErr = '';
  try { vm.runInContext('const aqi = 1;', env0.sandbox, { filename: 'probe.js' }); }
  catch (e) { probeErr = e.name + ': ' + e.message; }
  check('上下文可复现 `const aqi` 冲突（证明本测试有效）',
    /SyntaxError/.test(probeErr) && /already been declared/.test(probeErr), probeErr || '未报错');

  // ---------- ② 脚本可执行 + 命名规范 ----------
  check('menu-window.js 能正常执行（无 SyntaxError）', env0.err === '', env0.err || '');
  check('menu-window.js 顶层无 `const/let/var aqi` 声明',
    !/^\s*(?:const|let|var)\s+aqi\b/m.test(env0.code));
  check('menu-window.js 使用 api 别名', /const\s+api\s*=\s*window\.aqi/.test(env0.code));

  // ---------- ③ 休息态渲染 ----------
  await tick();
  check('休息态：标题显示等级 Lv.3', env0.els['m-lv'].textContent === 'Lv.3', env0.els['m-lv'].textContent);
  check('休息态：经验条 40/80 → 50.0%', env0.els['m-expfill'].style.width === '50.0%', env0.els['m-expfill'].style.width);
  check('休息态：经验文案 “40.0 / 80”', env0.els['m-exptext'].textContent === '40.0 / 80', env0.els['m-exptext'].textContent);
  check('休息态：状态行含“休息中”', /休息中/.test(env0.els['m-state'].textContent), env0.els['m-state'].textContent);
  check('休息态：主按钮为“🟢 上工”且 mode=in',
    /上工/.test(env0.els['m-punch'].textContent) && env0.els['m-punch'].dataset.mode === 'in',
    env0.els['m-punch'].textContent + '/' + env0.els['m-punch'].dataset.mode);
  check('休息态：主按钮可见', env0.els['m-punch'].style.display === '', String(env0.els['m-punch'].style.display));

  // ---------- ④ 点“上工” → punchIn + 收菜单 ----------
  fire(env0.els['m-punch'], 'click', {});
  await tick();
  check('点“上工” → 调用 punchIn', env0.calls.punchIn === 1, 'punchIn=' + env0.calls.punchIn);
  check('点“上工” → 操作后收起菜单（closeMenu）', env0.calls.closeMenu === 1, 'closeMenu=' + env0.calls.closeMenu);

  // ---------- ⑤ 菜单项 → menuAction ----------
  fire(env0.items[0], 'click', {});   // records
  fire(env0.items[2], 'click', {});   // stats
  check('点菜单项 → 回调对应动作（records / stats）',
    env0.calls.menuAction.join(',') === 'records,stats', env0.calls.menuAction.join(','));

  // ---------- ⑥ Esc → 收起菜单 ----------
  (env0.docListeners.keydown || []).forEach((fn) => fn({ key: 'Escape' }));
  check('按 Esc → 收起菜单', env0.calls.closeMenu >= 2, 'closeMenu=' + env0.calls.closeMenu);

  // ---------- ⑦ 工作中状态 ----------
  const work = loadEnv({ name: '阿七', level: 3, exp: 40, expPerLevel: 80, working: true, completed: false, state: 'WORKING', liveMinutes: 276, liveExp: 46 });
  await tick();
  check('工作中：主按钮变为“🔴 下工”且 mode=out',
    /下工/.test(work.els['m-punch'].textContent) && work.els['m-punch'].dataset.mode === 'out',
    work.els['m-punch'].textContent + '/' + work.els['m-punch'].dataset.mode);
  check('工作中：状态行显示“工作中”与实时时长 04:36',
    /工作中/.test(work.els['m-state'].textContent) && /04:36/.test(work.els['m-state'].textContent),
    work.els['m-state'].textContent);
  fire(work.els['m-punch'], 'click', {});
  await tick();
  check('工作中点主按钮 → 调用 punchOut', work.calls.punchOut === 1, 'punchOut=' + work.calls.punchOut);

  // ---------- ⑧ 已完成状态：主按钮隐藏 ----------
  const done = loadEnv({ name: '阿七', level: 3, exp: 40, expPerLevel: 80, working: false, completed: true, state: 'OFF_WORK', todayExp: 80.5 });
  await tick();
  check('今日已下工：主按钮隐藏', done.els['m-punch'].style.display === 'none', String(done.els['m-punch'].style.display));
  check('今日已下工：状态行含今日 EXP', /80\.5/.test(done.els['m-state'].textContent), done.els['m-state'].textContent);

  // ---------- ⑨ 结构：菜单项齐全且引用正确脚本 ----------
  check('菜单项数量为 7 项（记录/待办/统计/互动/状态/设置/隐藏）', MENU_ITEM_ACTS.length === 7 && env0.items.length === 7);
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'menu.html'), 'utf8');
  check('menu.html 引用 menu-window.js（不与纯逻辑同名）',
    /src="menu-window\.js"/.test(html) && !/src="menu\.js"/.test(html));
  check('menu.html 含规格 §34 的菜单项',
    ['records', 'todo', 'stats', 'growth', 'status', 'settings', 'hide'].every((a) => html.indexOf('data-act="' + a + '"') >= 0));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();

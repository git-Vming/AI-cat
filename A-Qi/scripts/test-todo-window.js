// scripts/test-todo-window.js
// 阶段 5 待办/统计窗口渲染层测试：验证 src/todo-window.js 在「contextBridge 不可配置全局 aqi」环境下
//   ① 能复现 const aqi 命名冲突（证明测试有效）② 脚本可执行 ③ 渲染待办与统计 ④ 勾选/关闭调对桥
// 运行：node scripts/test-todo-window.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ---------- DOM 桩 ----------
function makeEl(id) {
  const el = {
    id,
    _listeners: {},
    _children: [],
    _sel: '',
    className: '',
    value: '',
    disabled: false,
    checked: false,
    textContent: '',
    dataset: {},
    _scrolled: false,
    scrollIntoView() { el._scrolled = true; },
    addEventListener(type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); },
    dispatch(type, ev) { (this._listeners[type] || []).forEach((cb) => cb(ev || {})); },
    querySelectorAll(sel) { return this._children.filter((c) => c._sel === sel); }
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v);
      el._children = [];
      const re = /<input type="checkbox" data-i="(\d+)"( checked)?>/g;
      let m;
      while ((m = re.exec(_html))) {
        const c = makeEl('cb-' + m[1]);
        c._sel = 'input[type="checkbox"]';
        c.dataset.i = m[1];
        c.checked = !!m[2];
        el._children.push(c);
      }
    }
  });
  return el;
}

const IDS = ['todo-sub', 'todos', 'stats-body', 'stats-foot', 'result', 'btn-close', 'sec-todo', 'sec-stats'];
const els = {};
IDS.forEach((id) => { els[id] = makeEl(id); });

const docListeners = {};
const documentStub = {
  getElementById: (id) => els[id] || null,
  addEventListener: (t, cb) => { (docListeners[t] = docListeners[t] || []).push(cb); }
};

// ---------- 桥桩 ----------
const calls = { log: [], setTodo: [], close: 0, getTodos: 0, getStats: 0 };
const todosData = {
  date: '2026-10-05',
  from: '2026-10-04',
  items: [
    { text: '完成设备容量复核', completed: true },
    { text: '联系建筑专业确认设备位置', completed: false },
    { text: '整理配电方案', completed: false }
  ]
};
const statsData = {
  today: '2026-10-05',
  ranges: {
    today: { workDays: 1, totalMinutes: 480, avgMinutes: 480, weekdayOvertimeCount: 0, weekdayOvertimeMinutes: 0, weekendOvertimeCount: 0, weekendOvertimeMinutes: 0 },
    week: { workDays: 3, totalMinutes: 1260, avgMinutes: 420, weekdayOvertimeCount: 1, weekdayOvertimeMinutes: 60, weekendOvertimeCount: 0, weekendOvertimeMinutes: 0 },
    month: { workDays: 4, totalMinutes: 1500, avgMinutes: 375, weekdayOvertimeCount: 1, weekdayOvertimeMinutes: 60, weekendOvertimeCount: 1, weekendOvertimeMinutes: 240 },
    total: { workDays: 5, totalMinutes: 1980, avgMinutes: 396, weekdayOvertimeCount: 1, weekdayOvertimeMinutes: 60, weekendOvertimeCount: 1, weekendOvertimeMinutes: 240 }
  },
  streak: 4, totalExp: 3120.5, level: 40, exp: 0.5, expPerLevel: 80
};

const apiStub = {
  log: (m) => calls.log.push(m),
  getTodos: async () => { calls.getTodos += 1; return JSON.parse(JSON.stringify(todosData)); },
  getStats: async () => { calls.getStats += 1; return statsData; },
  setTodo: async (p) => {
    calls.setTodo.push(p);
    todosData.items[p.index].completed = !!p.done;
    return { ok: true, items: JSON.parse(JSON.stringify(todosData.items)) };
  },
  closeTodo: () => { calls.close += 1; },
  onFocusSection: (cb) => { apiStub._focus = cb; }
};

// ---------- 宿主环境（等价 contextBridge：全局 aqi 不可配置）----------
const win = { aqi: apiStub, addEventListener: () => {} };
const sandbox = { window: win, document: documentStub, console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: globalThis.window.aqi, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const srcPath = path.join(__dirname, '..', 'src', 'todo-window.js');
const code = fs.readFileSync(srcPath, 'utf8');

console.log('— ① 复现能力 —');
{
  let err = '';
  try { vm.runInContext('const aqi = 1;', sandbox, { filename: 'probe.js' }); }
  catch (e) { err = e.name + ': ' + e.message; }
  check('上下文能复现 `const aqi` 的 SyntaxError',
    /SyntaxError/.test(err) && /already been declared/.test(err), err || '未报错');
}

console.log('— ② 脚本执行 —');
{
  let loadErr = '';
  try { vm.runInContext(code, sandbox, { filename: 'src/todo-window.js' }); }
  catch (e) { loadErr = e.name + ': ' + e.message; }
  check('todo-window.js 执行无 SyntaxError', loadErr === '', loadErr);
  check('源码无顶层 const/let/var aqi 声明', !/^\s*(const|let|var)\s+aqi\b/m.test(code));
  check('使用 api 引用桥', /const\s+api\s*=\s*window\.aqi/.test(code));
  check('页面引用的脚本名与实际文件一致（todo-window.js）',
    /todo-window\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'todo.html'), 'utf8')));
}

setTimeout(() => {
  console.log('— ③ 今日待办渲染 —');
  check('已上报 booted', calls.log.some((m) => m.includes('booted')), calls.log.join('|'));
  check('副标题注明来源与进度',
    els['todo-sub'].textContent.includes('来自 2026-10-04') && els['todo-sub'].textContent.includes('已完成 1/3'),
    els['todo-sub'].textContent);
  const cbs = els.todos.querySelectorAll('input[type="checkbox"]');
  check('渲染出 3 个复选框', cbs.length === 3, String(cbs.length));
  check('第 1 条为已勾选', cbs[0] && cbs[0].checked === true);
  check('第 2 条未勾选', cbs[1] && cbs[1].checked === false);
  check('已完成项带删除线样式类', els.todos.innerHTML.includes('class="txt done"'));
  check('条目文本被 HTML 转义（防注入）',
    !/<script/i.test(els.todos.innerHTML));

  console.log('— ④ 工作统计渲染 —');
  const rows = (els['stats-body'].innerHTML.match(/<tr>/g) || []).length;
  check('统计表 7 行', rows === 7, String(rows));
  check('每行 1 个指标名 + 4 个数值列',
    (els['stats-body'].innerHTML.match(/<td>/g) || []).length === 28,
    String((els['stats-body'].innerHTML.match(/<td>/g) || []).length));
  check('含「平均每日工作时长」行', els['stats-body'].innerHTML.includes('平均每日工作时长'));
  check('时长按 时:分 显示（今日 480 → 08:00）', els['stats-body'].innerHTML.includes('>08:00<'));
  check('无记录时段显示 —（累计加班时长为 01:00）', els['stats-body'].innerHTML.includes('>01:00<'));
  check('底部显示累计 EXP / 等级 / 连续工作',
    els['stats-foot'].innerHTML.includes('3120.5')
    && els['stats-foot'].innerHTML.includes('Lv.40')
    && els['stats-foot'].innerHTML.includes('4 天'),
    els['stats-foot'].innerHTML);

  console.log('— ⑤ 勾选待办 —');
  const c1 = els.todos.querySelectorAll('input[type="checkbox"]')[1];
  c1.checked = true;
  c1.dispatch('change');
  setTimeout(() => {
    check('勾选调用 setTodo 且 payload 正确',
      calls.setTodo.length === 1 && calls.setTodo[0].date === '2026-10-05'
      && calls.setTodo[0].index === 1 && calls.setTodo[0].done === true,
      JSON.stringify(calls.setTodo));
    check('完成后副标题进度更新为 2/3',
      els['todo-sub'].textContent.includes('已完成 2/3'), els['todo-sub'].textContent);

    console.log('— ⑥ 空待办提示 —');
    todosData.items = [];
    apiStub._focus('todo');       // 模拟托盘再次打开 → 会 refresh
    setTimeout(() => {
      check('空列表显示引导文案',
        els.todos.innerHTML.includes('没有【明日待办】条目') && els.todos.innerHTML.includes('2026-10-04.txt'),
        els.todos.innerHTML.slice(0, 80));
      check('再次打开会刷新数据（getTodos 被调用 ≥2 次）', calls.getTodos >= 2, String(calls.getTodos));

      console.log('— ⑦ 分区定位 —');
      apiStub._focus('stats');
      check('打开统计时滚动到统计区', els['sec-stats']._scrolled === true);
      apiStub._focus('todo');
      check('打开待办时滚动到待办区', els['sec-todo']._scrolled === true);

      console.log('— ⑧ 关闭 —');
      els['btn-close'].dispatch('click');
      check('点击关闭调用 closeTodo', calls.close === 1, String(calls.close));
      (docListeners['keydown'] || []).forEach((cb) => cb({ key: 'Escape' }));
      check('Esc 也能关闭', calls.close === 2, String(calls.close));

      console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
      process.exit(fail === 0 ? 0 : 1);
    }, 30);
  }, 30);
}, 40);

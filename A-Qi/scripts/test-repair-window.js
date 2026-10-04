// scripts/test-repair-window.js
// 阶段 4 补录窗口渲染层测试：验证 repair.js 在「contextBridge 注入不可配置全局 aqi」的真实环境下
//   ① 能复现 const aqi 命名冲突（证明这套测试有效）
//   ② 真实 repair.js 执行无 SyntaxError、能查询待处理项、渲染列表、预填表单
//   ③ 点列表项填入表单、提交补录、忽略、关闭 全部调用到正确的桥
// 运行：node scripts/test-repair-window.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ---------- 极简 DOM 桩（带事件、innerHTML 解析出可点击的 .item 行） ----------
function makeEl(id) {
  const el = {
    id,
    _listeners: {},
    _children: [],
    _sel: '',
    className: '',
    value: '',
    disabled: false,
    dataset: {},
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
      const re = /<div class="item" data-date="([^"]+)">([\s\S]*?)<\/div>/g;
      let m;
      while ((m = re.exec(_html))) {
        const child = makeEl('item-' + m[1]);
        child._sel = '.item';
        child.dataset.date = m[1];
        child._text = m[2];
        el._children.push(child);
      }
    }
  });
  return el;
}

const IDS = ['pending', 'form', 'result', 'f-date', 'f-start', 'f-end', 'btn-save', 'btn-ignore', 'btn-close'];
const els = {};
IDS.forEach((id) => { els[id] = makeEl(id); });

const docListeners = {};
const documentStub = {
  getElementById: (id) => els[id] || null,
  addEventListener: (t, cb) => { (docListeners[t] = docListeners[t] || []).push(cb); }
};

const calls = { repair: [], ignore: [], close: 0, log: [] };
const pendingData = [{ date: '2026-10-05', kind: 'forgot_out', startHM: '08:00' }];

const apiStub = {
  log: (m) => calls.log.push(m),
  getPending: async () => pendingData.slice(),
  repair: async (p) => {
    calls.repair.push(p);
    return { ok: true, record: { date: p.date, sessions: [{ start: p.start, end: p.end }], totalMinutes: 480, exp: 80 } };
  },
  ignoreDay: async (d) => { calls.ignore.push(d); return { ok: true, date: d }; },
  closeRepair: () => { calls.close += 1; }
};

// ---------- 构造宿主环境 ----------
// 等价 contextBridge：全局 aqi 是【不可配置】属性；window.aqi 指向同一份桥。
const win = { aqi: apiStub, addEventListener: () => {} };
const sandbox = { window: win, document: documentStub, console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: globalThis.window.aqi, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const srcPath = path.join(__dirname, '..', 'src', 'repair.js');
const code = fs.readFileSync(srcPath, 'utf8');

console.log('— ① 复现能力（证明这类测试抓得住命名冲突）—');
{
  let err = '';
  try { vm.runInContext('const aqi = 1;', sandbox, { filename: 'probe.js' }); }
  catch (e) { err = e.name + ': ' + e.message; }
  check('上下文能复现 `const aqi` 与不可配置全局 aqi 的 SyntaxError',
    /SyntaxError/.test(err) && /already been declared/.test(err), err || '未报错');
}

console.log('— ② repair.js 执行 —');
{
  let loadErr = '';
  try { vm.runInContext(code, sandbox, { filename: 'src/repair.js' }); }
  catch (e) { loadErr = e.name + ': ' + e.message; }
  check('repair.js 执行无 SyntaxError', loadErr === '', loadErr);
  check('源码中无顶层 const/let/var aqi 声明', !/^\s*(const|let|var)\s+aqi\b/m.test(code));
  check('使用 api 引用桥（const api = window.aqi）', /const\s+api\s*=\s*window\.aqi/.test(code));
}

setTimeout(() => {
  console.log('— ③ 启动即查询并渲染 —');
  check('已上报 booted', calls.log.some((m) => m.includes('booted')), calls.log.join('|'));
  check('已查询待处理项并渲染日期', els.pending.innerHTML.includes('2026-10-05'), els.pending.innerHTML.slice(0, 80));
  check('渲染了「忘记下工」文案', els.pending.innerHTML.includes('忘记下工'));
  check('表单预填该日期', els['f-date'].value === '2026-10-05', els['f-date'].value);
  check('忘记下工场景带上已知上工时间', els['f-start'].value === '08:00', els['f-start'].value);
  check('下工时间留空待用户填写', els['f-end'].value === '', els['f-end'].value);

  console.log('— ④ 点列表项 → 填入表单 —');
  els.pending._children[0].dispatch('click');
  check('点击后日期仍为该日', els['f-date'].value === '2026-10-05');

  console.log('— ⑤ 提交补录 —');
  els['f-end'].value = '18:00';
  els.form.dispatch('submit', { preventDefault() {} });
  check('提交后按钮进入禁用态（防重复提交）', els['btn-save'].disabled === true);

  setTimeout(() => {
    check('调用 repair 且 payload 正确',
      calls.repair.length === 1 && calls.repair[0].date === '2026-10-05'
      && calls.repair[0].start === '08:00' && calls.repair[0].end === '18:00',
      JSON.stringify(calls.repair));
    check('显示成功结果并含 EXP', els.result.innerHTML.includes('+80.0 EXP'), els.result.innerHTML.slice(0, 90));
    check('结果样式为 ok', els.result.className.includes('ok'), els.result.className);
    check('按钮已恢复可用', els['btn-save'].disabled === false);

    console.log('— ⑥ 忽略「这天没上班」 —');
    els['f-date'].value = '2026-10-06';
    els['btn-ignore'].dispatch('click');
    setTimeout(() => {
      check('调用 ignoreDay 且日期正确',
        calls.ignore.length === 1 && calls.ignore[0] === '2026-10-06', JSON.stringify(calls.ignore));

      console.log('— ⑦ 关闭 —');
      els['btn-close'].dispatch('click');
      check('点击关闭调用 closeRepair', calls.close === 1, String(calls.close));
      (docListeners['keydown'] || []).forEach((cb) => cb({ key: 'Escape' }));
      check('Esc 也能关闭', calls.close === 2, String(calls.close));

      console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
      process.exit(fail === 0 ? 0 : 1);
    }, 25);
  }, 25);
}, 35);

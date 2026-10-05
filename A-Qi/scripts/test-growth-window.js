// scripts/test-growth-window.js
// 阶段 7 互动/宠物状态窗口渲染层测试：验证 src/growth-window.js 在「contextBridge 不可配置全局 aqi」环境下
//   ① 能复现 const aqi 命名冲突（证明测试有效）② 脚本可执行 ③ 渲染互动按钮与状态
//   ④ 点击互动调用正确桥 ⑤ 次数用完禁用 ⑥ 关闭/分区定位
// 运行：node scripts/test-growth-window.js
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
    textContent: '',
    dataset: {},
    disabled: false,
    _scrolled: false,
    scrollIntoView() { el._scrolled = true; },
    addEventListener(t, cb) { (this._listeners[t] = this._listeners[t] || []).push(cb); },
    dispatch(t, ev) { (this._listeners[t] || []).forEach((cb) => cb(ev || {})); },
    querySelectorAll(sel) { return this._children.filter((c) => c._sel === sel); }
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v);
      el._children = [];
      // 解析出 .act 按钮（用于点击测试）
      const re = /<button type="button" class="act" data-key="([^"]+)"( disabled)?>/g;
      let m;
      while ((m = re.exec(_html))) {
        const c = makeEl('act-' + m[1]);
        c._sel = '.act';
        c.dataset.key = m[1];
        c.disabled = !!m[2];
        el._children.push(c);
      }
    }
  });
  return el;
}

const IDS = ['interact-sub', 'acts', 'status-rows', 'unlocks', 'result', 'btn-close', 'sec-interact', 'sec-status'];
const els = {};
IDS.forEach((id) => { els[id] = makeEl(id); });

const docListeners = {};
const documentStub = {
  getElementById: (id) => els[id] || null,
  addEventListener: (t, cb) => { (docListeners[t] = docListeners[t] || []).push(cb); }
};

// ---------- 桥桩 ----------
const calls = { log: [], interact: [], close: 0, getGrowth: 0 };
const fixture = {
  name: '阿七', level: 3, exp: 3.5, expPerLevel: 80, totalExp: 163.5,
  affection: 7, interactionCount: 12,
  createdAt: '2026-10-03', companionDays: 3,
  unlockedItems: ['hat', 'clothes'],
  unlockList: [
    { level: 2, id: 'hat', name: '帽子', emoji: '🎩' },
    { level: 3, id: 'clothes', name: '衣服', emoji: '👕' },
    { level: 4, id: 'cup', name: '水杯', emoji: '🥤' },
    { level: 5, id: 'laptop', name: '小电脑', emoji: '💻' }
  ],
  nextUnlock: { level: 4, id: 'cup', name: '水杯', emoji: '🥤' },
  state: 'IDLE', stateText: '休息中', stateEmoji: '🐱',
  counters: { date: '2026-10-05', counts: { pat: 2, play: 3 } },
  actions: [
    { key: 'pat', label: '摸摸头', emoji: '🤚', dailyLimit: 5, remaining: 3 },
    { key: 'feed', label: '喂点吃的', emoji: '🍚', dailyLimit: 3, remaining: 3 },
    { key: 'water', label: '给它喝水', emoji: '💧', dailyLimit: 3, remaining: 3 },
    { key: 'play', label: '陪它玩会儿', emoji: '🧶', dailyLimit: 3, remaining: 0 }   // 用完 → 应禁用
  ]
};

const apiStub = {
  log: (m) => calls.log.push(m),
  getGrowth: async () => { calls.getGrowth += 1; return JSON.parse(JSON.stringify(fixture)); },
  interact: async (key) => {
    calls.interact.push(key);
    const a = fixture.actions.find((x) => x.key === key);
    if (!a || a.remaining <= 0) return { ok: false, reason: 'daily_limit' };
    a.remaining -= 1;
    fixture.affection += 1;
    fixture.interactionCount += 1;
    return {
      ok: true, action: key, state: 'HAPPY', stateText: '很开心',
      message: '阿七眯起眼睛蹭了蹭你的手 🐱', affection: fixture.affection,
      affectionDelta: 1, counters: fixture.counters
    };
  },
  closeGrowth: () => { calls.close += 1; },
  onGrowthFocus: (cb) => { apiStub._focus = cb; }
};

// ---------- 宿主环境（等价 contextBridge：全局 aqi 不可配置）----------
const win = { aqi: apiStub, addEventListener: () => {} };
const sandbox = { window: win, document: documentStub, console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: globalThis.window.aqi, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const srcPath = path.join(__dirname, '..', 'src', 'growth-window.js');
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
  try { vm.runInContext(code, sandbox, { filename: 'src/growth-window.js' }); }
  catch (e) { loadErr = e.name + ': ' + e.message; }
  check('growth-window.js 执行无 SyntaxError', loadErr === '', loadErr);
  check('源码无顶层 const/let/var aqi 声明', !/^\s*(const|let|var)\s+aqi\b/m.test(code));
  check('使用 api 引用桥', /const\s+api\s*=\s*window\.aqi/.test(code));
  check('页面引用的脚本名与实际文件一致（growth-window.js）',
    /growth-window\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'growth.html'), 'utf8')));
  check('文案用 esc() 转义（防注入）', /function esc\(/.test(code));
}

setTimeout(() => {
  console.log('— ③ 互动区渲染 —');
  check('已上报 booted', calls.log.some((m) => m.includes('booted')), calls.log.join('|'));
  const acts = els.acts.querySelectorAll('.act');
  check('渲染 4 个互动按钮', acts.length === 4, String(acts.length));
  check('按钮顺序为 pat/feed/water/play',
    acts.map((b) => b.dataset.key).join(',') === 'pat,feed,water,play', acts.map((b) => b.dataset.key).join(','));
  check('剩余 0 的按钮被禁用（play）',
    acts.find((b) => b.dataset.key === 'play').disabled === true);
  check('有剩余的按钮可用（pat）',
    acts.find((b) => b.dataset.key === 'pat').disabled === false);
  check('副标题显示好感度与可互动次数',
    els['interact-sub'].textContent.includes('好感度 7') && els['interact-sub'].textContent.includes('今日还可互动 9 次'),
    els['interact-sub'].textContent);
  check('每条按钮显示今日剩余', els.acts.innerHTML.includes('今日剩余 3/5'));

  console.log('— ④ 宠物状态渲染 —');
  const rows = els['status-rows'].innerHTML;
  check('含状态行（🐱 休息中）', rows.includes('状态') && rows.includes('休息中'), rows.slice(0, 80));
  check('含等级行（Lv.3）', rows.includes('Lv.3'));
  check('含累计 EXP 行并注明只来自工时', rows.includes('累计 EXP') && rows.includes('只来自真实工作时长'));
  check('含好感度行', rows.includes('好感度'));
  check('含陪伴天数行', rows.includes('3 天') && rows.includes('2026-10-03'));
  check('含互动总次数行', rows.includes('12'));
  check('已解锁道具 2 个（绿色 chip）',
    (els.unlocks.innerHTML.match(/class="chip"/g) || []).length === 2,
    String((els.unlocks.innerHTML.match(/class="chip"/g) || []).length));
  check('未解锁道具 2 个（带 🔒 与等级）',
    (els.unlocks.innerHTML.match(/class="chip locked"/g) || []).length === 2
    && els.unlocks.innerHTML.includes('🔒 Lv.4 水杯'),
    els.unlocks.innerHTML.slice(0, 120));

  console.log('— ⑤ 点击互动 —');
  const patBtn = els.acts.querySelectorAll('.act').find((b) => b.dataset.key === 'pat');
  patBtn.dispatch('click');
  setTimeout(() => {
    check('调用 interact("pat")', calls.interact.length === 1 && calls.interact[0] === 'pat',
      JSON.stringify(calls.interact));
    check('结果区显示互动文案与好感度 +1',
      els.result.innerHTML.includes('蹭了蹭你的手') && els.result.innerHTML.includes('+1'),
      els.result.innerHTML.slice(0, 100));
    check('结果样式为 ok', els.result.className.includes('ok'), els.result.className);
    check('互动后刷新数据（getGrowth 调用 ≥2 次）', calls.getGrowth >= 2, String(calls.getGrowth));
    check('剩余次数已减少（pat 变 2/5）', els.acts.innerHTML.includes('今日剩余 2/5'), els.acts.innerHTML.slice(0, 60));

    console.log('— ⑥ 次数用完 → 失败提示 —');
    const playBtn = els.acts.querySelectorAll('.act').find((b) => b.dataset.key === 'play');
    // 已禁用，但直接派发事件也能走到失败分支（模拟极端时序）
    playBtn.dispatch('click');
    setTimeout(() => {
      check('次数用完提示文案', els.result.innerHTML.includes('次数用完') || els.result.innerHTML.includes('互动失败'),
        els.result.innerHTML.slice(0, 80));

      console.log('— ⑦ 分区定位 —');
      apiStub._focus('status');
      check('打开宠物状态时滚动到状态区', els['sec-status']._scrolled === true);
      apiStub._focus('interact');
      check('打开互动时滚动到互动区', els['sec-interact']._scrolled === true);

      console.log('— ⑧ 关闭 —');
      els['btn-close'].dispatch('click');
      check('点击关闭调用 closeGrowth', calls.close === 1, String(calls.close));
      (docListeners['keydown'] || []).forEach((cb) => cb({ key: 'Escape' }));
      check('Esc 也能关闭', calls.close === 2, String(calls.close));

      console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
      process.exit(fail === 0 ? 0 : 1);
    }, 30);
  }, 30);
}, 40);

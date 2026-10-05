// scripts/test-bubble-window.js
// 阶段 6 提醒气泡渲染层测试：验证 src/bubble-window.js 在「contextBridge 不可配置全局 aqi」环境下
//   ① 能复现 const aqi 命名冲突（证明测试有效）② 脚本可执行 ③ 能接收文案并渲染
//   ④ 左键单击气泡 / Esc 关闭（V-ming 要求：气泡只有点击才消失）
// 运行：node scripts/test-bubble-window.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ---------- 极简 DOM 桩 ----------
function makeEl(id) {
  const el = {
    id,
    _listeners: {},
    textContent: '',
    innerHTML: '',
    dataset: {},
    addEventListener(t, cb) { (this._listeners[t] = this._listeners[t] || []).push(cb); },
    dispatch(t, ev) { (this._listeners[t] || []).forEach((cb) => cb(ev || {})); }
  };
  return el;
}
const els = { text: makeEl('text'), body: makeEl('body') };
const docListeners = {};
const documentStub = {
  title: '',
  body: els.body,
  getElementById: (id) => els[id] || null,
  addEventListener: (t, cb) => { (docListeners[t] = docListeners[t] || []).push(cb); }
};

// ---------- 桥桩 ----------
const calls = { log: [], hide: 0 };
let bubbleCb = null;
const apiStub = {
  log: (m) => calls.log.push(m),
  onBubbleText: (cb) => { bubbleCb = cb; },
  hideBubble: () => { calls.hide += 1; }
};

// ---------- 宿主环境（等价 contextBridge：全局 aqi 不可配置）----------
const win = { aqi: apiStub, addEventListener: () => {} };
const sandbox = { window: win, document: documentStub, console, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(
  "Object.defineProperty(globalThis, 'aqi', { value: globalThis.window.aqi, writable: true, enumerable: true, configurable: false });",
  sandbox, { filename: 'define-aqi.js' });

const srcPath = path.join(__dirname, '..', 'src', 'bubble-window.js');
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
  try { vm.runInContext(code, sandbox, { filename: 'src/bubble-window.js' }); }
  catch (e) { loadErr = e.name + ': ' + e.message; }
  check('bubble-window.js 执行无 SyntaxError', loadErr === '', loadErr);
  check('源码无顶层 const/let/var aqi 声明', !/^\s*(const|let|var)\s+aqi\b/m.test(code));
  check('使用 api 引用桥', /const\s+api\s*=\s*window\.aqi/.test(code));
  check('页面引用的脚本名与实际文件一致（bubble-window.js）',
    /bubble-window\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'bubble.html'), 'utf8')));
  check('文案用 textContent 写入（防注入，不用 innerHTML）',
    /elText\.textContent\s*=/.test(code) && !/elText\.innerHTML/.test(code));
}

console.log('— ③ 接收并渲染文案 —');
{
  check('已上报 booted', calls.log.some((m) => m.includes('booted')), calls.log.join('|'));
  check('已注册 onBubbleText 回调', typeof bubbleCb === 'function');
  if (typeof bubbleCb === 'function') {
    bubbleCb('工作很认真，但眼睛也要休息一下哦 👀');
    check('文案写入 text 元素',
      els.text.textContent === '工作很认真，但眼睛也要休息一下哦 👀', els.text.textContent);
    check('窗口标题同步更新', documentStub.title.includes('工作很认真'), documentStub.title);

    bubbleCb('起来走两步啦，你快和椅子融为一体了 🚶');
    check('第二条文案能覆盖显示',
      els.text.textContent.includes('融为一体'), els.text.textContent);

    bubbleCb('');
    check('空文案不报错', els.text.textContent === '');
  }
}

console.log('— ④ 只有点击才消失 —');
{
  check('初始未调用 hideBubble（气泡不会自动消失）', calls.hide === 0, String(calls.hide));
  els.body.dispatch('click');
  check('左键单击气泡 → hideBubble', calls.hide === 1, String(calls.hide));
  (docListeners['keydown'] || []).forEach((cb) => cb({ key: 'Escape' }));
  check('Esc 也能关闭', calls.hide === 2, String(calls.hide));
  (docListeners['keydown'] || []).forEach((cb) => cb({ key: 'a' }));
  check('其它按键不关闭', calls.hide === 2, String(calls.hide));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

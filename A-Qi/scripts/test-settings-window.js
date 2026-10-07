// scripts/test-settings-window.js
// 目的：用 vm 造宿主环境验证「设置页」渲染层能真正执行，并覆盖：
//   各设置项渲染、改动即保存、越界输入回退、改名校验、备份/恢复流程（恢复必须二次确认）、
//   命名冲突防复发。
// 运行：node scripts/test-settings-window.js
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
  const classes = new Set();
  return {
    id, __listeners: listeners, __parent: null, children: [],
    dataset: {}, style: {}, textContent: '', title: '', value: '',
    checked: false, disabled: false, className: '', _html: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      // 必须支持 force 参数：真实 DOM 里 toggle(c,false) 是【移除】（踩过）
      toggle: (c, force) => {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c); else classes.add(c);
        } else if (force) classes.add(c); else classes.delete(c);
        return classes.has(c);
      }
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    appendChild(c) { c.__parent = this; this.children.push(c); return c; },
    insertAdjacentElement(pos, node) { node.__parent = this.__parent; this.__sib = node; return node; },
    remove() { this.__removed = true; },
    querySelector() { return null; }
  };
}
function fire(el, type, ev) {
  ev = ev || {};
  if (!ev.preventDefault) ev.preventDefault = () => {};
  (el.__listeners[type] || []).slice().forEach((fn) => fn(ev));
}

const IDS = ['pet-name', 'btn-name', 'always-on-top', 'size-large', 'size-small', 'pos-text', 'btn-reset-pos',
  'reminders', 'eye-min', 'sit-min', 'start-on-boot', 'data-dir', 'btn-open-dir',
  'data-summary', 'last-backup', 'btn-backup', 'backups', 'ver', 'toast'];

function loadEnv(state, overrides) {
  const els = {};
  IDS.forEach((id) => { els[id] = makeEl(id); });
  const created = [];
  const calls = { save: [], setPetName: [], backup: 0, restore: [], resetPos: 0, openDir: 0, reload: 0 };
  const apiStub = {
    log: () => {},
    getSettingsState: async () => { calls.reload++; return state; },
    saveSettings: async (p) => { calls.save.push(p); return { ok: true, settings: state.settings }; },
    setPetName: async (n) => {
      calls.setPetName.push(n);
      if (!String(n).trim()) return { ok: false, reason: 'empty' };
      return { ok: true, name: String(n).trim() };
    },
    backupNow: async () => { calls.backup++; return { ok: true, name: '20261007-150000' }; },
    restoreBackup: async (n) => { calls.restore.push(n); return { ok: true, safetyBackup: '20261007-150001' }; },
    resetPosition: async () => { calls.resetPos++; return { ok: true, x: 800, y: 400 }; },
    openDataDir: () => { calls.openDir++; }
  };
  Object.assign(els, overrides || {});

  const sandbox = {
    window: { aqi: apiStub, addEventListener: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (tag) => { const e = makeEl('new:' + tag); created.push(e); return e; },
      querySelectorAll: () => []
    },
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Promise, Number, String
  };
  vm.createContext(sandbox);
  vm.runInContext(
    "Object.defineProperty(globalThis, 'aqi', { value: {}, writable: true, enumerable: true, configurable: false });",
    sandbox, { filename: 'define-aqi.js' });

  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings-window.js'), 'utf8');
  let err = '';
  try { vm.runInContext(code, sandbox, { filename: 'settings-window.js' }); }
  catch (e) { err = e.name + ': ' + e.message; }
  return { els, created, calls, err, sandbox, code };
}

const STATE = {
  settings: {
    petName: '阿七', alwaysOnTop: true, startOnBoot: false,
    position: { x: 100, y: 200 }, remindersEnabled: true,
    eyeReminderMin: 60, sitReminderMin: 90
  },
  appInfo: {
    dataDir: 'D:\\AI-cat\\AI-cat\\A-Qi\\data', attendanceDays: 3, recordFiles: 3,
    dataBytes: 2048, backupCount: 2,
    lastBackup: { name: '20261007-143000', createdAt: '2026-10-07T06:30:00.000Z', sizeBytes: 2048 }
  },
  backups: [
    { name: '20261007-143000', createdAt: '2026-10-07T06:30:00.000Z', sizeBytes: 2048 },
    { name: '20261006-180000', createdAt: '2026-10-06T10:00:00.000Z', sizeBytes: 1024 }
  ],
  version: '1.0.0',
  loginItem: false
};

(async function main() {
  // ---------- ① 冲突可复现 ----------
  const env0 = loadEnv(STATE);
  let probeErr = '';
  try { vm.runInContext('const aqi = 1;', env0.sandbox, { filename: 'probe.js' }); }
  catch (e) { probeErr = e.name + ': ' + e.message; }
  check('上下文可复现 `const aqi` 冲突（证明本测试有效）',
    /SyntaxError/.test(probeErr) && /already been declared/.test(probeErr), probeErr || '未报错');

  // ---------- ② 可执行 + 命名规范 ----------
  check('settings-window.js 能正常执行（无 SyntaxError）', env0.err === '', env0.err || '');
  check('settings-window.js 顶层无 `const/let/var aqi`',
    !/^\s*(?:const|let|var)\s+aqi\b/m.test(env0.code));
  check('settings-window.js 使用 api 别名', /const\s+api\s*=\s*window\.aqi/.test(env0.code));

  // ---------- ③ 渲染 ----------
  await tick();
  const E = env0.els;
  check('渲染：宠物名回填', E['pet-name'].value === '阿七', E['pet-name'].value);
  check('渲染：置顶勾选', E['always-on-top'].checked === true);
  check('渲染：提醒勾选', E['reminders'].checked === true);
  check('渲染：护眼间隔 60', String(E['eye-min'].value) === '60', String(E['eye-min'].value));
  check('渲染：久坐间隔 90', String(E['sit-min'].value) === '90', String(E['sit-min'].value));
  check('渲染：开机启动以系统真实状态为准（false）', E['start-on-boot'].checked === false);
  check('渲染：桌面位置文案含坐标', /100/.test(E['pos-text'].textContent) && /200/.test(E['pos-text'].textContent),
    E['pos-text'].textContent);
  check('渲染：数据概览含出勤天数', /3 天/.test(E['data-summary'].textContent), E['data-summary'].textContent);
  check('渲染：最近备份显示时间', /2026-10-07/.test(E['last-backup'].textContent), E['last-backup'].textContent);
  check('渲染：版本号', /1\.0\.0/.test(E['ver'].textContent), E['ver'].textContent);
  check('渲染：数据目录已填充', /A-Qi/.test(E['data-dir'].textContent), E['data-dir'].textContent);

  const backupRows = env0.created.filter((e) => e.className === 'backup-item');
  check('渲染：备份列表 2 条', backupRows.length === 2, String(backupRows.length));
  const restoreBtns = env0.created.filter((e) => e.textContent === '恢复');
  check('渲染：每条备份都有「恢复」按钮', restoreBtns.length === 2, String(restoreBtns.length));

  // ---------- ④ 各设置项：改动即保存 ----------
  E['always-on-top'].checked = false;
  fire(E['always-on-top'], 'change', {});
  await tick();
  check('取消置顶 → 保存 alwaysOnTop:false',
    env0.calls.save.length === 1 && env0.calls.save[0].alwaysOnTop === false,
    JSON.stringify(env0.calls.save));

  E['reminders'].checked = false;
  fire(E['reminders'], 'change', {});
  await tick();
  check('关闭提醒 → 保存 remindersEnabled:false',
    env0.calls.save.some((p) => p.remindersEnabled === false), JSON.stringify(env0.calls.save));

  E['eye-min'].value = '30';
  fire(E['eye-min'], 'change', {});
  await tick();
  check('护眼间隔改 30 → 保存 30',
    env0.calls.save.some((p) => p.eyeReminderMin === 30), JSON.stringify(env0.calls.save));

  E['eye-min'].value = '0';           // 越界：小于 1 → 回退默认 60
  fire(E['eye-min'], 'change', {});
  await tick();
  check('护眼间隔输入 0 → 回退默认 60（不写入非法值）',
    env0.calls.save.some((p) => p.eyeReminderMin === 60), JSON.stringify(env0.calls.save));

  E['sit-min'].value = '9999';        // 越界：超过上限 → 收敛到 600
  fire(E['sit-min'], 'change', {});
  await tick();
  check('久坐间隔输入 9999 → 收敛到 600',
    env0.calls.save.some((p) => p.sitReminderMin === 600), JSON.stringify(env0.calls.save));

  E['start-on-boot'].checked = true;
  fire(E['start-on-boot'], 'change', {});
  await tick();
  check('开启开机启动 → 保存 startOnBoot:true',
    env0.calls.save.some((p) => p.startOnBoot === true), JSON.stringify(env0.calls.save));

  // ---------- ⑤ 改名 ----------
  E['pet-name'].value = '小黑';
  fire(E['btn-name'], 'click', {});
  await tick();
  check('改名为「小黑」→ 调用 setPetName', env0.calls.setPetName.join(',') === '小黑',
    env0.calls.setPetName.join(','));

  E['pet-name'].value = '   ';
  const before = env0.calls.setPetName.length;
  fire(E['btn-name'], 'click', {});
  await tick();
  check('空名字被拦下（不调用 setPetName）', env0.calls.setPetName.length === before,
    'calls=' + env0.calls.setPetName.length);

  // ---------- ⑥ 位置 / 打开目录 / 备份 ----------
  fire(E['btn-reset-pos'], 'click', {});
  await tick();
  check('点「回到屏幕中央」→ 调用 resetPosition', env0.calls.resetPos === 1, String(env0.calls.resetPos));

  fire(E['btn-open-dir'], 'click', {});
  check('点「打开」→ 调用 openDataDir', env0.calls.openDir === 1, String(env0.calls.openDir));

  fire(E['btn-backup'], 'click', {});
  await tick();
  check('点「立即备份」→ 调用 backupNow', env0.calls.backup === 1, String(env0.calls.backup));

  // ---------- ⑦ 恢复：必须先二次确认 ----------
  const c0 = env0.created.length;
  fire(restoreBtns[0], 'click', {});
  await tick();
  check('点「恢复」不会立刻恢复（必须二次确认）', env0.calls.restore.length === 0,
    JSON.stringify(env0.calls.restore));
  const confirms = env0.created.slice(c0).filter((e) => e.className === 'confirm');
  check('点「恢复」会展开确认条', confirms.length === 1, String(confirms.length));
  const okBtn = env0.created.filter((e) => e.textContent === '确认恢复');
  check('确认条里有「确认恢复」按钮', okBtn.length === 1, String(okBtn.length));
  const cancelBtn = env0.created.filter((e) => e.textContent === '取消');
  check('确认条里有「取消」按钮', cancelBtn.length === 1, String(cancelBtn.length));

  fire(okBtn[0], 'click', {});
  await tick();
  check('点「确认恢复」→ 执行恢复且带备份名', env0.calls.restore.join(',') === '20261007-143000',
    env0.calls.restore.join(','));

  const c1 = env0.created.length;
  const restoreBtns2 = env0.created.filter((e) => e.textContent === '恢复');
  fire(restoreBtns2[1], 'click', {});
  await tick();
  fire(env0.created.filter((e) => e.textContent === '取消').slice(-1)[0], 'click', {});
  check('点「取消」→ 不执行恢复', env0.calls.restore.length === 1, JSON.stringify(env0.calls.restore));

  // ---------- ⑧ 结构断言 ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
  check('settings.html 引用 settings-window.js（窗口脚本单独命名）',
    /src="settings-window\.js"/.test(html) && !/src="settings\.js"/.test(html));
  check('settings.html 含阶段 9 全部设置项',
    ['pet-name', 'always-on-top', 'reminders', 'eye-min', 'sit-min',
      'start-on-boot', 'btn-backup', 'btn-reset-pos'].every((id) => html.indexOf('id="' + id + '"') >= 0));

  // ---------- ⑨ 宠物大小（2026-10-07 新增：大 / 小 = 一半） ----------
  // 放在最后，避免污染前面用例共用的 calls / DOM 状态
  {
    const env = loadEnv(STATE);
    // HTML 里两个按钮带 data-size；桩不会解析 HTML，这里手工补上（等价真实 DOM）
    env.els['size-large'].dataset.size = 'large';
    env.els['size-small'].dataset.size = 'small';
    await tick();
    const S = env.els;
    check('宠物大小未设置时默认高亮「大」',
      S['size-large'].classList.contains('active') && !S['size-small'].classList.contains('active'));

    fire(S['size-small'], 'click', {});
    await tick();
    const patch = env.calls.save[env.calls.save.length - 1];
    check('点「小」→ 保存 petSize=small', patch && patch.petSize === 'small', JSON.stringify(patch));
    check('patch 只含 petSize 一个字段（不误改其它设置）',
      patch && Object.keys(patch).length === 1, JSON.stringify(patch));

    fire(S['size-large'], 'click', {});
    await tick();
    const patch2 = env.calls.save[env.calls.save.length - 1];
    check('点「大」→ 保存 petSize=large', patch2 && patch2.petSize === 'large', JSON.stringify(patch2));
  }
  {
    const env2 = loadEnv(Object.assign({}, STATE, {
      settings: Object.assign({}, STATE.settings, { petSize: 'small' })
    }));
    await tick();
    check('已是 small → 高亮「小」、不再高亮「大」',
      env2.els['size-small'].classList.contains('active')
      && !env2.els['size-large'].classList.contains('active'));
  }
  {
    const html2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.html'), 'utf8');
    check('settings.html 含宠物大小两个按钮（data-size=large/small）',
      /id="size-large"[^>]*data-size="large"|data-size="large"[^>]*id="size-large"/.test(html2)
      && /id="size-small"[^>]*data-size="small"|data-size="small"[^>]*id="size-small"/.test(html2));
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();

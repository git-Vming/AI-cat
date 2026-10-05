// scripts/test-todo.js
// 阶段 5 待办纯逻辑测试：前一天日期 / 【明日待办】解析 / 状态合并 / 展示格式 / 与真实模板联通
// 运行：node scripts/test-todo.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const todo = require('../src/todo');
const wr = require('../src/work-record');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('— 前一天日期（含跨月/跨年/闰年）—');
{
  check('2026-10-05 → 2026-10-04', todo.prevDate('2026-10-05') === '2026-10-04', todo.prevDate('2026-10-05'));
  check('2026-10-01 → 2026-09-30（跨月）', todo.prevDate('2026-10-01') === '2026-09-30', todo.prevDate('2026-10-01'));
  check('2026-01-01 → 2025-12-31（跨年）', todo.prevDate('2026-01-01') === '2025-12-31', todo.prevDate('2026-01-01'));
  check('2026-03-01 → 2026-02-28（平年）', todo.prevDate('2026-03-01') === '2026-02-28', todo.prevDate('2026-03-01'));
  check('2024-03-01 → 2024-02-29（闰年）', todo.prevDate('2024-03-01') === '2024-02-29', todo.prevDate('2024-03-01'));
}

console.log('— 解析【明日待办】—');
{
  const t1 = [
    '2026-10-02｜工作记录', '',
    '【考勤】', '上工：08:03', '',
    '【明日待办】', '',
    '1. 完成设备容量复核',
    '2. 联系建筑专业',
    '3. 整理配电方案', '',
    '【阿七】', '今日获得EXP：81'
  ].join('\n');
  const r1 = todo.parseTodoLines(t1);
  check('标准编号列表解析正确', r1.length === 3 && r1[0] === '完成设备容量复核' && r1[2] === '整理配电方案',
    JSON.stringify(r1));

  const t2 = ['【明日待办】', '', '1.', '2.', '3.'].join('\n');
  check('模板空占位（1./2./3.）解析为空', todo.parseTodoLines(t2).length === 0, JSON.stringify(todo.parseTodoLines(t2)));

  check('无该段 → 空数组', todo.parseTodoLines('【考勤】\n上工：08:00').length === 0);
  check('空文本 → 空数组', todo.parseTodoLines('').length === 0 && todo.parseTodoLines(null).length === 0);

  const t3 = ['【明日待办】', '继续完成南安项目', '找结构专业要条件'].join('\n');
  check('无编号行也能解析', todo.parseTodoLines(t3).length === 2, JSON.stringify(todo.parseTodoLines(t3)));

  const t4 = ['【明日待办】', '- 甲', '* 乙', '· 丙', '□ 丁', '☑ 戊'].join('\n');
  const r4 = todo.parseTodoLines(t4);
  check('项目符号/勾选框被剥离', r4.join('|') === '甲|乙|丙|丁|戊', r4.join('|'));

  const t5 = ['【明日待办】', '1、带顿号', '2) 带括号', '3 带空格'].join('\n');
  const r5 = todo.parseTodoLines(t5);
  check('多种编号写法都能剥离', r5.join('|') === '带顿号|带括号|带空格', r5.join('|'));

  const t6 = ['【明日待办】', '12. 两位数编号', '  ', '2026年要做的事'].join('\n');
  const r6 = todo.parseTodoLines(t6);
  check('两位数编号剥离，纯文本行不被误删', r6.join('|') === '两位数编号|2026年要做的事', r6.join('|'));

  const t7 = ['【明日待办】', '1. 段在文末也要能读'].join('\n');   // 无后续段标题
  check('段在文末（无后续标题）也能解析', todo.parseTodoLines(t7).join('|') === '段在文末也要能读');
}

console.log('— 完成状态合并 —');
{
  const items = ['甲', '乙', '丙'];
  const merged = todo.mergeState(items, [{ text: '乙', completed: true }]);
  check('按文本匹配恢复完成状态', merged[1].completed === true && merged[0].completed === false, JSON.stringify(merged));
  check('无保存状态时全部未完成', todo.mergeState(items, null).every((x) => x.completed === false));
  check('保存了未知条目也不报错', todo.mergeState(items, [{ text: '不存在', completed: true }]).every((x) => !x.completed));
  check('文本被改动则视为未完成（安全）',
    todo.mergeState(['乙（改过）'], [{ text: '乙', completed: true }])[0].completed === false);
}

console.log('— 展示与计数 —');
{
  const items = [{ text: '甲', completed: true }, { text: '乙', completed: false }];
  check('fmtTodos 使用 ☑/□', todo.fmtTodos(items).join('|') === '☑ 甲|□ 乙', todo.fmtTodos(items).join('|'));
  const c = todo.countDone(items);
  check('countDone 计数正确', c.total === 2 && c.done === 1, JSON.stringify(c));
  check('空列表计数为 0', todo.countDone([]).total === 0);
}

console.log('— 与真实工作记录 TXT 联通 —');
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-todo-'));
  const D = '2026-10-05';
  // 1) 刚生成的模板（只有 1./2./3. 占位）→ 待办应为空
  wr.syncRecord(root, D, null, { lunch: ['12:00', '14:00'] });
  check('模板占位不产生待办', todo.parseTodoLines(wr.readRecord(root, D)).length === 0);

  // 2) 用户手写条目后 → 能解析出来
  const p = wr.recordPath(root, D);
  let t = fs.readFileSync(p, 'utf8');
  t = t.replace('1.\n2.\n3.', '1. 完成设备容量复核\n2. 联系建筑专业确认设备位置\n3. 整理配电方案');
  fs.writeFileSync(p, t, 'utf8');

  const items = todo.mergeState(todo.parseTodoLines(wr.readRecord(root, D)), null);
  check('手写条目被正确解析为今日待办', items.length === 3, JSON.stringify(items.map(x => x.text)));

  // 3) 同步考勤不应破坏【明日待办】（阶段 3 的铁律在新流程下依然成立）
  wr.syncRecord(root, D, {
    date: D, type: 'workday',
    sessions: [{ start: '08:00', end: '18:00', source: 'normal' }],
    totalMinutes: 480, normalMinutes: 480, overtimeMinutes: 0, exp: 80, status: 'completed'
  }, { lunch: ['12:00', '14:00'] });
  const after = todo.parseTodoLines(wr.readRecord(root, D));
  check('同步考勤后待办仍在', after.length === 3, JSON.stringify(after));

  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

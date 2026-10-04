// scripts/test-work-record.js
// 阶段 3 工作记录 TXT 测试：模板生成 / 考勤段同步 / 用户手写内容绝不被覆盖 / 历史列表
// 运行：node scripts/test-work-record.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const wr = require('../src/work-record');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-rec-'));
const opts = { lunch: ['12:00', '14:00'] };
const D = '2026-10-05';   // 周一

const recWorking = {
  date: D, type: 'workday',
  sessions: [{ start: '08:03', startTs: '2026-10-05T08:03:00.000Z', source: 'normal' }],
  status: 'working'
};
const recDone = {
  date: D, type: 'workday',
  sessions: [{ start: '08:03', end: '18:07', source: 'normal' }],
  totalMinutes: 484, normalMinutes: 480, overtimeMinutes: 4, exp: 80.7, status: 'completed'
};
const recDoneNoLunch = {
  date: '2026-10-06', type: 'workday',
  sessions: [{ start: '09:00', end: '11:00', source: 'normal' }],
  totalMinutes: 120, normalMinutes: 120, overtimeMinutes: 0, exp: 20, status: 'completed'
};
const recWeekend = {
  date: '2026-10-04', type: 'weekend',
  sessions: [{ start: '09:00', end: '13:00', source: 'normal' }],
  totalMinutes: 240, normalMinutes: 0, overtimeMinutes: 240, exp: 40, status: 'completed'
};
const recIncomplete = {
  date: '2026-10-02', type: 'workday',
  sessions: [{ start: '08:02', startTs: '2026-10-02T08:02:00.000Z', source: 'normal' }],
  status: 'incomplete'
};

console.log('— 基础 —');
check('fmtDuration(484) = 08小时04分钟', wr.fmtDuration(484) === '08小时04分钟', wr.fmtDuration(484));
check('fmtDuration(0) = 00小时00分钟', wr.fmtDuration(0) === '00小时00分钟', wr.fmtDuration(0));

console.log('— 首次生成（无上工记录也要有骨架）—');
{
  const p = path.join(root, 'WorkRecords', D + '.txt');
  const r = wr.syncRecord(root, D, recWorking, opts);
  check('文件已创建', r.created === true && fs.existsSync(p));
  const t = wr.readRecord(root, D);
  check('标题为「2026-10-05｜工作记录」', t.includes('2026-10-05｜工作记录'));
  check('上工时间写入', t.includes('上工：08:03'));
  check('进行中状态正确', t.includes('下工：--:--') && t.includes('实际工作时长：（进行中）'));
  check('五个用户段齐全', wr.HEADERS.every(h => t.includes(h)));
  check('明日待办有 1./2./3. 占位', t.includes('1.') && t.includes('2.') && t.includes('3.'));
  check('文件以换行结尾', t.endsWith('\n'));
  // 新模板结构（V-ming 2026-10-04 定稿）
  check('【工作内容】含类型提示注', t.includes('注：工作类型分为设计、服务、对接。在这里填写今日的工作内容。'));
  check('【工作内容】含上午时段 08:00~12:00', t.includes('08:00~12:00：'));
  check('【工作内容】含下午时段 14:00~18:00', t.includes('14:00~18:00：'));
  check('【工作内容】含是否加班行', t.includes('是否加班：是/否'));
  check('【工作内容】含加班时段 18:00~20:00', t.includes('18:00~20:00：'));
  check('新增段【今日新知】存在', t.includes('【今日新知】'));
  check('新增段【项目节点】存在', t.includes('【项目节点】'));
  check('【项目节点】含示例行', t.includes('例如：南安半导体项目：交图日期2026-10-30；今日由师傅通过微信告知项目节点。'));
  // 段落顺序必须与定稿一致
  check('段落顺序正确（考勤→工作内容→完成→问题→新知→项目节点→待办→阿七）',
    (() => {
      const order = wr.HEADERS.map(h => t.indexOf(h));
      return order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
    })(), wr.HEADERS.map(h => h + '@' + t.indexOf(h)).join(' '));
}

console.log('— 下工后同步考勤（工作日、跨午休）—');
{
  const r = wr.syncRecord(root, D, recDone, opts);
  check('第二次为更新而非新建', r.created === false);
  const t = wr.readRecord(root, D);
  check('下工时间写入', t.includes('下工：18:07'));
  check('午休行出现且标注自动扣除', t.includes('午休：12:00–14:00（自动扣除）'), '无午休行');
  check('实际工作时长正确', t.includes('实际工作时长：08小时04分钟'));
  check('今日EXP 保留 1 位小数', t.includes('今日EXP：80.7'));
  check('【阿七】段 EXP 同步', t.includes('今日获得EXP：80.7'));
  check('考勤段只出现一次', (t.match(/【考勤】/g) || []).length === 1);
  check('用户段仍各出现一次', wr.HEADERS.every(h => (t.match(new RegExp(h, 'g')) || []).length === 1));
}

console.log('— 不跨午休 / 周末 不写午休行 —');
{
  wr.syncRecord(root, '2026-10-06', recDoneNoLunch, opts);
  const t1 = wr.readRecord(root, '2026-10-06');
  check('09:00–11:00 无午休行', !t1.includes('午休：'));
  wr.syncRecord(root, '2026-10-04', recWeekend, opts);
  const t2 = wr.readRecord(root, '2026-10-04');
  check('周末无午休行', !t2.includes('午休：'));
}

console.log('— 跨天未下工（incomplete）—');
{
  wr.syncRecord(root, '2026-10-02', recIncomplete, opts);
  const t = wr.readRecord(root, '2026-10-02');
  check('下工标注（未记录）', t.includes('下工：（未记录）'));
  check('时长标注（待补录）', t.includes('实际工作时长：（待补录）'));
}

console.log('— 关键：用户手写内容不被覆盖 —');
{
  const p = wr.recordPath(root, D);
  let t = fs.readFileSync(p, 'utf8');
  t = t.replace('注：工作类型分为设计、服务、对接。在这里填写今日的工作内容。', '08:00~12:00：南安半导体厂房识图\n14:00~18:00：核对设备位置');
  t = t.replace('在这里填写今日完成事项。', '完成设备容量初算');
  t = t.replace('在这里填写工作过程中遇到的问题。', '底图缺少标高');
  t = t.replace('在这里填写工作过程中学习到的新知识。', '学会了用天正批量改标高');
  t = t.replace('在这里填写今日分配的项目的交图日期。', '南安半导体项目：交图日期2026-10-30');
  t = t.replace('1.\n2.\n3.', '1. 完成设备容量复核\n2. 联系建筑专业\n3. 整理配电方案');
  fs.writeFileSync(p, t, 'utf8');

  // 再同步一次（改用另一组工时，模拟重新结算/补录）
  wr.syncRecord(root, D, { ...recDone, totalMinutes: 500, exp: 83.3 }, opts);
  const t2 = fs.readFileSync(p, 'utf8');
  check('手写「工作内容」保留', t2.includes('08:00~12:00：南安半导体厂房识图') && t2.includes('14:00~18:00：核对设备位置'));
  check('手写「今日完成」保留', t2.includes('完成设备容量初算'));
  check('手写「今日问题」保留', t2.includes('底图缺少标高'));
  check('手写「今日新知」保留', t2.includes('学会了用天正批量改标高'));
  check('手写「项目节点」保留', t2.includes('南安半导体项目：交图日期2026-10-30'));
  check('手写「明日待办」保留', t2.includes('1. 完成设备容量复核') && t2.includes('3. 整理配电方案'));
  check('考勤段已按新数据更新', t2.includes('实际工作时长：08小时20分钟') && t2.includes('今日EXP：83.3'));
  check('用户段未被复制成两份', (t2.match(/【今日完成】/g) || []).length === 1);
  check('新增段未被复制成两份', (t2.match(/【今日新知】/g) || []).length === 1 && (t2.match(/【项目节点】/g) || []).length === 1);
}

console.log('— 无上工记录的骨架 —');
{
  wr.syncRecord(root, '2026-10-07', null, opts);
  const t = wr.readRecord(root, '2026-10-07');
  check('提示今日还没有上工记录', t.includes('（今日还没有上工记录）'));
  check('EXP 占位为 —', t.includes('今日EXP：—') && t.includes('今日获得EXP：—'));
}

console.log('— 历史列表 —');
{
  const list = wr.listRecords(root);
  check('列出 5 个记录文件', list.length === 5, 'got=' + list.length + ' ' + JSON.stringify(list.map(x => x.date)));
  check('按日期倒序', list.map(x => x.date).join(',') === '2026-10-07,2026-10-06,2026-10-05,2026-10-04,2026-10-02',
    list.map(x => x.date).join(','));
  check('忽略非日期文件', (() => {
    fs.writeFileSync(path.join(root, 'WorkRecords', 'README.txt'), 'x', 'utf8');
    return wr.listRecords(root).length === 5;
  })());
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

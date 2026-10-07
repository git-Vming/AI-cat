// scripts/test-acceptance.js
// 阶段 10：**逐条复现《技术实现规格》§45「最终验收核心」的 5 个场景**。
// 这是 V1.0 最重要的一组期望值，因此单独成一套测试，把规格里的数字直接写成断言。
//
// 运行：node scripts/test-acceptance.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const ds = require('../src/data-store');
const wt = require('../src/work-time');
const wr = require('../src/work-record');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function mkRoot(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-acc-' + tag + '-')); }
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
const LUNCH = { lunch: ['12:00', '14:00'] };
const S = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0);

function worked(dateStr, sh, sm, eh, em, type) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const day = new Date(y, mo - 1, d);
  return wt.computeWorked(S(day, sh, sm), S(day, eh, em), type, LUNCH);
}

console.log('===== 场景 A：正常工作日 =====');
console.log('   08:00 上工 → 12:00 午休 → 14:00 恢复 → 18:00 下工');
{
  const r = worked('2026-10-07', 8, 0, 18, 0, 'workday');
  check('工作 8 小时（480 分钟）', r.totalMinutes === 480, String(r.totalMinutes));
  check('EXP 80', wt.expFromMinutes(r.totalMinutes) === 80, String(wt.expFromMinutes(r.totalMinutes)));
  check('加班 0', r.overtimeMinutes === 0, String(r.overtimeMinutes));
  check('正常时长 480', r.normalMinutes === 480, String(r.normalMinutes));
}

console.log('===== 场景 B：工作日晚走 =====');
console.log('   08:00 上工 → 20:00 下工');
{
  const r = worked('2026-10-07', 8, 0, 20, 0, 'workday');
  check('正常 8 小时（480 分钟）', r.normalMinutes === 480, String(r.normalMinutes));
  check('加班 2 小时（120 分钟）', r.overtimeMinutes === 120, String(r.overtimeMinutes));
  check('总工作 10 小时（600 分钟）', r.totalMinutes === 600, String(r.totalMinutes));
  check('EXP 100', wt.expFromMinutes(r.totalMinutes) === 100, String(wt.expFromMinutes(r.totalMinutes)));
  check('工作日加班计 1 次', r.overtimeMinutes > 0);
}

console.log('===== 场景 C：早到晚走 =====');
console.log('   07:30 上工 → 18:30 下工');
{
  const r = worked('2026-10-07', 7, 30, 18, 30, 'workday');
  check('正常 8 小时（480 分钟）', r.normalMinutes === 480, String(r.normalMinutes));
  check('额外时长 = 早到 0.5h + 晚走 0.5h = 1 小时（60 分钟）',
    r.overtimeMinutes === 60, String(r.overtimeMinutes));
  check('总工作 9 小时（540 分钟）', r.totalMinutes === 540, String(r.totalMinutes));
  check('EXP 90', wt.expFromMinutes(r.totalMinutes) === 90, String(wt.expFromMinutes(r.totalMinutes)));
  // 注：规格 §45 场景 C 写的"额外 1.5h / 总 9.5h / EXP 95"与自身描述（07:30→18:30）算术不符
  // （07:30→18:30 共 11h，扣 2h 午休 = 9h）。此处以实现（与阶段 2 已验收的算法）为准，
  // 差异已在《开发报告_阶段10》中列明请 PM 确认。
}

console.log('===== 场景 D：周六加班 =====');
console.log('   周六 09:00 上工 → 13:00 下工');
{
  const r = worked('2026-10-03', 9, 0, 13, 0, 'weekend');
  check('周末加班 4 小时（240 分钟）', r.totalMinutes === 240, String(r.totalMinutes));
  check('周末不扣午休（本次跨 12:00 也不扣）', r.totalMinutes === 240);
  check('EXP 40', wt.expFromMinutes(r.totalMinutes) === 40, String(wt.expFromMinutes(r.totalMinutes)));
  check('判定为周末', wt.classifyDay('2026-10-03') === 'weekend');
}

console.log('===== 场景 E：忘记下工 =====');
console.log('   前一天 08:00 上工，没有下工 → 第二天必须提醒补录，且绝不能自动算成超长工时');
{
  const r = mkRoot('E');
  ds.ensureDataLayer(r);
  // 造一条"昨天上工、一直没下工"的记录
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const p2 = (n) => String(n).padStart(2, '0');
  const yday = `${y.getFullYear()}-${p2(y.getMonth() + 1)}-${p2(y.getDate())}`;
  const att = ds.readJson(path.join(r, 'data', 'attendance.json'), {});
  att[yday] = {
    date: yday, type: wt.classifyDay(yday), status: 'working',
    sessions: [{ start: '08:00', startTs: new Date(y.getFullYear(), y.getMonth(), y.getDate(), 8).toISOString(), source: 'normal' }]
  };
  ds.writeJson(path.join(r, 'data', 'attendance.json'), att);

  const changed = ds.resumeIncomplete(r);
  const rec = ds.readJson(path.join(r, 'data', 'attendance.json'), {})[yday];
  check('跨天未下工 → 被标记为 incomplete', changed === true && rec.status === 'incomplete',
    JSON.stringify({ changed, status: rec && rec.status }));

  const s = ds.getStats(r);
  check('★ 绝不自动计入工时（累计 0 分钟）', s.ranges.total.totalMinutes === 0, String(s.ranges.total.totalMinutes));
  check('★ 绝不自动给 EXP（累计 0 EXP）', s.totalExp === 0, String(s.totalExp));

  const pend = ds.findPendingRepairs(r);
  check('待补录检测能发现它', pend.length === 1 && pend[0].date === yday, JSON.stringify(pend));

  // 人工补录后才计入
  const rep = ds.repairAttendance(r, { date: yday, start: '08:00', end: '18:00' });
  check('人工补录后状态变为 completed（标注来源）', rep.ok && rep.record.status === 'completed');
  check('补录后工时按补录值计（480 分钟）', ds.getStats(r).ranges.total.totalMinutes === 480);
  const txt = wr.recordPath(r, yday);
  wr.syncRecord(r, yday, rep.record, LUNCH);
  check('该日工作记录标注「考勤状态：补录」',
    fs.existsSync(txt) && /补录/.test(fs.readFileSync(txt, 'utf8')));
  rm(r);
}

console.log('===== 场景 F：工作日加班进入统计 =====');
{
  const r = mkRoot('F');
  ds.ensureDataLayer(r);
  ds.repairAttendance(r, { date: '2026-09-28', start: '08:00', end: '20:00' });  // 周一 10h
  ds.repairAttendance(r, { date: '2026-10-03', start: '09:00', end: '13:00' });  // 周六 4h
  const s = ds.getStats(r);
  check('工作日加班计 1 次 / 120 分钟',
    s.ranges.total.weekdayOvertimeCount === 1 && s.ranges.total.weekdayOvertimeMinutes === 120,
    JSON.stringify({ c: s.ranges.total.weekdayOvertimeCount, m: s.ranges.total.weekdayOvertimeMinutes }));
  check('周末加班计 1 次 / 240 分钟',
    s.ranges.total.weekendOvertimeCount === 1 && s.ranges.total.weekendOvertimeMinutes === 240,
    JSON.stringify({ c: s.ranges.total.weekendOvertimeCount, m: s.ranges.total.weekendOvertimeMinutes }));
  check('累计总时长 600 + 240 = 840 分钟', s.ranges.total.totalMinutes === 840, String(s.ranges.total.totalMinutes));
  check('累计 EXP = 100 + 40 = 140', s.totalExp === 140, String(s.totalExp));
  check('等级按 80/级：140 EXP → Lv.2', wt.levelFromTotalExp(140) === 2, String(wt.levelFromTotalExp(140)));
  rm(r);
}

console.log('===== 场景 G：一天只点击两次（上工/下工），午休自动排除 =====');
{
  const r = mkRoot('G');
  ds.ensureDataLayer(r);
  ds.repairAttendance(r, { date: '2026-10-07', start: '08:00', end: '18:00' });
  const rec = ds.readJson(path.join(r, 'data', 'attendance.json'), {})['2026-10-07'];
  check('只产生 1 个会话（2 次点击即可）', rec.sessions.length === 1, String(rec.sessions.length));
  check('工时 480 分钟（午休已自动排除，无需用户操作）', rec.totalMinutes === 480, String(rec.totalMinutes));
  rm(r);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

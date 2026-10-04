// scripts/test-repair.js
// 阶段 4 测试：补录 / 修正考勤 / 忽略 / 待补录检测 / 全量重算一致性 / 绝不自动算超长工时
// 运行：node scripts/test-repair.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const ds = require('../src/data-store');
const wr = require('../src/work-record');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ===== 可控时间：测试「昨天」相关检测 =====
const RealDate = Date;
function fakeNow(iso) {
  const fixed = new RealDate(iso).getTime();
  function FakeDate(...args) {
    if (args.length === 0) return new RealDate(fixed);
    return new RealDate(...args);
  }
  FakeDate.now = () => fixed;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  global.Date = FakeDate;
}
function restoreDate() { global.Date = RealDate; }

function newRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-repair-'));
  ds.ensureDataLayer(r);
  return r;
}
function stats(r) { return ds.readJson(path.join(r, 'data', 'statistics.json'), {}); }
function pet(r) { return ds.readJson(path.join(r, 'data', 'pet.json'), {}); }
function att(r) { return ds.readJson(path.join(r, 'data', 'attendance.json'), {}); }
function setPet(r, obj) { ds.writeJson(path.join(r, 'data', 'pet.json'), obj); }
function rm(r) { fs.rmSync(r, { recursive: true, force: true }); }

console.log('— 输入校验（非法输入必须被拒，且不写入任何数据）—');
{
  const r = newRoot();
  const bad = (p) => ds.repairAttendance(r, p);
  check('非法日期 abc', bad({ date: 'abc', start: '08:00', end: '18:00' }).reason === 'bad_date');
  check('不存在的日期 2026-02-31', bad({ date: '2026-02-31', start: '08:00', end: '18:00' }).reason === 'bad_date');
  check('缺日期', bad({ start: '08:00', end: '18:00' }).reason === 'bad_date');
  check('非法上工 25:00', bad({ date: '2026-09-28', start: '25:00', end: '18:00' }).reason === 'bad_start');
  check('上工格式 8:0', bad({ date: '2026-09-28', start: '8:0', end: '18:00' }).reason === 'bad_start');
  check('非法下工', bad({ date: '2026-09-28', start: '08:00', end: '25:00' }).reason === 'bad_end');
  check('下工早于上工', bad({ date: '2026-09-28', start: '18:00', end: '08:00' }).reason === 'bad_range');
  check('下工等于上工', bad({ date: '2026-09-28', start: '08:00', end: '08:00' }).reason === 'bad_range');
  check('未来日期被拒', bad({ date: '2099-01-01', start: '08:00', end: '18:00' }).reason === 'future');
  check('校验失败后未写入任何记录', Object.keys(att(r)).length === 0, JSON.stringify(att(r)));
  check('isValidHM 正确', ds.isValidHM('23:59') === true && ds.isValidHM('24:00') === false);
  check('isValidDate 正确', ds.isValidDate('2026-10-05') === true && ds.isValidDate('2026-2-5') === false);
  rm(r);
}

console.log('— 补录：工作日 08:00→18:00（午休自动扣除）—');
{
  const r = newRoot();
  const res = ds.repairAttendance(r, { date: '2026-09-28', start: '08:00', end: '18:00' }); // 周一
  check('补录成功', res.ok === true, JSON.stringify(res && res.reason));
  check('类型判定为工作日', res.record.type === 'workday');
  check('工时 480 分钟（10h − 2h 午休）', Math.abs(res.record.totalMinutes - 480) < 0.01, res.record.totalMinutes);
  check('EXP = 80', res.record.exp === 80, res.record.exp);
  check('source = manual_repair', res.record.source === 'manual_repair');
  check('状态 completed 且已计入', res.record.status === 'completed' && res.record.counted === true);
  check('首次补录 replaced=false', res.replaced === false);
  const s = stats(r);
  check('统计 workDays=1', s.workDays === 1, s.workDays);
  check('统计 totalWorkMinutes=480', Math.abs(s.totalWorkMinutes - 480) < 0.01, s.totalWorkMinutes);
  check('统计 totalExp=80', s.totalExp === 80, s.totalExp);
  const p = pet(r);
  check('宠物 totalExp=80 → Lv.2', p.totalExp === 80 && p.level === 2, 'lv=' + p.level);
  // 对应 TXT
  wr.syncRecord(r, '2026-09-28', res.record, { lunch: ['12:00', '14:00'] });
  const t = wr.readRecord(r, '2026-09-28');
  check('TXT 标注「考勤状态：补录」', t.includes('考勤状态：补录'));
  check('TXT 时长为 08小时00分钟', t.includes('实际工作时长：08小时00分钟'), '');
  check('TXT 今日EXP 为 80.0', t.includes('今日EXP：80.0'));
  rm(r);
}

console.log('— 关键：二次补录（修改时间）不重复累加 —');
{
  const r = newRoot();
  ds.repairAttendance(r, { date: '2026-09-28', start: '08:00', end: '18:00' });   // 480
  const res2 = ds.repairAttendance(r, { date: '2026-09-28', start: '08:00', end: '12:00' }); // 240
  check('覆盖成功且 replaced=true', res2.ok === true && res2.replaced === true);
  check('改为 240 分钟', Math.abs(res2.record.totalMinutes - 240) < 0.01, res2.record.totalMinutes);
  const s = stats(r);
  check('统计为 240（不是 480+240=720）', Math.abs(s.totalWorkMinutes - 240) < 0.01, s.totalWorkMinutes);
  check('totalExp=40（不是 120）', s.totalExp === 40, s.totalExp);
  check('workDays 仍为 1（不重复计天）', s.workDays === 1, s.workDays);
  check('该日仅一条记录', Object.keys(att(r)).length === 1, Object.keys(att(r)).join(','));
  rm(r);
}

console.log('— 补录：无记录的日期（忘记上工）—');
{
  const r = newRoot();
  const res = ds.repairAttendance(r, { date: '2026-09-29', start: '09:00', end: '17:00' }); // 周二
  check('新建补录记录', res.ok === true && res.replaced === false);
  check('工时 360 分钟', Math.abs(res.record.totalMinutes - 360) < 0.01, res.record.totalMinutes);
  check('EXP 60', res.record.exp === 60, res.record.exp);
  rm(r);
}

console.log('— 补录：周末（不套标准区间、不扣午休）—');
{
  const r = newRoot();
  const res = ds.repairAttendance(r, { date: '2026-10-03', start: '09:00', end: '13:00' }); // 周六
  check('类型判定为周末', res.record.type === 'weekend');
  check('工时 240 分钟（不扣午休）', Math.abs(res.record.totalMinutes - 240) < 0.01, res.record.totalMinutes);
  check('EXP 40', res.record.exp === 40);
  const s = stats(r);
  check('统计：workDays=0 / 周末加班 1 次', s.workDays === 0 && s.weekendOvertimeCount === 1, JSON.stringify(s));
  rm(r);
}

console.log('— 忽略「这天没上班」—');
{
  const r = newRoot();
  const ig = ds.ignoreDay(r, '2026-09-28');
  check('忽略成功', ig.ok === true);
  check('写入 absent 标记', att(r)['2026-09-28'] && att(r)['2026-09-28'].status === 'absent');
  check('忽略不产生工时/EXP', stats(r).totalWorkMinutes === 0 && stats(r).totalExp === 0);
  check('忽略非法日期被拒', ds.ignoreDay(r, 'xxx').reason === 'bad_date');
  // 已有出勤记录的日子不允许被"忽略"抹掉
  ds.repairAttendance(r, { date: '2026-09-29', start: '09:00', end: '17:00' });
  const ig2 = ds.ignoreDay(r, '2026-09-29');
  check('已有出勤记录的日子禁止忽略', ig2.ok === false && ig2.reason === 'has_record');
  check('已有记录未被抹掉', att(r)['2026-09-29'].status === 'completed');
  rm(r);
}

console.log('— 待补录检测（含「绝不误报全新安装」）—');
{
  // 假今天 = 2026-10-06（周二）→ 昨天 = 2026-10-05（周一，工作日）
  const r = newRoot();
  setPet(r, { createdAt: '2026-10-01', level: 1, exp: 0, totalExp: 0 });
  fakeNow('2026-10-06T10:00:00');

  let list = ds.findPendingRepairs(r);
  check('周一无记录 → 提醒忘记上工', list.length === 1 && list[0].kind === 'forgot_in' && list[0].date === '2026-10-05',
    JSON.stringify(list));

  ds.ignoreDay(r, '2026-10-05');
  list = ds.findPendingRepairs(r);
  check('忽略后不再提醒', list.length === 0, JSON.stringify(list));

  // 忘记下工：incomplete
  const a = att(r);
  a['2026-09-30'] = {
    date: '2026-09-30', type: 'workday',
    sessions: [{ start: '08:00', startTs: new RealDate('2026-09-30T08:00:00').toISOString(), source: 'normal' }],
    status: 'incomplete'
  };
  ds.writeJson(path.join(r, 'data', 'attendance.json'), a);
  list = ds.findPendingRepairs(r);
  check('incomplete → 提醒忘记下工', list.length === 1 && list[0].kind === 'forgot_out' && list[0].date === '2026-09-30',
    JSON.stringify(list));
  check('提醒带上已知的上工时间', list[0].startHM === '08:00', list[0].startHM);
  rm(r);

  // 程序昨天才首次运行 → 不该报"你昨天忘打卡"
  const r2 = newRoot();
  setPet(r2, { createdAt: '2026-10-05', level: 1, exp: 0, totalExp: 0 });
  check('createAt 不早于昨天 → 不误报', ds.findPendingRepairs(r2).length === 0);
  rm(r2);

  // 昨天是周末 → 不提醒
  const r3 = newRoot();
  setPet(r3, { createdAt: '2026-10-01', level: 1, exp: 0, totalExp: 0 });
  fakeNow('2026-10-05T10:00:00');   // 昨天 = 10-04 周日
  check('昨天是周末 → 不提醒', ds.findPendingRepairs(r3).length === 0);
  rm(r3);
  restoreDate();
}

console.log('— 核心安全底线：跨天未下工绝不自动算超长工时 —');
{
  const r = newRoot();
  const a = {};
  a['2026-10-05'] = {
    date: '2026-10-05', type: 'workday',
    sessions: [{ start: '08:00', startTs: new RealDate('2026-10-05T08:00:00').toISOString(), source: 'normal' }],
    status: 'working'
  };
  ds.writeJson(path.join(r, 'data', 'attendance.json'), a);

  fakeNow('2026-10-06T09:30:00');   // 第二天才开机
  ds.resumeIncomplete(r);
  const a2 = att(r);
  check('跨天 working → incomplete', a2['2026-10-05'].status === 'incomplete', a2['2026-10-05'].status);
  check('未写入任何工时/EXP', a2['2026-10-05'].totalMinutes === undefined && a2['2026-10-05'].exp === undefined);

  const rr = ds.recomputeAll(r);
  check('统计为 0（没把第二天算进去）', rr.statistics.totalWorkMinutes === 0 && rr.pet.totalExp === 0,
    JSON.stringify(rr.statistics));

  const res = ds.repairAttendance(r, { date: '2026-10-05', start: '08:00', end: '18:00' });
  check('补录后为 480 分钟', Math.abs(res.record.totalMinutes - 480) < 0.01, res.record.totalMinutes);
  check('补录后统计为 480', Math.abs(stats(r).totalWorkMinutes - 480) < 0.01, stats(r).totalWorkMinutes);
  restoreDate();
  rm(r);
}

console.log('— 全量重算：统计与宠物始终由记录派生 —');
{
  const r = newRoot();
  ds.repairAttendance(r, { date: '2026-09-28', start: '08:00', end: '18:00' }); // 工作日 480
  ds.repairAttendance(r, { date: '2026-10-03', start: '09:00', end: '13:00' }); // 周末 240
  let s = stats(r);
  check('混合：workDays=1 / 周末加班=1', s.workDays === 1 && s.weekendOvertimeCount === 1, JSON.stringify(s));
  check('totalWorkMinutes=720', Math.abs(s.totalWorkMinutes - 720) < 0.01, s.totalWorkMinutes);
  check('totalExp=120', s.totalExp === 120, s.totalExp);

  // 直接删掉一条记录后重算 → 统计必须同步下降（证明不是增量累加）
  const a = att(r);
  delete a['2026-10-03'];
  ds.writeJson(path.join(r, 'data', 'attendance.json'), a);
  const rr = ds.recomputeAll(r);
  check('删除记录后统计同步下降', Math.abs(rr.statistics.totalWorkMinutes - 480) < 0.01 && rr.statistics.weekendOvertimeCount === 0,
    JSON.stringify(rr.statistics));
  check('宠物 EXP 同步下降为 80', rr.pet.totalExp === 80, rr.pet.totalExp);
  rm(r);
}

// 恢复（防御：万一中途异常退出）
restoreDate();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

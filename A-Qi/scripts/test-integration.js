// scripts/test-integration.js
// 数据层集成测试：在临时目录真实跑 上工→状态→下工→结算→统计/宠物更新。
// 用固定工作日日期，避免真实日期落在周末导致 weekday/weekend 统计偏移，也避免用真实当前时间。
const os = require('os');
const fs = require('fs');
const path = require('path');
const ds = require('../src/data-store');

const RealDate = Date;
const TEST_DATE = '2026-10-05'; // 周一（工作日），固定，不依赖真实日期
const FIXED_NOW = new RealDate(TEST_DATE + 'T16:07:00');
function FakeDate(...args) {
  if (args.length === 0) return new RealDate(FIXED_NOW.getTime());
  return new RealDate(...args);
}
FakeDate.now = RealDate.now;
global.Date = FakeDate;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-test-'));
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + ' → ' + d); } };

ds.ensureDataLayer(root);
ds.resumeIncomplete(root);

let s = ds.getStatus(root);
check('初始状态 OFF_WORK', s.state === 'OFF_WORK', s.state);

const r1 = ds.punchIn(root);
check('上工成功', r1.ok === true, JSON.stringify(r1));
s = ds.getStatus(root);
check('上工后状态 WORKING', s.state === 'WORKING' || s.state === 'LUNCH_BREAK', s.state);

// 固定上工 08:03（下工时间由 FIXED_NOW=16:07 决定 → 8h04m=484min）
const att = ds.readJson(path.join(root, 'data', 'attendance.json'), {});
att[TEST_DATE].sessions[0].start = '08:03';                                   // 同步伪造显示用的上工时间
att[TEST_DATE].sessions[0].startTs = new RealDate(TEST_DATE + 'T08:03:00').toISOString();
ds.writeJson(path.join(root, 'data', 'attendance.json'), att);

const r2 = ds.punchOut(root);
check('下工结算成功', r2.ok === true, JSON.stringify(r2));
// 区间算法：08:03-12:00(237) + 14:00-16:07(127) = 364min；EXP=364/6≈60.7（午休12-14已排除）
check('结算工时≈364min(08:03-16:07, 午休已排除)', Math.abs(r2.record.totalMinutes - 364) < 5, r2.record.totalMinutes);
check('结算EXP≈60.7', Math.abs(r2.record.exp - 60.7) < 0.5, r2.record.exp);
check('记录状态 completed', r2.record.status === 'completed', r2.record.status);

const pet = ds.readJson(path.join(root, 'data', 'pet.json'), {});
check('宠物 totalExp 已累加', pet.totalExp > 0, pet.totalExp);
check('宠物 level=1（60.7 EXP < 80/级）', pet.level === 1, pet.level);
check('宠物 exp = 级内进度(= totalExp)', Math.abs(pet.exp - pet.totalExp) < 1e-6, pet.exp + '/' + pet.totalExp);

// 等级/经验摘要（托盘菜单用）
const li = ds.getLevelInfo(root);
check('getLevelInfo level=1', li.level === 1, li.level);
check('getLevelInfo expPerLevel=80', li.expPerLevel === 80, li.expPerLevel);
check('getLevelInfo exp=级内进度', Math.abs(li.exp - pet.totalExp) < 1e-6, li.exp);

const stats = ds.readJson(path.join(root, 'data', 'statistics.json'), {});
check('统计 workDays=1', stats.workDays === 1, stats.workDays);
check('统计 totalWorkMinutes 已累加', stats.totalWorkMinutes > 0, stats.totalWorkMinutes);

// 防重复上工（仍用固定日期 2026-10-05，确保与上面同一天）
const r3 = ds.punchIn(root);
check('当天重复上工被拒绝', r3.ok === false && r3.reason === 'already', JSON.stringify(r3));

// 防重复下工
const r4 = ds.punchOut(root);
check('重复下工被拒绝', r4.ok === false, JSON.stringify(r4));

// ===== 阶段 3：工作记录 TXT（用上面真实结算的结果生成）=====
{
  const wr = require('../src/work-record');
  const p = wr.recordPath(root, TEST_DATE);
  wr.syncRecord(root, TEST_DATE, r2.record, { lunch: ['12:00', '14:00'] });
  const txt = wr.readRecord(root, TEST_DATE) || '';
  check('阶段3：下工后生成工作记录 TXT', fs.existsSync(p), p);
  check('阶段3：考勤写入上工/下工', txt.includes('上工：08:03') && txt.includes('下工：16:07'), '');
  check('阶段3：时长与 EXP 与结算一致',
    txt.includes('实际工作时长：06小时04分钟') && txt.includes('今日EXP：60.7'), '');
  check('阶段3：午休自动扣除行存在', txt.includes('午休：12:00–14:00（自动扣除）'));
  check('阶段3：listRecords 能列出该日', wr.listRecords(root).some(x => x.date === TEST_DATE));
}

global.Date = RealDate; // 还原
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

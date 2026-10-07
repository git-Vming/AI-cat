// scripts/test-migration.js
// 目的：对应规格 §40「迁移要求」与 §41「迁移测试」——
//   验证「把整个阿七文件夹复制到另一台 Windows 电脑，数据仍然存在」。
//
// 做法：在临时目录造「电脑 A」，跑一段真实使用（补录工时 → 出勤/EXP/统计 → 写工作记录 TXT
//   → 生成并勾选待办 → 互动好感 → 改设置），然后把**整个目录**复制成「电脑 B」，
//   在 B 上重新读取，断言等级/EXP/考勤/统计/工作记录/待办/好感度/解锁/设置全部一致。
//
// 运行：node scripts/test-migration.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const ds = require('../src/data-store');
const wr = require('../src/work-record');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function mkRoot(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-' + tag + '-')); }
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

// ===== 电脑 A：造出真实使用痕迹 =====
const A = mkRoot('pcA');
ds.ensureDataLayer(A);
const LUNCH = { lunch: ['12:00', '14:00'] };

ds.repairAttendance(A, { date: '2026-09-28', start: '08:00', end: '18:00' });   // 周一
ds.repairAttendance(A, { date: '2026-09-29', start: '09:00', end: '19:30' });   // 周二（含加班）
ds.repairAttendance(A, { date: '2026-10-03', start: '09:00', end: '13:00' });   // 周六（周末加班）

const attA = ds.readJson(path.join(A, 'data', 'attendance.json'), {});
for (const d of Object.keys(attA)) wr.syncRecord(A, d, attA[d], LUNCH);

// 手写一份带【明日待办】的记录，供次日读取待办
const D1 = '2026-09-30';
fs.writeFileSync(wr.recordPath(A, D1), [
  '【考勤】',
  '上工：09:00',
  '下工：18:00',
  '',
  '【明日待办】',
  '1. 完成南安项目报价',
  '2. 找结构专业要条件',
  '3. （可选）整理会议纪要',
  '',
  '【工作内容】',
  '（用户手写内容，程序不得覆盖）',
  ''
].join('\n'), 'utf8');

const todosA = ds.getTodos(A, '2026-10-01');
ds.setTodoDone(A, '2026-10-01', 0, true);          // 勾掉第一条
const todosA2 = ds.getTodos(A, '2026-10-01');

ds.interact(A, 'pat');
ds.interact(A, 'pat');
ds.interact(A, 'feed');

ds.setPetName(A, '小黑');   // 走真实改名路径（pet.json.name 为唯一权威）
ds.updateSettings(A, {
  alwaysOnTop: false, startOnBoot: true,
  eyeReminderMin: 45, sitReminderMin: 75,
  position: { x: 120, y: 340 }
});

// A 的快照（迁移前）
const snap = {
  level: ds.getLevelInfo(A),
  stats: ds.getStats(A),
  growth: ds.getGrowth(A),
  todos: todosA2,
  settings: ds.getSettingsSummary(A),
  attendance: ds.readJson(path.join(A, 'data', 'attendance.json'), {}),
  records: {}
};
for (const d of Object.keys(snap.attendance)) {
  snap.records[d] = fs.readFileSync(wr.recordPath(A, d), 'utf8');
}

console.log('— 电脑 A 的数据 —');
console.log('   等级 Lv.' + snap.level.level + ' / EXP ' + snap.level.totalExp +
  ' / 出勤 ' + snap.stats.ranges.total.workDays + ' 天 / 好感 ' + snap.growth.affection);

// ===== 复制整个文件夹 → 电脑 B =====
const B = mkRoot('pcB');
copyDir(A, B);
console.log('— 已把整个数据目录复制到电脑 B —');

// ===== 在 B 上重新读取并逐项比对 =====
console.log('— 迁移后（电脑 B）逐项比对 —');
const lvlB = ds.getLevelInfo(B);
check('等级不变', lvlB.level === snap.level.level, lvlB.level + ' vs ' + snap.level.level);
check('EXP 不变', lvlB.totalExp === snap.level.totalExp, lvlB.totalExp + ' vs ' + snap.level.totalExp);
check('宠物名不变', lvlB.name === '小黑', lvlB.name);

const stB = ds.getStats(B);
check('累计工作时长不变', stB.ranges.total.totalMinutes === snap.stats.ranges.total.totalMinutes);
check('累计 EXP 不变', stB.totalExp === snap.stats.totalExp);
check('出勤天数不变', stB.ranges.total.workDays === snap.stats.ranges.total.workDays);
check('工作日加班次数不变', stB.ranges.total.weekdayOvertimeCount === snap.stats.ranges.total.weekdayOvertimeCount);
check('周末加班次数不变', stB.ranges.total.weekendOvertimeCount === snap.stats.ranges.total.weekendOvertimeCount);

const attB = ds.readJson(path.join(B, 'data', 'attendance.json'), {});
check('考勤记录条数不变', Object.keys(attB).length === Object.keys(snap.attendance).length,
  Object.keys(attB).length + ' vs ' + Object.keys(snap.attendance).length);
check('考勤记录逐条一致', JSON.stringify(attB) === JSON.stringify(snap.attendance));

const gB = ds.getGrowth(B);
check('好感度不变', gB.affection === snap.growth.affection, gB.affection + ' vs ' + snap.growth.affection);
check('互动次数不变', gB.interactionCount === snap.growth.interactionCount);
check('已解锁道具不变', JSON.stringify(gB.unlockedItems) === JSON.stringify(snap.growth.unlockedItems));

const todoB = ds.getTodos(B, '2026-10-01');
check('待办条目不变', JSON.stringify(todoB.items) === JSON.stringify(todosA2.items));
check('待办勾选状态不变', todoB.items.filter((t) => t.done).length === todosA2.items.filter((t) => t.done).length);

const setB = ds.getSettingsSummary(B);
check('设置：宠物名', setB.petName === '小黑');
check('设置：置顶开关', setB.alwaysOnTop === false);
check('设置：开机启动', setB.startOnBoot === true);
check('设置：护眼间隔', setB.eyeReminderMin === 45);
check('设置：久坐间隔', setB.sitReminderMin === 75);
check('设置：桌面位置', JSON.stringify(setB.position) === JSON.stringify({ x: 120, y: 340 }));

console.log('— 工作记录 TXT 逐字比对 —');
let allTxtSame = true;
const txtDiffs = [];
for (const d of Object.keys(snap.records)) {
  const b = fs.existsSync(wr.recordPath(B, d)) ? fs.readFileSync(wr.recordPath(B, d), 'utf8') : '(缺失)';
  if (b !== snap.records[d]) { allTxtSame = false; txtDiffs.push(d); }
}
check('所有工作记录 TXT 内容逐字一致', allTxtSame, txtDiffs.join(','));
check('用户手写区未被程序改动', /用户手写内容，程序不得覆盖/.test(
  fs.readFileSync(wr.recordPath(B, D1), 'utf8')));

// ===== 数据与程序分离（规格 §26）=====
console.log('— 数据与程序分离 —');
check('数据只落在数据根目录内（data/ 与 WorkRecords/ 均在根下）',
  fs.existsSync(path.join(B, 'data')) && fs.existsSync(path.join(B, 'WorkRecords')));
const srcFiles = fs.readdirSync(path.join(__dirname, '..', 'src'));
check('程序源码目录中不含任何数据文件（*.json 只有源码，数据不在 src/）',
  !srcFiles.some((f) => /^(pet|attendance|statistics|settings|tasks)\.json$/.test(f)),
  srcFiles.join(','));

const infoB = ds.getAppInfo(B);
check('应用信息能读出出勤天数', infoB.attendanceDays === Object.keys(attB).length);

rm(A); rm(B);
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

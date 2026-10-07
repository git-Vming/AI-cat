// scripts/test-backup.js
// 目的：对应《开发流程》阶段 9 的「数据备份 / 数据恢复」——
//   备份必须是**只读复制**（不动当前数据）；恢复必须能真的把数据还原，
//   且在覆盖前自动再备份一次（防手滑）；非法/不存在的备份名一律拒绝。
// 运行：node scripts/test-backup.js
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
const attPath = (r) => path.join(r, 'data', 'attendance.json');
const readAtt = (r) => ds.readJson(attPath(r), {});
const countAtt = (r) => Object.keys(readAtt(r)).length;

const R = mkRoot('bk');
ds.ensureDataLayer(R);
const LUNCH = { lunch: ['12:00', '14:00'] };

// ===== 造数据 =====
ds.repairAttendance(R, { date: '2026-09-28', start: '08:00', end: '18:00' });
ds.repairAttendance(R, { date: '2026-09-29', start: '09:00', end: '18:00' });
const att = readAtt(R);
for (const d of Object.keys(att)) wr.syncRecord(R, d, att[d], LUNCH);
ds.setPetName(R, '豆豆');
const expBefore = ds.getLevelInfo(R).totalExp;

console.log('— 备份 —');
const b1 = ds.backupData(R);
check('备份成功', b1.ok === true, JSON.stringify(b1));
check('备份名符合时间戳格式', /^\d{8}-\d{6}(-\d+)?$/.test(b1.name), b1.name);
check('备份目录确实生成', fs.existsSync(b1.path));
check('备份内含 data/', fs.existsSync(path.join(b1.path, 'data', 'pet.json')));
check('备份内含 WorkRecords/', fs.existsSync(path.join(b1.path, 'WorkRecords')));
check('备份内含元信息 backup-info.json', fs.existsSync(path.join(b1.path, 'backup-info.json')));
check('备份里的出勤天数与当时一致',
  Object.keys(ds.readJson(path.join(b1.path, 'data', 'attendance.json'), {})).length === 2);
check('备份是只读复制：当前数据仍是 2 天', countAtt(R) === 2, String(countAtt(R)));
check('备份不影响当前等级', ds.getLevelInfo(R).totalExp === expBefore);

console.log('— 同一秒连续备份不冲突 —');
const b2 = ds.backupData(R);
check('第二次备份也成功且名字不同', b2.ok === true && b2.name !== b1.name, b1.name + ' / ' + b2.name);

console.log('— 备份列表 —');
const list1 = ds.listBackups(R);
check('列表含两次备份', list1.length === 2, String(list1.length));
check('列表最新在前', list1[0].name >= list1[1].name, list1.map((x) => x.name).join(','));
check('列表带体积信息', typeof list1[0].sizeBytes === 'number' && list1[0].sizeBytes > 0);
check('列表带创建时间', !!list1[0].createdAt);

console.log('— 破坏数据后恢复 —');
ds.repairAttendance(R, { date: '2026-10-01', start: '08:00', end: '18:00' });   // 多一天
ds.setPetName(R, '隔壁老王');
check('（前置）当前已变成 3 天', countAtt(R) === 3, String(countAtt(R)));
check('（前置）当前名字已改', ds.getLevelInfo(R).name === '隔壁老王');

const r = ds.restoreBackup(R, b1.name);
check('恢复成功', r.ok === true, JSON.stringify(r));
check('恢复后出勤天数回到备份时（2 天）', countAtt(R) === 2, String(countAtt(R)));
check('恢复后名字回到备份时（豆豆）', ds.getLevelInfo(R).name === '豆豆', ds.getLevelInfo(R).name);
check('恢复后 EXP 回到备份时', ds.getLevelInfo(R).totalExp === expBefore);
check('恢复前自动做了安全备份（返回其名字）', !!r.safetyBackup, JSON.stringify(r));
check('安全备份确实存在', !!(r.safetyBackup && fs.existsSync(path.join(R, 'backup', r.safetyBackup))));
check('安全备份里保存的是"恢复前"的状态（3 天）',
  Object.keys(ds.readJson(path.join(R, 'backup', r.safetyBackup, 'data', 'attendance.json'), {})).length === 3);
check('备份总数变为 3（含安全备份）', ds.listBackups(R).length === 3, String(ds.listBackups(R).length));

console.log('— 非法输入 —');
check('非法备份名（路径穿越）被拒', ds.restoreBackup(R, '../../etc').reason === 'bad_name');
check('非法备份名（乱写）被拒', ds.restoreBackup(R, 'hello').reason === 'bad_name');
check('空名字被拒', ds.restoreBackup(R, '').reason === 'bad_name');
check('不存在的备份被拒', ds.restoreBackup(R, '19990101-000000').reason === 'not_found');
check('非法备份被拒后数据未被破坏', countAtt(R) === 2, String(countAtt(R)));

console.log('— 应用信息 —');
const info = ds.getAppInfo(R);
check('应用信息：出勤天数正确', info.attendanceDays === 2, String(info.attendanceDays));
check('应用信息：工作记录文件数正确', info.recordFiles === 2, String(info.recordFiles));
check('应用信息：体积为正数', info.dataBytes > 0);
check('应用信息：备份数量正确', info.backupCount === 3, String(info.backupCount));
check('应用信息：最近备份为最新一份', !!info.lastBackup && info.lastBackup.name >= b1.name);

console.log('— 宠物名双写与校验 —');
check('改名过长被拒', ds.setPetName(R, '一二三四五六七八九十十一十二十三').reason === 'too_long');
check('改名空白被拒', ds.setPetName(R, '   ').reason === 'empty');
const nr = ds.setPetName(R, ' 小花 ');
check('名字首尾空格被裁剪', nr.ok === true && nr.name === '小花', JSON.stringify(nr));
check('pet.json 与 settings.petName 同步', 
  ds.readJson(path.join(R, 'data', 'pet.json'), {}).name === '小花' &&
  ds.getSettingsSummary(R).petName === '小花');

rm(R);
console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

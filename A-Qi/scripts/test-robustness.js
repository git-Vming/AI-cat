// scripts/test-robustness.js
// 阶段 10 自测：**脏数据 / 缺文件 / 损坏文件**容错。
//
// 为什么要这一套：V-ming 要拿它实机跑一个月，期间很可能出现 ——
//   · TXT 被记事本编辑坏了、JSON 被手改坏、目录被误删、硬盘写入中断产生半截文件；
//   · 系统时间被调整、记录里出现缺字段的旧数据。
// 要求：程序在这些情况下**降级运行**（用默认值 / 视作空），**绝不崩溃、绝不产生 NaN**。
//
// 运行：node scripts/test-robustness.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const ds = require('../src/data-store');
const stats = require('../src/stats');
const wt = require('../src/work-time');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function mkRoot(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-rb-' + tag + '-')); }
function rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
// 调用而不抛异常
function safe(fn) { try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, e: e.message }; } }
function noNaN(v, seen) {
  seen = seen || [];
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object') {
    if (seen.indexOf(v) >= 0) return true;
    seen.push(v);
    return Object.keys(v).every((k) => noNaN(v[k], seen));
  }
  return true;
}
const D = (r, f) => path.join(r, 'data', f);
const writeRaw = (p, s) => fs.writeFileSync(p, s, 'utf8');

console.log('— 1. JSON 损坏（手改坏 / 写一半）—');
{
  const r = mkRoot('badjson');
  ds.ensureDataLayer(r);
  writeRaw(D(r, 'attendance.json'), '{"2026-10-01": {"status": "comp');   // 截断
  writeRaw(D(r, 'pet.json'), 'not json at all');
  writeRaw(D(r, 'settings.json'), '{,,,}');
  writeRaw(D(r, 'tasks.json'), '[broken');

  const s1 = safe(() => ds.getStatus(r));
  check('考勤 JSON 损坏：getStatus 不崩', s1.ok, s1.e);
  const s2 = safe(() => ds.getStats(r));
  check('考勤 JSON 损坏：getStats 不崩', s2.ok, s2.e);
  check('考勤 JSON 损坏：统计视为空（0 分钟）', s2.ok && s2.v.ranges.total.totalMinutes === 0,
    s2.ok ? String(s2.v.ranges.total.totalMinutes) : s2.e);
  const s3 = safe(() => ds.getLevelInfo(r));
  check('宠物 JSON 损坏：降级为 Lv.1 / 0 EXP',
    s3.ok && s3.v.level === 1 && s3.v.totalExp === 0 && s3.v.name === '阿七',
    JSON.stringify(s3));
  const s4 = safe(() => ds.getSettingsSummary(r));
  check('设置 JSON 损坏：降级为默认（阿七 / 60 / 90）',
    s4.ok && s4.v.petName === '阿七' && s4.v.eyeReminderMin === 60 && s4.v.sitReminderMin === 90,
    JSON.stringify(s4));
  const s5 = safe(() => ds.getTodos(r));
  check('待办 JSON 损坏：getTodos 不崩', s5.ok, s5.e);
  const s6 = safe(() => ds.getGrowth(r));
  check('待办/宠物损坏：getGrowth 不崩', s6.ok, s6.e);
  check('全流程无 NaN', noNaN([s2.v, s3.v, s4.v].filter(Boolean)));
  rm(r);
}

console.log('— 2. 类型不对（null / 数组 / 字符串）—');
{
  const r = mkRoot('badtype');
  ds.ensureDataLayer(r);
  writeRaw(D(r, 'attendance.json'), 'null');
  check('考勤为 null：getStats 不崩且为 0',
    (() => { const x = safe(() => ds.getStats(r)); return x.ok && x.v.ranges.total.totalMinutes === 0; })());
  writeRaw(D(r, 'attendance.json'), '[1,2,3]');
  check('考勤为数组：getStats 不崩',
    (() => { const x = safe(() => ds.getStats(r)); return x.ok && x.v.ranges.total.workDays === 0; })());
  writeRaw(D(r, 'pet.json'), '"hello"');
  check('宠物为字符串：降级 Lv.1',
    (() => { const x = safe(() => ds.getLevelInfo(r)); return x.ok && x.v.level === 1; })());
  writeRaw(D(r, 'pet.json'), '{"totalExp": 999, "unlockedItems": "hat"}');
  check('unlockedItems 非数组：getGrowth 不崩且按空处理',
    (() => { const x = safe(() => ds.getGrowth(r)); return x.ok && Array.isArray(x.v.unlockedItems); })(),
    '');
  rm(r);
}

console.log('— 3. 记录缺字段（旧版本数据 / 手工编辑）—');
{
  const r = mkRoot('missing');
  ds.ensureDataLayer(r);
  ds.writeJson(D(r, 'attendance.json'), {
    '2026-10-01': { status: 'completed' },                                   // 什么字段都没有
    '2026-10-02': { status: 'completed', totalMinutes: 480 },                // 缺 type/overtime
    '2026-10-05': { status: 'completed', totalMinutes: 240, type: 'weekend' },
    '2026-10-06': { status: 'bogus', totalMinutes: 999 },                    // 非法状态
    '2026-10-07': { status: 'working', totalMinutes: 10 }                     // 未完成
  });
  const x = safe(() => ds.getStats(r));
  check('缺字段的记录不导致崩溃', x.ok, x.e);
  check('统计结果无 NaN', x.ok && noNaN(x.v));
  // 说明：统计要求 totalMinutes 是数字 —— 缺该字段的 completed 记录被视作"无效残留"，
  // 不计入天数（防脏数据的保守策略）；bogus 状态与 working 同样不计。
  // 于是有效记录只有 10-02（工作日 480）与 10-05（周末 240），天数 2。
  check('只统计有效 completed（缺字段 / bogus / working 都不计天数）',
    x.ok && x.v.ranges.total.workDays === 2, x.ok ? String(x.v.ranges.total.workDays) : x.e);
  check('总时长只累加有效记录（480 + 240 = 720），无 NaN',
    x.ok && x.v.ranges.total.totalMinutes === 720, x.ok ? String(x.v.ranges.total.totalMinutes) : x.e);
  rm(r);
}

console.log('— 4. 目录 / 文件被删 —');
{
  const r = mkRoot('gone');
  ds.ensureDataLayer(r);
  ds.repairAttendance(r, { date: '2026-10-01', start: '08:00', end: '18:00' });
  rm(path.join(r, 'data'));                        // 模拟用户误删 data/
  const a = safe(() => ds.ensureDataLayer(r));
  check('data/ 被删后能自动重建', a.ok && fs.existsSync(D(r, 'pet.json')));
  const b = safe(() => ds.getStats(r));
  check('重建后 getStats 正常（0 天）', b.ok && b.v.ranges.total.workDays === 0);
  rm(path.join(r, 'WorkRecords'));
  const c = safe(() => ds.getTodos(r));
  check('WorkRecords/ 被删后 getTodos 不崩（按"无待办"处理）', c.ok, c.e);
  // 目录由"写记录"时重建，验证一下确实能自愈
  const rr = ds.repairAttendance(r, { date: '2026-10-02', start: '08:00', end: '18:00' });
  const rec2 = ds.readJson(D(r, 'attendance.json'), {})['2026-10-02'];
  const wr = require('../src/work-record');
  const c2 = safe(() => wr.syncRecord(r, '2026-10-02', rec2, { lunch: ['12:00', '14:00'] }));
  check('写工作记录时自动重建 WorkRecords/（自愈）',
    c2.ok && rr.ok && fs.existsSync(path.join(r, 'WorkRecords')), c2.e || '');
  rm(r);
}

console.log('— 5. 时间 / 日期边界 —');
{
  const r = mkRoot('edge');
  ds.ensureDataLayer(r);
  check('跨年（12-31 → 01-01）', wt.classifyDay('2026-12-31') === 'workday' && wt.classifyDay('2027-01-01') === 'workday');
  check('闰年 2-29 可被识别为有效日期', ds.isValidDate('2028-02-29'));
  check('非闰年 2-29 被拒', !ds.isValidDate('2027-02-29'));
  check('时间 00:00 / 23:59 合法', ds.isValidHM('00:00') && ds.isValidHM('23:59'));
  check('时间 24:00 非法', !ds.isValidHM('24:00'));

  // 跨午休与不吃午休的两种情形
  const t1 = wt.computeWorked(new Date('2026-10-07T08:00:00'), new Date('2026-10-07T18:00:00'), 'workday', { lunch: ['12:00', '14:00'] });
  check('工作日 08:00–18:00 扣午休 = 480 分钟', t1.totalMinutes === 480, String(t1.totalMinutes));
  const t2 = wt.computeWorked(new Date('2026-10-03T09:00:00'), new Date('2026-10-03T13:00:00'), 'weekend', { lunch: ['12:00', '14:00'] });
  check('周末 09:00–13:00 不扣午休 = 240 分钟', t2.totalMinutes === 240, String(t2.totalMinutes));
  const t3 = wt.computeWorked(new Date('2026-10-07T08:00:00'), new Date('2026-10-07T08:30:00'), 'workday', { lunch: ['12:00', '14:00'] });
  check('极短工时 30 分钟 = 30', t3.totalMinutes === 30, String(t3.totalMinutes));
  const t4 = wt.computeWorked(new Date('2026-10-07T18:00:00'), new Date('2026-10-07T08:00:00'), 'workday', { lunch: ['12:00', '14:00'] });
  check('结束早于开始：按 0 处理而不是负数', t4.totalMinutes === 0, String(t4.totalMinutes));
  rm(r);
}

console.log('— 6. 大量数据（一个月实机使用的量级）—');
{
  const r = mkRoot('bulk');
  ds.ensureDataLayer(r);
  const att = {};
  for (let i = 0; i < 1000; i += 1) {
    const d = new Date(2024, 0, 1 + i);
    const p = (n) => String(n).padStart(2, '0');
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    att[key] = {
      date: key, type: wt.classifyDay(key), status: 'completed',
      totalMinutes: 480, normalMinutes: 480, overtimeMinutes: 0, exp: 80,
      sessions: [{ start: '08:00', end: '18:00', startTs: new Date(2024, 0, 1 + i, 8).toISOString(), endTs: new Date(2024, 0, 1 + i, 18).toISOString() }]
    };
  }
  ds.writeJson(D(r, 'attendance.json'), att);
  const t0 = Date.now();
  const x = ds.getStats(r);
  const cost = Date.now() - t0;
  check('1000 天记录：统计不崩且耗时 < 1 秒', cost < 1000, cost + 'ms');
  check('1000 天记录：天数统计正确', x.ranges.total.workDays === 1000, String(x.ranges.total.workDays));
  check('1000 天记录：无 NaN', noNaN(x));
  const t1 = Date.now();
  fs.writeFileSync(path.join(r, 'WorkRecords', '2026-10-07.txt'), '【明日待办】\n1. 一条\n', 'utf8');
  ds.getTodos(r, '2026-10-08');
  check('待办解析同样轻量（< 500ms）', Date.now() - t1 < 500, (Date.now() - t1) + 'ms');
  rm(r);
}

console.log('— 7. 未来日期 / 非法写入被拒 —');
{
  const r = mkRoot('future');
  ds.ensureDataLayer(r);
  check('补录未来日期被拒', ds.repairAttendance(r, { date: '2099-01-01', start: '08:00', end: '18:00' }).reason === 'future');
  check('下工早于上工被拒', ds.repairAttendance(r, { date: '2026-10-01', start: '18:00', end: '08:00' }).reason === 'bad_range');
  check('非法时间被拒', ds.repairAttendance(r, { date: '2026-10-01', start: '25:00', end: '26:00' }).reason === 'bad_start');
  check('被拒后没有写入任何记录',
    Object.keys(ds.readJson(D(r, 'attendance.json'), {})).length === 0);
  check('非法日期被拒', ds.ignoreDay(r, '2026-13-45').reason === 'bad_date');
  rm(r);
}

console.log('— 8. 纯函数边界（等级 / 状态映射）—');
{
  check('totalExp 负数不加级', wt.levelFromTotalExp(-100) === 1);
  check('totalExp 0 = Lv.1', wt.levelFromTotalExp(0) === 1);
  check('totalExp 80 = Lv.2', wt.levelFromTotalExp(80) === 2);
  check('totalExp 79.9 仍在 Lv.1', wt.levelFromTotalExp(79.9) === 1);
  check('EXP 取整不产生 NaN', Number.isFinite(wt.expInLevel(123.456)) && Number.isFinite(wt.levelFromTotalExp(NaN)));
  check('经验条文本：0/80 与 80/80 都不越界',
    /░{5}/.test(wt.expBarText(0, 80, 5)) && /█{5}/.test(wt.expBarText(80, 80, 5)),
    wt.expBarText(80, 80, 5));
  check('经验条：超出上限时不画 6 格（钳制）', wt.expBarText(999, 80, 5) === wt.expBarText(80, 80, 5));
  check('stats.computeStats 接受空对象', (() => { const s = stats.computeStats({}, new Date()); return s.ranges.today.totalMinutes === 0; })());
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

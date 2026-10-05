// scripts/test-stats.js
// 阶段 5 工作统计纯逻辑测试：四组维度 / 周月边界 / 平均每日 / 加班拆分 / 连续工作 / 只统计 completed
// 运行：node scripts/test-stats.js
const st = require('../src/stats');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
function eq(a, b) { return Math.abs(Number(a) - Number(b)) < 0.01; }

// ===== 固定数据 =====
// 2026-10-04 是周日 → 10-05 周一、10-06 周二、10-07 周三
function rec(type, totalMinutes, overtimeMinutes, status) {
  return { type, totalMinutes, overtimeMinutes, status: status || 'completed' };
}
const ATT = {
  '2026-09-28': rec('workday', 480, 0),          // 周一（上个月）
  '2026-09-29': { date: '2026-09-29', type: 'workday', sessions: [], status: 'absent' },  // 忽略：没上班
  '2026-10-01': { date: '2026-10-01', type: 'workday', sessions: [{ start: '08:00' }], status: 'incomplete' }, // 忽略：忘记下工
  '2026-10-02': { date: '2026-10-02', type: 'workday', sessions: [{ start: '08:00' }], status: 'working' },    // 忽略：进行中
  '2026-10-03': rec('weekend', 240, 240),        // 周六加班
  '2026-10-05': rec('workday', 480, 0),          // 周一
  '2026-10-06': rec('workday', 540, 60),         // 周二（晚走 1h）
  '2026-10-07': rec('workday', 240, 0)           // 周三（今天）
};

const NOW = new Date(2026, 9, 7, 15, 0, 0);      // 2026-10-07 周三 15:00

console.log('— 今日 —');
{
  const s = st.computeStats(ATT, NOW);
  check('today 日期为 2026-10-07', s.ranges.today.from === '2026-10-07' && s.ranges.today.to === '2026-10-07');
  const t = s.ranges.today;
  check('工作天数 1', t.workDays === 1, t.workDays);
  check('工作时长 240', eq(t.totalMinutes, 240), t.totalMinutes);
  check('平均每日 = 240', eq(t.avgMinutes, 240), t.avgMinutes);
  check('无加班', t.weekdayOvertimeCount === 0 && t.weekendOvertimeCount === 0);
}

console.log('— 本周（周一为起点）—');
{
  const s = st.computeStats(ATT, NOW);
  const w = s.ranges.week;
  check('from = 2026-10-05（周一）', w.from === '2026-10-05', w.from);
  check('工作天数 3', w.workDays === 3, w.workDays);
  check('工作时长 1260', eq(w.totalMinutes, 1260), w.totalMinutes);
  check('平均每日 420', eq(w.avgMinutes, 420), w.avgMinutes);
  check('工作日加班 1 次 / 60 分', w.weekdayOvertimeCount === 1 && eq(w.weekdayOvertimeMinutes, 60),
    w.weekdayOvertimeCount + '/' + w.weekdayOvertimeMinutes);
  check('本周无周末加班（10-03 属上周）', w.weekendOvertimeCount === 0, w.weekendOvertimeCount);
}

console.log('— 本月 —');
{
  const s = st.computeStats(ATT, NOW);
  const m = s.ranges.month;
  check('from = 2026-10-01', m.from === '2026-10-01', m.from);
  check('工作天数 4（含周末加班日）', m.workDays === 4, m.workDays);
  check('工作时长 1500', eq(m.totalMinutes, 1500), m.totalMinutes);
  check('平均每日 375', eq(m.avgMinutes, 375), m.avgMinutes);
  check('工作日加班 1 次 / 60 分', m.weekdayOvertimeCount === 1 && eq(m.weekdayOvertimeMinutes, 60));
  check('周末加班 1 次 / 240 分', m.weekendOvertimeCount === 1 && eq(m.weekendOvertimeMinutes, 240),
    m.weekendOvertimeCount + '/' + m.weekendOvertimeMinutes);
}

console.log('— 累计 —');
{
  const s = st.computeStats(ATT, NOW);
  const a = s.ranges.total;
  check('工作天数 5', a.workDays === 5, a.workDays);
  check('工作时长 1980', eq(a.totalMinutes, 1980), a.totalMinutes);
  check('平均每日 396', eq(a.avgMinutes, 396), a.avgMinutes);
  check('累计含上月的 09-28', a.from === '2026-09-28', a.from);
}

console.log('— 只统计 completed（关键）—');
{
  const s = st.computeStats(ATT, NOW);
  const a = s.ranges.total;
  check('absent 不计（09-29 未进天数）', a.workDays === 5, a.workDays);
  check('incomplete 不计工时', eq(a.totalMinutes, 1980), a.totalMinutes);
  check('working 不计工时', eq(a.totalMinutes, 1980), a.totalMinutes);
  check('三种非完成记录均不产生加班次数', a.weekdayOvertimeCount === 1, a.weekdayOvertimeCount);
}

console.log('— 连续工作（V-ming 2026-10-05 定稿：任一天无记录即中断）—');
{
  // ATT 里 10-07(三)/10-06(二)/10-05(一) 有记录，10-04(日) 空，10-03(六) 有记录
  // → 数到 10-04 空即断 = 3（即 PM 举例：三/二/一有记录、周日休息、周六有记录 → 连续 3 天）
  const s = st.computeStats(ATT, NOW);
  check('PM 例1：三/二/一有记录、周日空、周六有记录 → 连续 3 天', s.streak === 3, s.streak);

  // PM 例2：日/一/二/三有记录、周六空 → 连续 4 天
  const B = {
    '2026-10-04': rec('weekend', 240, 240),   // 周日加班
    '2026-10-05': rec('workday', 480, 0),
    '2026-10-06': rec('workday', 480, 0),
    '2026-10-07': rec('workday', 480, 0)      // 10-03(六) 无记录
  };
  check('PM 例2：日/一/二/三有记录、周六空 → 连续 4 天', st.computeStats(B, NOW).streak === 4,
    st.computeStats(B, NOW).streak);

  // 今天还没下工 → 从昨天起算
  const s2 = st.computeStats(ATT, new Date(2026, 9, 8, 10, 0, 0));   // 10-08 周四，无记录
  check('今天未下工时从昨天起算', s2.streak === 3, s2.streak);

  // 工作日缺记录 → 中断
  const broken = {
    '2026-10-07': rec('workday', 480, 0),
    '2026-10-05': rec('workday', 480, 0)     // 缺 10-06（周二，工作日）
  };
  check('工作日缺记录即中断', st.computeStats(broken, NOW).streak === 1, st.computeStats(broken, NOW).streak);

  // 周末缺记录同样中断（不再是"跳过"）
  const weekendGap = {
    '2026-10-07': rec('workday', 480, 0),
    '2026-10-06': rec('workday', 480, 0),
    '2026-10-03': rec('weekend', 240, 240)    // 缺 10-04 与 10-05
  };
  check('周末缺记录同样中断', st.computeStats(weekendGap, NOW).streak === 2, st.computeStats(weekendGap, NOW).streak);

  // 完全没有记录
  check('无任何记录时连续 0 天', st.computeStats({}, NOW).streak === 0);
  check('今天有记录 + 昨天无记录 → 连续 1 天',
    st.computeStats({ '2026-10-07': rec('workday', 480, 0) }, NOW).streak === 1);
}

console.log('— 边界 —');
{
  const empty = st.computeStats({}, NOW);
  check('空数据：各维度均为 0 且 avg=0',
    empty.ranges.total.workDays === 0 && empty.ranges.total.totalMinutes === 0
    && empty.ranges.total.avgMinutes === 0 && empty.ranges.today.avgMinutes === 0);

  // 周一当天的「本周」只有一天
  const mon = st.computeStats(ATT, new Date(2026, 9, 5, 10, 0, 0));   // 2026-10-05 周一
  check('周一当天本周从周一开始', mon.ranges.week.from === '2026-10-05', mon.ranges.week.from);
  check('周一当天本周仅 1 天', mon.ranges.week.workDays === 1, mon.ranges.week.workDays);

  // 月初
  const nov = st.computeStats(ATT, new Date(2026, 10, 1, 10, 0, 0));  // 2026-11-01
  check('月初本月从 01 起', nov.ranges.month.from === '2026-11-01', nov.ranges.month.from);
  check('11 月无记录则本月全 0', nov.ranges.month.workDays === 0 && nov.ranges.month.totalMinutes === 0);

  // 记录缺 type 时按日期自动判定
  const noType = { '2026-10-03': { totalMinutes: 240, overtimeMinutes: 240, status: 'completed' } };
  const nt = st.computeStats(noType, NOW);
  check('缺 type 的记录按日期推定为周末加班',
    nt.ranges.total.weekendOvertimeCount === 1 && nt.ranges.total.weekdayOvertimeCount === 0,
    JSON.stringify(nt.ranges.total));

  // addDays 跨月
  check('addDays 跨月', st.addDays('2026-10-01', -1) === '2026-09-30', st.addDays('2026-10-01', -1));
  check('addDays 跨年', st.addDays('2026-01-01', -1) === '2025-12-31', st.addDays('2026-01-01', -1));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

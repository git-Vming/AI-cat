// scripts/test-worktime.js
// 阶段 2 工时算法单测：用 node 跑，不需 GUI。
// 注意：规格《场景 C》原文写 9.5h/95EXP，但按"按区间算、午休排除"规则正确值应为 9h/90EXP，
// 此处按一致规则断言，并在报告中标记该笔误。

const wt = require('../src/work-time');

const settings = {
  work: {
    intervals: [['08:00', '12:00'], ['14:00', '18:00']],
    lunch: ['12:00', '14:00']
  }
};

// 用具体日期构造，避开本地时区/UTC 误差
const MON = new Date(2026, 9, 5, 0, 0);   // 2026-10-05 周一（工作日）
const SAT = new Date(2026, 9, 3, 0, 0);   // 2026-10-03 周六（周末）
function at(base, h, m) { return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  →  ${detail}`); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

console.log('— 工作日判定 —');
check('周一=workday', wt.classifyDay(MON) === 'workday');
check('周六=weekend', wt.classifyDay(SAT) === 'weekend');

console.log('— 场景 A：08:00–18:00（正常）—');
{
  const r = wt.computeWorked(at(MON, 8, 0), at(MON, 18, 0), 'workday', settings);
  check('总工时=480min(8h)', approx(r.totalMinutes, 480), r.totalMinutes);
  check('正常=480min', approx(r.normalMinutes, 480), r.normalMinutes);
  check('加班=0', approx(r.overtimeMinutes, 0), r.overtimeMinutes);
  check('EXP=80', approx(wt.expFromMinutes(r.totalMinutes), 80), wt.expFromMinutes(r.totalMinutes));
}

console.log('— 场景 B：08:00–20:00（晚走加班）—');
{
  const r = wt.computeWorked(at(MON, 8, 0), at(MON, 20, 0), 'workday', settings);
  check('总工时=600min(10h)', approx(r.totalMinutes, 600), r.totalMinutes);
  check('正常=480min', approx(r.normalMinutes, 480), r.normalMinutes);
  check('加班=120min(2h)', approx(r.overtimeMinutes, 120), r.overtimeMinutes);
  check('EXP=100', approx(wt.expFromMinutes(r.totalMinutes), 100), wt.expFromMinutes(r.totalMinutes));
}

console.log('— 场景 C：07:30–18:30（早到+晚走）—');
{
  const r = wt.computeWorked(at(MON, 7, 30), at(MON, 18, 30), 'workday', settings);
  check('总工时=540min(9h) [规格笔误9.5h]', approx(r.totalMinutes, 540), r.totalMinutes);
  check('正常=480min', approx(r.normalMinutes, 480), r.normalMinutes);
  check('额外/加班=60min(1h)', approx(r.overtimeMinutes, 60), r.overtimeMinutes);
  check('EXP=90 [规格笔误95]', approx(wt.expFromMinutes(r.totalMinutes), 90), wt.expFromMinutes(r.totalMinutes));
}

console.log('— 场景 D：周六 09:00–13:00（周末加班）—');
{
  const r = wt.computeWorked(at(SAT, 9, 0), at(SAT, 13, 0), 'weekend', settings);
  check('总工时=240min(4h)', approx(r.totalMinutes, 240), r.totalMinutes);
  check('isWeekend=true', r.isWeekend === true);
  check('EXP=40', approx(wt.expFromMinutes(r.totalMinutes), 40), wt.expFromMinutes(r.totalMinutes));
}

console.log('— 跨午休边界：08:00–14:00（午休应排除）—');
{
  const r = wt.computeWorked(at(MON, 8, 0), at(MON, 14, 0), 'workday', settings);
  check('总工时=240min(4h，仅上午)', approx(r.totalMinutes, 240), r.totalMinutes);
  check('加班=0', approx(r.overtimeMinutes, 0), r.overtimeMinutes);
}

console.log('— 等级系统（固定 80 EXP / 级，V-ming 2026-10-03 定稿）—');
check('EXP_PER_LEVEL = 80', wt.EXP_PER_LEVEL === 80);
check('0 EXP → Lv.1', wt.levelFromTotalExp(0) === 1);
check('79 EXP → Lv.1', wt.levelFromTotalExp(79) === 1);
check('80 EXP → Lv.2', wt.levelFromTotalExp(80) === 2);
check('159 EXP → Lv.2', wt.levelFromTotalExp(159) === 2);
check('160 EXP → Lv.3', wt.levelFromTotalExp(160) === 3);
check('250 EXP → Lv.4', wt.levelFromTotalExp(250) === 4);
check('级内进度正确 (250 → 10)', wt.expInLevel(250) === 10);
check('级内进度正确 (80 → 0)', wt.expInLevel(80) === 0);

console.log('— 托盘文本经验条（10 格）—');
check('0/80 → 全空', wt.expBarText(0, 80) === '░░░░░░░░░░', wt.expBarText(0, 80));
check('40/80 → 半满', wt.expBarText(40, 80) === '█████░░░░░', wt.expBarText(40, 80));
check('80/80 → 全满', wt.expBarText(80, 80) === '██████████', wt.expBarText(80, 80));
check('超上限被截断为全满', wt.expBarText(200, 80) === '██████████', wt.expBarText(200, 80));

console.log('— 托盘文本经验条（5 格 = 状态卡的 1/2 长度）—');
check('0/80 → 全空', wt.expBarText(0, 80, 5) === '░░░░░', wt.expBarText(0, 80, 5));
check('40/80 → 3/5 格', wt.expBarText(40, 80, 5) === '███░░', wt.expBarText(40, 80, 5));
check('80/80 → 全满', wt.expBarText(80, 80, 5) === '█████', wt.expBarText(80, 80, 5));
check('超上限被截断为全满', wt.expBarText(200, 80, 5) === '█████', wt.expBarText(200, 80, 5));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

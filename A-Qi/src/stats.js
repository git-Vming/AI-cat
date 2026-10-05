// src/stats.js
// 阶段 5：工作统计（纯函数，便于无 GUI 单测）
//
// 规则来自《技术实现规格》§25 / 《开发流程》阶段 5：
//   维度：今日 / 本周 / 本月 / 累计
//   指标：工作天数、总工作时长、平均每日工作时长、
//         工作日加班次数、工作日加班时长、周末加班次数、周末加班时长
//   另附：累计 EXP、当前等级（由调用方从 pet.json 提供）、连续工作记录
//
// 口径（已在《开发报告_阶段5》中写明，供 PM 确认）：
//   1. 只统计 status === 'completed' 的记录（working / incomplete / absent 一律不计）。
//   2. 【本周】以**周一**为一周起点，统计 周一 ~ 今天。
//   3. 【本月】统计 当月 1 日 ~ 今天。
//   4. 【工作天数】= 该时段内有出勤记录的天数（含周末加班日），
//      这样它才与「总工作时长」「平均每日工作时长」口径自洽；
//      工作日/周末的拆分由「加班次数」两行体现。
//   5. 【平均每日工作时长】= 总工作时长 ÷ 工作天数；无记录时为 0。
//   6. 【连续工作】= 从「今天（若今天已下工）或昨天」向前回溯，连续有完成记录的天数；
//      **任何一天（含周六/周日）没有完成记录即中断**（V-ming 2026-10-05 定稿）。
//      例：三/二/一有记录、周日空、周六有记录 → 连续 3 天；日/一/二/三有记录、周六空 → 连续 4 天。

const wt = require('./work-time');

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 日期字符串 + n 天
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() + n);
  return fmtDate(base);
}

function isCounted(rec) {
  return !!rec && rec.status === 'completed' && typeof rec.totalMinutes === 'number';
}

// 统计某个日期区间（含首含尾）
function rangeStats(att, fromDate, toDate) {
  const a = att || {};
  let workDays = 0;            // 工作日有记录的天数
  let weekendDays = 0;         // 周末有记录的天数（= 周末加班次数）
  let totalMinutes = 0;
  let wdOtCount = 0, wdOtMinutes = 0;
  let weOtCount = 0, weOtMinutes = 0;

  for (const date of Object.keys(a)) {
    if (date < fromDate || date > toDate) continue;
    const rec = a[date];
    if (!isCounted(rec)) continue;

    const type = rec.type || wt.classifyDay(date);
    totalMinutes += rec.totalMinutes;

    if (type === 'weekend') {
      weekendDays += 1;
      weOtCount += 1;
      weOtMinutes += rec.totalMinutes;
    } else {
      workDays += 1;
      const ot = rec.overtimeMinutes || 0;
      if (ot > 0) {
        wdOtCount += 1;
        wdOtMinutes += ot;
      }
    }
  }

  const days = workDays + weekendDays;
  return {
    workDays: days,                       // 「工作天数」= 有出勤记录的总天数（含周末）
    weekdayDays: workDays,
    weekendDays,
    totalMinutes: wt.round1(totalMinutes),
    avgMinutes: days ? wt.round1(totalMinutes / days) : 0,
    weekdayOvertimeCount: wdOtCount,
    weekdayOvertimeMinutes: wt.round1(wdOtMinutes),
    weekendOvertimeCount: weOtCount,
    weekendOvertimeMinutes: wt.round1(weOtMinutes)
  };
}

// 连续工作天数
// V-ming 2026-10-05 定稿口径：**任何一天（含周六/周日）没有完成记录即中断**，周末不再"跳过"。
//   例：三/二/一有记录、周日空、周六有记录 → 连续 3 天（数到周日空即断）
//   例：日/一/二/三有记录、周六空         → 连续 4 天（数到周六空即断）
function computeStreak(att, now) {
  const a = att || {};
  const today = fmtDate(now);
  let d = isCounted(a[today]) ? today : addDays(today, -1);   // 今天还没下工则从昨天起算
  let n = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!isCounted(a[d])) break;                              // 任一天无完成记录 → 立即中断
    n += 1;
    d = addDays(d, -1);
  }
  return n;
}

function computeStats(att, now) {
  const d = now instanceof Date ? now : new Date();
  const today = fmtDate(d);
  const dow = d.getDay();                        // 0=周日
  const weekStart = addDays(today, -(dow === 0 ? 6 : dow - 1));  // 周一
  const monthStart = `${today.slice(0, 8)}01`;

  return {
    today,
    ranges: {
      today: { from: today, to: today, ...rangeStats(att, today, today) },
      week: { from: weekStart, to: today, ...rangeStats(att, weekStart, today) },
      month: { from: monthStart, to: today, ...rangeStats(att, monthStart, today) },
      total: {
        from: (Object.keys(att || {}).sort()[0] || today), to: today,
        ...rangeStats(att, '0000-00-00', '9999-99-99')
      }
    },
    streak: computeStreak(att, d)
  };
}

module.exports = { pad2, fmtDate, addDays, isCounted, rangeStats, computeStreak, computeStats };

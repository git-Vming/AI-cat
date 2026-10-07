// src/work-time.js
// 阶段 2 核心：工时计算纯函数模块（无副作用，可在 Node 下单测）
//
// 设计铁律（来自《技术实现规格》《README》）：
//  1. 按工作区间计算，绝不直接 (下工-上工) 相减。
//  2. 午休 12:00–14:00 自动排除（工作日）。
//  3. 早到（<08:00）/ 晚走（>18:00）计入额外/加班；其余区间内的部分算正常。
//  4. 周末不套用标准区间、不自动扣午休，全部算周末加班。
//  5. EXP：实际工作 60 分钟 = 10 EXP（保留 1 位小数，四舍五入）。
//  6. 等级：累计每 EXP_PER_LEVEL EXP 升一级。
//     注：原《技术实现规格》§19 / 《README》§22 写的是 100 EXP/级；
//     V-ming 于 2026-10-03 明确定稿为 **固定 80 EXP 升一级**，此处以最新指令为准。

function toMin(hhmm) {
  // "08:03" -> 483
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function classifyDay(dateStr) {
  // dateStr: "YYYY-MM-DD" 或 Date；0=周日 .. 6=周六
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return (day >= 1 && day <= 5) ? 'workday' : 'weekend';
}

// 归一化 settings：兼容新结构 work.intervals 与旧字段 workStart 等
function normalizeWork(settings) {
  const s = settings || {};
  if (s.work && Array.isArray(s.work.intervals) && s.work.intervals.length) {
    return {
      intervals: s.work.intervals.map(iv => [toMin(iv[0]), toMin(iv[1])]),
      lunch: [
        toMin((s.work.lunch && s.work.lunch[0]) || (s.lunchStart || '12:00')),
        toMin((s.work.lunch && s.work.lunch[1]) || (s.lunchEnd || '14:00'))
      ]
    };
  }
  const ws = s.workStart || '08:00', we = s.workEnd || '18:00';
  const ls = s.lunchStart || '12:00', le = s.lunchEnd || '14:00';
  return {
    intervals: [[toMin(ws), toMin('12:00')], [toMin('14:00'), toMin(we)]],
    lunch: [toMin(ls), toMin(le)]
  };
}

// 计算一次「上工→下工」的实际工作时长（分钟）。
// startTs/endTs：Date 或 ISO 字符串；假设同一天（V1.0 单次上工下工同天）。
function computeWorked(startTs, endTs, type, settings) {
  const start = startTs instanceof Date ? startTs : new Date(startTs);
  const end = endTs instanceof Date ? endTs : new Date(endTs);
  const { intervals } = normalizeWork(settings);

  // 转成「当天分钟数」
  const base = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const startM = (start - base) / 60000;
  const endM = (end - base) / 60000;

  if (type === 'weekend') {
    // 周末：不套用标准区间、不自动扣午休，全部计入周末加班
    const total = Math.max(0, endM - startM);
    return { totalMinutes: total, normalMinutes: 0, overtimeMinutes: total, isWeekend: true };
  }

  // 工作日：正常 = 与标准区间交集之和（自然排除午休 12–14）
  let normal = 0;
  for (const [s, e] of intervals) normal += overlap(startM, endM, s, e);

  // 额外/加班：上工早于首区间起点、或下工晚于末区间终点
  const dayStart = intervals[0][0];
  const dayEnd = intervals[intervals.length - 1][1];
  let early = 0, late = 0;
  if (startM < dayStart) early = Math.max(0, Math.min(endM, dayStart) - startM);
  if (endM > dayEnd) late = Math.max(0, endM - Math.max(startM, dayEnd));
  const overtime = early + late;

  const total = normal + overtime;
  return { totalMinutes: total, normalMinutes: normal, overtimeMinutes: overtime, isWeekend: false };
}

// 保留 1 位小数，四舍五入（V-ming 2026-10-02 要求：所有 EXP 保留 1 位小数）
// 统一的数值净化：脏数据（字符串 / null / NaN / 负数）一律当 0。
// 起因（阶段 10 自测发现的真 BUG）：Math.max(0, NaN) 仍然是 NaN，
// 于是 pet.json 的 totalExp 若被手工改成非数字，等级会算出 NaN、界面显示 "Lv.NaN"。
function safeNum(v) {
  const n = Number(v);
  return (Number.isFinite(n) && n > 0) ? n : 0;
}

function round1(x) {
  return Math.round(safeNum(x) * 10) / 10;
}

function expFromMinutes(minutes) {
  return round1(safeNum(minutes) / 60 * 10); // 60min = 10 EXP，保留 1 位小数
}

// 升级所需 EXP（固定值）：每累计 80 EXP 升 1 级（Lv.1→Lv.2→…）
const EXP_PER_LEVEL = 80;

function levelFromTotalExp(totalExp) {
  return Math.floor(safeNum(totalExp) / EXP_PER_LEVEL) + 1;
}

function expInLevel(totalExp) {
  const t = safeNum(totalExp);
  return t - Math.floor(t / EXP_PER_LEVEL) * EXP_PER_LEVEL;
}

// 文本进度条：原生菜单不支持图形进度条，用方块字符 █/░ 近似（默认 10 格）。
function expBarText(exp, need, cells) {
  const n = Math.max(1, need || EXP_PER_LEVEL);
  const e = Math.max(0, Math.min(exp || 0, n));
  const total = Math.max(1, cells || 10);
  const filled = Math.round((e / n) * total);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, total - filled));
}

function fmtHM(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

module.exports = {
  toMin, overlap, classifyDay, normalizeWork,
  computeWorked, expFromMinutes, levelFromTotalExp, expInLevel, expBarText, fmtHM, round1,
  EXP_PER_LEVEL
};

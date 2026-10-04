const fs = require('fs');
const path = require('path');
const wt = require('./work-time');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

// 阶段 1 数据层：确保目录与默认 JSON 存在。
// 关键原则：数据与程序分离，data/ 与 WorkRecords/ 独立于代码，可整体迁移。
function ensureDataLayer(root) {
  const dataDir = path.join(root, 'data');
  const workDir = path.join(root, 'WorkRecords');
  const backupDir = path.join(root, 'backup');
  for (const d of [dataDir, workDir, backupDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  const today = todayStr();

  const defaults = {
    'pet.json': {
      name: '阿七', level: 1, exp: 0, totalExp: 0, affection: 0,
      createdAt: today, skin: 'default', unlockedItems: [], interactionCount: 0
    },
    'attendance.json': {},
    'statistics.json': {
      totalWorkMinutes: 0, totalExp: 0, workDays: 0,
      weekdayOvertimeCount: 0, weekdayOvertimeMinutes: 0,
      weekendOvertimeCount: 0, weekendOvertimeMinutes: 0
    },
    'settings.json': {
      petName: '阿七', alwaysOnTop: true, startOnBoot: false,
      position: null,
      eyeReminderMin: 60, sitReminderMin: 90, waterReminderMin: 120,
      work: {
        intervals: [['08:00', '12:00'], ['14:00', '18:00']],
        lunch: ['12:00', '14:00']
      }
    },
    'tasks.json': {}
  };

  for (const [name, def] of Object.entries(defaults)) {
    const f = path.join(dataDir, name);
    if (!fs.existsSync(f)) writeJson(f, def);
  }

  return { dataDir, workDir, backupDir };
}

// ===== 阶段 2：上工 / 下工 / 工时 / EXP =====

function paths(root) {
  const dataDir = path.join(root, 'data');
  return {
    dataDir,
    attendance: path.join(dataDir, 'attendance.json'),
    statistics: path.join(dataDir, 'statistics.json'),
    pet: path.join(dataDir, 'pet.json'),
    settings: path.join(dataDir, 'settings.json')
  };
}

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayStr() {
  return fmtDate(new Date());
}

// 昨天（阶段 4：忘记上工的检测基准日）
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return fmtDate(d);
}

// ===== 阶段 4：补录 / 修正 的输入校验 =====
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// 严格校验 YYYY-MM-DD（排除 2026-02-31 这类"格式对但不存在"的日期）
function isValidDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && fmtDate(d) === s;
}

function isValidHM(s) {
  return HM_RE.test(String(s || ''));
}

function nowHM() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function loadSettings(dataDir) {
  return readJson(path.join(dataDir, 'settings.json'), {});
}

// 上工：记录当前时间，进入 WORKING。一天仅允许一次（防重复打卡）。
function punchIn(root) {
  const { dataDir, attendance } = paths(root);
  const att = readJson(attendance, {});
  const today = todayStr();
  const rec = att[today];
  if (rec && (rec.status === 'working' || rec.status === 'completed')) {
    return { ok: false, reason: 'already', record: rec };
  }
  const now = new Date();
  const recNew = {
    date: today,
    type: wt.classifyDay(today),
    sessions: [{ start: nowHM(), startTs: now.toISOString(), source: 'normal' }],
    status: 'working'
  };
  att[today] = recNew;
  writeJson(attendance, att);
  return { ok: true, record: recNew };
}

// 下工：记录结束时间，按区间算法结算工时与 EXP，然后【全量重算】统计与宠物。
function punchOut(root) {
  const { attendance, dataDir } = paths(root);
  const att = readJson(attendance, {});
  const today = todayStr();
  const rec = att[today];
  if (!rec || rec.status !== 'working') return { ok: false, reason: 'not_working' };
  if (rec.counted) return { ok: false, reason: 'already_out' };

  const now = new Date();
  const s0 = rec.sessions[0];
  const settings = loadSettings(dataDir);
  const calc = wt.computeWorked(new Date(s0.startTs), now, rec.type, settings);

  s0.end = nowHM();
  s0.endTs = now.toISOString();
  rec.totalMinutes = calc.totalMinutes;
  rec.normalMinutes = calc.normalMinutes;
  rec.overtimeMinutes = calc.overtimeMinutes;
  rec.exp = wt.expFromMinutes(calc.totalMinutes);
  rec.source = rec.source || s0.source || 'normal';
  rec.status = 'completed';
  rec.counted = true;

  writeJson(attendance, att);
  const { pet: p } = recomputeAll(root);   // 阶段 4：统计/宠物由记录全量派生，不做增量累加
  return { ok: true, record: rec, pet: p };
}

// ===== 阶段 4：全量重算 =====
// 为什么用全量重算而不是增量累加：
//   阶段 4 允许"补录 / 手动修改工作时间"，改完必须重算。若沿用增量累加，
//   修改一条旧记录就会造成统计重复累加或无法回滚，时间一长必然漂移。
//   本函数把 statistics.json 与 pet.json 完全由 attendance.json 派生 —— 单一真相来源。
// XP 口径：V1.0 的 EXP 唯一来源是工时记录，故 pet.totalExp === statistics.totalExp。
function recomputeAll(root) {
  const { attendance, statistics, pet } = paths(root);
  const att = readJson(attendance, {});

  const stats = {
    totalWorkMinutes: 0, totalExp: 0, workDays: 0,
    weekdayOvertimeCount: 0, weekdayOvertimeMinutes: 0,
    weekendOvertimeCount: 0, weekendOvertimeMinutes: 0
  };

  for (const date of Object.keys(att).sort()) {
    const rec = att[date];
    if (!rec || rec.status !== 'completed') continue;        // 只有已结算记录计入
    if (typeof rec.totalMinutes !== 'number') continue;
    const type = rec.type || wt.classifyDay(date);
    const total = rec.totalMinutes;
    stats.totalWorkMinutes += total;
    stats.totalExp = wt.round1(stats.totalExp + (rec.exp || 0));
    if (type === 'weekend') {
      stats.weekendOvertimeCount += 1;
      stats.weekendOvertimeMinutes += total;
    } else {
      stats.workDays += 1;
      const ot = rec.overtimeMinutes || 0;
      if (ot > 0) {
        stats.weekdayOvertimeCount += 1;
        stats.weekdayOvertimeMinutes += ot;
      }
    }
  }

  const p = readJson(pet, { name: '阿七', level: 1, exp: 0, totalExp: 0 });
  p.totalExp = stats.totalExp;
  p.level = wt.levelFromTotalExp(p.totalExp);
  p.exp = wt.round1(wt.expInLevel(p.totalExp));

  writeJson(statistics, stats);
  writeJson(pet, p);
  return { statistics: stats, pet: p };
}

// 当前状态：供渲染层显示（含实时计时）。
function getStatus(root) {
  const { dataDir, attendance, pet } = paths(root);
  const att = readJson(attendance, {});
  const p = readJson(pet, { name: '阿七', level: 1, exp: 0, totalExp: 0 });
  const today = todayStr();
  const rec = att[today];
  const base = {
    name: p.name || '阿七',
    level: p.level || 1,
    exp: wt.round1(p.exp || 0),        // 当前等级内已获得的 EXP
    expPerLevel: wt.EXP_PER_LEVEL,     // 升一级所需 EXP（固定 80，V-ming 2026-10-03 定稿）
    totalExp: wt.round1(p.totalExp || 0)
  };

  if (!rec || rec.status === 'off' || rec.status === 'incomplete' || rec.status === 'absent') {
    return { ...base, state: 'OFF_WORK', working: false };
  }

  if (rec.status === 'working') {
    const s0 = rec.sessions[0];
    const settings = loadSettings(dataDir);
    const now = new Date();
    const calc = wt.computeWorked(new Date(s0.startTs), now, rec.type, settings);
    const lunch = wt.normalizeWork(settings).lunch;
    const nowM = now.getHours() * 60 + now.getMinutes();
    const inLunch = rec.type === 'workday' && nowM >= lunch[0] && nowM < lunch[1];
    return {
      ...base,
      state: inLunch ? 'LUNCH_BREAK' : 'WORKING',
      working: true,
      startHM: s0.start,
      liveMinutes: calc.totalMinutes,
      liveExp: wt.expFromMinutes(calc.totalMinutes),
      type: rec.type
    };
  }

  if (rec.status === 'completed') {
    return {
      ...base,
      state: 'OFF_WORK',
      working: false,
      completed: true,
      startHM: rec.sessions[0].start,
      endHM: rec.sessions[0].end,
      totalMinutes: rec.totalMinutes,
      todayExp: wt.round1(rec.exp)   // 今日本次结算所得 EXP（与 base.exp=等级内进度区分开）
    };
  }
  return { ...base, state: 'OFF_WORK', working: false };
}

// 启动恢复：跨天仍处于 working 的记录置为 incomplete（绝不自动算超长工时）。
// 当天仍 working 的记录保留，渲染层会继续按原上工时间实时计时。
function resumeIncomplete(root) {
  const { attendance, dataDir } = paths(root);
  const att = readJson(attendance, {});
  const today = todayStr();
  let changed = false;
  for (const [date, rec] of Object.entries(att)) {
    if (rec.status === 'working' && date !== today) {
      rec.status = 'incomplete';
      changed = true;
    }
  }
  if (changed) writeJson(attendance, att);
  return changed;
}

// ===== 阶段 4：补录 / 修正工作时间 =====
// 用户指定 日期 + 上工 + 下工 → 写入一条 source='manual_repair' 的已完成记录，并全量重算。
// 覆盖语义：若该日期已有记录（例如之前是 incomplete，或想修正已完成的时间），直接覆盖，
// 因为统计是"全量派生"的，所以不会出现重复累加。
function repairAttendance(root, input) {
  const { attendance, dataDir } = paths(root);
  const date = String((input && input.date) || '').trim();
  const start = String((input && input.start) || '').trim();
  const end = String((input && input.end) || '').trim();

  if (!isValidDate(date)) return { ok: false, reason: 'bad_date' };
  if (!isValidHM(start)) return { ok: false, reason: 'bad_start' };
  if (!isValidHM(end)) return { ok: false, reason: 'bad_end' };
  if (wt.toMin(end) <= wt.toMin(start)) return { ok: false, reason: 'bad_range' };
  if (date > todayStr()) return { ok: false, reason: 'future' };

  const type = wt.classifyDay(date);
  const settings = loadSettings(dataDir);
  const sTs = new Date(`${date}T${start}:00`);
  const eTs = new Date(`${date}T${end}:00`);
  const calc = wt.computeWorked(sTs, eTs, type, settings);

  const att = readJson(attendance, {});
  const prev = att[date] || null;

  const rec = {
    date,
    type,
    sessions: [{
      start, startTs: sTs.toISOString(),
      end, endTs: eTs.toISOString(),
      source: 'manual_repair'
    }],
    totalMinutes: calc.totalMinutes,
    normalMinutes: calc.normalMinutes,
    overtimeMinutes: calc.overtimeMinutes,
    exp: wt.expFromMinutes(calc.totalMinutes),
    status: 'completed',
    counted: true,
    source: 'manual_repair'
  };

  att[date] = rec;
  writeJson(attendance, att);
  const { statistics, pet } = recomputeAll(root);
  return {
    ok: true,
    record: rec,
    replaced: !!prev,
    prevStatus: prev ? prev.status : null,
    statistics, pet
  };
}

// 忽略某一天（"这天没上班"）：写入 absent 标记，之后不再作为"忘记上工"提醒。
// 安全约束：该日若已有出勤记录（sessions 非空），拒绝忽略，避免误抹真实数据。
function ignoreDay(root, date) {
  const d = String(date || '').trim();
  if (!isValidDate(d)) return { ok: false, reason: 'bad_date' };
  const { attendance } = paths(root);
  const att = readJson(attendance, {});
  const prev = att[d];
  if (prev && Array.isArray(prev.sessions) && prev.sessions.length) {
    return { ok: false, reason: 'has_record' };
  }
  att[d] = {
    date: d,
    type: wt.classifyDay(d),
    sessions: [],
    status: 'absent',
    source: 'ignored',
    ignoredAt: new Date().toISOString()
  };
  writeJson(attendance, att);
  recomputeAll(root);
  return { ok: true, date: d };
}

// 待补录检测（启动时提醒用）：
//  A) 忘记下工：任何日期存在 status='incomplete' 的记录（由 resumeIncomplete 产生）→ 必须用户确认，绝不自动算。
//  B) 忘记上工：仅检查「昨天」，且要求程序在昨天之前就已存在（pet.createdAt < 昨天），
//     避免全新安装当天就误报"你昨天忘打卡"。
//  已 ignored（absent）或有任何记录的日期都不会提示。
function findPendingRepairs(root) {
  const { attendance, pet } = paths(root);
  const att = readJson(attendance, {});
  const out = [];

  for (const date of Object.keys(att).sort()) {
    const rec = att[date];
    if (rec && rec.status === 'incomplete') {
      out.push({
        date,
        kind: 'forgot_out',
        startHM: (rec.sessions && rec.sessions[0] && rec.sessions[0].start) || ''
      });
    }
  }

  const y = yesterdayStr();
  const p = readJson(pet, {});
  const createdAt = p.createdAt || '';
  const existedBefore = !!createdAt && createdAt < y;
  if (existedBefore && wt.classifyDay(y) === 'workday' && !att[y]) {
    out.push({ date: y, kind: 'forgot_in' });
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// 等级/经验摘要：供托盘菜单显示等级与经验条（每次调用都读最新 pet.json）。
function getLevelInfo(root) {
  const { pet } = paths(root);
  const p = readJson(pet, { level: 1, exp: 0, totalExp: 0 });
  const totalExp = p.totalExp || 0;
  return {
    name: p.name || '阿七',
    level: wt.levelFromTotalExp(totalExp),
    exp: wt.round1(wt.expInLevel(totalExp)),
    expPerLevel: wt.EXP_PER_LEVEL,
    totalExp: wt.round1(totalExp)
  };
}

module.exports = {
  ensureDataLayer, readJson, writeJson,
  punchIn, punchOut, getStatus, resumeIncomplete, getLevelInfo,
  // 阶段 4
  recomputeAll, repairAttendance, ignoreDay, findPendingRepairs,
  isValidDate, isValidHM,
  todayStr, yesterdayStr, nowHM
};

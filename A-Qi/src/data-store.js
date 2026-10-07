const fs = require('fs');
const path = require('path');
const wt = require('./work-time');
const todo = require('./todo');
const stats = require('./stats');
const growth = require('./growth');
const wr = require('./work-record');

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
      createdAt: today, skin: 'default', unlockedItems: [], interactionCount: 0,
      // 阶段 7：互动系统。interactionsToday 只保留"当天"的计数（跨天自动归零）
      interactionsToday: { date: today, counts: {} }
    },
    'attendance.json': {},
    'statistics.json': {
      totalWorkMinutes: 0, totalExp: 0, workDays: 0,
      weekdayOvertimeCount: 0, weekdayOvertimeMinutes: 0,
      weekendOvertimeCount: 0, weekendOvertimeMinutes: 0
    },
    'settings.json': {
      // 阶段 9：开机启动**默认开启**（规格 §37「默认建议开启」，V-ming 2026-10-07 确认）。
      // 用户可在设置页随时关闭；程序不会改写已存在的设置文件（老用户保持原值，除非手动开）。
      petName: '阿七', alwaysOnTop: true, startOnBoot: true,
      // 2026-10-07 新增：桌面宠物大小（'large' 默认 / 'small' = 一半比例）。
      // 只影响桌面宠物的显示比例与窗口尺寸，不改动任何功能。
      petSize: 'large',
      position: null,
      // 阶段 6：健康提醒（默认开启；间隔单位分钟；托盘可开关，设置界面留阶段 9）
      // 注：V-ming 2026-10-05 验收决定取消喝水提醒，故默认值不再包含 waterReminderMin；
      //     已存在的 settings.json 不会被程序改写（其中残留的该键会被忽略）。
      remindersEnabled: true,
      eyeReminderMin: 60, sitReminderMin: 90,
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
  const rc = recomputeAll(root);   // 阶段 4：统计/宠物由记录全量派生，不做增量累加
  return { ok: true, record: rec, pet: rc.pet, levelUp: rc.levelUp, newUnlocks: rc.newUnlocks };
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
  const prevLevel = wt.levelFromTotalExp(p.totalExp || 0);
  p.totalExp = stats.totalExp;
  p.level = wt.levelFromTotalExp(p.totalExp);
  p.exp = wt.round1(wt.expInLevel(p.totalExp));

  // 阶段 7：等级提升自动解锁道具（**只增不减** —— 补录导致降级时不回收，避免养成观感倒退）
  const had = Array.isArray(p.unlockedItems) ? p.unlockedItems.slice() : [];
  const earned = growth.unlocksForLevel(p.level);
  const addedUnlocks = earned.filter((u) => !had.includes(u.id));
  p.unlockedItems = Array.from(new Set(had.concat(earned.map((u) => u.id))));

  writeJson(statistics, stats);
  writeJson(pet, p);
  return {
    statistics: stats,
    pet: p,
    prevLevel,
    levelUp: p.level > prevLevel,
    newUnlocks: addedUnlocks
  };
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
  const rc = recomputeAll(root);
  return {
    ok: true,
    record: rec,
    replaced: !!prev,
    prevStatus: prev ? prev.status : null,
    statistics: rc.statistics,
    pet: rc.pet,
    levelUp: rc.levelUp,
    newUnlocks: rc.newUnlocks
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

// ===== 阶段 5：今日待办（tasks.json） =====
// 职责分离（技术规格 §28）：TXT 是工作记录（用户手写，绝不改写）；tasks.json 只存待办勾选状态。
// 来源：读取【前一天】工作记录 TXT 的【明日待办】，成为今天的待办。
//
// 注意：不缓存"空列表"——若前一天还没有记录，本次返回空且不落盘，
// 这样用户稍后补写了昨天的【明日待办】，再打开就能拿到最新内容。
function getTodos(root, date) {
  const d = date || todayStr();
  const file = path.join(paths(root).dataDir, 'tasks.json');
  const all = readJson(file, {});
  const from = todo.prevDate(d);

  if (Array.isArray(all[d]) && all[d].length) {
    return { date: d, from, items: all[d] };
  }

  const text = wr.readRecord(root, from) || '';
  const items = todo.mergeState(todo.parseTodoLines(text), all[d]);
  if (items.length) {
    all[d] = items;
    writeJson(file, all);
  }
  return { date: d, from, items };
}

// 勾选 / 取消勾选某一条今日待办
function setTodoDone(root, date, index, done) {
  const d = date || todayStr();
  const file = path.join(paths(root).dataDir, 'tasks.json');
  const all = readJson(file, {});
  const list = Array.isArray(all[d]) ? all[d] : null;
  if (!list) return { ok: false, reason: 'no_list' };

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) return { ok: false, reason: 'bad_index' };

  list[i].completed = !!done;
  all[d] = list;
  writeJson(file, all);
  return { ok: true, date: d, items: list };
}

// ===== 阶段 5：工作统计 =====
// 数据全部由 attendance.json（经 stats.js 纯函数）派生，另附 pet.json 的累计 EXP 与当前等级。
function getStats(root) {
  const { attendance, pet } = paths(root);
  const att = readJson(attendance, {});
  const s = stats.computeStats(att, new Date());
  const p = readJson(pet, { level: 1, exp: 0, totalExp: 0 });
  const totalExp = p.totalExp || 0;
  return {
    ...s,
    totalExp: wt.round1(totalExp),
    level: wt.levelFromTotalExp(totalExp),
    exp: wt.round1(wt.expInLevel(totalExp)),
    expPerLevel: wt.EXP_PER_LEVEL
  };
}

// ===== 阶段 6：设置更新（供托盘切换「健康提醒」开关；阶段 9 做完整设置界面） =====
function updateSettings(root, patch) {
  const file = path.join(paths(root).dataDir, 'settings.json');
  const s = readJson(file, {});
  const next = Object.assign({}, s, patch || {});
  writeJson(file, next);
  return next;
}

// 读取健康提醒设置（原始值；归一化交给 src/reminder.js 的 normalizeSettings）
function getReminderSettings(root) {
  return readJson(path.join(paths(root).dataDir, 'settings.json'), {});
}

// ===== 阶段 9：设置 / 数据备份与恢复 / 应用信息 =====
// 原则（规格 §26/§40）：**程序可以更新，数据不能丢失**；data/ 与 WorkRecords/ 独立于代码，可整体迁移。
// 备份 = 把这两块**只读复制**到 backup/<时间戳>/；恢复 = 先把当前数据整体挪到临时目录（可回滚），
// 再把备份复制回来，成功后才删临时目录。恢复前**必定**先自动做一次安全备份。

function normInterval(v, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return dflt;
  return Math.min(Math.round(n), 600);   // 上限 10 小时，防手输离谱值
}

// 设置摘要：读原始 settings.json 并补齐默认值，供设置页展示（**不改写文件**）
function getSettingsSummary(root) {
  const s = readJson(path.join(paths(root).dataDir, 'settings.json'), {});
  const p = readJson(paths(root).pet, {});
  const work = (s.work && Array.isArray(s.work.intervals) && s.work.intervals.length)
    ? s.work
    : { intervals: [['08:00', '12:00'], ['14:00', '18:00']], lunch: ['12:00', '14:00'] };
  const pos = s.position;
  // 名字的**唯一权威是 pet.json.name**（settings.petName 只是镜像，防止两处不一致）
  const name = (typeof p.name === 'string' && p.name.trim()) ? p.name.trim()
    : ((typeof s.petName === 'string' && s.petName.trim()) ? s.petName.trim() : '阿七');
  return {
    petName: name,
    alwaysOnTop: s.alwaysOnTop !== false,
    startOnBoot: !!s.startOnBoot,
    // 桌面宠物大小：只认 'small'，其余一律回退 'large'（脏数据防呆）
    petSize: (s.petSize === 'small' ? 'small' : 'large'),
    position: (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y))
      ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null,
    remindersEnabled: s.remindersEnabled !== false,
    eyeReminderMin: normInterval(s.eyeReminderMin, 60),
    sitReminderMin: normInterval(s.sitReminderMin, 90),
    work
  };
}

// 改宠物名（同时更新 pet.json.name 与 settings.petName，避免两处不一致）
function setPetName(root, name) {
  const raw = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > 12) return { ok: false, reason: 'too_long' };
  const { pet } = paths(root);
  const p = readJson(pet, {});
  p.name = raw;
  writeJson(pet, p);
  updateSettings(root, { petName: raw });
  return { ok: true, name: raw };
}

function backupStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// 备份名：YYYYMMDD-HHMMSS；同一秒内重复备份（如"备份后立刻恢复"触发安全备份）会加序号后缀
const BACKUP_NAME_RE = /^\d{8}-\d{6}(-\d+)?$/;

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirRecursive(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function countFiles(dir, ext) {
  let n = 0;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) n += countFiles(p, ext);
      else if (ent.isFile() && (!ext || p.endsWith(ext))) n += 1;
    }
  } catch (_) { /* 目录不存在按 0 计 */ }
  return n;
}

function dirSize(dir) {
  let n = 0;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) n += dirSize(p);
      else if (ent.isFile()) n += fs.statSync(p).size;
    }
  } catch (_) {}
  return n;
}

// 备份：把 data/ 与 WorkRecords/ **只读复制**到 backup/<时间戳>/
function backupData(root) {
  const { dataDir, workDir, backupDir } = ensureDataLayer(root);
  const base = backupStamp(new Date());
  let name = base;
  let n = 1;
  while (fs.existsSync(path.join(backupDir, name))) { n += 1; name = base + '-' + n; }  // 同秒重名 → 加序号
  const dst = path.join(backupDir, name);
  try {
    copyDirRecursive(dataDir, path.join(dst, 'data'));
    copyDirRecursive(workDir, path.join(dst, 'WorkRecords'));
    writeJson(path.join(dst, 'backup-info.json'), {
      name,
      createdAt: new Date().toISOString(),
      dataFiles: countFiles(path.join(dst, 'data')),
      recordFiles: countFiles(path.join(dst, 'WorkRecords'), '.txt'),
      totalBytes: dirSize(dst)
    });
    return { ok: true, name, path: dst };
  } catch (e) {
    try { fs.rmSync(dst, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, reason: 'io_error', message: e && e.message };
  }
}

function listBackups(root) {
  const { backupDir } = ensureDataLayer(root);
  let names = [];
  try {
    names = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && BACKUP_NAME_RE.test(d.name))
      .map((d) => d.name);
  } catch (_) {}
  return names.sort().reverse().map((name) => {
    const p = path.join(backupDir, name);
    const info = readJson(path.join(p, 'backup-info.json'), null);
    return {
      name,
      createdAt: (info && info.createdAt) || null,
      sizeBytes: dirSize(p),
      dataFiles: info ? info.dataFiles : undefined,
      recordFiles: info ? info.recordFiles : undefined
    };
  });
}

// 恢复：先把当前数据整体挪到临时目录（可回滚），复制备份回去，成功后才删临时目录；
// 并且**恢复前必定先自动做一次安全备份**（backup/<更早时间戳>/），避免"手滑把今天的数据弄丢"。
function restoreBackup(root, name) {
  if (!BACKUP_NAME_RE.test(String(name || ''))) return { ok: false, reason: 'bad_name' };
  const { dataDir, workDir, backupDir } = ensureDataLayer(root);
  const src = path.join(backupDir, name);
  if (!fs.existsSync(src)) return { ok: false, reason: 'not_found' };

  const safe = backupData(root);   // 安全网：先备份"当前"状态

  const tmp = path.join(backupDir, '.restore-tmp');
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    if (fs.existsSync(dataDir)) fs.renameSync(dataDir, path.join(tmp, 'data'));
    if (fs.existsSync(workDir)) fs.renameSync(workDir, path.join(tmp, 'WorkRecords'));

    if (fs.existsSync(path.join(src, 'data'))) copyDirRecursive(path.join(src, 'data'), dataDir);
    if (fs.existsSync(path.join(src, 'WorkRecords'))) copyDirRecursive(path.join(src, 'WorkRecords'), workDir);
    ensureDataLayer(root);   // 补齐备份里可能缺失的默认文件

    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: true, restoredFrom: name, safetyBackup: safe.ok ? safe.name : null };
  } catch (e) {
    // 回滚：把临时目录里的原数据挪回来
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(workDir, { recursive: true, force: true });
      if (fs.existsSync(path.join(tmp, 'data'))) fs.renameSync(path.join(tmp, 'data'), dataDir);
      if (fs.existsSync(path.join(tmp, 'WorkRecords'))) fs.renameSync(path.join(tmp, 'WorkRecords'), workDir);
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
    return { ok: false, reason: 'io_error', message: e && e.message, safetyBackup: safe.ok ? safe.name : null };
  }
}

// 应用信息：数据目录 / 记录数与体积 / 最近一次备份（供设置页"数据"分区展示）
function getAppInfo(root) {
  const { dataDir, workDir, backupDir } = ensureDataLayer(root);
  const att = readJson(path.join(dataDir, 'attendance.json'), {});
  const backups = listBackups(root);
  return {
    dataDir,
    recordsDir: workDir,
    backupDir,
    attendanceDays: Object.keys(att).length,
    recordFiles: countFiles(workDir, '.txt'),
    dataBytes: dirSize(dataDir) + dirSize(workDir),
    backupCount: backups.length,
    lastBackup: backups.length ? backups[0] : null
  };
}

// ===== 阶段 7：成长 / 互动 =====
// 宠物状态 + 等级 + 好感度 + 解锁 + 互动次数，供「互动 / 宠物状态」窗口使用。
function getGrowth(root) {
  const { pet } = paths(root);
  const p = readJson(pet, {});
  const today = todayStr();
  const totalExp = p.totalExp || 0;
  const level = wt.levelFromTotalExp(totalExp);
  const counters = growth.normalizeCounters(p.interactionsToday, today);
  const unlocked = Array.isArray(p.unlockedItems) ? p.unlockedItems.slice() : [];

  return {
    name: p.name || '阿七',
    level,
    exp: wt.round1(wt.expInLevel(totalExp)),
    expPerLevel: wt.EXP_PER_LEVEL,
    totalExp: wt.round1(totalExp),
    affection: Math.max(0, Math.round(p.affection || 0)),
    interactionCount: Math.max(0, Math.round(p.interactionCount || 0)),
    createdAt: p.createdAt || today,
    companionDays: growth.companionDays(p.createdAt || today, today),
    unlockedItems: unlocked,
    unlocked: growth.unlocksForLevel(level),          // 按等级应解锁的（含名称/emoji）
    unlockList: growth.UNLOCKS,                       // 全部道具（含未解锁的，供界面展示）
    nextUnlock: growth.nextUnlock(level),
    counters,
    actions: growth.INTERACTIONS.map((it) => ({
      key: it.key, label: it.label, emoji: it.emoji,
      dailyLimit: it.dailyLimit,
      remaining: growth.remainingOf(counters, it.key)
    }))
  };
}

// 执行一次互动：**只加好感度，不加 EXP**（README §二十二：工作时长是 EXP 的绝对核心来源）
function interact(root, key) {
  const { pet } = paths(root);
  const p = readJson(pet, {});
  const today = todayStr();
  const counters = growth.normalizeCounters(p.interactionsToday, today);
  const r = growth.applyInteraction(counters, key, today);
  if (!r.ok) return { ok: false, reason: r.reason, counters };

  p.interactionsToday = r.counters;
  p.affection = Math.max(0, Math.round((p.affection || 0) + r.affectionDelta));
  p.interactionCount = Math.max(0, Math.round((p.interactionCount || 0) + 1));
  writeJson(pet, p);

  return {
    ok: true,
    action: key,
    state: r.state,
    message: r.message,
    affection: p.affection,
    affectionDelta: r.affectionDelta,
    interactionCount: p.interactionCount,
    counters: r.counters,
    totalExp: wt.round1(p.totalExp || 0)   // 原样返回，用于向用户证明"互动没有加 EXP"
  };
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
  // 阶段 5
  getTodos, setTodoDone, getStats,
  // 阶段 6
  updateSettings, getReminderSettings,
  // 阶段 7
  getGrowth, interact,
  // 阶段 9
  getSettingsSummary, setPetName, backupData, listBackups, restoreBackup, getAppInfo,
  todayStr, yesterdayStr, nowHM
};

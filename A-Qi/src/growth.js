// src/growth.js
// 阶段 7：阿七成长 + 互动（纯函数，便于无 GUI 单测）
//
// 规格依据：
//   《技术实现规格》§32 宠物状态（IDLE/WALK/SLEEP/HAPPY/SAD/WORKING/EATING/DRINKING/REMINDING）
//   《技术实现规格》§33 工作状态下可随机 坐着/走动/看电脑/趴着/打哈欠/喝水/伸懒腰（不影响计时）
//   《README》§二十一 宠物互动、§二十二 成长、§二十三 成长奖励（升级解锁道具）
//   《README》§二十二 核心红线：「工作时长是 EXP 的绝对核心来源，不能让用户靠疯狂点击互动刷经验」
//
// ⭐ 因此本项目铁律：**互动只加好感度（affection），绝不产生 EXP**。
//    EXP 永远只来自真实工时（statistics.totalExp），互动链路不碰 totalExp。

// ===== 宠物状态 =====
// 说明：WALK / SAD 属于规格要求的"至少要支持"的状态，但当前版本**不会主动产生**它们
// （WALK 需要动画素材、SAD 的触发规则规格未定义）。阶段 8 落地动画时会用上。
const PET_STATES = [
  'IDLE', 'WALK', 'SLEEP', 'HAPPY', 'SAD', 'WORKING', 'EATING', 'DRINKING', 'REMINDING'
];
const REACHABLE_STATES = ['IDLE', 'SLEEP', 'HAPPY', 'WORKING', 'EATING', 'DRINKING', 'REMINDING'];

// 互动后的状态持续时间
const ACTION_MS = 12000;    // 12 秒：摸头/玩耍→HAPPY，喂食→EATING，喂水→DRINKING
const LEVELUP_MS = 20000;   // 20 秒：升级后保持 HAPPY

// ===== 互动动作 =====
// 每种动作有【每日上限】，防止刷好感度（对应 README「不能让用户靠疯狂点击刷经验」的精神）
const INTERACTIONS = [
  { key: 'pat',   label: '摸摸头', emoji: '🤚', state: 'HAPPY',    dailyLimit: 5, message: '阿七眯起眼睛蹭了蹭你的手 🐱' },
  { key: 'feed',  label: '喂点吃的', emoji: '🍚', state: 'EATING',  dailyLimit: 3, message: '阿七认真吃起来，尾巴一摇一摇的 🍚' },
  { key: 'water', label: '给它喝水', emoji: '💧', state: 'DRINKING', dailyLimit: 3, message: '咕咚咕咚……阿七喝饱了 💧' },
  { key: 'play',  label: '陪它玩会儿', emoji: '🧶', state: 'HAPPY',  dailyLimit: 3, message: '阿七追着毛线球转了两圈 🧶' }
];
const AFFECTION_PER_INTERACTION = 1;

// ===== 升级解锁（README §二十三）=====
const UNLOCKS = [
  { level: 2, id: 'hat',     name: '帽子',     emoji: '🎩' },
  { level: 3, id: 'clothes', name: '衣服',     emoji: '👕' },
  { level: 4, id: 'cup',     name: '水杯',     emoji: '🥤' },
  { level: 5, id: 'laptop',  name: '小电脑',   emoji: '💻' },
  { level: 6, id: 'plant',   name: '植物',     emoji: '🪴' },
  { level: 7, id: 'sofa',    name: '沙发',     emoji: '🛋' },
  { level: 8, id: 'bed',     name: '床',       emoji: '🛏' },
  { level: 9, id: 'trophy',  name: '工作奖杯', emoji: '🏆' }
];

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 从 dateStr（含）到今天（含）的天数
function companionDays(createdAt, today) {
  const a = new Date(`${createdAt}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 1;
  const days = Math.round((b - a) / 86400000) + 1;
  return Math.max(1, days);
}

// ===== 互动次数计数器 =====
// 结构：{ date: 'YYYY-MM-DD', counts: { pat: 2, feed: 1, ... } }
// 跨天自动归零（不写历史，只保留当天）
function normalizeCounters(counters, today) {
  const c = counters || {};
  if (c.date !== today || !c.counts || typeof c.counts !== 'object') {
    return { date: today, counts: {} };
  }
  const clean = {};
  for (const it of INTERACTIONS) {
    const n = Number(c.counts[it.key]);
    clean[it.key] = (isFinite(n) && n > 0) ? Math.floor(n) : 0;
  }
  return { date: today, counts: clean };
}

function remainingOf(counters, key) {
  const it = INTERACTIONS.find((x) => x.key === key);
  if (!it) return 0;
  const used = (counters && counters.counts && counters.counts[key]) || 0;
  return Math.max(0, it.dailyLimit - used);
}

function canInteract(counters, key) {
  if (!INTERACTIONS.some((x) => x.key === key)) return false;
  return remainingOf(counters, key) > 0;
}

// 执行一次互动（返回新的计数器；不改入参）
function applyInteraction(counters, key, today) {
  const it = INTERACTIONS.find((x) => x.key === key);
  if (!it) return { ok: false, reason: 'unknown_action' };

  const cur = normalizeCounters(counters, today);
  if (remainingOf(cur, key) <= 0) {
    return { ok: false, reason: 'daily_limit', counters: cur, action: it };
  }

  const next = { date: today, counts: Object.assign({}, cur.counts) };
  next.counts[key] = (next.counts[key] || 0) + 1;

  return {
    ok: true,
    counters: next,
    action: it,
    affectionDelta: AFFECTION_PER_INTERACTION,
    state: it.state,
    message: it.message
  };
}

// ===== 宠物状态判定 =====
// input: { working, bubbleShown, lastAction, lastActionAt }
//   lastAction ∈ 'pat' | 'feed' | 'water' | 'play' | 'levelup'
function computeState(input, now) {
  const i = input || {};
  const t = now instanceof Date ? now : new Date();

  if (i.bubbleShown) return 'REMINDING';          // 正在提醒
  if (i.working) return 'WORKING';                // 上工中（V1.0 特色状态）

  if (i.lastAction && i.lastActionAt) {
    const age = t.getTime() - new Date(i.lastActionAt).getTime();
    const window = i.lastAction === 'levelup' ? LEVELUP_MS : ACTION_MS;
    if (age >= 0 && age < window) {
      if (i.lastAction === 'levelup') return 'HAPPY';
      const it = INTERACTIONS.find((x) => x.key === i.lastAction);
      if (it) return it.state;
    }
  }

  const h = t.getHours();
  if (h >= 22 || h < 6) return 'SLEEP';           // 夜间休息
  return 'IDLE';
}

const STATE_TEXT = {
  IDLE: '休息中',
  WALK: '溜达中',
  SLEEP: '睡着了',
  HAPPY: '很开心',
  SAD: '有点没精神',
  WORKING: '工作中',
  EATING: '吃东西',
  DRINKING: '喝水',
  REMINDING: '给你提醒'
};
const STATE_EMOJI = {
  IDLE: '🐱', WALK: '🐾', SLEEP: '😴', HAPPY: '😸', SAD: '😿',
  WORKING: '🟢', EATING: '🍚', DRINKING: '💧', REMINDING: '💬'
};

function stateText(state) { return STATE_TEXT[state] || STATE_TEXT.IDLE; }
function stateEmoji(state) { return STATE_EMOJI[state] || STATE_EMOJI.IDLE; }

// ===== 解锁 =====
// 某等级应当解锁的全部道具
function unlocksForLevel(level) {
  const lv = Math.max(1, Math.round(Number(level) || 1));
  return UNLOCKS.filter((u) => u.level <= lv);
}

// 相比 already 列表，新解锁的道具
function newUnlocks(level, already) {
  const has = Array.isArray(already) ? already : [];
  return unlocksForLevel(level).filter((u) => !has.includes(u.id));
}

function nextUnlock(level) {
  const lv = Math.max(1, Math.round(Number(level) || 1));
  return UNLOCKS.find((u) => u.level > lv) || null;
}

function levelUpMessage(level) {
  return `阿七升级了！现在是 Lv.${level} 🎉`;
}

function unlockMessage(items) {
  const list = items || [];
  if (!list.length) return '';
  return '解锁了：' + list.map((i) => `${i.emoji}${i.name}`).join('、');
}

module.exports = {
  PET_STATES, REACHABLE_STATES, INTERACTIONS, UNLOCKS,
  AFFECTION_PER_INTERACTION, ACTION_MS, LEVELUP_MS,
  fmtDate, companionDays,
  normalizeCounters, remainingOf, canInteract, applyInteraction,
  computeState, stateText, stateEmoji, STATE_TEXT, STATE_EMOJI,
  unlocksForLevel, newUnlocks, nextUnlock, levelUpMessage, unlockMessage
};

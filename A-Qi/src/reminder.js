// src/reminder.js
// 阶段 6：阿七健康提醒（纯函数，便于无 GUI 单测）
//
// 规则来自《技术实现规格》§29–31：
//   · 两种提醒与默认间隔：护眼 60 分钟、久坐 90 分钟（连续工作计时）
//     ⚠ V-ming 2026-10-05 验收决定：**取消喝水提醒**，只保留护眼与久坐。
//   · 只在「用户正在工作」且「不处于午休」且「提醒功能开启」时触发（§30）
//   · 提醒不是惩罚：不扣 EXP、不影响等级、不影响考勤、不影响宠物心情（§31）
//
// 关于「连续工作」：传入的 liveMinutes 由 data-store 的 getStatus() 给出，
// 它用 work-time 的区间交集算法计算，**午休 12:00–14:00 已被自然排除**。
//
// 档位法：level = floor(liveMinutes / interval)。
//   同一档位只提醒一次（level > 已记录档位才触发），避免每分钟重复弹。
//   若一次 tick 前进了多档（例如程序刚启动时已经工作很久），只提醒一次并把状态推进到最新档。

const DEFAULTS = { enabled: true, eyeMin: 60, sitMin: 90 };

const ITEMS = [
  { key: 'eye', minKey: 'eyeMin', label: '眼睛休息', emoji: '👀', message: '工作很认真，但眼睛也要休息一下哦 👀' },
  { key: 'sit', minKey: 'sitMin', label: '起身走走', emoji: '🚶', message: '起来走两步啦，你快和椅子融为一体了 🚶' }
];

function positive(v, fallback) {
  const n = Number(v);
  return (isFinite(n) && n > 0) ? n : fallback;
}

// 归一化提醒设置：兼容 settings.json 里的字段名，非法值回退默认
function normalizeSettings(settings) {
  const s = settings || {};
  return {
    enabled: s.remindersEnabled !== false,                 // 默认开启，只有显式 false 才关闭
    eyeMin: positive(s.eyeReminderMin, DEFAULTS.eyeMin),
    sitMin: positive(s.sitReminderMin, DEFAULTS.sitMin)
  };
}

function zeroState() { return { eye: 0, sit: 0 }; }

// 判定本次应当触发的提醒
//   liveMinutes : 当前工作会话的累计实际工作分钟（已排除午休）
//   state       : { eye, sit } 记录各提醒已推进到的档位
// 返回 { due: [{key,label,emoji,message,level,interval,dueAtMin}], state: 新状态 }
function dueReminders(liveMinutes, state, settings) {
  const cfg = normalizeSettings(settings);
  const prev = Object.assign(zeroState(), state || {});

  if (!cfg.enabled) return { due: [], state: prev };        // 关闭时既不触发也不改状态

  const live = Math.max(0, Math.floor(Number(liveMinutes) || 0));
  const next = Object.assign({}, prev);
  const due = [];

  for (const it of ITEMS) {
    const interval = cfg[it.minKey];
    const level = Math.floor(live / interval);
    if (level > (prev[it.key] || 0)) {
      next[it.key] = level;
      due.push({
        key: it.key,
        label: it.label,
        emoji: it.emoji,
        message: it.message,
        level,
        interval,
        dueAtMin: level * interval
      });
    }
  }

  return { due, state: next };
}

// 把到期项合成一句给桌宠气泡的话
function composeMessage(due) {
  const list = due || [];
  if (!list.length) return '';
  if (list.length === 1) return list[0].message;
  const labels = list.map((d) => d.label).join(' / ');
  const emojis = list.map((d) => d.emoji).join('');
  return `该照顾一下自己了：${labels} ${emojis}`;
}

module.exports = {
  DEFAULTS, ITEMS,
  normalizeSettings, zeroState, dueReminders, composeMessage
};

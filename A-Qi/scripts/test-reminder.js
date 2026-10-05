// scripts/test-reminder.js
// 阶段 6 健康提醒纯逻辑测试：默认值/阈值/档位/不重复/多档合并/开关/自定义间隔/文案合成
// V-ming 2026-10-05 验收：**取消喝水提醒**，只保留护眼 60 / 久坐 90。
// 运行：node scripts/test-reminder.js
const rm = require('../src/reminder');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
const keys = (r) => r.due.map((d) => d.key).join(',');

console.log('— 只保留两种提醒（喝水已取消）—');
{
  check('ITEMS 只有 2 项', rm.ITEMS.length === 2, String(rm.ITEMS.length));
  check('ITEMS 为 护眼 + 久坐', rm.ITEMS.map((i) => i.key).join(',') === 'eye,sit', rm.ITEMS.map((i) => i.key).join(','));
  check('默认设置不含 waterMin', rm.normalizeSettings({}).waterMin === undefined);
  check('zeroState 不含 water', !('water' in rm.zeroState()), JSON.stringify(rm.zeroState()));
  // 关键回归：老的 settings.json 里可能还残留 waterReminderMin，必须被忽略
  const withLeftover = rm.normalizeSettings({ waterReminderMin: 1, eyeReminderMin: 60, sitReminderMin: 90 });
  check('残留的 waterReminderMin 被忽略（不产生喝水提醒）',
    !('waterMin' in withLeftover) && keys(rm.dueReminders(600, null, { waterReminderMin: 1 })) === 'eye,sit',
    keys(rm.dueReminders(600, null, { waterReminderMin: 1 })));
}

console.log('— 设置归一化 —');
{
  const d = rm.normalizeSettings({});
  check('默认开启', d.enabled === true);
  check('默认 60 / 90', d.eyeMin === 60 && d.sitMin === 90, JSON.stringify(d));
  check('显式 false 才关闭', rm.normalizeSettings({ remindersEnabled: false }).enabled === false);
  check('true 保持开启', rm.normalizeSettings({ remindersEnabled: true }).enabled === true);
  check('自定义间隔生效',
    rm.normalizeSettings({ eyeReminderMin: 30, sitReminderMin: 45 }).eyeMin === 30
    && rm.normalizeSettings({ eyeReminderMin: 30, sitReminderMin: 45 }).sitMin === 45);
  check('数字字符串也接受', rm.normalizeSettings({ eyeReminderMin: '45' }).eyeMin === 45);
  const bad = rm.normalizeSettings({ eyeReminderMin: 0, sitReminderMin: -5 });
  check('0/负数回退默认', bad.eyeMin === 60 && bad.sitMin === 90, JSON.stringify(bad));
  check('非数字回退默认', rm.normalizeSettings({ eyeReminderMin: 'abc' }).eyeMin === 60);
}

console.log('— 阈值边界 —');
{
  check('0 分钟不提醒', keys(rm.dueReminders(0, null, {})) === '');
  check('59 分钟不提醒', keys(rm.dueReminders(59, null, {})) === '');
  check('60 分钟 → 仅护眼', keys(rm.dueReminders(60, null, {})) === 'eye', keys(rm.dueReminders(60, null, {})));
  check('60.9 分钟（浮点）→ 护眼', keys(rm.dueReminders(60.9, null, {})) === 'eye');
  check('89 分钟 → 仅护眼（久坐还差 1 分钟）', keys(rm.dueReminders(89, null, {})) === 'eye');
  check('90 分钟 → 护眼 + 久坐', keys(rm.dueReminders(90, null, {})) === 'eye,sit');
  check('119 分钟 → 护眼 + 久坐', keys(rm.dueReminders(119, null, {})) === 'eye,sit');
  check('120 分钟 → 护眼下一档 + 久坐（无喝水）', keys(rm.dueReminders(120, null, {})) === 'eye,sit');
  check('负数/非法值不提醒', keys(rm.dueReminders(-10, null, {})) === '' && keys(rm.dueReminders('x', null, {})) === '');
}

console.log('— 档位：同一档位不重复提醒 —');
{
  const r1 = rm.dueReminders(60, null, {});
  check('第一次 60 分钟触发护眼', keys(r1) === 'eye');
  check('状态推进到 eye=1', r1.state.eye === 1, JSON.stringify(r1.state));

  const r2 = rm.dueReminders(60, r1.state, {});
  check('同一分钟再算一次不重复提醒', keys(r2) === '', keys(r2));
  const r3 = rm.dueReminders(119, { eye: 1, sit: 1 }, {});
  check('119 分钟：护眼与久坐都不重复', keys(r3) === '', keys(r3));
  const r4 = rm.dueReminders(120, r1.state, {});
  check('120 分钟 → 护眼下一档 + 久坐', keys(r4) === 'eye,sit', keys(r4));
  check('状态推进为 eye=2,sit=1', r4.state.eye === 2 && r4.state.sit === 1, JSON.stringify(r4.state));

  const r5 = rm.dueReminders(180, r4.state, {});
  check('180 分钟 → 护眼第 3 档 + 久坐第 2 档', keys(r5) === 'eye,sit', keys(r5));
  const eyeDue = r5.due.find((d) => d.key === 'eye');
  check('护眼 dueAtMin = 180', eyeDue && eyeDue.dueAtMin === 180, eyeDue && eyeDue.dueAtMin);
  const r6 = rm.dueReminders(180, r5.state, {});
  check('180 分钟再算一次不重复', keys(r6) === '', keys(r6));
}

console.log('— 一次 tick 跨多档：只报一次但状态推到最新 —');
{
  // 例如程序刚启动、已经工作 200 分钟，状态却还是 0
  const r = rm.dueReminders(200, rm.zeroState(), {});
  check('护眼只报一条（不是 3 条）', r.due.filter((d) => d.key === 'eye').length === 1);
  check('护眼档位一次推到 3', r.state.eye === 3, r.state.eye);
  check('久坐推到 2', r.state.sit === 2, r.state.sit);
  const after = rm.dueReminders(200, r.state, {});
  check('紧接着再算不重复', keys(after) === '', keys(after));
}

console.log('— 开关关闭时不触发也不改状态 —');
{
  const prev = { eye: 2, sit: 1 };
  const r = rm.dueReminders(600, prev, { remindersEnabled: false });
  check('关闭时无提醒', r.due.length === 0);
  check('关闭时状态原样保留', JSON.stringify(r.state) === JSON.stringify(prev), JSON.stringify(r.state));
  const r2 = rm.dueReminders(600, r.state, { remindersEnabled: true });
  check('重新开启后补报（每类只一条）', r2.due.length === 2, keys(r2));
}

console.log('— 自定义间隔 —');
{
  check('护眼 30 分钟：30 分即提醒', keys(rm.dueReminders(30, null, { eyeReminderMin: 30 })) === 'eye');
  check('久坐 20 分钟：20 分即提醒', keys(rm.dueReminders(20, null, { sitReminderMin: 20 })) === 'sit');
  const cfg = { eyeReminderMin: 15, sitReminderMin: 15 };
  check('两项都设 15 分钟：15 分同时提醒', keys(rm.dueReminders(15, null, cfg)) === 'eye,sit');
}

console.log('— 8 小时工作日全量模拟 —');
{
  let state = rm.zeroState();
  const count = { eye: 0, sit: 0 };
  for (let m = 0; m <= 480; m += 1) {          // 模拟每分钟一次 tick
    const r = rm.dueReminders(m, state, {});
    state = r.state;
    r.due.forEach((d) => { count[d.key] += 1; });
  }
  check('8 小时：护眼 8 次（每 60 分钟）', count.eye === 8, count.eye);
  check('8 小时：久坐 5 次（每 90 分钟）', count.sit === 5, count.sit);
  check('合计 13 次（原含喝水为 17 次）', count.eye + count.sit === 13, count.eye + count.sit);
  check('状态终值正确', state.eye === 8 && state.sit === 5, JSON.stringify(state));
  check('状态里没有 water 键', !('water' in state), JSON.stringify(state));
}

console.log('— 文案合成 —');
{
  const one = rm.dueReminders(60, null, {}).due;
  check('单条直接用原文案', rm.composeMessage(one) === '工作很认真，但眼睛也要休息一下哦 👀', rm.composeMessage(one));
  const two = rm.dueReminders(90, null, {}).due;
  const msg = rm.composeMessage(two);
  check('多条合并含两类', /眼睛休息/.test(msg) && /起身走走/.test(msg), msg);
  check('多条合并带 emoji', msg.includes('👀') && msg.includes('🚶'), msg);
  check('合并文案不含喝水', !/喝水/.test(msg), msg);
  check('空数组返回空串', rm.composeMessage([]) === '' && rm.composeMessage(null) === '');
}

console.log('— 纯函数性（不改入参）—');
{
  const state = { eye: 1, sit: 1 };
  const snapshot = JSON.stringify(state);
  const settings = { eyeReminderMin: 60 };
  const sSnap = JSON.stringify(settings);
  rm.dueReminders(500, state, settings);
  check('不修改传入的 state', JSON.stringify(state) === snapshot, JSON.stringify(state));
  check('不修改传入的 settings', JSON.stringify(settings) === sSnap, JSON.stringify(settings));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

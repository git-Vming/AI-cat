// scripts/test-growth.js
// 阶段 7 成长 + 互动测试：状态机 / 好感度 / 每日上限 / 解锁 / 升级文案 / 数据层联动
// 核心红线验证：**互动绝不产生 EXP**
// 运行：node scripts/test-growth.js
const os = require('os');
const fs = require('fs');
const path = require('path');
const g = require('../src/growth');
const ds = require('../src/data-store');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ===== 纯逻辑 =====
console.log('— 陪伴天数 —');
{
  check('同一天 → 1 天', g.companionDays('2026-10-05', '2026-10-05') === 1);
  check('10-03 → 10-05 → 3 天', g.companionDays('2026-10-03', '2026-10-05') === 3, g.companionDays('2026-10-03', '2026-10-05'));
  check('跨月 09-30 → 10-02 → 3 天', g.companionDays('2026-09-30', '2026-10-02') === 3);
  check('非法日期回退 1 天', g.companionDays('bad', '2026-10-05') === 1);
}

console.log('— 互动计数器（跨天归零）—');
{
  const c1 = g.normalizeCounters(null, '2026-10-05');
  check('空值 → 当天空计数', c1.date === '2026-10-05' && Object.keys(c1.counts).length === 0, JSON.stringify(c1));

  const c2 = g.normalizeCounters({ date: '2026-10-04', counts: { pat: 5 } }, '2026-10-05');
  check('跨天自动归零', c2.date === '2026-10-05' && !c2.counts.pat, JSON.stringify(c2));

  const c3 = g.normalizeCounters({ date: '2026-10-05', counts: { pat: 2, feed: -3, play: 'x' } }, '2026-10-05');
  check('非法计数被清理为 0', c3.counts.pat === 2 && c3.counts.feed === 0 && c3.counts.play === 0, JSON.stringify(c3.counts));
}

console.log('— 剩余次数与上限 —');
{
  const c = g.normalizeCounters(null, '2026-10-05');
  check('初始：摸头剩 5 次', g.remainingOf(c, 'pat') === 5, g.remainingOf(c, 'pat'));
  check('初始：喂食剩 3 次', g.remainingOf(c, 'feed') === 3);
  check('未知动作剩余 0', g.remainingOf(c, 'hack') === 0);
  check('未知动作不可互动', g.canInteract(c, 'hack') === false);

  let cur = c;
  for (let i = 0; i < 5; i += 1) {
    const r = g.applyInteraction(cur, 'pat', '2026-10-05');
    check(`第 ${i + 1} 次摸头成功`, r.ok === true);
    cur = r.counters;
  }
  check('摸头用完 5 次后剩 0', g.remainingOf(cur, 'pat') === 0);
  const r6 = g.applyInteraction(cur, 'pat', '2026-10-05');
  check('第 6 次摸头被拒（每日上限）', r6.ok === false && r6.reason === 'daily_limit', JSON.stringify(r6));
  check('被拒时计数器不变', g.remainingOf(r6.counters, 'pat') === 0);

  const bad = g.applyInteraction(c, 'nope', '2026-10-05');
  check('未知动作被拒', bad.ok === false && bad.reason === 'unknown_action');

  const snap = JSON.stringify(c);
  g.applyInteraction(c, 'water', '2026-10-05');
  check('不修改传入的计数器（纯函数）', JSON.stringify(c) === snap);
}

console.log('— 宠物状态机 —');
{
  const noon = new Date(2026, 9, 5, 14, 0, 0);      // 白天
  const night = new Date(2026, 9, 5, 23, 30, 0);    // 夜间
  const iso = (d) => d.toISOString();

  check('气泡显示中 → REMINDING', g.computeState({ bubbleShown: true }, noon) === 'REMINDING');
  check('工作中 → WORKING', g.computeState({ working: true }, noon) === 'WORKING');
  check('工作中优先于互动状态', g.computeState({ working: true, lastAction: 'pat', lastActionAt: iso(noon) }, noon) === 'WORKING');
  check('白天空闲 → IDLE', g.computeState({}, noon) === 'IDLE');
  check('夜间（23:30）→ SLEEP', g.computeState({}, night) === 'SLEEP');
  check('凌晨 3 点 → SLEEP', g.computeState({}, new Date(2026, 9, 5, 3, 0, 0)) === 'SLEEP');
  check('6 点整 → IDLE（不再睡）', g.computeState({}, new Date(2026, 9, 5, 6, 0, 0)) === 'IDLE');

  const just = new Date(noon.getTime() - 3000).toISOString();
  check('刚摸头 → HAPPY', g.computeState({ lastAction: 'pat', lastActionAt: just }, noon) === 'HAPPY');
  check('刚喂食 → EATING', g.computeState({ lastAction: 'feed', lastActionAt: just }, noon) === 'EATING');
  check('刚喂水 → DRINKING', g.computeState({ lastAction: 'water', lastActionAt: just }, noon) === 'DRINKING');
  check('刚玩耍 → HAPPY', g.computeState({ lastAction: 'play', lastActionAt: just }, noon) === 'HAPPY');

  const old = new Date(noon.getTime() - (g.ACTION_MS + 5000)).toISOString();
  check('互动超时后回到 IDLE', g.computeState({ lastAction: 'pat', lastActionAt: old }, noon) === 'IDLE');

  const lvOld = new Date(noon.getTime() - (g.LEVELUP_MS - 1000)).toISOString();
  check('升级 20 秒内 → HAPPY', g.computeState({ lastAction: 'levelup', lastActionAt: lvOld }, noon) === 'HAPPY');
  const lvExpired = new Date(noon.getTime() - (g.LEVELUP_MS + 1000)).toISOString();
  check('升级超时 → IDLE', g.computeState({ lastAction: 'levelup', lastActionAt: lvExpired }, noon) === 'IDLE');

  check('所有可达状态都有文案', g.REACHABLE_STATES.every((s) => !!g.stateText(s) && !!g.stateEmoji(s)));
  check('状态清单含规格要求的 9 种', g.PET_STATES.length === 9 && g.PET_STATES.includes('WALK') && g.PET_STATES.includes('SAD'));
}

console.log('— 升级解锁 —');
{
  check('Lv.1 什么都不解锁', g.unlocksForLevel(1).length === 0);
  check('Lv.2 解锁帽子', g.unlocksForLevel(2).map((u) => u.id).join(',') === 'hat');
  check('Lv.4 解锁帽子/衣服/水杯',
    g.unlocksForLevel(4).map((u) => u.id).join(',') === 'hat,clothes,cup', g.unlocksForLevel(4).map((u) => u.id).join(','));
  check('Lv.9 解锁全部 8 件', g.unlocksForLevel(9).length === 8, g.unlocksForLevel(9).length);
  check('Lv.99 仍是 8 件', g.unlocksForLevel(99).length === 8);
  check('非法等级按 Lv.1 处理', g.unlocksForLevel('x').length === 0);

  check('newUnlocks：Lv.3 且已有 hat → 只剩衣服',
    g.newUnlocks(3, ['hat']).map((u) => u.id).join(',') === 'clothes');
  check('newUnlocks：全部已有时为空', g.newUnlocks(3, ['hat', 'clothes']).length === 0);

  check('nextUnlock：Lv.3 → 水杯(Lv.4)', g.nextUnlock(3) && g.nextUnlock(3).id === 'cup');
  check('nextUnlock：满级 → null', g.nextUnlock(9) === null);

  check('升级文案含等级', g.levelUpMessage(4).includes('Lv.4'));
  check('解锁文案含道具名', g.unlockMessage([{ name: '帽子', emoji: '🎩' }]).includes('帽子'));
  check('空解锁文案为空串', g.unlockMessage([]) === '' && g.unlockMessage(null) === '');
}

// ===== 数据层联动 =====
function newRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'aqi-growth-'));
  ds.ensureDataLayer(r);
  return r;
}
function petOf(r) { return ds.readJson(path.join(r, 'data', 'pet.json'), {}); }
function statsOf(r) { return ds.readJson(path.join(r, 'data', 'statistics.json'), {}); }
function rm(r) { fs.rmSync(r, { recursive: true, force: true }); }

console.log('— 数据层：互动只加好感度，绝不加 EXP（核心红线）—');
{
  const r = newRoot();
  const before = petOf(r);
  check('初始好感度 0', before.affection === 0 && before.interactionCount === 0);

  const r1 = ds.interact(r, 'pat');
  check('互动成功', r1.ok === true, JSON.stringify(r1));
  check('好感度 +1', r1.affection === 1, r1.affection);
  check('互动总次数 +1', r1.interactionCount === 1);
  check('返回的状态为 HAPPY（摸头）', r1.state === 'HAPPY', r1.state);
  check('文案非空', !!r1.message);

  const p = petOf(r);
  check('pet.totalExp 仍为 0（互动不产生 EXP）', (p.totalExp || 0) === 0, p.totalExp);
  check('statistics.totalExp 仍为 0', (statsOf(r).totalExp || 0) === 0);
  check('pet.level 仍为 Lv.1', (p.level || 1) === 1, p.level);

  const r2 = ds.interact(r, 'unknown');
  check('未知动作被拒', r2.ok === false && r2.reason === 'unknown_action');
  rm(r);
}

console.log('— 数据层：每日上限与跨天重置 —');
{
  const r = newRoot();
  for (let i = 0; i < 5; i += 1) ds.interact(r, 'pat');
  const over = ds.interact(r, 'pat');
  check('第 6 次摸头被拒', over.ok === false && over.reason === 'daily_limit');
  check('好感度停在 5', petOf(r).affection === 5, petOf(r).affection);

  // 模拟跨天：把计数日期改成昨天
  const p = petOf(r);
  p.interactionsToday = { date: '2026-01-01', counts: { pat: 5 } };
  ds.writeJson(path.join(r, 'data', 'pet.json'), p);
  const r3 = ds.interact(r, 'pat');
  check('跨天后重新可用', r3.ok === true, JSON.stringify(r3));
  check('跨天后好感度累加到 6', petOf(r).affection === 6, petOf(r).affection);
  rm(r);
}

console.log('— 数据层：等级提升自动解锁（只增不减）—');
{
  const r = newRoot();
  const day = (d) => ({ date: d, start: '08:00', end: '18:00' });   // 480 分钟 = 80 EXP

  const res = ds.repairAttendance(r, day('2026-09-28'));            // 80 EXP → Lv.2
  check('补录 480 分钟后到达 Lv.2', res.pet.level === 2, res.pet.level);
  check('Lv.2 自动解锁帽子', res.pet.unlockedItems.includes('hat'), JSON.stringify(res.pet.unlockedItems));
  check('返回 newUnlocks 含帽子', (res.newUnlocks || []).some((u) => u.id === 'hat'));
  check('levelUp = true', res.levelUp === true);

  const res2 = ds.repairAttendance(r, day('2026-09-29'));           // 160 EXP → Lv.3
  check('第二天到达 Lv.3', res2.pet.level === 3, res2.pet.level);
  check('Lv.3 解锁帽子+衣服', res2.pet.unlockedItems.slice().sort().join(',') === 'clothes,hat',
    JSON.stringify(res2.pet.unlockedItems));

  const res3 = ds.repairAttendance(r, day('2026-09-30'));           // 240 EXP → Lv.4
  check('第三天到达 Lv.4', res3.pet.level === 4, res3.pet.level);
  check('Lv.4 自动补上水杯', res3.pet.unlockedItems.includes('cup'), JSON.stringify(res3.pet.unlockedItems));
  check('newUnlocks 只报新增的水杯（不重复报旧的）',
    res3.newUnlocks.map((u) => u.id).join(',') === 'cup', JSON.stringify(res3.newUnlocks.map((u) => u.id)));

  // 删掉一条记录 → 等级降回 Lv.3；已解锁道具**不回收**
  const att = ds.readJson(path.join(r, 'data', 'attendance.json'), {});
  delete att['2026-09-30'];
  ds.writeJson(path.join(r, 'data', 'attendance.json'), att);
  const rc2 = ds.recomputeAll(r);
  check('删除记录后降回 Lv.3', rc2.pet.level === 3, rc2.pet.level);
  check('降级后已解锁道具不回收（养成不倒退）', rc2.pet.unlockedItems.includes('cup'),
    JSON.stringify(rc2.pet.unlockedItems));
  check('降级不产生 newUnlocks', rc2.newUnlocks.length === 0);
  check('levelUp = false（等级下降）', rc2.levelUp === false);
  rm(r);
}

console.log('— 数据层：getGrowth 面板数据 —');
{
  const r = newRoot();
  ds.interact(r, 'feed');
  const d = ds.getGrowth(r);
  check('含等级/好感度/陪伴天数', d.level === 1 && d.affection === 1 && d.companionDays >= 1,
    JSON.stringify({ lv: d.level, aff: d.affection, days: d.companionDays }));
  check('含 4 个互动动作与剩余次数', d.actions.length === 4 && d.actions[0].remaining === 5, JSON.stringify(d.actions.map((a) => a.key + ':' + a.remaining)));
  check('喂食后剩余 2 次', d.actions.find((a) => a.key === 'feed').remaining === 2);
  check('含全部道具清单（未解锁也列出）', d.unlockList.length === 8);
  check('下一件解锁为帽子(Lv.2)', d.nextUnlock && d.nextUnlock.id === 'hat', JSON.stringify(d.nextUnlock));
  rm(r);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

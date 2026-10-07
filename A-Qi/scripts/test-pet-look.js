// scripts/test-pet-look.js
// 目的：验证「原画显示逻辑」（src/pet-look.js）是纯函数、优先级正确、脏数据不崩，
//   并且它引用的每一张原画都真的存在（防止"逻辑对了但图没打包"）。
//
// 对应 PM 2026-10-07 的要求：为《阿七形象资产》的
//   表情设定 / 基础动作 / 场景互动 三套图写显示逻辑（什么时候显示哪一张）。
//
// 运行：node scripts/test-pet-look.js
const fs = require('fs');
const path = require('path');
const pl = require('../src/pet-look');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('— 三套原画清单 —');
check('动作 8 张', pl.POSES.length === 8 && pl.POSES.indexOf('sit') >= 0, JSON.stringify(pl.POSES));
check('表情 8 张', pl.MOODS.length === 8 && pl.MOODS.indexOf('normal') >= 0, JSON.stringify(pl.MOODS));
check('场景 4 张', pl.SCENES.length === 4 && pl.SCENES.indexOf('work') >= 0, JSON.stringify(pl.SCENES));

console.log('— 桌面本体：动作选择（pickPose）—');
check('默认（IDLE）→ 坐着', pl.pickPose({ state: 'IDLE' }) === 'sit');
check('上工中（WORKING）→ 坐着（动作集无"看电脑"全身姿势）', pl.pickPose({ state: 'WORKING' }) === 'sit');
check('互动·喂点吃的（EATING）→ 吃东西', pl.pickPose({ state: 'EATING' }) === 'eat');
check('互动·给它喝水（DRINKING）→ 喝水', pl.pickPose({ state: 'DRINKING' }) === 'drink');
check('护眼/久坐提醒中（REMINDING）→ 伸懒腰', pl.pickPose({ state: 'REMINDING' }) === 'stretch');
check('夜间（SLEEP）→ 睡觉', pl.pickPose({ state: 'SLEEP' }) === 'sleep');
check('★午休时段（lunch）→ 睡觉（PM 指定）', pl.pickPose({ state: 'IDLE', lunch: true }) === 'sleep');
check('摸头/玩耍后（HAPPY）→ 走路', pl.pickPose({ state: 'HAPPY' }) === 'walk');
check('今日已下工（completedToday）→ 趴着', pl.pickPose({ state: 'IDLE', completedToday: true }) === 'lie');
check('升级瞬间（celebrate）→ 升级（冒星星）', pl.pickPose({ state: 'HAPPY', celebrate: true }) === 'levelup');

console.log('— 动作优先级（越特殊越优先）—');
check('升级 > 吃东西', pl.pickPose({ state: 'EATING', celebrate: true }) === 'levelup');
check('吃东西 > 午休睡觉', pl.pickPose({ state: 'EATING', lunch: true }) === 'eat');
check('喝水 > 午休睡觉', pl.pickPose({ state: 'DRINKING', lunch: true }) === 'drink');
check('提醒 > 上工中', pl.pickPose({ state: 'WORKING', lunch: false }) === 'sit'
  && pl.pickPose({ state: 'REMINDING' }) === 'stretch');

console.log('— 动作：脏数据 / 空输入不崩 —');
check('空参数 → sit', pl.pickPose() === 'sit');
check('undefined → sit', pl.pickPose(undefined) === 'sit');
check('乱状态 → sit', pl.pickPose({ state: 'WHAT' }) === 'sit');
check('真值 lunch 即使不是布尔也按午休处理', pl.pickPose({ state: 'IDLE', lunch: 'yes' }) === 'sleep');
check('假值 celebrate 不触发升级', pl.pickPose({ state: 'IDLE', celebrate: 0 }) === 'sit');

console.log('— 心情头像：表情选择（pickMood）—');
check('提醒中 → 惊讶', pl.pickMood({ state: 'REMINDING' }) === 'surprise');
check('没精神（SAD）→ 难过', pl.pickMood({ state: 'SAD' }) === 'sad');
check('午休 → 困倦', pl.pickMood({ state: 'IDLE', lunch: true }) === 'sleepy');
check('夜间 → 困倦', pl.pickMood({ state: 'SLEEP' }) === 'sleepy');
check('★刚被摸头（lastAction=pat）→ 害羞', pl.pickMood({ state: 'HAPPY', lastAction: 'pat' }) === 'shy');
check('开心（HAPPY）→ 开心', pl.pickMood({ state: 'HAPPY' }) === 'happy');
check('吃东西 → 开心', pl.pickMood({ state: 'EATING' }) === 'happy');
check('喝水 → 开心', pl.pickMood({ state: 'DRINKING' }) === 'happy');
check('有忘记打卡没补 → 生气', pl.pickMood({ state: 'IDLE', repairPending: true }) === 'angry');
check('上工中 → 正常脸', pl.pickMood({ state: 'WORKING' }) === 'normal');
check('待机 → 歪头', pl.pickMood({ state: 'IDLE' }) === 'tilt');
check('空参数 → 歪头（待机默认）', pl.pickMood() === 'tilt');

console.log('— 心情优先级 —');
check('提醒中优先于"忘记打卡生气"',
  pl.pickMood({ state: 'REMINDING', repairPending: true }) === 'surprise');
check('被摸头优先于普通开心',
  pl.pickMood({ state: 'HAPPY', lastAction: 'pat' }) === 'shy');
check('午休优先于待机歪头',
  pl.pickMood({ state: 'IDLE', lunch: true }) === 'sleepy');
check('8 种心情都能被某个上下文取到（不浪费原画）', (function () {
  const seen = {};
  seen[pl.pickMood({ state: 'WORKING' })] = 1;
  seen[pl.pickMood({ state: 'HAPPY' })] = 1;
  seen[pl.pickMood({ state: 'REMINDING' })] = 1;
  seen[pl.pickMood({ state: 'HAPPY', lastAction: 'pat' })] = 1;
  seen[pl.pickMood({ state: 'SLEEP' })] = 1;
  seen[pl.pickMood({ state: 'IDLE', repairPending: true })] = 1;
  seen[pl.pickMood({ state: 'SAD' })] = 1;
  seen[pl.pickMood({ state: 'IDLE' })] = 1;
  return Object.keys(seen).length === 8;
})());

console.log('— 当前场景：场景选择（pickScene）—');
check('上工中 → 工作陪伴', pl.pickScene({ state: 'WORKING' }) === 'work');
check('吃东西 → 吃东西场景', pl.pickScene({ state: 'EATING' }) === 'eat');
check('喝水 → 喝水场景', pl.pickScene({ state: 'DRINKING' }) === 'drink');
check('待机/休息/提醒 → 伸懒腰场景', pl.pickScene({ state: 'IDLE' }) === 'stretch'
  && pl.pickScene({ state: 'REMINDING' }) === 'stretch'
  && pl.pickScene({ state: 'SLEEP' }) === 'stretch');
check('空参数 → stretch（等同待机）', pl.pickScene() === 'stretch');
check('4 种场景都能被取到', (function () {
  const s = new Set([
    pl.pickScene({ state: 'WORKING' }), pl.pickScene({ state: 'EATING' }),
    pl.pickScene({ state: 'DRINKING' }), pl.pickScene({ state: 'IDLE' })
  ]);
  return s.size === 4;
})());

console.log('— 文件名映射 + 非法名回退 —');
check('poseFile 正常', pl.poseFile('eat') === 'pose_eat.png');
check('poseFile 非法 → pose_sit.png', pl.poseFile('nope') === 'pose_sit.png');
check('moodFile 正常', pl.moodFile('shy') === 'expr_shy.png');
check('moodFile 非法 → expr_normal.png', pl.moodFile('nope') === 'expr_normal.png');
check('sceneFile 正常', pl.sceneFile('drink') === 'scene_drink.png');
check('sceneFile 非法 → scene_work.png', pl.sceneFile('nope') === 'scene_work.png');

console.log('— 原画文件真的都在（防止"逻辑对了但图没打包"）—');
{
  const dir = path.join(__dirname, '..', 'assets', 'pet');
  const missing = [];
  pl.POSES.forEach((n) => { if (!fs.existsSync(path.join(dir, pl.poseFile(n)))) missing.push(pl.poseFile(n)); });
  pl.MOODS.forEach((n) => { if (!fs.existsSync(path.join(dir, pl.moodFile(n)))) missing.push(pl.moodFile(n)); });
  pl.SCENES.forEach((n) => { if (!fs.existsSync(path.join(dir, pl.sceneFile(n)))) missing.push(pl.sceneFile(n)); });
  check('8 动作 + 8 表情 + 4 场景 = 20 张原画全部存在', missing.length === 0, missing.join(', '));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

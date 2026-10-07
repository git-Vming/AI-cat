/**
 * 阿七「看哪张原画」的显示逻辑（纯函数，可单测）
 *
 * 2026-10-07 新增。三套原画各司其职：
 *   · 动作设定（全身 8 张）  → **桌面宠物本体**的动作
 *   · 表情设定（半身 8 张）  → **心情头像**（宠物状态窗、菜单顶栏）
 *   · 场景互动（带场景 4 张）→ **宠物状态窗顶部的"当前场景"插图**
 *
 * 为什么这样分：
 *   表情那 8 张是拼版图里被裁到胸口的**半身像**，动作那 8 张是**全身**；
 *   两者混在桌面上用，切换时猫的大小会"突变"，所以桌面只走动作图。
 *   场景图自带方形背景、又抠不出单体，贴在桌面上会像贴了一张卡片，故放进窗口里用。
 *
 * 设计原则：**只做事件驱动，不做随机**。
 *   PM 明确反馈过"动作都是一些抖动" —— 所以这里没有任何随机/轮询，
 *   每一张图的出现都对应一个明确的时机（午休、提醒、互动、升级、下工…）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PetLook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const POSES = ['sit', 'walk', 'lie', 'sleep', 'stretch', 'drink', 'eat', 'levelup'];
  const MOODS = ['normal', 'happy', 'surprise', 'shy', 'sleepy', 'angry', 'sad', 'tilt'];
  const SCENES = ['work', 'stretch', 'drink', 'eat'];

  /**
   * 桌面本体显示哪个动作。
   * @param {{state?:string, lunch?:boolean, completedToday?:boolean, celebrate?:boolean}} [ctx]
   *   state        主进程 growth.computeState 的结果
   *   lunch        是否处于工作日午休（12:00–14:00）
   *   completedToday 今日是否已下工
   *   celebrate    是否刚升级（20 秒内）
   * @returns {string} POSES 之一
   */
  function pickPose(ctx) {
    const c = ctx || {};
    const st = c.state;
    // 按优先级从"最特殊"到"最普通"
    if (c.celebrate) return 'levelup';         // 升级：冒黄绿星星
    if (st === 'EATING') return 'eat';         // 互动·喂点吃的
    if (st === 'DRINKING') return 'drink';     // 互动·给它喝水
    if (st === 'REMINDING') return 'stretch';  // 护眼/久坐提醒中 → 该起来活动了
    if (st === 'SLEEP') return 'sleep';        // 夜间 22:00–06:00
    if (c.lunch) return 'sleep';               // 工作日午休 12:00–14:00（PM 指定）
    if (st === 'HAPPY') return 'walk';         // 摸头/玩耍后 → 开心地溜达
    if (st === 'WORKING') return 'sit';        // 上工中（动作集里没有"看电脑"全身姿势）
    if (c.completedToday) return 'lie';        // 今日已下工 → 趴着歇会儿
    return 'sit';                              // 其余（待机）
  }

  /**
   * 心情头像用哪张表情。
   * @param {{state?:string, lunch?:boolean, lastAction?:string, repairPending?:boolean}} [ctx]
   */
  function pickMood(ctx) {
    const c = ctx || {};
    const st = c.state;
    if (st === 'REMINDING') return 'surprise';          // 正在提醒你
    if (st === 'SAD') return 'sad';                     // 没精神
    if (c.lunch || st === 'SLEEP') return 'sleepy';     // 午休 / 夜间
    if (c.lastAction === 'pat') return 'shy';           // 刚被摸头 → 害羞
    if (st === 'HAPPY' || st === 'EATING' || st === 'DRINKING') return 'happy';
    if (c.repairPending) return 'angry';                // 有忘记打卡没处理 → 有点生气
    if (st === 'WORKING') return 'normal';              // 工作时专注脸
    return 'tilt';                                      // 待机：歪着头看你
  }

  /**
   * 宠物状态窗顶部的"当前场景"插图。
   * @param {{state?:string}} [ctx]
   */
  function pickScene(ctx) {
    const st = (ctx || {}).state;
    if (st === 'EATING') return 'eat';
    if (st === 'DRINKING') return 'drink';
    if (st === 'WORKING') return 'work';
    return 'stretch';                                   // 待机 / 休息 / 提醒 → 放松伸展
  }

  // 资源文件名（与 A-Qi/assets/pet/ 下的实际文件名一致）
  function poseFile(name) { return 'pose_' + (POSES.indexOf(name) >= 0 ? name : 'sit') + '.png'; }
  function moodFile(name) { return 'expr_' + (MOODS.indexOf(name) >= 0 ? name : 'normal') + '.png'; }
  function sceneFile(name) { return 'scene_' + (SCENES.indexOf(name) >= 0 ? name : 'work') + '.png'; }

  return { POSES, MOODS, SCENES, pickPose, pickMood, pickScene, poseFile, moodFile, sceneFile };
});

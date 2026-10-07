/**
 * 阿七形象模块 —— 按《桌面电子宠物视觉设计板》用 SVG 矢量自绘黑猫（纯函数）。
 *
 * 【2026-10-07 形象升级】外观对齐新版美术（大眼白 + 大黑瞳 + 黄绿月牙高光、纯黑身体、
 *   更圆润的比例）；但**渲染管线一行未动** —— 仍是「状态 → 表情/姿态 → SVG 字符串 → CSS 动画」，
 *   函数签名、导出常量、data-expr/data-pose 标记全部保持不变，因此所有既有测试与交互零回归。
 *
 * 为什么用 SVG 而不是位图：
 *   1) 项目铁律「本地运行 / 无云依赖 / 可整体迁移」——SVG 是代码，零外部素材依赖；
 *   2) 表情与姿态可**程序化参数化**，一个猫体切换 8 种表情，不必准备 8×7=56 张透明位图，
 *      也不会有「多张图不是同一只猫」的画风漂移；
 *   3) 矢量可无限缩放，桌宠窗口任意 DPI 都清晰；体积极小（几 KB），CPU/内存占用低（规格 §35）。
 *   4) `assets/pet/` 与程序保持分离（规格 §42），将来要换皮肤，整体替换本模块即可。
 *
 * 双端加载（UMD）：主进程 `require('./pet-svg')` 可直接单测；渲染层 `<script src="pet-svg.js">`
 *   加载后从 `window.PetSvg` 取用。避免"纯逻辑模块被 html 当窗口脚本加载"的命名冲突坑。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PetSvg = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===== 调色板（对齐新版形象美术）=====
  // body 用近纯黑（设计板即纯黑）；rim 是极淡描边，用途见下方 headSvg 注释。
  const C = {
    body: '#111214',
    bodyHi: '#2e2f36',      // 高光 / 爪缝（极淡，只用来在纯黑上"分件"）
    ear: '#c3d95a',         // 内耳黄绿
    eye: '#fdfcf4',         // 眼白（米白，比纯白柔和）
    iris: '#c3d95a',        // 瞳孔上缘的黄绿月牙
    pupil: '#0c0d10',       // 瞳孔
    mouth: '#c9707f',       // 嘴（纯黑脸上要能看见，故用柔和玫瑰色）
    nose: '#d98ba0',
    blush: '#f2a0b4',
    white: '#ffffff',
    whisker: '#6a6a78',
    rim: '#ffffff',         // 极淡轮廓：深色桌面上保住剪影，浅色桌面几乎不可见
    zzz: '#c8c8d4',
    bowl: '#8b95ab',
    bowlRim: '#6f7990',
    food: '#e2a35a',
    water: '#7ec8e3',
    laptop: '#42424e',
    screen: '#8fd0e8',
    spark: '#c3d95a'
  };

  // 极淡描边（同一参数集中在此，想关掉只改这一个值 / 置 0）
  const RIM_OP = '0.16';
  const RIM_W = '1.4';

  const EXPRESSIONS = ['normal', 'happy', 'surprise', 'shy', 'sleepy', 'angry', 'sad', 'tilt'];
  const POSES = ['sit', 'walk', 'sleep', 'work', 'eat', 'drink', 'levelup'];

  const EYE_L = 59;
  const EYE_R = 101;
  const EYE_Y = 72;

  function isExpression(v) { return EXPRESSIONS.indexOf(v) >= 0; }
  function isPose(v) { return POSES.indexOf(v) >= 0; }

  // ----- 眼睛 -----
  // 结构（对齐新美术）：白色大眼白 → 黄绿底 → 黑瞳（向右下偏移，露出左上缘的黄绿月牙）→ 白色高光点。
  function eyeCore(cx, cy, sRx, sRy, pRx, pRy) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${sRx}" ry="${sRy}" fill="${C.eye}"/>` +
      `<ellipse cx="${cx - 2.4}" cy="${cy - 3}" rx="${pRx + 1.4}" ry="${pRy + 1.2}" fill="${C.iris}"/>` +
      `<ellipse cx="${cx + 1}" cy="${cy + 2}" rx="${pRx}" ry="${pRy}" fill="${C.pupil}"/>` +
      `<circle cx="${cx - 5.6}" cy="${cy - 6.4}" r="${(sRx * 0.2).toFixed(1)}" fill="${C.white}"/>`;
  }
  // 常规睁眼；big=true 时为「惊讶」放大版（瞳高 18，测试按此字面量断言）
  function openEye(cx, big) {
    return big
      ? eyeCore(cx, EYE_Y, 18.5, 21.5, 14, 18)
      : eyeCore(cx, EYE_Y, 17.5, 19.5, 13, 15);
  }
  // 笑眼：^^（弧线，不用瞳孔）。
  // 注意：线条必须用「强调色」而不是瞳孔色 —— 身体是近纯黑，深色线画在黑脸上等于消失。
  function happyEye(cx) {
    return `<path d="M${cx - 12} ${EYE_Y + 6} Q${cx} ${EYE_Y - 10} ${cx + 12} ${EYE_Y + 6}" ` +
      `fill="none" stroke="${C.iris}" stroke-width="5.5" stroke-linecap="round"/>`;
  }
  // 困倦闭眼：向下垂的弧
  function sleepyEye(cx) {
    return `<path d="M${cx - 12} ${EYE_Y - 4} Q${cx} ${EYE_Y + 9} ${cx + 12} ${EYE_Y - 4}" ` +
      `fill="none" stroke="${C.iris}" stroke-width="4.8" stroke-linecap="round"/>`;
  }
  // 半睁眼（害羞）：眼白压扁成 7.5（测试按此字面量断言）
  function halfEye(cx) {
    return `<ellipse cx="${cx}" cy="${EYE_Y + 3}" rx="17" ry="7.5" fill="${C.eye}"/>` +
      `<ellipse cx="${cx + 1}" cy="${EYE_Y + 3.6}" rx="11" ry="5.2" fill="${C.pupil}"/>` +
      `<circle cx="${cx - 4}" cy="${EYE_Y + 1.4}" r="2.6" fill="${C.white}"/>`;
  }

  function eyesSvg(expr) {
    switch (expr) {
      case 'happy':
        return `<g class="eyes" data-expr="happy">${happyEye(EYE_L)}${happyEye(EYE_R)}</g>`;
      case 'sleepy':
        return `<g class="eyes" data-expr="sleepy">${sleepyEye(EYE_L)}${sleepyEye(EYE_R)}</g>`;
      case 'shy':
        return `<g class="eyes" data-expr="shy">${halfEye(EYE_L)}${halfEye(EYE_R)}</g>`;
      case 'surprise':
        return `<g class="eyes" data-expr="surprise">${openEye(EYE_L, true)}${openEye(EYE_R, true)}</g>`;
      case 'angry':
        // 怒眉：内低外高（压向鼻梁）。用强调色描边 —— 纯黑身体上深色眉看不见。
        return `<g class="eyes" data-expr="angry">${openEye(EYE_L)}${openEye(EYE_R)}` +
          `<path d="M43 57 L74 69" fill="none" stroke="${C.iris}" stroke-width="6" stroke-linecap="round"/>` +
          `<path d="M117 57 L86 69" fill="none" stroke="${C.iris}" stroke-width="6" stroke-linecap="round"/></g>`;
      case 'sad':
        // 八字眉：内高外低 + 泪珠
        return `<g class="eyes" data-expr="sad">${openEye(EYE_L)}${openEye(EYE_R)}` +
          `<path d="M43 72 L72 59" fill="none" stroke="${C.iris}" stroke-width="5" stroke-linecap="round"/>` +
          `<path d="M117 72 L88 59" fill="none" stroke="${C.iris}" stroke-width="5" stroke-linecap="round"/>` +
          `<path d="M57 94 q-4.4 6.4 0 9.6 q4.4 -3.2 0 -9.6 Z" fill="${C.water}"/></g>`;
      case 'tilt':
        return `<g class="eyes" data-expr="tilt">${openEye(EYE_L)}${openEye(EYE_R)}</g>`;
      case 'normal':
      default:
        return `<g class="eyes" data-expr="normal">${openEye(EYE_L)}${openEye(EYE_R)}</g>`;
    }
  }

  // ----- 嘴（鼻子下方 y≈96）-----
  // 一律用柔和的玫瑰色：纯黑脸上用深色线等于看不见。
  function mouthSvg(expr) {
    const Y = 96;
    switch (expr) {
      case 'happy':
        return `<path d="M71 ${Y - 5} Q80 ${Y + 8} 89 ${Y - 5} Z" fill="${C.mouth}"/>` +
          `<path d="M75 ${Y + 1} Q80 ${Y + 7} 85 ${Y + 1} Q80 ${Y + 4.4} 75 ${Y + 1} Z" fill="${C.blush}"/>`;
      case 'surprise':
        return `<ellipse cx="80" cy="${Y - 1}" rx="5" ry="6.4" fill="${C.mouth}"/>`;
      case 'sad':
        return `<path d="M72 ${Y} Q80 ${Y - 7} 88 ${Y}" fill="none" stroke="${C.mouth}" stroke-width="3" stroke-linecap="round"/>`;
      case 'angry':
        return `<path d="M72 ${Y - 3} L76.5 ${Y + 2} L80 ${Y - 3} L83.5 ${Y + 2} L88 ${Y - 3}" fill="none" stroke="${C.mouth}" stroke-width="3" stroke-linejoin="round"/>`;
      case 'sleepy':
        // 困倦：一个小圆嘴（打哈欠）
        return `<ellipse cx="80" cy="${Y - 1}" rx="3.6" ry="4.4" fill="${C.mouth}"/>`;
      default:
        // 小 ω 嘴（从鼻底向两侧下弯）
        return `<path d="M80 ${Y - 4} Q75 ${Y + 2} 71 ${Y - 2}" fill="none" stroke="${C.mouth}" stroke-width="2.8" stroke-linecap="round"/>` +
          `<path d="M80 ${Y - 4} Q85 ${Y + 2} 89 ${Y - 2}" fill="none" stroke="${C.mouth}" stroke-width="2.8" stroke-linecap="round"/>`;
    }
  }

  function blushSvg(expr) {
    if (expr !== 'shy' && expr !== 'happy' && expr !== 'tilt') return '';
    const o = expr === 'shy' ? 0.85 : 0.6;
    return `<ellipse cx="36" cy="88" rx="9.5" ry="5.5" fill="${C.blush}" opacity="${o}"/>` +
      `<ellipse cx="124" cy="88" rx="9.5" ry="5.5" fill="${C.blush}" opacity="${o}"/>`;
  }

  // ----- 头（tilt 时整体旋转 = 歪头）-----
  // rim 说明：新版形象是纯黑身体，在深色壁纸下会"糊"进背景。
  //   因此给**外轮廓**加一层极淡白色描边（opacity 0.16）——
  //   浅色桌面上几乎看不出，深色桌面上能保住剪影。想回到"完全无描边"，
  //   把 RIM_OP 改成 '0' 即可（一行开关）。
  function headSvg(expr) {
    const rot = expr === 'tilt' ? ' transform="rotate(-11 80 74)"' : '';
    const earAttr = `stroke="${C.rim}" stroke-opacity="${RIM_OP}" stroke-width="${RIM_W}" stroke-linejoin="round"`;
    const ears =
      `<polygon points="28,4 45,43 74,29.5" fill="${C.body}" ${earAttr}/>` +
      `<polygon points="132,4 115,43 86,29.5" fill="${C.body}" ${earAttr}/>` +
      // 内耳黄绿三角【必须整体位于头部轮廓之上】——
      //   耳朵先画、头后画，若内耳探进头里就会被头盖住（旧版内耳只剩一条细边就是这原因）。
      `<polygon points="34,14 46,39 64,29" fill="${C.ear}"/>` +
      `<polygon points="126,14 114,39 96,29" fill="${C.ear}"/>`;
    const head =
      `<ellipse cx="80" cy="70" rx="47" ry="42" fill="${C.body}" stroke="${C.rim}" stroke-opacity="${RIM_OP}" stroke-width="${RIM_W}"/>` +
      // 极淡高光，给纯黑一点体积感（opacity 很低，肉眼几乎只是"没那么死黑"）
      `<ellipse cx="62" cy="46" rx="19" ry="11" fill="${C.bodyHi}" opacity="0.22"/>`;
    const nose = `<path d="M75.5 89 L84.5 89 L80 94.6 Z" fill="${C.nose}"/>`;
    return `<g class="head"${rot}>${ears}${head}${eyesSvg(expr)}${nose}${mouthSvg(expr)}${blushSvg(expr)}</g>`;
  }

  // ----- 身体（坐姿正面）-----
  function bodySvg() {
    const tail = `M120 148 q40 -6 30 -46`;
    const pawAttr = `stroke="${C.bodyHi}" stroke-opacity="0.9" stroke-width="1.6"`;
    return (
      // 尾巴：先画一圈略粗的淡色描边，再用本体黑覆盖 → 得到 1px 淡轮廓
      `<path d="${tail}" fill="none" stroke="${C.rim}" stroke-opacity="${RIM_OP}" stroke-width="15.6" stroke-linecap="round"/>` +
      `<path d="${tail}" fill="none" stroke="${C.body}" stroke-width="13.6" stroke-linecap="round"/>` +
      `<ellipse cx="80" cy="134" rx="46" ry="34" fill="${C.body}" stroke="${C.rim}" stroke-opacity="${RIM_OP}" stroke-width="${RIM_W}"/>` +
      // 两只前爪：同色填充 + 极淡"爪缝"，避免纯黑糊成一团
      `<ellipse cx="59" cy="161" rx="13.5" ry="8.4" fill="${C.body}" ${pawAttr}/>` +
      `<ellipse cx="101" cy="161" rx="13.5" ry="8.4" fill="${C.body}" ${pawAttr}/>`
    );
  }

  // ----- 附件（依 pose）-----
  function accessorySvg(pose) {
    switch (pose) {
      case 'sleep':
        return `<path d="M112 40 h13 l-13 13 h13" fill="none" stroke="${C.zzz}" stroke-width="3" stroke-linejoin="round" opacity="0.9"/>` +
          `<path d="M131 26 h9 l-9 9 h9" fill="none" stroke="${C.zzz}" stroke-width="2.4" stroke-linejoin="round" opacity="0.75"/>`;
      case 'work':
        // 面前的小笔记本电脑（阿七在屏幕后探头陪你工作）
        return `<rect x="46" y="150" width="68" height="30" rx="4" fill="${C.laptop}"/>` +
          `<rect x="51" y="154" width="58" height="20" rx="2" fill="${C.screen}" opacity="0.85"/>` +
          `<path d="M40 180 h80" stroke="${C.laptop}" stroke-width="4" stroke-linecap="round"/>`;
      case 'eat':
        return `<path d="M58 168 q22 20 44 0 Z" fill="${C.bowl}"/>` +
          `<ellipse cx="80" cy="168" rx="22" ry="7" fill="${C.bowlRim}"/>` +
          `<ellipse cx="80" cy="166" rx="16" ry="4.6" fill="${C.food}"/>`;
      case 'drink':
        return `<path d="M58 168 q22 20 44 0 Z" fill="${C.bowl}"/>` +
          `<ellipse cx="80" cy="168" rx="22" ry="7" fill="${C.bowlRim}"/>` +
          `<ellipse cx="80" cy="166" rx="16" ry="4.6" fill="${C.water}"/>`;
      case 'levelup':
        return `<path class="spark" d="M30 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="${C.spark}"/>` +
          `<path class="spark" d="M130 44 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 Z" fill="${C.spark}"/>` +
          `<path class="spark" d="M120 100 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 Z" fill="${C.spark}" opacity="0.85"/>`;
      default:
        return '';
    }
  }

  /**
   * 生成阿七的 SVG 字符串。
   * @param {{expression?:string, pose?:string, size?:number}} [opts]
   * @returns {string} 可内联的 <svg> 字符串
   */
  function petSvg(opts) {
    const o = opts || {};
    const expr = isExpression(o.expression) ? o.expression : 'normal';
    const pose = isPose(o.pose) ? o.pose : 'sit';
    const w = Number(o.size) > 0 ? Number(o.size) : 150;
    const h = Math.round(w * 180 / 160);
    return `<svg class="aqi-pet" data-expr="${expr}" data-pose="${pose}" ` +
      `viewBox="0 0 160 180" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" ` +
      `shape-rendering="geometricPrecision">` +
      bodySvg() + headSvg(expr) + accessorySvg(pose) +
      `</svg>`;
  }

  return { petSvg, EXPRESSIONS, POSES, isExpression, isPose, palette: C };
});

/**
 * 阿七形象模块 —— 按《桌面电子宠物视觉设计板》用 SVG 矢量自绘黑猫（纯函数）。
 *
 * 为什么用 SVG 而不是位图：
 *   1) 项目铁律「本地运行 / 无云依赖 / 可整体迁移」——SVG 是代码，零外部素材依赖；
 *   2) 表情与姿态可**程序化参数化**，一个猫体切换 8 种表情，比"8 张静态图"体积小得多、也不会有画风不一致；
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

  // ===== 调色板（取自设计板：黑身 + 黄绿虹膜/内耳 + 粉鼻）=====
  const C = {
    body: '#20202a',
    bodyHi: '#33333f',
    ear: '#c3d95a',
    eye: '#f3f8d6',
    iris: '#bcd94c',
    pupil: '#1b1f0e',
    nose: '#e88aa0',
    blush: '#f2a0b4',
    white: '#ffffff',
    whisker: '#6a6a78',
    zzz: '#c8c8d4',
    bowl: '#8b95ab',
    bowlRim: '#6f7990',
    food: '#e2a35a',
    water: '#7ec8e3',
    laptop: '#42424e',
    screen: '#8fd0e8',
    spark: '#ffd95e'
  };

  const EXPRESSIONS = ['normal', 'happy', 'surprise', 'shy', 'sleepy', 'angry', 'sad', 'tilt'];
  const POSES = ['sit', 'walk', 'sleep', 'work', 'eat', 'drink', 'levelup'];

  const EYE_L = 62;
  const EYE_R = 98;
  const EYE_Y = 72;

  function isExpression(v) { return EXPRESSIONS.indexOf(v) >= 0; }
  function isPose(v) { return POSES.indexOf(v) >= 0; }

  // ----- 眼睛：常规睁眼（大眼白 + 黄绿虹膜 + 黑瞳 + 高光）-----
  function openEye(cx, ry) {
    const r = ry || 15;
    return `<ellipse cx="${cx}" cy="${EYE_Y}" rx="14" ry="${r}" fill="${C.eye}"/>` +
      `<ellipse cx="${cx}" cy="${EYE_Y + 2}" rx="10" ry="${r - 3}" fill="${C.iris}"/>` +
      `<ellipse cx="${cx}" cy="${EYE_Y + 3}" rx="4.6" ry="${Math.max(4, r - 8)}" fill="${C.pupil}"/>` +
      `<circle cx="${cx - 3.4}" cy="${EYE_Y - 4.5}" r="3.2" fill="${C.white}"/>`;
  }
  // 笑眼：^ ^
  function happyEye(cx) {
    return `<path d="M${cx - 11} ${EYE_Y + 5} Q${cx} ${EYE_Y - 9} ${cx + 11} ${EYE_Y + 5}" ` +
      `fill="none" stroke="${C.pupil}" stroke-width="5" stroke-linecap="round"/>`;
  }
  // 困倦闭眼：向下垂的弧
  function sleepyEye(cx) {
    return `<path d="M${cx - 11} ${EYE_Y - 3} Q${cx} ${EYE_Y + 8} ${cx + 11} ${EYE_Y - 3}" ` +
      `fill="none" stroke="${C.pupil}" stroke-width="4.5" stroke-linecap="round"/>`;
  }
  // 半睁眼（害羞）
  function halfEye(cx) {
    return `<ellipse cx="${cx}" cy="${EYE_Y + 2}" rx="14" ry="7.5" fill="${C.eye}"/>` +
      `<ellipse cx="${cx}" cy="${EYE_Y + 3}" rx="9.5" ry="5" fill="${C.iris}"/>` +
      `<ellipse cx="${cx}" cy="${EYE_Y + 3.5}" rx="4.2" ry="4.2" fill="${C.pupil}"/>` +
      `<circle cx="${cx - 3.2}" cy="${EYE_Y}" r="2.4" fill="${C.white}"/>`;
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
        return `<g class="eyes" data-expr="surprise">${openEye(EYE_L, 18)}${openEye(EYE_R, 18)}</g>`;
      case 'angry':
        // 怒眉：内低外高（压向鼻梁）
        return `<g class="eyes" data-expr="angry">${openEye(EYE_L)}${openEye(EYE_R)}` +
          `<path d="M44 58 L74 70" fill="none" stroke="${C.pupil}" stroke-width="6" stroke-linecap="round"/>` +
          `<path d="M116 58 L86 70" fill="none" stroke="${C.pupil}" stroke-width="6" stroke-linecap="round"/></g>`;
      case 'sad':
        // 八字眉：内高外低 + 泪珠
        return `<g class="eyes" data-expr="sad">${openEye(EYE_L)}${openEye(EYE_R)}` +
          `<path d="M44 72 L74 60" fill="none" stroke="${C.pupil}" stroke-width="5" stroke-linecap="round"/>` +
          `<path d="M116 72 L86 60" fill="none" stroke="${C.pupil}" stroke-width="5" stroke-linecap="round"/>` +
          `<circle cx="59" cy="92" r="3.2" fill="${C.water}"/></g>`;
      case 'tilt':
        return `<g class="eyes" data-expr="tilt">${openEye(EYE_L)}${openEye(EYE_R)}</g>`;
      case 'normal':
      default:
        return `<g class="eyes" data-expr="normal">${openEye(EYE_L)}${openEye(EYE_R)}</g>`;
    }
  }

  // ----- 嘴（鼻子下方 y≈94）-----
  function mouthSvg(expr) {
    const Y = 94;
    switch (expr) {
      case 'happy':
        return `<path d="M68 ${Y - 2} Q80 ${Y + 11} 92 ${Y - 2} Z" fill="${C.pupil}"/>` +
          `<path d="M74 ${Y + 4} Q80 ${Y + 11} 86 ${Y + 4} Q80 ${Y + 8} 74 ${Y + 4} Z" fill="${C.blush}"/>`;
      case 'surprise':
        return `<ellipse cx="80" cy="${Y + 2}" rx="5" ry="6.4" fill="${C.pupil}"/>`;
      case 'sad':
        return `<path d="M70 ${Y + 4} Q80 ${Y - 4} 90 ${Y + 4}" fill="none" stroke="${C.pupil}" stroke-width="3" stroke-linecap="round"/>`;
      case 'angry':
        return `<path d="M70 ${Y} L76 ${Y + 5} L80 ${Y} L84 ${Y + 5} L90 ${Y}" fill="none" stroke="${C.pupil}" stroke-width="3" stroke-linejoin="round"/>`;
      default:
        // 小 ω 嘴（从鼻底向两侧下弯）
        return `<path d="M80 ${Y - 2} Q74 ${Y + 5} 69 ${Y}" fill="none" stroke="${C.pupil}" stroke-width="3" stroke-linecap="round"/>` +
          `<path d="M80 ${Y - 2} Q86 ${Y + 5} 91 ${Y}" fill="none" stroke="${C.pupil}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }

  function blushSvg(expr) {
    if (expr !== 'shy' && expr !== 'happy' && expr !== 'tilt') return '';
    const o = expr === 'shy' ? 0.8 : 0.6;
    return `<ellipse cx="40" cy="92" rx="9" ry="5" fill="${C.blush}" opacity="${o}"/>` +
      `<ellipse cx="120" cy="92" rx="9" ry="5" fill="${C.blush}" opacity="${o}"/>`;
  }

  // ----- 头（tilt 时整体旋转 = 歪头）-----
  function headSvg(expr) {
    const rot = expr === 'tilt' ? ' transform="rotate(-11 80 74)"' : '';
    const ears =
      `<polygon points="42,46 26,8 72,32" fill="${C.body}"/>` +
      `<polygon points="118,46 134,8 88,32" fill="${C.body}"/>` +
      `<polygon points="48,40 38,18 64,32" fill="${C.ear}"/>` +
      `<polygon points="112,40 122,18 96,32" fill="${C.ear}"/>`;
    const head = `<circle cx="80" cy="74" r="42" fill="${C.body}"/>` +
      `<path d="M56 40 q14 -8 30 -2" fill="none" stroke="${C.bodyHi}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`;
    const whiskers =
      `<line x1="30" y1="88" x2="48" y2="92" stroke="${C.whisker}" stroke-width="1.4"/>` +
      `<line x1="30" y1="96" x2="48" y2="97" stroke="${C.whisker}" stroke-width="1.4"/>` +
      `<line x1="130" y1="88" x2="112" y2="92" stroke="${C.whisker}" stroke-width="1.4"/>` +
      `<line x1="130" y1="96" x2="112" y2="97" stroke="${C.whisker}" stroke-width="1.4"/>`;
    const nose = `<path d="M74 88 L86 88 L80 95 Z" fill="${C.nose}"/>`;
    return `<g class="head"${rot}>${ears}${head}${whiskers}${eyesSvg(expr)}${nose}${mouthSvg(expr)}${blushSvg(expr)}</g>`;
  }

  // ----- 身体（坐姿正面）-----
  function bodySvg() {
    return `<path d="M118 152 q40 -6 32 -48" fill="none" stroke="${C.body}" stroke-width="13" stroke-linecap="round"/>` +
      `<ellipse cx="80" cy="132" rx="44" ry="32" fill="${C.body}"/>` +
      `<ellipse cx="80" cy="140" rx="26" ry="20" fill="${C.bodyHi}" opacity="0.35"/>` +
      `<ellipse cx="60" cy="160" rx="12" ry="7.5" fill="${C.body}"/>` +
      `<ellipse cx="100" cy="160" rx="12" ry="7.5" fill="${C.body}"/>` +
      `<ellipse cx="60" cy="159" rx="5" ry="3" fill="${C.ear}" opacity="0.35"/>` +
      `<ellipse cx="100" cy="159" rx="5" ry="3" fill="${C.ear}" opacity="0.35"/>`;
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

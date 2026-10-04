// src/tray-format.js
// 托盘文案格式化（纯函数，便于在无 GUI 环境下单测）
//
// V-ming 2026-10-04 要求：
//   1. 托盘鼠标【悬停】提示显示的是【等级】，不是版本号 → "阿七 Lv.1"；
//   2. 版本号移到右键菜单最底部、"退出"按钮【下方】，用灰色淡显。
//
// 平台限制：Windows 原生菜单不支持自定义文字颜色，
//   "变灰" 的唯一手段就是把菜单项设为 enabled:false（原生渲染为灰色且不可点）。
//   这一点已在《开发报告_阶段4》中向 PM 说明。

// 悬停提示：名称 + 当前等级（等级随 pet.json 变化，每次重建托盘菜单时刷新）
function tooltip(levelInfo) {
  const name = (levelInfo && levelInfo.name) || '阿七';
  const lv = (levelInfo && levelInfo.level) || 1;
  return `${name} Lv.${lv}`;
}

// 版本标签："1.0.0" → "V1.0"（只取主.次；V1.x 是产品线，补丁号不展示）
function versionLabel(version) {
  const parts = String(version || '1.0.0').trim().split('.').filter((s) => s !== '');
  if (!parts.length) return 'V1.0';
  return 'V' + parts.slice(0, 2).join('.');
}

module.exports = { tooltip, versionLabel };

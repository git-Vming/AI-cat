// src/bubble-window.js —— 阶段 6：提醒气泡（独立无边框小窗，显示在阿七旁边）
//
// ⚠️ 命名铁律：绝不写 `const aqi = window.aqi`（contextBridge 注入的全局 aqi 是不可配置属性，
// 同名 const 会抛 SyntaxError 让整份脚本不执行）。统一用 api。
//
// 行为（V-ming 2026-10-05 要求）：
//   · 提醒显示为阿七旁边的气泡，**不在状态卡内**；
//   · 气泡**不会自动消失**，只有「左键单击阿七」或「左键单击气泡」才消失。

const api = window.aqi || null;
const elText = document.getElementById('text');

function log(m) { try { if (api && api.log) api.log('[bubble] ' + m); } catch (_) {} }

function render(text) {
  elText.textContent = text || '';
  try { document.title = (text || '阿七提醒').slice(0, 16); } catch (_) {}
  log('text ' + (text || ''));
}

// 主进程下发文案
if (api && api.onBubbleText) api.onBubbleText(render);

// 左键单击气泡 → 关闭（右键不会触发 click，符合"仅左键"的要求）
document.body.addEventListener('click', () => { if (api && api.hideBubble) api.hideBubble(); });
// 兜底：Esc 也能关
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && api && api.hideBubble) api.hideBubble(); });

log('booted');

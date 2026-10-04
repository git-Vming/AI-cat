// scripts/test-tray.js
// 阶段 4 增补：托盘文案测试（V-ming 2026-10-04）
//   ① 悬停提示必须显示【等级】而不是版本号；
//   ② 版本号必须出现在右键菜单最底部「退出」【下方】，且为灰色淡显（enabled:false）。
// 托盘是 Windows 原生菜单，无法在无 GUI 环境下渲染，故：
//   - 文案逻辑抽成纯函数（src/tray-format.js）直接测；
//   - 菜单结构对 main.js 源码做结构断言（防回归）。
// 运行：node scripts/test-tray.js
const fs = require('fs');
const path = require('path');
const tf = require('../src/tray-format');
const pkg = require('../package.json');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('— ① 悬停提示：显示等级（不是版本号）—');
{
  check('Lv.1', tf.tooltip({ name: '阿七', level: 1 }) === '阿七 Lv.1', tf.tooltip({ name: '阿七', level: 1 }));
  check('Lv.3', tf.tooltip({ name: '阿七', level: 3 }) === '阿七 Lv.3', tf.tooltip({ name: '阿七', level: 3 }));
  check('Lv.12（两位数等级）', tf.tooltip({ name: '阿七', level: 12 }) === '阿七 Lv.12', tf.tooltip({ name: '阿七', level: 12 }));
  check('缺 name 时回退为「阿七」', tf.tooltip({ level: 5 }) === '阿七 Lv.5', tf.tooltip({ level: 5 }));
  check('空入参回退为「阿七 Lv.1」', tf.tooltip(null) === '阿七 Lv.1', tf.tooltip(null));
  check('提示里不含版本号 V1.0', !tf.tooltip({ name: '阿七', level: 2 }).includes('V1.0'));
}

console.log('— ② 版本标签 —');
{
  check('1.0.0 → V1.0', tf.versionLabel('1.0.0') === 'V1.0', tf.versionLabel('1.0.0'));
  check('2.3.4 → V2.3', tf.versionLabel('2.3.4') === 'V2.3', tf.versionLabel('2.3.4'));
  check('空值回退 V1.0', tf.versionLabel('') === 'V1.0' && tf.versionLabel(undefined) === 'V1.0');
  check('package.json 的 version 实际渲染为 V1.0', tf.versionLabel(pkg.version) === 'V1.0',
    pkg.version + ' → ' + tf.versionLabel(pkg.version));
}

console.log('— ③ main.js 托盘结构（防回归）—');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  check('悬停用纯函数按等级设置（tray.setToolTip(tf.tooltip(li))）',
    /tray\.setToolTip\(\s*tf\.tooltip\(li\)\s*\)/.test(src), '未找到动态 tooltip');
  check('已移除硬编码的「阿七 V1.0」悬停提示',
    !/setToolTip\(\s*['"]阿七\s*V1\.0['"]\s*\)/.test(src));

  const iQuit = src.indexOf("label: '退出'");
  const iVer = src.indexOf('tf.versionLabel(app.getVersion())');
  check('存在版本号菜单项', iVer >= 0);
  check('版本号位于「退出」之后', iQuit >= 0 && iVer > iQuit, 'quit@' + iQuit + ' version@' + iVer);
  check('版本号为灰色淡显且不可点击（enabled:false）',
    /\{\s*label:\s*tf\.versionLabel\(app\.getVersion\(\)\),\s*enabled:\s*false\s*\}/.test(src));

  // 版本项必须是模板里的最后一项（后面紧跟 ] ）
  const tail = src.slice(iVer, iVer + 200);
  check('版本号是菜单最后一项（其后无其它菜单项）', /\]\s*;/.test(tail), tail.split('\n')[0]);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

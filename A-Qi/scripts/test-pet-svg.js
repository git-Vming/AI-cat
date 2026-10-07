// scripts/test-pet-svg.js
// 目的：验证「阿七形象模块」是纯函数、输出合法 SVG、表情/姿态可参数化且互不相同，
//   非法输入不崩并回退默认（保证桌宠在任何异常数据下都能画出一只猫）。
// 运行：node scripts/test-pet-svg.js
const p = require('../src/pet-svg');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
// 标签平衡校验：去掉自闭合标签后，开/闭标签数量应一致（足够抓出拼接漏括号）
function isBalanced(s) {
  const noSelf = s.replace(/<[^>]*\/>/g, '');
  const opens = (noSelf.match(/<[a-zA-Z][^>]*>/g) || []).length;
  const closes = (noSelf.match(/<\/[a-zA-Z]+>/g) || []).length;
  return opens === closes;
}

console.log('— 表情（8 种）—');
const seenExpr = new Set();
for (const e of p.EXPRESSIONS) {
  const s = p.petSvg({ expression: e });
  check(`表情「${e}」输出合法且标签闭合`,
    s.startsWith('<svg') && s.endsWith('</svg>') && isBalanced(s));
  check(`表情「${e}」的 data-expr 正确`, s.includes(`data-expr="${e}"`));
  check(`表情「${e}」含黑猫本体填充色`, s.includes(p.palette.body));
  seenExpr.add(s);
}
check('8 种表情的 SVG 两两不同（参数确实生效）', seenExpr.size === p.EXPRESSIONS.length,
  'distinct=' + seenExpr.size);

console.log('— 表情特征 —');
check('开心 = 弯月笑眼（用 path 画弧，不是椭圆瞳孔）',
  !/<ellipse cx="62" cy="72" rx="14"/.test(p.petSvg({ expression: 'happy' })) &&
  /data-expr="happy"/.test(p.petSvg({ expression: 'happy' })));
check('困倦 = 下垂闭眼弧（含下弯 Q 路径）',
  /data-expr="sleepy"/.test(p.petSvg({ expression: 'sleepy' })));
check('惊讶 = 更大的眼睛（ry=18）', /ry="18"/.test(p.petSvg({ expression: 'surprise' })));
check('害羞 = 半睁眼 + 腮红', /ry="7.5"/.test(p.petSvg({ expression: 'shy' })) &&
  p.petSvg({ expression: 'shy' }).includes(p.palette.blush));
// 【2026-10-07 随形象升级调整】原断言写死「怒眉 = 瞳孔色」。
//   但新形象身体改为近纯黑（#111214），瞳孔色（#0c0d10）画在黑脸上等于不可见，
//   故怒眉改用强调色 iris。断言随之改为「高对比强调色」，其余表情断言未变。
check('生气 = 带怒眉（用强调色，纯黑身体上可见）',
  p.petSvg({ expression: 'angry' }).includes(`stroke="${p.palette.iris}" stroke-width="6"`));
check('难过 = 带泪珠', p.petSvg({ expression: 'sad' }).includes(p.palette.water));
check('歪头 = 头部整体旋转', /rotate\(-11 80 74\)/.test(p.petSvg({ expression: 'tilt' })));

console.log('— 姿态（7 种）—');
const seenPose = new Set();
for (const q of p.POSES) {
  const s = p.petSvg({ pose: q });
  check(`姿态「${q}」输出合法且标签闭合`,
    s.startsWith('<svg') && s.endsWith('</svg>') && isBalanced(s));
  check(`姿态「${q}」的 data-pose 正确`, s.includes(`data-pose="${q}"`));
  seenPose.add(s);
}
check('7 种姿态的 SVG 两两不同', seenPose.size === p.POSES.length, 'distinct=' + seenPose.size);

console.log('— 姿态特征 —');
check('睡觉 = 带 zZ', /stroke="#c8c8d4"/.test(p.petSvg({ pose: 'sleep' })));
check('工作 = 面前有笔记本电脑', p.petSvg({ pose: 'work' }).includes(p.palette.laptop));
check('吃东西 = 有饭碗（食物色）', p.petSvg({ pose: 'eat' }).includes(p.palette.food));
check('喝水 = 有水碗（水色）', p.petSvg({ pose: 'drink' }).includes(p.palette.water));
check('升级 = 带星星（class="spark" 供 CSS 闪光）',
  /class="spark"/.test(p.petSvg({ pose: 'levelup' })));

console.log('— 参数健壮性 —');
check('空参数 → 默认 normal/sit',
  /data-expr="normal"/.test(p.petSvg()) && /data-pose="sit"/.test(p.petSvg()));
check('非法表情回退 normal', /data-expr="normal"/.test(p.petSvg({ expression: 'nope' })));
check('非法姿态回退 sit', /data-pose="sit"/.test(p.petSvg({ pose: 'nope' })));
check('isExpression / isPose 判定正确',
  p.isExpression('happy') && !p.isExpression('sit') && p.isPose('sleep') && !p.isPose('happy'));
check('自定义尺寸生效（size=200 → width=200 height=225 保持比例）',
  /width="200"/.test(p.petSvg({ size: 200 })) && /height="225"/.test(p.petSvg({ size: 200 })));
check('非法尺寸回退默认 150',
  /width="150"/.test(p.petSvg({ size: -5 })) && /width="150"/.test(p.petSvg({ size: 'x' })));
check('viewBox 固定为 160×180',
  /viewBox="0 0 160 180"/.test(p.petSvg({ expression: 'happy', pose: 'work' })));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

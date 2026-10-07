// scripts/package.js
// 阿七 · 免安装版打包（**零外部依赖**，不需要 electron-builder / electron-packager）
//
// 原理：Electron 应用的"打包"本质上就是两件事 ——
//   ① 带上 Electron 运行时（node_modules/electron/dist）
//   ② 把 app 代码放进 resources/app/（Electron 会自动加载它）
// 本项目的**运行时依赖为空**（package.json 里没有 dependencies，只有 devDependencies: electron），
//   所以 resources/app 里**不需要 node_modules**，打包产物天然干净、体积只由 Electron 决定。
//
// 产出：dist/A-Qi-V<版本>-win32-x64/A-Qi.exe
//   双击即用；数据目录创建在 exe 同目录 → 符合规格 §26「程序与数据分离」与 §40「整体迁移」。
//
// 运行：npm run package
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const PRODUCT = 'A-Qi';
const DIR_NAME = `${PRODUCT}-V${PKG.version}-win32-x64`;
const OUT_ROOT = path.join(ROOT, 'dist');
const OUT = path.join(OUT_ROOT, DIR_NAME);
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

// 进 app 的文件 / 目录（**不含** scripts 与任何测试文件）
// 注：项目根的 LICENSE 是一个空占位目录（阶段 1 按 README 目录树建立），不是文件，故不打包；
//     Electron/Chromium 自己的第三方许可证随运行时（dist）一并分发。
const APP_FILES = ['main.js', 'preload.js'];
const APP_DIRS = ['src', 'assets'];
const EXCLUDE_RE = /(^|[\\/])(test[-.].*|.*\.test\.js|.*_shot\.js|\.DS_Store|Thumbs\.db)$/i;

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

// 清理旧产物。注意：本机对 Node 的删除 API 有安全包装（会尝试送入回收站），
// 在回收站不可用的环境里会抛错 —— 因此**降级为"改名移走"**，保证打包在任何环境下都能继续。
function cleanOld(p, label) {
  if (!fs.existsSync(p)) return true;
  try {
    fs.rmSync(p, { recursive: true, force: true });
    if (!fs.existsSync(p)) return true;
  } catch (_) { /* 落到下面的改名方案 */ }
  try {
    const bak = p + '.old-' + Date.now();
    fs.renameSync(p, bak);
    console.log(`   （${label} 无法删除，已改名为 ${path.basename(bak)}，可稍后手动清理）`);
    return true;
  } catch (e) {
    console.error(`✗ 无法清理${label}：` + e.message);
    return false;
  }
}

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(ent)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d, filter);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}
function dirSize(p) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) n += dirSize(q);
      else if (e.isFile()) n += fs.statSync(q).size;
    }
  } catch (_) {}
  return n;
}
function countFiles(p) {
  let n = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) n += countFiles(q);
    else if (e.isFile()) n += 1;
  }
  return n;
}
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

console.log(`== 阿七 V${PKG.version} 免安装版打包 ==`);
if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  console.error('✗ 找不到 Electron 运行时：' + ELECTRON_DIST);
  console.error('  请先在 A-Qi 目录执行：npm install');
  process.exit(1);
}
if (PKG.dependencies && Object.keys(PKG.dependencies).length) {
  console.error('✗ 检测到运行时依赖（dependencies 非空），本脚本的"无 node_modules"前提不再成立：');
  console.error('  ' + JSON.stringify(PKG.dependencies));
  process.exit(1);
}

console.log('1/6 清理旧产物 …');
if (!cleanOld(OUT, '旧产物')) process.exit(1);
fs.mkdirSync(OUT, { recursive: true });

console.log('2/6 复制 Electron 运行时（约 260MB，请稍候）…');
copyDir(ELECTRON_DIST, OUT);

console.log('3/6 组装 resources/app …');
const appDir = path.join(OUT, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
for (const f of APP_FILES) {
  const s = path.join(ROOT, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(appDir, f));
}
for (const d of APP_DIRS) {
  const s = path.join(ROOT, d);
  if (fs.existsSync(s)) copyDir(s, path.join(appDir, d), (ent) => !EXCLUDE_RE.test(ent.name));
}
// 运行时 package.json：只留运行必需字段（不带 devDependencies / scripts）
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: PKG.name,
  productName: '阿七',
  version: PKG.version,
  description: PKG.description,
  main: 'main.js',
  author: PKG.author,
  license: PKG.license
}, null, 2) + '\n', 'utf8');

console.log('4/6 清理 Electron 默认应用 …');
rmrf(path.join(OUT, 'resources', 'default_app.asar'));

console.log('5/6 重命名可执行文件 …');
const exeOld = path.join(OUT, 'electron.exe');
const exeNew = path.join(OUT, `${PRODUCT}.exe`);
if (fs.existsSync(exeOld)) fs.renameSync(exeOld, exeNew);
else { console.error('✗ 找不到 electron.exe，打包中止'); process.exit(1); }

console.log('6/6 写入使用说明 …');
const readme = [
  '阿七 · 桌面电子宠物 V1.0（免安装版）',
  '========================================',
  '',
  '【怎么用】',
  '1. 把整个文件夹复制到你想放的位置（建议放有写权限的目录，例如 D:\\A-Qi\\）',
  '2. 双击 A-Qi.exe 启动',
  '3. 阿七会出现在桌面上：左键单击它 → 弹出功能菜单；右键它 → 也是菜单',
  '4. 关闭窗口不会退出程序；右键系统托盘的小图标 →「退出」才真正结束',
  '',
  '【数据在哪】就在这个文件夹里',
  '  data\\          宠物 / 考勤 / 统计 / 设置 / 待办（JSON）',
  '  WorkRecords\\   每天的工作记录（TXT，可直接用记事本编辑）',
  '  backup\\        备份（设置页可一键备份与恢复）',
  '  diag.log       运行日志（排查问题时看它）',
  '',
  '【换电脑】把整个文件夹复制过去就行',
  '等级、EXP、工作记录、考勤、统计、待办、设置全部保留，不需要安装任何东西。',
  '',
  '【隐私】完全本地运行',
  '不联网、不上传、不读取工作记录以外的任何文件。',
  '',
  '【注意】',
  '- 请放在有写权限的目录；不要放在 C:\\Program Files 下（那里无法写入数据）',
  '- 开机自动启动默认开启，可在「设置」页关闭',
  '- 想彻底卸载：退出程序后删掉整个文件夹即可（数据也一并删除，建议先备份）'
].join('\r\n');
fs.writeFileSync(path.join(OUT, '使用说明.txt'), readme, 'utf8');

const size = dirSize(OUT);
const appFiles = countFiles(appDir);
console.log('');
console.log('✅ 打包完成');
console.log('   产物: ' + OUT);
console.log('   可执行: ' + exeNew);
console.log('   app 文件数: ' + appFiles + '（不含 node_modules）');
console.log('   总体积: ' + mb(size));

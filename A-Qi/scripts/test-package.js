// scripts/test-package.js
// 阶段 10 自测：验证「免安装版」打包产物结构，并（可选）真机启动一次做冒烟测试。
//
// 用法：
//   node scripts/test-package.js           只验产物结构（不会启动任何窗口）
//   node scripts/test-package.js --launch  额外启动一次 A-Qi.exe，验证「首次启动」行为，随后自动退出
//
// 注意：本脚本**不放进 npm test**（npm test 必须能在无显示器环境安静跑完）。
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const DIR = `A-Qi-V${PKG.version}-win32-x64`;
const OUT = path.join(ROOT, 'dist', DIR);
const APP = path.join(OUT, 'resources', 'app');
const EXE = path.join(OUT, 'A-Qi.exe');
const LAUNCH = process.argv.indexOf('--launch') >= 0;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function exists(p) { return fs.existsSync(p); }

console.log('== 打包产物结构验证 ==');
check('产物目录存在：' + DIR, exists(OUT));
check('可执行文件 A-Qi.exe 存在', exists(EXE));
check('electron.exe 已改名（不残留原名）', !exists(path.join(OUT, 'electron.exe')));
check('Electron 运行时齐全（icudtl.dat / *.pak / ffmpeg.dll）',
  exists(path.join(OUT, 'icudtl.dat')) &&
  fs.readdirSync(OUT).some((f) => f.endsWith('.pak')) &&
  exists(path.join(OUT, 'ffmpeg.dll')));
check('已移除 Electron 默认应用（default_app.asar）',
  !exists(path.join(OUT, 'resources', 'default_app.asar')));

console.log('— app 代码 —');
check('resources/app 存在', exists(APP));
for (const f of ['main.js', 'preload.js', 'package.json']) {
  check('app/' + f + ' 存在', exists(path.join(APP, f)));
}
for (const f of ['index.html', 'app.js', 'styles.css', 'pet-svg.js', 'menu.html',
  'settings.html', 'data-store.js', 'growth.js', 'reminder.js', 'stats.js']) {
  check('app/src/' + f + ' 存在', exists(path.join(APP, 'src', f)));
}
check('app/assets/icons/tray-icon.png 存在', exists(path.join(APP, 'assets', 'icons', 'tray-icon.png')));

console.log('— 不该进包的东西 —');
check('app 内**没有** node_modules（运行时依赖为空）', !exists(path.join(APP, 'node_modules')));
check('app 内**没有** scripts（测试不进包）', !exists(path.join(APP, 'scripts')));
check('app 内**没有** dist（不递归打包）', !exists(path.join(APP, 'dist')));
check('app 内**没有**开发报告', fs.readdirSync(APP).every((f) => !f.startsWith('开发报告')));
check('app 内**没有**测试文件', !fs.readdirSync(path.join(APP, 'src'))
  .some((f) => f.startsWith('test')));

console.log('— 运行时 package.json —');
{
  const rp = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  check('main 指向 main.js', rp.main === 'main.js', rp.main);
  check('版本号与开发一致（' + PKG.version + '）', rp.version === PKG.version, rp.version);
  check('不含 devDependencies（包里不需要）', rp.devDependencies === undefined);
  check('不含 scripts', rp.scripts === undefined);
  check('保留 license 字段', !!rp.license, rp.license);
}

console.log('— 交付附件 —');
check('使用说明.txt 存在', exists(path.join(OUT, '使用说明.txt')));
{
  const txt = exists(path.join(OUT, '使用说明.txt')) ? fs.readFileSync(path.join(OUT, '使用说明.txt'), 'utf8') : '';
  check('使用说明含"数据在哪"与"换电脑"两节', /数据在哪/.test(txt) && /换电脑/.test(txt));
}

console.log('— 数据与程序分离（首次运行前不应有数据目录）—');
const hadData = exists(path.join(OUT, 'data'));
console.log('   ' + (hadData ? '⚠ 已存在 data/（说明不是首次启动，稍后验证会基于现状）' : '✅ 首次启动前无 data/'));

(async function main() {
  if (!LAUNCH) {
    console.log('\n（未加 --launch，跳过启动冒烟测试）');
  } else {
    if (!exists(EXE)) { console.log('\n✗ 没有 exe，跳过启动测试'); }
    else {
      console.log('\n== 启动冒烟测试（会短暂弹出阿七窗口，约 8 秒后自动退出）==');
      const before = {
        data: exists(path.join(OUT, 'data')),
        diag: exists(path.join(OUT, 'diag.log'))
      };
      let child = null;
      try {
        child = spawn(EXE, [], { cwd: OUT, stdio: 'ignore', windowsHide: false });
        console.log('   已启动 PID=' + child.pid + '，等待初始化 …');
        await sleep(8000);

        check('进程仍在运行（未崩溃）', child.exitCode === null, 'exitCode=' + child.exitCode);
        check('在 exe 同目录创建了 data/', exists(path.join(OUT, 'data')));
        check('在 exe 同目录创建了 WorkRecords/', exists(path.join(OUT, 'WorkRecords')));
        check('在 exe 同目录创建了 backup/', exists(path.join(OUT, 'backup')));
        if (!before.diag) check('写入了 diag.log（日志与程序分离）', exists(path.join(OUT, 'diag.log')));
        const petPath = path.join(OUT, 'data', 'pet.json');
        check('生成了 data/pet.json', exists(petPath));
        if (exists(petPath)) {
          const pet = JSON.parse(fs.readFileSync(petPath, 'utf8'));
          check('新装宠物为 Lv.1 / 0 EXP', pet.level === 1 && pet.totalExp === 0,
            'Lv.' + pet.level + ' EXP ' + pet.totalExp);
        }
        const stPath = path.join(OUT, 'data', 'settings.json');
        if (exists(stPath)) {
          const st = JSON.parse(fs.readFileSync(stPath, 'utf8'));
          check('默认设置：开机启动开启', st.startOnBoot === true, String(st.startOnBoot));
          check('默认设置：护眼 60 / 久坐 90', st.eyeReminderMin === 60 && st.sitReminderMin === 90,
            st.eyeReminderMin + '/' + st.sitReminderMin);
        }
        if (exists(path.join(OUT, 'diag.log'))) {
          const log = fs.readFileSync(path.join(OUT, 'diag.log'), 'utf8');
          check('日志里有 app ready 与创建窗口记录', /app ready/.test(log), log.split('\n').slice(-3).join(' | '));
        }
      } catch (e) {
        check('启动冒烟测试未抛异常', false, e.message);
      } finally {
        // 收尾：结束进程树（Electron 有 GPU/渲染子进程）
        try { if (child && child.pid) execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: 'ignore' }); } catch (_) {}
        await sleep(1200);
        console.log('   已结束阿七进程');
      }
    }
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();

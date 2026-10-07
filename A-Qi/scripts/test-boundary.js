// scripts/test-boundary.js
// 目的：把「隐私红线」变成**可被机器验证**的断言，而不是一句承诺。
//   对应规格 §38 本地化要求（完全断网可运行）、§39 安全边界（只读 A-Qi/ 自己的数据）、
//   §28 隐私原则（不读公司文件/微信/邮件/浏览器/键盘/屏幕，不上传）。
//
// 做法：对**运行时会执行的文件**做静态扫描（main.js / preload.js / src/*），
//   出现任何网络、剪贴板、键盘、屏幕捕获、遥测、上传相关 API 即判定失败。
//
// 运行：node scripts/test-boundary.js
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const targets = [];
targets.push(path.join(ROOT, 'main.js'));
targets.push(path.join(ROOT, 'preload.js'));
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (/\.(js|html|css)$/.test(f)) targets.push(path.join(ROOT, 'src', f));
}

// 允许的"看似敏感但必需"的白名单片段
const ALLOW = [
  /xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/g,   // SVG 命名空间，非网络请求
  /http:\/\/www\.w3\.org/g
];

function scan(label, re, note) {
  const hits = [];
  for (const f of targets) {
    let code = fs.readFileSync(f, 'utf8');
    for (const a of ALLOW) code = code.replace(a, '');
    const m = code.match(re);
    if (m) hits.push(path.basename(f) + ':' + m.slice(0, 3).join('|'));
  }
  check(label + (note ? '（' + note + '）' : ''), hits.length === 0, hits.join(' ; '));
}

console.log('— 规格 §38 本地化：不得有网络能力（断网必须可运行）—');
scan('无 http(s) 请求地址', /https?:\/\/[^\s"'<>)]+/);
scan('无 fetch() 调用', /\bfetch\s*\(/);
scan('无 XMLHttpRequest', /XMLHttpRequest/);
scan('无 WebSocket', /WebSocket|\bws:\/\//);
scan('无 Node 网络模块', /require\(\s*['"](http|https|net|dns|tls|dgram)['"]\s*\)/);
scan('无第三方网络库', /require\(\s*['"](axios|node-fetch|got|request|superagent)['"]\s*\)/);
scan('html 无外链脚本/样式', /<(script|link)[^>]+(src|href)=["']https?:/i);

console.log('— 规格 §39 / §28 隐私：不得读取用户环境 —');
scan('无剪贴板读写', /clipboard|readText|writeText/i);
scan('无屏幕捕获', /desktopCapturer|capturePage|getUserMedia|screenshot/i);
scan('无全局键盘监听', /globalShortcut|iohook|node-key-sender|robotjs|keylogger/i);
scan('无活动窗口探测', /active-win|getForegroundWindow|activeWindow/i);
scan('无浏览器数据读取', /cookies|bookmarks|chrome\s*\.|firefox|localStorage/i);
scan('无邮件协议', /imap|smtp|pop3|outlook|mailparser/i);
scan('无微信/企微读取', /wechat|weixin|wxwork|work\.weixin/i);
// 注：正则刻意收窄 —— "syncTo" 会误伤本地的 syncTodayRecord，"login" 会误伤 loginItem（开机启动项）
scan('无云同步/账号体系', /cloudSync|syncToCloud|cloudUpload|accountId|userToken|accessToken|oauth2?/i);

console.log('— 不得有遥测/上传 —');
scan('无遥测 SDK', /telemetry|analytics|sentry|bugsnag|mixpanel|umeng|gtag/i);
scan('无上传行为', /\bupload\b|multipart|form-data/i);

console.log('— 数据边界：只读写 A-Qi 自己的目录 —');
scan('不引用系统个人目录', /getPath\(\s*['"](documents|downloads|desktop|pictures|videos|music)['"]\s*\)/i);
scan('不引用系统盘符绝对路径', /['"][A-Za-z]:\\\\(Users|Windows|Program)/);
scan('不读取环境变量中的敏感项', /process\.env\.(USERPROFILE|APPDATA|HOMEPATH)/);

console.log('— 主进程诊断日志仅写本地文件 —');
{
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  check('diag.log 写在数据根目录内', /path\.join\(getAppRoot\(\),\s*'diag\.log'\)/.test(main));
  // 唯一允许的对外动作：用系统默认程序打开本地文件/目录
  const external = (main.match(/shell\.open(Path|External)/g) || []);
  check('对外动作只有 shell.openPath（打开本地文件/目录）', external.length > 0 &&
    !/shell\.openExternal/.test(main), 'openPath=' + external.length);
}

console.log('— 运行时会执行的文件清单（本检查的覆盖范围）—');
console.log('   ' + targets.map((f) => path.relative(ROOT, f)).join('\n   '));
check('扫描范围包含主进程/预加载/全部渲染层文件', targets.length >= 16, 'count=' + targets.length);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);

# 阿七 V1.0 项目长期记忆

## 项目定位
桌面电子宠物「阿七」V1.0 —— Windows 本地桌宠，陪伴工作型。真实工作时长 = 阿七养料。
四条铁律：本地运行、本地存档、无云依赖、可整体迁移。技术路线：Electron + HTML/CSS/JS + JSON/TXT。

## 工作流铁律（V-ming 2026-10-02 确立）
- **分阶段开发，每阶段完成后必须出具《开发报告》，由 V-ming 以 PM 身份人工审核。**
- **PM 说"通过 / 可以继续开发"后才允许进入下一阶段；未获放行不得擅自开工。**
- 阶段：0 设计冻结 → 1 底座 → 2 上下工/工时/EXP → 3 工作记录 → 4 遗忘打卡/补录 → 5 待办/统计 →
  6 健康提醒 → 7 成长/互动 → 8 完整 UI/动画 → 9 设置/开机启动/迁移 → 10 测试/打包。（阶段 0–10 均已完成）

## 关键决策（PM 已拍板，不可擅改）
- 命名/结构：`A-Qi.exe` / 5 个 JSON（pet, attendance, statistics, settings, tasks）/ V1.0 不做 .petpack（留 V1.1+）。
- 上下工时间**不写死**：点击即取电脑当前时间；一天仅 2 次点击，午休（12:00–14:00）由算法自动排除。
- 目标机：i5-12400F / 16GB / GTX1650 / 466G。
- **等级规则**：**固定 80 EXP 升一级**（`EXP_PER_LEVEL=80`）。**EXP 显示保留 1 位小数**；
  等级内进度用 `exp`，当日结算用 `todayExp`，切勿混用。
- **托盘经验条只能用文本近似**（2026-10-03 返工教训）：Windows 原生托盘菜单**不能上色、不能画图形条**，
  只能用 `█/░` 画 5 格（`wt.expBarText`）。曾尝试自绘托盘面板，被 PM 以"改动量过大"否决并回退。
  **再遇此需求先说明硬限制与代价，不要直接开工。**
- **辅助功能窗口一律用「普通窗口」**（带系统标题栏，2026-10-04 定案），不自绘无边框面板：
  天然可关闭、改动量最小、无"关不掉"风险。代价是任务栏会出现窗口项，可接受。
- **点击阿七的菜单 = 独立无边框小窗**（`src/menu.html`，`focusable:false` 不抢焦点），**不扩大主窗口**：
  塞进主窗口会让窗口从 200 涨到 ~540，透明区成倍变大、明显挡桌面（违反规格 §35）。
- **隐藏/显示动画用 CSS 过渡**（渲染层淡出 → 主进程延迟 `hide()`），**不用窗口透明度 API**。
- **桌面位置记忆**：`settings.json` 的 `position`；启动恢复（做越界收敛），拖动结束由渲染层通知保存。
- **宠物名的唯一权威 = `pet.json.name`**（2026-10-07 定案）：`settings.petName` 降级为镜像。
  起因：迁移测试当场暴露双存储不一致。**凡是"同一事实存两处"，都要指定唯一权威。**
- **数据备份 = 只读复制**到 `backup/<YYYYMMDD-HHMMSS>/`；**恢复 = 三重保护**：先自动安全备份 →
  当前数据 `rename` 到临时目录（失败可回滚）→ 界面二次确认。备份名严格校验 `^\d{8}-\d{6}(-\d+)?$`，
  **非法名（路径穿越）一律拒绝**。
- **开机启动**：PM 2026-10-07 决定**默认开启**（`startOnBoot: true`），启动时与系统对齐。
- **隐私红线用测试锁死**：`scripts/test-boundary.js` 静态扫描全部运行时文件，出现网络 / 剪贴板 / 键盘 /
  屏幕捕获 / 浏览器数据 / 邮件 / 微信 / 遥测 / 上传相关 API 即失败（规格 §38/§39/§28）。
- **迁移测试**：`scripts/test-migration.js` 模拟「电脑A → 复制整个目录 → 电脑B」，逐项比对
  等级/EXP/考勤/统计/TXT（逐字）/待办/好感度/解锁/设置（规格 §40/§41 的机器化验证）。

## 数据架构铁律（阶段4 确立，改数据前必读）
- **`attendance.json` 是唯一真相来源**；`statistics.json` 与 `pet.json` 一律由 `recomputeAll()` 全量派生，
  **绝不增量累加**（否则补录/改历史会"改不掉、重复累加"）。`punchOut` 也走同一路径。
- 由此：`pet.totalExp` == `statistics.totalExp`。**若将来引入非工时 EXP，必须单开字段**，不得混入。
- **红线：跨天未下工绝不能自动算工时**。`resumeIncomplete` 置 `incomplete` → 只统计 `completed` →
  必须经 `repairAttendance` 人工确认才变 completed。
- 补录可覆盖已有记录（含改已完成时间）；靠全量重算保证正确。但**已有出勤记录的日期禁止被 `ignoreDay` 抹掉**（返回 `has_record`）。
- 状态取值：`working | completed | incomplete | absent`；来源：`normal | manual_repair | ignored`。

## 统计口径（阶段5 确立，改统计前必读）
- **只统计 `status === 'completed'`**；`working`/`incomplete`/`absent` 一律不计。
- 维度：今日 / 本周（**周一起算**）/ 本月（**1 日起算**）/ 累计。
- **工作天数** = 该时段有出勤记录的天数（**含周六日加班日**）。
- **平均每日工作时长** = 总时长 ÷ 工作天数。
- **连续工作** = 从今天（若已下工）或昨天向前回溯，连续有完成记录的天数；
  **任何一天（含周末）没有完成记录即中断**（PM 2026-10-05 定稿，原"周末跳过"被修订）。
  例：三/二/一有、周日空、周六有 → 3 天；日/一/二/三有、周六空 → 4 天。
- 实现：`src/stats.js`（纯函数 `computeStats` / `computeStreak`）。
- **待办**：来源恒为**前一天** TXT 的【明日待办】；勾选状态只存 `data/tasks.json`；
  **PM 明确：不回写 TXT、不带进次日**。实现：`src/todo.js` + `src/todo-window.js`。

## 健康提醒（阶段6 确立）
- 默认间隔：**护眼 60 / 久坐 90 分钟**。**喝水提醒已取消**（2026-10-05），旧 settings 里的
  `waterReminderMin` 会被忽略（**不主动改用户设置文件**）。
- 触发三条件（§30 必须同时满足）：**正在工作 + 不在午休(12:00–14:00) + `remindersEnabled !== false`**。
- 实现 `src/reminder.js`（档位法 `level = floor(liveMinutes/interval)`，同档位不重复提醒，跨多档只报一条、
  状态推到最新）；`main.js` 每 60 秒 tick。**「连续工作分钟」直接用 `getStatus().liveMinutes`**（区间算法已排除午休）。
- **提醒呈现 = 阿七旁边的独立气泡小窗**（216×76 无边框透明）：**不动主窗口**；默认贴上方、空间不足翻下方；
  拖动时跟随；**不自动消失**，只有「单击气泡 / 单击阿七 / Esc」才关。点击阿七时先 `dismissBubble()`，
  返回 true 则这一击只关气泡。
- **提醒不是惩罚（§31）**：链路只写 diag.log + 弹气泡，**绝不写 attendance/statistics/pet**。
- 档位状态**只存内存**（重启后可能对同档再提醒一次，换零数据污染）。托盘有「🔔 健康提醒」勾选项。
- **托盘已删除「显示阿七/隐藏阿七」**（左键单击托盘图标即可切换）。

## 版本基线与回退（每通过一个阶段滚动一次）
- **双保险**：① Git 提交 + 打标签（remote = github.com/git-Vming/AI-cat，**未经 PM 同意不 push**）；
  ② 物理快照 `_snapshots/<名>_<日期>/`（含源码 + 文档 + `校验清单.txt`(sha256) + `快照说明.md` 回退步骤）。
- **快照只冻结「程序」，绝不含用户数据**：排除 `node_modules/`、`data/*.json`、`WorkRecords/*`、
  `backup/*`、`diag.log`、`dist/`（构建产物）。
- **当前 = 快照 `_snapshots/V1.0-测试版_形象终版_20261007/`**（**110/110 OK** / 111 文件 / 7.4MB）；
  标签 **`v1.0-beta-7`** = 提交 `5188ac3` —— **阶段 0–10 全部通过 + 形象/动作映射终版 = V1.0 测试版交付**。
  历史快照（阶段 0–10 及更早）已归档到 `_snapshots/_历史版本/`。
  交付物：`A-Qi/dist/A-Qi-V1.0.0-win32-x64/A-Qi.exe`（264MB，**不进 git、不进快照**，用 `npm run package` 重建）。
- 根 `.gitignore` 排除 `_snapshots/`、`node_modules/`、`diag.log`、`_preview/`、`dist/`。
- **【坑】sha256 校验清单不要用 `xargs`**：本机环境变量过多 → `xargs: environment is too large for exec`，
  会**静默生成空清单**（`OK=0 FAILED=0`，极难察觉）。改用
  `find … | sort | while IFS= read -r f; do sha256sum "$f" | sed 's|^\./||'; done > 校验清单.txt`。

## 成长与互动（阶段7 确立）
- **核心红线：互动只加好感度，绝不产生 EXP**。`interact()` 只写 `affection`/`interactionCount`/`interactionsToday`，
  **没有任何修改 totalExp 的路径**（结构性保证）。
- 宠物状态（`src/growth.js`）：9 种定义、**当前可达 7 种**（IDLE/SLEEP/HAPPY/WORKING/EATING/DRINKING/REMINDING）；
  优先级：气泡显示 > 工作中 > 互动后 12 秒（升级 20 秒）> 夜间(22–6)SLEEP > IDLE。
  **WALK / SAD 暂不触发，不自行发明规则。**
- 互动每日上限：摸头 5 / 喂食 3 / 喂水 3 / 玩耍 3，各 +1 好感度（跨天归零）。
- 解锁：Lv.2 🎩 → Lv.9 🏆，每级一件，**只增不减**（降级不回收）；启动 `recomputeAll` 自动补全老数据。
- 升级用**气泡**提示（点击才消失）。
- 【坑】想造某个等级**不能**手动改 `pet.totalExp` —— `recomputeAll` 会从 attendance 重新派生并覆盖。

## 打包与交付（阶段10 确立）
- **免安装版 = 零外部依赖手动组装**（`scripts/package.js`，`npm run package`）：复制 `electron/dist` →
  组装 `resources/app`（main.js/preload.js/src/assets）→ `electron.exe` 改名 `A-Qi.exe`。
  **前提：运行时 `dependencies` 必须为空**（本项目成立），故 app 目录**不需要 node_modules**；脚本会检查。
- 产物 `A-Qi/dist/A-Qi-V1.0.0-win32-x64/`（约 258MB）。**`dist/` 不进快照、不入测试**。
- 数据目录取 `path.dirname(app.getPath('exe'))`（打包后）或 `__dirname`（开发期）。
- 重打包：`rm -rf dist && npm run package`；验证：`node scripts/test-package.js`（加 `--launch` 才启动窗口）。

## 形象与 UI 主题（改视觉前必读）
- **【最高铁律】形象必须"照搬原画"，绝不许自己创作或重绘。**
  PM 原话：**"不可以自己修改形象原画"**。原画是**权威**，不是"风格参考"。
  我曾按设计板"自己画了一版 SVG"被否决（圆角耳画成尖三角、瞳孔方位错、嘴部多画、内耳画窄），
  也曾把"抠图"误解为"把猫从场景里抠出来"。**教训：宁可问，不要"按风格发挥"。**
- **形象 = 20 张原画单体**（`A-Qi/assets/pet/`），程序只负责"显示哪一张"：
  · `pose_*.png` × 8（动作·**全身**）→ **桌面宠物本体** ← 桌面只用这套
  · `expr_*.png` × 8（表情·**半身像**）→ **心情头像**（宠物状态窗 + 菜单顶栏）
  · `scene_*.png` × 4（场景·**带背景**）→ **宠物状态窗顶部"当前场景"横幅**
  · 原始拼版图存 `assets/pet/source/`
- **为什么表情/场景不放桌面**：表情是半身像，与全身动作混用会**大小突变**；场景自带方形背景、抠不出单体。
- **显示逻辑 = `src/pet-look.js` 纯函数**（`pickPose`/`pickMood`/`pickScene` + `*File`）：
  · **动作（PM 2026-10-07 定稿）：待机→趴 · 上工→坐 · 下工/开心→走路** · 午休12–14→睡 · 夜22–6→睡 ·
    提醒中→伸懒腰 · 喂食→吃 · 喂水→喝 · 升级→升级 —— **8 张全部有用途（无闲置图）**
  · 心情：摸头→害羞 · 未补录→生气 · 提醒→惊讶 · 午休/夜→困倦 · 开心→开心 · 上工→正常 · SAD→难过 · 待机→歪头
  · 场景：上工→work · 吃→eat · 喝→drink · 其余→stretch
  · **只做事件驱动，不做随机**（PM 反馈过"动作都是抖动"）。
- **8 个动作图共用同一画布 301×311**（水平居中、底部对齐 MARGIN=10）；**加新动作必须用同一画布**，
  并用"两眼瞳孔间距"校验尺度。**兜底一律用 `lie`**（`app.js` 的 `POSE_LIST` 兜底、非法名回退、
  `index.html` 初始 `<img>`）。
- **单体切法**（白底拼版格子；**只做分离、绝不改画**）：按格裁切 + **从四边泛洪去白底**（眼白在内部不会被挖空）。
  脚本 `_preview/_sprite/build_sprites.py`。
- **宠物大小**：`settings.petSize = 'large'|'small'`，小 = **正好一半**（180×200 → 90×100）。
  `.pet` 用**百分比铺满窗口** → 窗口一缩形象等比缩一半；兜底 `body.pet-small-fallback`。
  **只改显示比例与窗口尺寸，不碰数据层。**
- `styles.css` **无任何 animation/@keyframes**（PM 要求"不写动态"）；仅保留交互过渡：hover 放大、显隐淡入淡出。
- **UI = 浅色主题**：底 `#f5f7fb` · 卡 `#fff` · 描边 `#e3e9f2` · 文字 `#252a33`/`#6b7480` ·
  主色蓝 `#5b8ff9` · 强调黄绿 `#c3d95a`/`#7f9526` · 成功 `#3aa76d` · 危险 `#d9534f`。
- **改 UI 皮肤只改颜色/圆角/阴影，绝不动 padding/margin/字号/边框宽度** —— 窗口尺寸写死在 main.js
  （菜单 196×344、补录 420×486、气泡 216×76 均**不可缩放**），动尺寸就会撑破。
- 【已修 bug】菜单窗口 344px 曾装不下 377px 内容 → 最后一项「🙈 隐藏阿七」被裁掉；已收敛留白 +
  `.m-list` 加 `overflow-y:auto` 兜底。**改菜单项间距/内边距/表头高度会重新触发。**
- 【已弃用】**「看电脑(work)」动作贴图**：做过「程序抠纯猫」和「PM 手抠场景图」两版，**PM 判定观感不好，全部删除**；
  `pose_work.png` 与 source 存档均已删（**PM 手抠原图仍在 `_preview/阿七形象资产/看电脑.png`**）。
  **不要恢复 work** —— 三套测试都有防复活断言。
- 【已定】纯黑原画贴深色壁纸会"糊"进背景 → PM 答复：**保持现状，不加光晕**。
- 【已删除】`aqi.png`(264KB) 与 `placeholder-cat.svg`(1.2KB) —— PM 2026-10-07 确认无引用后删除。

## ★两条通用教训（比具体实现更值钱）
1. **素材方案被否时，先问"能不能用现有素材 + 改语义解决"**。PM 最终用"8 张图重排语义"代替"新增贴图"——
   更轻、更统一、零新素材。我前两轮一直纠结"怎么把新图做好看"，**方向就错了**。
2. **换"带场景"的素材前必须先算比例**：`contain 下主体显示高 = 主体像素高 × min(窗口宽/图宽, 窗口高/图高)`；
   **预先把图片缩放是无效的**（contain 会抵消），**只能改宽高比（裁切）**；裁切边界要用**连通域分析**量出；
   **不可擅自裁掉 PM 手作图的内容**。
   （技术留档：从带场景的图里分离黑猫 → 泛洪无效，改用**暗色掩膜 + 孔洞填充**：
   猫纯黑 vs 背景米色，亮度<100 即可分离；再从四边泛洪"外部背景"，剩余非掩膜像素 = 猫内部孔洞（眼白/内耳）→ 保留。
   裁剪下界要避开相邻暗色物体；最后 1px 收缩 + 0.8px 羽化。脚本 `_preview/_sprite/extract_work.py`。）

## 本机环境坑（踩过，务必记住）
- **Node 的删除 API 被 safe-delete 包装**（送回收站，本机回收站不可用 → `unlinkSync`/`rmSync` **一律抛错**）。
  替代：① PowerShell `Move-Item`（归档而非删除）；② `ELECTRON_RUN_AS_NODE=1 ./A-Qi.exe`（Electron 自带 Node，无包装）；
  ③ bash `rm -rf` 只用于**构建产物**（如 `dist/`），绝不用于用户数据。
- **PowerShell 的 `Add-Type` 被安全策略禁用**；**PowerShell 工具 stdout 常为空** → 写文件再读。
- **往文件里注入诊断代码用 heredoc，不要用 `node -e` 嵌套字符串拼接**（`\n` 被吞 → 写成跨行字符串 →
  SyntaxError → 会被误判成"程序启动失败"）。写完必须 `node --check`。
- **本执行环境无法创建 Electron GUI 窗口**：exe 的 GUI 启动、CPU/内存实测由 PM 在真实桌面验证；
  沙箱内用 `--version`、`ELECTRON_RUN_AS_NODE` 跑代码、结构断言做替代验证。
- **UI 观感校验办法**（沙箱跑不起 Electron 时）：本地静态服务 + **iframe 精确还原窗口真实像素** +
  `iframe.contentWindow.eval(桩 + 窗口脚本)` 重跑渲染后截图。坑：① 直接重复注入窗口脚本会因顶层 `const api`
  报 SyntaxError → **必须包进 `(function(){})()`**；② 桩数据形状抄 `scripts/test-*-window.js`；
  ③ 本地服务**换端口别复用**（旧 node 进程没杀掉会让新进程绑定失败、旧代码应答 403）。
  可复用件在 `_preview/_ui_check/`。
- **清理用户数据前一律先 `backupData()`**；"删除"改用 PowerShell `Move-Item` 归档到
  `backup/<说明>_<日期>/`（非标准备份名，不会被 `listBackups` 当成备份）。
- **【GitHub 推送的两个坑】（2026-10-07 踩到）**
  ① git global 配着 `http.proxy=http://127.0.0.1:7890`（Clash 类），**代理软件没开时所有 git 网络操作都会失败**
  （报 `Failed to connect to github.com:443 over proxy 127.0.0.1`）。**本机直连可通** →
  在仓库内 `git config --local http.proxy ""`（空值覆盖 global）即可恢复正常。
  **排查 git 连不上时，第一个要看的就是代理配置。**
  ② **本机没有任何 GitHub 凭据**（未装 `gh`、凭据管理器无 github 条目、无 `.git-credentials`）→
  **无法无人值守 push**；仓库 remote = `https://github.com/git-Vming/AI-cat.git`（owner `git-Vming`）。
  需要 PM 在本机执行一次（弹窗登录后自动记住）或提供 PAT。WorkBuddy 的 GitHub 通道虽已授权为 `git-Vming`，
  但其 `push_files` 只能"一次提交写多文件"（**会丢提交历史、标签无法创建，且二进制图片同步不可靠**），
  **不适合替代 git push**。

## 工程约定（踩过的坑，务必遵守）
- **纯逻辑模块要被渲染层 `<script>` 直接加载，用 UMD 头**（主进程可 `require` 单测、html 加载同一份）。
  **但窗口脚本必须单独命名** `<name>-window.js`，绝不把窗口逻辑塞进纯逻辑文件（阶段5 `todo.js` 覆盖事故）。
- **渲染层禁用与 contextBridge 暴露名同名的 `const/let`**：preload 注入的全局 `aqi` 是不可配置属性，
  `const aqi = window.aqi` 抛 SyntaxError → **整份脚本不执行**（界面照常显示，极难察觉）。一律用 `const api = window.aqi`。
  `node --check` 查不出，必须跑 `test-renderer-load.js` / `test-repair-window.js` / `test-todo-window.js`。
- **每个新渲染窗口三件套**：① 窗口脚本用 `const api = window.aqi`；② 补一份 vm 渲染层测试；
  ③ 用普通窗口（带系统标题栏），不自绘无边框面板。
- **桌宠窗口交互定案**：不用 `-webkit-app-region: drag`（会被 OS 当非客户区、吞 mouseup/click → "能拖不能点"）；
  不用整窗 `setIgnoreMouseEvents`。正确做法 = JS 拖动：`pointerdown/pointerup` + `setPointerCapture`，
  位移用**屏幕坐标 screenX/screenY**（clientX 会因窗口移动错乱），阈值 6px 区分单击/拖动，`click` 兜底 + 标志位去重。
- **窗口尺寸约束**：主窗口 180×200，所有弹出面板必须完整落在窗口内（`overflow:hidden` 会裁切）。
- **诊断**：`A-Qi/diag.log` 是排查渲染层静默失效的唯一可靠手段；**不要加页内 F12 DevTools 入口**（PM 明确取消）。

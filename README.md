# DSH 余额宠物 · Harness 插件版

> 把 Windows 桌面挂件「DSH 余额宠物」搬进 DeepSeek Harness 的页面里：
> 她站在页面左下角举着一块平板显示你的 DeepSeek 余额，每花掉 0.01 元就红闪、
> 震一下、头顶弹出红色的 `-0.01`；充值不掉数字，而是从天上掉下一盆米饭 ——
> 把盆拖到她身上才入账。

<p>
  <img alt="platform" src="https://img.shields.io/badge/platform-DSH%20Desktop%202.0.x-1f6feb">
  <img alt="client" src="https://img.shields.io/badge/client-web%20overlay-8957e5">
  <img alt="licence" src="https://img.shields.io/badge/licence-MIT%20%2B%20asset%20notice-2ea043">
  <img alt="deps" src="https://img.shields.io/badge/runtime%20deps-none-6e7781">
</p>

<p>
  <img src="assets/expression_happy.png" alt="开心" width="150">
  <img src="assets/expression_nervous.png" alt="紧张" width="150">
  <img src="assets/expression_aloof.png" alt="傲娇" width="150">
  <img src="assets/expression_calm.png" alt="冷脸" width="150">
</p>

---

## ⚠️ 关于作者与来源（请先读这一段）

**这个 Harness 插件是我（一个 AI 编程助手）写的**：`index.js`、`client.js`、
`package.json`、`cordis.patch.yml`、`tools/` 与本文档，都是在本仓库里为这次移植
新写的代码。

**但它不是原创作品，而是对下面这位作者作品的「移植 / 改编」（port / adaptation）：**

| | |
| --- | --- |
| **原作者** | **VKmich16** |
| **GitHub** | <https://github.com/VKmich16/VK-1> |
| **B 站** | **VKmich16** · <https://space.bilibili.com/1836020534?spm_id_from=333.788.upinfo.detail.click> |
| **原作** | Windows 桌面挂件 **「DSH 余额宠物」**（PowerShell + WinForms + GDI+），B 站演示见 [DSH余额挂件改进型 D-16B](https://www.bilibili.com/video/BV1cYa56fEyR/)、[D-16BVM](https://www.bilibili.com/video/BV1ZjHi6XEAp/) |
| **本仓库做了什么** | 把原作的**行为**逐条搬到 Harness 的页面里（读余额、扣费红闪、掉盆、喂食、铁盆、差分表情、火控雷达、右键菜单…），并补上原作没有的 Host/Client 分离与 API Key 托管 |

**所有美术与音效素材（`assets/` 全部内容）都来自原作 / 原作者**，不是本仓库生成的
（例外：`assets/flash.png` 是用 `tools/make_flash.ps1` 从原作立绘派生的红闪层）。
`reference/` 目录里放的是原作脚本与说明文档，仅作移植对照。

**因此：**

- 如果你是**使用者**：放心装、放心用，但请把上面的署名一起保留。
- 如果你是**要二次分发 / 打包发布的人**：请先确认你有权分发 `assets/` 与
  `reference/` 里的素材；没有授权就删掉这两个目录（插件主体代码仍可运行，
  自行替换素材即可）。详见 [LICENSE](LICENSE) 末尾的 Third-party notice。
- 如果你就是 **VKmich16** 本人，且不希望本仓库以这种形式存在：提个 issue，
  我会立刻下架或按要求整改。

> 换句话说：**代码 = 本仓库（AI 移植），创意与素材 = VKmich16（原作）。**
> 请按这两句话来署名。

---

## 目录

- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [和桌面版一致的行为](#和桌面版一致的行为)
- [右键菜单](#右键菜单)
- [余额从哪来 / API Key 怎么给](#余额从哪来--api-key-怎么给)
- [开发者说明](#开发者说明)
- [四个必须记住的实现约束](#四个必须记住的实现约束)
- [自检与排错](#自检与排错)
- [文件](#文件)
- [素材](#素材)
- [与桌面版的差异](#与桌面版的差异)
- [许可](#许可)

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 实时余额平板 | 每 2 秒查一次 DeepSeek 余额，显示在平板屏上 |
| 扣费演出 | 余额每掉 0.01 元：整只红闪 + 抖动 + 打击音 + 头顶弹出红色 `-0.01`，连扣时数字串成一条 |
| 充值掉盆 | 余额上升时从上方掉下一盆米饭（自由落体 + 弹跳）；屏幕上数字先不动 |
| 喂食 | 左键把米饭盆拖到她身上（碰到身体就算）→ 盆消失、冒爱心、喂食音、这笔一次性入账 |
| 自动吸附 | 米饭盆落地 **5 秒**没被喂 → 火控雷达锁定 → 再过 1 秒自动被拖过去 |
| 火控雷达 | 绿色方括号 + `RNG` 距离 / `Vc` 接近率 / `Alt` 相对高度 + 方位环 + `LOCK` 倒计时 |
| 铁盆（彩蛋） | 吃掉米饭盆会掉出一口铁盆；拖到她头上她会**顶着锅**（整个人压扁一点、变成冷脸），双击可以弹飞 |
| 四种表情 | 开心 / 紧张（扣费中）/ 傲娇（盆满 5 秒没喂）/ 冷脸（顶着锅） |
| 拖动 | 左键按住**她本人**拖动；拖道具只动道具 |
| 位置 | 右键菜单「位置 ▸」：内容区左下角（默认）/ 窗口左下角 / 右下角 / 左上角 / 右上角 |
| 尺寸 | 中杯 340 / 大杯 454 / 超大杯 624，也可以自己填像素 |
| 音效 | 自有打击音与喂食音，音量与开关独立于系统音量 |
| 主题与语言 | 浅色 / 深色，菜单中/英自动跟随 |
| 模拟测试 | 菜单里可以模拟一次扣费、模拟充值 3 元、自定义金额、连续扣费演示 |

## 安装

**依赖**：DSH Desktop 2.0.x（React 运行时由宿主提供，本包**没有**运行时依赖）。

1. 把本仓库克隆或复制到任意目录，例如 `D:\plugins\dsh-balance-pet`。

2. 在 DSH Desktop 的插件管理器里，用**本地包路径**添加它；或者把这个片段插进你的
   profile（和 `cordis.patch.yml` 内容一致）：

   ```yaml
   - insert:
       - id: dsh-balance-pet
         name: '@local/dsh-balance-pet'
         config: {}
   ```

   > `name` 必须与 `package.json` 的 `name`（`@local/dsh-balance-pet`）一致，
   > 否则 DSH 找不到模块。改包名时**两处一起改**。

3. 给一个 API Key，三选一（详见 [余额从哪来](#余额从哪来--api-key-怎么给)）。

4. 启用插件 → **刷新页面**。

## 使用

装好后她就在页面左下角。常用操作：

| 想做什么 | 怎么做 |
| --- | --- |
| 打开菜单 | **右键点她**（或右键点铁盆/米饭盆） |
| 移动她 | 左键按住她拖 |
| 喂她 | 把掉下来的米饭盆拖到她身上 |
| 给她戴锅 / 摘锅 | 把铁盆拖到她头上 → 戴；**双击铁盆**（或双击她头顶）→ 弹飞 |
| 看余额立刻更新 | 菜单 →「立即刷新余额」 |
| 试一次扣费效果 | 菜单 →「测试一次扣费效果」 |
| 试一次充值效果 | 菜单 →「测试充值动画 ▸ 模拟充值 3 元」 |
| 换位置 / 换大小 | 菜单 →「位置 ▸」/「尺寸 ▸」 |

## 和桌面版一致的行为

| 行为 | 说明 |
| --- | --- |
| 平板读数 | 实时余额，每 2 秒查一次；数字永远只在扣费那一帧变化，一次只扣 0.01 |
| 扣费节奏 | 差额换算成 N 个 0.01，每 0.2 秒扣一次，每次都有完整的红闪 + 飘字 + 音效 |
| 红闪 | 立绘整体盖一层纯红剪影（RGB 255,48,34），不透明度跟随桌面版公式 `max(0.30, 0.64-0.75*scale)` |
| 飘字连击 | 连续扣费时数字依次向上错开（0.7 行），串成一条，不会叠在一起 |
| 排队上限 | 单次轮询最多排 40 次（0.40 元），剩余的在下一次轮询继续 |
| 掉米饭盆 | 余额上升时从上方掉下一盆（自由落体 + 弹跳），屏幕数字先不动 |
| 喂食 | 拖到她身上 → 盆消失、头顶冒爱心、放喂食音效、这笔一次性入账 |
| 火控雷达 | 有米饭盆时出现绿色方括号 + 距离 / 接近率 / 相对高度 + 方位环 + 锁定倒计时 |
| 自动吸附 | 落地 10 秒 → 锁定 → 1 秒后吸走（本插件按用户要求改成 **5 秒**锁定） |
| 铁盆 | 吃掉米饭盆后掉出；拖到头上会戴上（她压扁成 0.9、表情转冷脸），双击弹飞 |
| 平板读数位置 | 压在平板屏正中，四张差分图共用同一位置（`tools/check_quad.ps1` 校验） |
| 道具层级 | 铁盆 / 米饭盆画在她**前面**，戴上头的铁盆再抬一层，能盖住平板读数 |

## 右键菜单

```
立即刷新余额
──────────────
测试
  测试一次扣费效果
  测试充值动画 ▸
    模拟充值 3 元（掉米饭盆）
    打开火控雷达
    ──────────────
    自定义…
  演示连续扣费 ▸
    扣 0.1 元
    扣 1 元
    ──────────────
    自定义…
──────────────
显示
  尺寸 ▸  中杯 340 px / 大杯 454 px / 超大杯 624 px / 自定义…
  位置 ▸  内容区左下角 / 窗口左下角 / 左下角 / 右下角 / 左上角 / 右上角
  主题 ▸  浅色 / 深色
  菜单语言 ▸  自动 / 中文 / English
  声音 ▸  开 / 关 / 音量 ▸ 0…100 / 自定义…
──────────────
系统
  设置 API Key…
  隐藏宠物
  退出
```

## 余额从哪来 / API Key 怎么给

页面**永远拿不到 Key**：所有请求都走 Host 半边的 `index.js`，Key 只在 Host 进程里
存在，页面只知道余额数字。取 Key 的顺序：

```
插件 config  →  DSHPET_KEY  →  DEEPSEEK_API_KEY  →  插件目录 apikey.txt  →  ~/.dsh/apikey.txt  →  ~/.dsh/.credentials.yaml
```

取不到 Key 时平板显示 `--` 加一行原因说明，挂件其余功能照常。

> `apikey.txt` 已在 [.gitignore](.gitignore) 里，**不会**被提交。别人 clone 之后
> 需要自己放一个，或用菜单里的「设置 API Key…」。

## 开发者说明

### Host 半边（`index.js`）

| 路由 | 作用 |
| --- | --- |
| `GET /api/dsh-balance-pet/assets/<name>` | 提供 `assets/` 里的文件（带白名单，防目录穿越） |
| `GET /api/dsh-balance-pet/balance` | 代理 DeepSeek 余额查询，Key 不出 Host |
| `POST /api/dsh-balance-pet/key` | 保存用户填的 Key |
| `GET/POST /api/dsh-balance-pet/report` | 页面把自检结果回传 Host，供 `/pet-check` 读取 |

斜杠命令 `/pet-check [--json]`：检查资产是否齐全（含 `flash.png`）并报告余额能否取到。

### 页面半边（`client.js`）

单文件约 3.9k 行，结构：

- `createEngine()` —— 仿真与渲染：`sim`（状态）+ `tick(dt)`（物理/计时）+ `renderFrame()`（DOM 写值）
- 引擎由 `setInterval(33ms)` 驱动，按 50ms 定步长积分（原因见下面的约束 3）
- `window.__ModuleLoader__.load({ id, factory })` 是页面半边的加载入口
- 通过 `ctx.slots.inject('shell.overlay', …)` 挂到 Harness 的浮层槽位上

### 调试通道

插件注册了一条**只读**的 Client Inspect provider `PetStatus`（`probe | act | getStatus`，
`act` 支持 `charge / topUp / radar / potCheck / bowlCheck / faceCheck / dialogCheck /
rowCheck / refreshCheck / knockCheck / headProfile …`），可以在不碰运行时的前提下
读取页面里的真实状态。本 README 里所有"实测"数据都是它读回来的。

### 怎么改

| 想改什么 | 改哪里 |
| --- | --- |
| 尺寸 / 位置 / 时间 / 表情顺序 | `client.js` 顶部的常量（`SIZES`、`DEFAULTS`、`BOWL_WAIT`、`POT_*`…） |
| 菜单项与文案 | `client.js` 的 `TEXT` 与 `menuModel()`；`locale/zh.json`、`locale/en.json` |
| 接口 / Key 逻辑 | `index.js` |
| 换图换音 | 覆盖 `assets/` 同名文件后刷新页面；**换立绘**要重跑 `tools/make_flash.ps1` 重新生成红闪层 |

## 四个必须记住的实现约束

都是在真实页面上踩出来的，改代码前值得先读：

1. **宿主把插件组件当静态元素挂载：状态更新不会让它重渲染。**
   所以任何会变的东西（菜单、平板数字、盆、飘字、名牌）都必须由引擎直接操作
   DOM，不能靠 React 状态。菜单最初写成 React 组件，结果右键点了什么都不出现；
   现在的菜单是 `openMenu()` 时用 `document.createElement` 现场搭出来的 DOM，
   右键、拖动、双击都在 `start()` 里用 `window.addEventListener(…, true)` 手动绑定
   —— 挂在 React 属性上时**实测根本没被调用**。

2. **`setPointerCapture` 必须在监听器注册之后调用。** 它会把该 pointer 后续所有
   事件重定向到该元素，所以先 capture 再 `addEventListener` 会让 move/up 永远收不到
   —— 表现就是「按下去有反应，但拖不动」。对合成 pointer id 不要 capture
   （没有活动 pointer），只看 `event.isTrusted`。

3. **页面是隐藏标签页时 `requestAnimationFrame` 完全不触发**（实测
   `document.visibilityState === "hidden"`）。引擎原来只靠 rAF 驱动，于是米饭盆不掉、
   扣费动画不播、平板数字冻住。现在引擎由 `setInterval(33ms)` 驱动，并把真实流逝
   时间按 50ms 定步长积分补上：隐藏时 1Hz 节流仍能推进，切回来立刻追平，也不会因
   一大步积分而穿地板。

4. **不要在 1px 容器上用 `em`。** 曾经把基准设成 `105×scaleX`、子元素用 `0.27em`
   继承，字号被算成 6666px、文字块变成 75522×80991 并被推到 y=-11271，被外层
   `overflow:hidden` 裁掉 —— 平板一片黑。现在读数位置与字号全部按量出来的平板四角
   算成绝对像素。同理，道具尺寸要在**一处**定义：`resizeProp()` 原来把「非米饭盆」
   一律按 `0.46` 重设，每次布局都把铁盆的尺寸覆盖回去，改多少次都看不出效果。

> 还有一个操作层面的坑：**不要用 PowerShell 往返写这两个源文件。**
> `Get-Content -Raw` + `Set-Content` 会把 UTF-8 当 ANSI 解码再写回，中文全部变成
> 乱码、字符串字面量的引号也会被吃掉。用编辑工具直接改。

## 自检与排错

在会话里输入斜杠命令：

```
/pet-check          # 资产是否齐全（含 flash.png）+ 余额能不能取到
/pet-check --json   # 附带每个资产的字节数
```

平板上出现异常文字时，对照这张表：

| 平板显示 | 含义 | 处理 |
| --- | --- | --- |
| `DSH 余额` + `¥xx.xx` | 正常 | — |
| `offline` + `--` + `未找到 API Key` | Host 侧没找到 Key | 菜单 →「设置 API Key」贴一个，或把 `apikey.txt` 放进插件目录 |
| `offline` + `--` + `API Key 无效` | 接口返回 401/403 | 换一个 Key |
| `offline` + `--` + `取余额失败（网络/超时）` | 这台机器连不上 `api.deepseek.com` | 检查网络或代理 |
| 左下角红块写着 `余额宠物渲染失败` | 页面半边启动就报错了 | 把红块里的文字发出来 |

| 症状 | 先检查 |
| --- | --- |
| 菜单点了没反应 / 数字不动 | 刷新页面（页面半边每次加载现取；Host 半边要重新启用一次插件才生效） |
| 右键没反应 | 是不是点在透明区域？只有她本人和道具可点 |
| 拖不动 | 见上面约束 2（`setPointerCapture` 顺序） |
| 铁盆位置/大小不对 | `POT_WORN_W` / `POT_RIM_Y` / `POT_HEIGHT` 三个常量，注释里有推导过程 |
| 表情不切换 | 看 `renderError`（渲染抛异常会让整帧中断、表情冻住） |

## 文件

| 文件 | 说明 |
| --- | --- |
| `package.json` | 插件清单（Host 入口 + `dsh.client` 段 + 图标） |
| `cordis.patch.yml` | 往 profile 里插入一行 `dsh-balance-pet` |
| `index.js` | Host 半边：资产路由、余额代理、`/pet-check` |
| `client.js` | 页面半边：立绘 / 平板读数 / 动画 / 物理 / 雷达 / 菜单 |
| `assets/` | 立绘 `sprite.png`、四张表情差分、红闪层 `flash.png`、`rice.png`、`iron_bowl.webp`、`hit.mp3`、`feed.mp3` |
| `apikey.txt` | Host 读取的 API Key（**已被 .gitignore 忽略，不要提交**） |
| `icon.svg` | 插件卡片图标 |
| `locale/` | `zh.json` / `en.json` |
| `tools/` | 开发辅助脚本，见 [tools/README.md](tools/README.md)；**运行插件不需要它们** |
| `test/` | 开发期实验台 `dom-test.cjs` + `mini-react.cjs`（**尚未跑绿**，非发布阻塞项） |
| `reference/` | 原作脚本与说明文档，仅作对照，见 [reference/README.md](reference/README.md) |

## 素材

**立绘、表情差分、音效均来自原作（作者 VKmich16），不是本仓库生成的。**
对应关系：

| 文件 | 来源 |
| --- | --- |
| `assets/sprite.png` | 原作立绘 |
| `assets/expression_happy.png` | 原作开心差分 |
| `assets/expression_aloof.png` | 原作傲娇差分 |
| `assets/expression_calm.png` | 原作冷脸差分 |
| `assets/expression_nervous.png` | 原作紧张差分 |
| `assets/rice.png`、`assets/iron_bowl.webp` | 原作米饭盆 / 铁盆素材 |
| `assets/hit.mp3`、`assets/feed.mp3` | 原作打击音 / 喂食音 |
| `assets/flash.png` | 本仓库用 `tools/make_flash.ps1` 从原作立绘**派生**的红闪层（RGB 255,48,34，保留 alpha，与桌面版 `BuildRedLayer` 一致） |

四张差分图的平板位置与立绘一致（`tools/check_quad.ps1` 校验过），所以读数不会跑偏。

## 与桌面版的差异

| | 桌面版 | 插件版 |
| --- | --- | --- |
| 位置 | 屏幕左下角，浮在所有窗口之上 | 页面左下角，浮在 Harness 之上（透明区域鼠标穿透） |
| 可移动 | 拖动后回弹到左下角 | 拖动后停在原地，或菜单「位置 ▸」选 |
| API Key | 自己读 `.credentials.yaml` 或弹框填 | Host 侧读取，页面永远拿不到 Key |
| 设置保存 | `state.ini` | `localStorage` |
| 尺寸 | 菜单里按像素选 | 同上，另外可填自定义像素 |
| 托盘图标 | 双击触发一次扣费 | 无托盘；用右键菜单「测试一次扣费效果」 |
| 铁盆挡掉落物 | 会挡 | 不挡（按用户要求去掉了碰撞） |
| 锁定时间 | 10 秒 | **5 秒**（按用户要求） |
| 戴锅时扣费表情 | 保持冷脸（原作规则：铁盆优先级最高） | **露紧张脸**（按用户要求调换了这两条优先级） |
| 换图 / 换音 | 覆盖同名文件 | 覆盖 `assets/` 同名文件后刷新页面 |

## 许可

- **本仓库新增的代码与文档**：MIT，见 [LICENSE](LICENSE)。
- **`assets/` 的美术与音效、`reference/` 的原作脚本与文档**：**不适用** MIT，
  版权归原作者 **VKmich16**（<https://github.com/VKmich16/VK-1>）。

二次分发前请确认你有权分发这些素材；没有的话删除 `assets/` 与 `reference/`
并自行替换即可（代码主体不依赖具体素材内容，只依赖文件名与尺寸关系）。

---

<p align="center">
  原作 <a href="https://github.com/VKmich16/VK-1">VKmich16/VK-1</a> ·
  B 站 <b>VKmich16</b> ·
  Harness 插件移植由 AI 编程助手完成
</p>

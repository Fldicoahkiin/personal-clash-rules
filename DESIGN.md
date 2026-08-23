---
name: 订阅转换
description: 以线路总图呈现订阅转换和个人代理规则的命中路径。
colors:
  paper: "#faf8f4"
  surface: "#faf8f4"
  surface-muted: "#e8efed"
  ink: "#091e37"
  muted: "#4a5e6e"
  faint: "#65959c"
  line: "#b6c5c8"
  line-strong: "#091e37"
  accent: "#085f68"
  accent-hover: "#064e56"
  accent-soft: "#d3e4e1"
  success: "#237a4b"
  danger: "#a23e46"
  code: "#152a3b"
  code-ink: "#eef2ef"
  action-ink: "#f7faf8"
typography:
  display:
    fontFamily: "Flacier Display, Noto Sans SC, sans-serif"
    fontSize: "clamp(2.35rem, 3.8vw, 3.15rem)"
    fontWeight: 400
    lineHeight: 1.02
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Flacier Display, Noto Sans SC, sans-serif"
    fontSize: "clamp(1.7rem, 3vw, 2.7rem)"
    fontWeight: 400
    lineHeight: normal
    letterSpacing: "-0.015em"
  title:
    fontFamily: "SF Pro Text, Avenir Next, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 650
    lineHeight: normal
    letterSpacing: "-0.02em"
  body:
    fontFamily: "SF Pro Text, Avenir Next, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: normal
    letterSpacing: normal
  label:
    fontFamily: "SF Pro Text, Avenir Next, PingFang SC, Noto Sans SC, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 650
    lineHeight: normal
    letterSpacing: normal
  mono:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "0.76rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: normal
  routeValue:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "0.92rem"
    fontWeight: 680
    lineHeight: 1.35
    letterSpacing: normal
  routeTerminal:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "1.08rem"
    fontWeight: 680
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  square: "0"
  sm: "2px"
  full: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "42px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 15px"
    height: "42px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "44px"
  route-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "52px"
  client-tab:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    rounded: "{rounded.square}"
    padding: "7px 9px"
    height: "42px"
  route-node:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.full}"
    height: "21px"
    width: "21px"
  profile-item:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "12px 20px"
    height: "72px"
  profile-item-active:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.accent}"
    rounded: "{rounded.square}"
    padding: "12px 20px"
    height: "72px"
---

# Design System: 订阅转换

## Overview

**Creative North Star: "线路总图"**

订阅转换像一张正在工作的规则地图册：冷白纸面承载深蓝细线、索引、表格和普通圆点，青色只标出当前选择与可执行动作。信息以可读线路组织，用户能从网址一路读到命中规则与策略，而不是在卡片之间猜测关系。

界面属于操作工具，不采用营销首屏、玻璃拟态或装饰性信号灯。规则命中站可使用绿灯或红灯，但必须同时写出“通过 / 未通过”、实际规则和最终路线。密度来自清楚的表格分隔、紧凑标签和稳定对齐；品牌感来自自托管得意黑标题与路线图语法。

**Key Characteristics:**

- 冷白地图纸、深蓝描线和青色主线路；绿与红只承担规则命中语义。
- 线路、索引和表格优先于卡片与插画。
- 小圆角控件配合方正容器，普通站点保持青色描边圆站。
- 简体中文短句承载任务；机器可读值才切换为等宽字体。
- 动效只解释一次成功的线路计算，并尊重 reduced-motion。

## Colors

色彩像印在冷白工程纸上的深蓝墨线；青色用量克制，只用于当前路线、交互与少量状态反馈。

### Primary

- **线路青**（`accent`）：主要按钮、选中节点、当前路线、链接和输入焦点。
- **深线路青**（`accent-hover`）：悬停状态与较小的策略代码，保证交互有明确回馈。

### Neutral

- **冷白地图纸**（`paper`、`surface`）：页面和工作区的统一底色，不制造独立漂浮卡片。
- **浅青灰分区**（`surface-muted`、`accent-soft`）：输出区、选中列表项和低层级区分。
- **深蓝墨色**（`ink`、`line-strong`）：正文主色、结构边框与分支线路。
- **说明蓝灰**（`muted`、`faint`）：辅助文字、表头和占位信息。
- **制图细线**（`line`）：分隔、表格行、输入边界和未选线路。
- **代码深底**（`code`、`code-ink`）：转换结果的高对比代码区域。
- **通过绿 / 未通过红**（`success`、`danger`）：只用于规则站的文字化检查状态；`danger` 同时用于表单错误。

**The Route Color Rule.** 青色表达线路、操作和选择；绿与红只表达规则站的“已命中 / 未命中”，并始终配文字。不要使用橙色或增加其他强调色。

## Typography

**Display Font:** Flacier Display（自托管得意黑 v2.0.1，回退到 Noto Sans SC）

**Body Font:** SF Pro Text（回退到 Avenir Next、PingFang SC、Noto Sans SC）

**Label/Mono Font:** SFMono-Regular（回退到 Consolas、monospace）

**Character:** 得意黑仅承担页面与区段标题，让工具保留鲜明但不夸张的中文识别度。正文使用系统无衬线，等宽字体只标示 URL、规则文本、策略代码、数量和节点组代号。

### Hierarchy

- **Display:** 首页任务标题；低字重、紧行高，移动端保持明确的第一层级。
- **Headline:** 转换、策略、规则等区段标题，不扩展成营销口号。
- **Title:** 索引标题、品牌名和表格行主标签；使用较重字重建立扫描锚点。
- **Body:** 说明、覆盖范围和操作文案；保持短句，不用大段叙事。
- **Label:** 字段名、表头和状态说明；字号紧凑但保持可读。
- **Mono:** URL、规则、策略、节点组与输出内容；普通中文说明不得使用等宽字体。

**The Machine Text Rule.** 只有需要被复制、匹配或逐字识别的值使用等宽字体；产品标题和操作文案始终使用中文显示或正文体系。

## Layout

页面使用最大宽度 1440px 的单列纵向流，桌面两侧各保留 20px 外边距，820px 以下缩为 12px。首屏在 1100px 以上为“主线路 + 350px 索引”的两栏总图；网址、规则、策略组和最终路线沿四站线路排列。1100px 以下索引移到底部，820px 以下测试表单改为单列、线路改为纵向，节点和值按行排列。

操作区以边框相接或顺序堆叠，不用大面积卡片间隙制造碎片。转换工作区和策略表在桌面保留并排/横向结构；820px 以下转换区改单列，宽策略表允许水平滚动，规则目录折成两列信息行。520px 以下隐藏横向页内导航，按钮与底部动作改为满宽。

**The Continuous Sheet Rule.** 同一任务的相邻区块应通过共享边框或连续纸面连接；只有任务阶段真正变化时才使用较大的纵向留白和分隔线。

## Elevation & Depth

系统没有常驻投影。层级由边框粗细、底色变化、虚实线型和代码区的深色反转建立；客户端当前项底部的内嵌青色标记表达客户端选择，管理页的当前方案则只使用浅青灰底、青色文字和字重，不使用条纹或侧边色带。

**The Flat Map Rule.** 所有工作区在静止状态保持平面；不要为容器、按钮或表格添加投影、模糊或玻璃效果。

## Shapes

输入与按钮使用轻微直角小圆角；工作区、索引、表格和代码容器保持方正。圆形只属于线路节点、命中信号与策略选项：规则命中为实心绿点，未命中为实心红点，其余站点使用青色描边与冷白内芯。

**The Diagram Geometry Rule.** 方框承载信息，圆点承载路线状态；不要把区块普遍改成胶囊或大圆角卡片。

## Components

### Buttons

- **Shape:** 与输入一致的 2px 小圆角，通用按钮最小高度 42px；网址测试按钮在桌面占据输入框末端。
- **Primary:** 线路青底、浅色文字、1px 同色边框；用于测试、转换、导入和主要下载。
- **Hover / Focus:** 悬停转为深线路青；键盘焦点使用青色半透明 3px 外轮廓。禁用态降低透明度并显示不可用或等待光标。
- **Secondary:** 冷白底、制图细线边框；悬停只加深边框，不制造抬升。

### Inputs / Fields

- **Style:** 冷白底、深蓝文字、1px 深线与 2px 小圆角。普通字段高 44px，首屏网址字段高 52px。
- **Focus:** 普通工作区字段把边框切换为线路青；首屏网址字段保留可见外轮廓。
- **Error / Disabled:** 错误使用错误红文字或边界；不可用动作降低透明度，不用隐藏来代替状态说明。

### Navigation

- **Style:** 顶栏固定在页面顶部，以底部深线连接整张纸面。导航是无底色的文字标签，悬停时出现细边与纸面底色；520px 以下隐藏页内链接，只保留品牌和 GitHub 图标入口。

### Management Access Gate

- **Style:** 未授权时只显示居中的“进入订阅管理”与管理令牌表单，不提前露出方案、来源或固定链接。44px 密码字段与主按钮无缝相接，外侧保留 2px 小圆角，内部接缝不重复描边。
- **State:** 令牌为空时“进入”按钮禁用；授权失败继续停留在 gate。界面不宣称长期登录，当前实现只在浏览器标签页会话内保存管理令牌。

### Profile Rail

- **Style:** 桌面管理页使用 260px 左侧方案栏和连续纸面主区；方案行高 72px，以细线逐行分隔。
- **State:** 当前方案只使用浅青灰底、线路青文字和较重名称；不要增加斜纹、条纹、侧边色带或装饰图案。悬停可复用浅青灰底，但不改变文字为线路青。

### Client Selector

- **Style:** 客户端按共享网格排列，无圆角、无卡片间隙；每项使用 20px 官方图标和名称，由相邻细线分隔。
- **State:** 当前项使用浅青灰底、深蓝文字与底部 3px 青线，未选项保持透明底和说明蓝灰文字。
- **Assets:** 只使用 `public/client-icons/` 中已收录的官方产品图标；来源、许可边界与 PNG XMP 元数据记录在 `THIRD_PARTY_NOTICES.md`，不得用 emoji、通用占位图或无来源的搜索结果替换。

### Route Diagram

- **Style:** 桌面用两条 2px 青线和短枕木连接四个站点，线段停在节点边缘；移动端改为两条 1px 竖线和横向短枕木。实际网址、命中规则、策略组和最终 `DIRECT` 或 `PROXY` 写在线路节点上方，辅助说明写在节点下方。
- **Signal:** 只有规则站使用红绿状态。绿点配“通过”，红点配“未通过”；颜色不能代替文字。
- **Behavior:** 每次测试只播放 240ms 节点落位；第二、三站分别延迟 70ms 与 140ms，`prefers-reduced-motion: reduce` 时完全静止。双轨本身不执行描线动画。

### Tables and Indexes

- **Style:** 表头使用小号说明色文字，行以 1px 实线或点线分隔；策略、数量和规则代号用等宽字体。初始节点组用实心青色圆点，其他选项使用深线空心圆。

### Code Output

- **Style:** 转换结果使用代码深底与浅色等宽文字，允许滚动并保留换行；空状态则回到浅青灰纸面和虚线边框。

## Do's and Don'ts

### Do:

- **Do** 把规则决定画成从网址、实际规则、策略组到最终路线的四站双轨，并让节点、标签和值共享对齐轴。
- **Do** 用表格、索引、细线和连续纸面组织高密度配置内容。
- **Do** 让青色稀缺，只标记主动作、当前选择、焦点或命中路线。
- **Do** 在移动端把横向关系转换为纵向顺序，并保持原有信息与操作。
- **Do** 仅对 URL、规则文本、策略代码和节点组代号使用等宽字体。
- **Do** 使用已记录来源的官方客户端图标，并保持 20px 图标与文字名称同时可见。

### Don't:

- **Don't** 使用玻璃拟态、漂浮卡片堆、营销式大标题或装饰性插画。
- **Don't** 引入橙色、无文字的装饰信号灯、发光节点或多套竞争性的强调色。
- **Don't** 给平面工作区添加投影、模糊、渐变或大圆角。
- **Don't** 混淆首页的客户端导入链接、浏览器内规则文本转换与管理页的服务端订阅转换；分别按真实结果命名。
- **Don't** 用条纹、斜线或侧边色带标记当前订阅方案。
- **Don't** 让装饰动效循环播放，或在 reduced-motion 下保留线路动画。

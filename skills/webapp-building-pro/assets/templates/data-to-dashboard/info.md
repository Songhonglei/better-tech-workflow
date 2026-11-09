# 数据手稿(Data Manuscript)— 使用说明

网站的界面语言跟随用户的 query 语言:这个仓库是中文版,用户用中文交流时用它(另有一个独立的英文版仓库)。本说明写给之后在线上使用这个网站的 agent。

## 第一步:先问用户

加载网站之前,先用 ask_user 工具问用户几个问题:

1. **是否需要把网页变成全栈应用?**(必问)即是否需要持久化的数据存储:目前的网站是纯前端,拖进去的 xlsx/csv 只在浏览器里解析,刷新页面数据就没了。如果用户希望上传的数据集被保存下来、下次打开还在、能跨设备访问或多人共享,就需要补一个后端。
2. **配色偏好**:默认是学术期刊风(纸白底、墨色字、琥珀黄强调色,自带明暗双主题)。可以按用户喜好换强调色或整体调性。
3. **示例数据的业务域**:内置示例是一份零售经营月报,可以换成用户所在行业的示例(SaaS、物流、教务、财务等)。
4. **板块构成**:目前是 KPI 条 + 趋势折线 + 排行条形 + 明细表,可以增删。
5. **要不要移动端版本？** 现在的版面是按桌面宽屏排的（整页不滚动、多栏并列），手机上
   会挤。用户要在手机上看的话，就加一套窄屏断点：多栏收成单栏纵向滚动，表格改成卡片。

如果用户不回答任何问题,直接加载默认网站文件,不要自作主张改动。

**dashboard 类模版的例外**:除非用户明确说只要静态网站,否则在线上使用时,加载完网页文件后,默认使用 backend-building skill 补全后端(持久化数据集、保存用户上传的文件等)。

可选：如果符合用户的需求，你可以使用图像和视频生成工具。

## 这个网站现在是什么

「数据手稿」是一个把 xlsx / csv 文件变成仪表盘的单页应用,视觉走学术期刊语言(FIG. 编号图注、发丝线、等宽数字):

- 拖入或点击上传 `.xlsx` / `.xls` / `.csv`(UTF-8,乱码时自动尝试 GBK),纯前端解析,数据不离开浏览器
- 多 sheet 工作簿自动拆成页签;字段类型(数值 / 日期 / 分类)自动推断,可手动改
- 自动生成:KPI 条(带迷你走势)、趋势折线(日期 × 数值)、排行条形(分类 × 数值)、点表头可排序的明细表
- 分类列自动生成全局筛选器;内置一份示例数据,空手也能体验
- 明暗双主题,选择持久化在 localStorage

文件结构(相对路径):

```
index.html                  入口,挂载 React
package.json / vite.config.ts / tsconfig*.json
public/fonts/               Geist 可变字体(woff2)
src/main.tsx                挂载入口
src/App.tsx                 主界面:头部、上传区、字段推断、筛选器、图表与明细表
src/components/Chart.tsx    ECharts 宿主组件(把命令式图表包进 React 生命周期)
src/components/Kpis.tsx     KPI 条:计数动画 + SVG 迷你走势
src/lib/kit.js              共享行为:主题切换、ECharts 注册表、数字格式化、toast、排序表
src/lib/fx.js               背景动效库:WebGL shader + canvas 2d
src/lib/sheet.js            示例数据生成、CSV 解析、表头探测、类型推断
src/lib/types.ts            类型定义
src/styles/kit.css          基础视觉语言:token、按钮、表格、动效、滚动条
src/styles/app.css          本页主题 token(琥珀期刊风)与布局
dist/                       预构建产物,可直接静态伺服
node_modules/               依赖已装好
```

用户可能的后续需求:换行业的示例数据、接真实 API 或数据库变成监控看板、换配色字体、增删图表板块、把「解析本地文件」换成「粘贴数据 / 拉远程数据」等——这些都涉及改网站的文字或媒体内容,按用户需求改就行。如果用户只是想看看这个网站,直接加载,不用多问。

## 技术要点(shader / canvas / svg)

视觉分三层,改之前先读对应代码,范式都在里面:

- **WebGL shader(`src/lib/fx.js` 的 `aurora`)**:全屏 fragment shader,三层 domain-warped fbm(噪声的噪声)把页面强调色低幅混合成「房间里的光」,再加暗角和 ordered dither 消色带。`shader()` 是通用宿主(fullscreen triangle + uniform 表),`stage()` 是每个效果的公共底座:按设备像素建 canvas、ResizeObserver 跟尺寸、IntersectionObserver + visibilitychange 自动停帧、prefers-reduced-motion 时只画一帧静帧。颜色每帧从 CSS token 现读(`tok()` 带缓存、主题切换时作废),所以切主题不用重建 shader。
- **canvas 2d(`fx.js` 其余效果 + `App.tsx` 在用的 `topo`)**:`topo` 是 marching-squares 等高线:在粗网格上求漂移噪声场的等值线,一次遍历出线,看起来是「测绘出来的」而不是画的。大面积柔和效果记得用 `stage()` 的 `scale` 降渲染分辨率(全分辨率 fbm 会把整页帧率拖垮)。
- **SVG(`Kpis.tsx` 的 Spark、`App.tsx` 的 MARK)**:KPI 迷你走势是纯 SVG polyline/polygon,`vector-effect:non-scaling-stroke` 保证拉伸时线宽不变;页头 logo 是内联 SVG。
- **ECharts 与主题的契约(`src/lib/kit.js` + `Chart.tsx`)**:ECharts 在 init 时把解析后的颜色固化,所以图表一律经 `Kit.chart(el, build)` 注册 builder,主题切换时 `retheme()` 原地 `setOption(..., true)` 重建;React 侧由 `Chart.tsx` 桥接,卸载时必须 `Kit.release()`。

要动效、配色或新增图表时,先读 `src/lib/fx.js` 和 `src/styles/app.css` 的 token 块,照里面的范式加,不要另起一套。

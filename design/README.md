# 班屏 · 图标与命名

产品名 **班屏**（ClassBoard）。一句话：教室里的那块屏。

## 图标的想法

一块屏，屏幕里正显示着"今天这一节"（金色那一行）。就两笔：外框 + 一条高亮，别的都不加。

- 颜色直接取看板：深绿渐变 `#3c6049 → #1b2d22`、强调色 `#f1bd4e`、浅色 `#eaf2ec`。
- 512 网格、圆角 116（iOS / Android / Windows 都按这个比例收边，不用每个平台改一版）。
- 16 / 32 px 用 `icon-small.svg`：去掉次要条目、外框加粗到 44、金条放大 —— 主图直接缩小会糊成一团。

试过但没用的：2×2 课表格子（一格点亮）在 32px 像"应用启动器的宫格"，看不出是班级屏；带底座的显示器在 16px 只剩一团灰点。

## 文件

| 文件 | 用途 |
| --- | --- |
| `icon.svg` | 主图（≥48px） |
| `icon-small.svg` | 16 / 32 px 简化版 |
| `make-icons.mjs` | 生成 png + ico 并分发，见下 |
| `out/` | 生成物（可重建，不必手改） |

分发到：`board-web/`（favicon.ico / icon.svg / apple-touch-icon.png）、`publish-api/public/` 同上、`host-m0/app.ico`（exe 图标）。

## 重新生成

```bash
node design/make-icons.mjs
```

只用本机 Edge 的无头截图（`--headless=new --default-background-color=00000000`）把 svg 渲成各尺寸 png，再自拼 ICO（PNG 负载，Vista 之后都认），不引第三方依赖。Edge 不在默认路径时设 `EDGE_PATH`。

改了 `icon.svg` 之后记得重跑一次，否则网页上的 favicon 还是旧的（另外两个目录里是拷贝，不是软链）。

## 名字用在哪

- 浏览器标题：大屏 `班屏`，老师端 `班屏 · 老师端`，配对页 `配对教室大屏 · 班屏`，免登页 `加入班级 · 班屏`。
- 老师端顶栏和登录页的品牌行：图标 + 「班屏」。
- 仓库名、服务域名、`BoardState` 里的字段都不改（`ClassBoard` / `class.code` 留着，改名只改对外展示）。

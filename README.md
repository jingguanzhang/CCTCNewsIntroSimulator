# CCTV 《新闻联播》片头动画模拟器与三维视频生成器

<img width="1920" height="1030" alt="QQ截图20261029215806" src="https://github.com/user-attachments/assets/72d83621-9db5-48f2-86ac-a6a9773d1fc9" />
<img width="1920" height="1030" alt="QQ截图20261029215628" src="https://github.com/user-attachments/assets/5ccdfabb-a805-4561-9da7-ca62a665923c" />

<p align="center">
  <strong>基于 Three.js + WebCodecs 的纯前端经典央视新闻联播片头 3D 模拟、定制与离线 MP4 渲染导出工具</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Three.js-r174-black?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/WebCodecs-Hardware_Accelerated-blue" alt="WebCodecs" />
  <img src="https://img.shields.io/badge/Pure_Frontend-Zero_Backend-brightgreen" alt="No Backend" />
  <img src="https://img.shields.io/badge/Export-MP4_H.264+AAC-red" alt="MP4 Export" />
  <img src="https://img.shields.io/badge/ES_Modules-Modern_JS-yellow" alt="ES Modules" />
</p>

---

## 🌟 项目简介

本项目是一个完全运行在浏览器端的 **CCTV 《新闻联播》片头动画高保真重建模拟器** 与 **MP4 视频生成工作台**。

无需安装 Blender、After Effects 或任何后端服务，只需现代浏览器，即可实时预览三维地球旋转、RGB 彩色光带环绕与立体字特效，并支持自由定制标题文本、音频音轨与分辨率，通过硬件加速的 **WebCodecs API** 极速导出 720p / 1080p / 2K / 4K 的广播级 MP4 视频。

---

## ✨ 核心特性

### 1. 🎬 双界面模式体验
- **视频生成模式 (`index.html`)**：
  - 零门槛操作，专为快速生成视频设计。
  - 支持快捷替换字幕文字、栏目名称与日期。
  - 分辨率预设随心切换（720p / 1080p / 2K / 4K）。
  - 内置背景音乐预览，支持本地上传音频替代或关闭音轨。
  - 交互式播放控制台、精确到毫秒的时间轴拖拽与实时渲染预览。
- **高级 3D 编辑器 (`editor.html` / Motion Studio)**：
  - 专业级运动图形工作台，提供独立的“主视口 + 3D 编辑自由视角”双视口。
  - 场景元素树状管理：地球、云层、RGB 红绿蓝光带、立体文字、光斑与背景环境。
  - 多通道关键帧曲线编辑（位移 X/Y/Z、旋转、缩放、不透明度、文字揭示进度、自转与公转）。
  - 完善的撤销/重做机制（`Ctrl + Z` / `Ctrl + Shift + Z`）。
  - 支持导入自定义 SVG 矢量并一键挤出为三维模型。

### 2. ⚡ 纯前端 WebCodecs 硬件加速渲染
- 采用 **WebCodecs API (`VideoEncoder`, `VideoFrame`)** 搭配 **MediaBunny**。
- 采用独立 **Web Worker (`export-worker.js`)** 进行离线逐帧渲染，计算过程不阻塞主界面。
- 支持 H.264 硬件编码加速与 AAC 音频多轨混流，直接在内存中封装生成符合通用播放器标准的 `.mp4` 文件。

### 3. 🔤 动态三维文字与字体解析
- 集成 **opentype.js**，支持动态加载本地 `.ttf` / `.otf` 字体。
- 实时抽取字形贝塞尔曲线（Glyph Shapes），利用 Three.js 进行三维曲面挤出（Extrude）、平滑法线（Smooth Normals）与金色反射倒角渲染。

### 4. 💾 参数持久化与项目工程导入导出
- 动画运动参数完全采用结构化 JSON 驱动。
- 支持将当前调整好的所有动画曲线、光照、材质与音轨参数导出为 `.json` 工程，或随时导入历史工程继续二次创作。
- 页面状态自动利用本地存储暂存，防止误刷新丢失修改。

---

## 🛠️ 技术架构

| 模块 / 环节 | 技术方案 | 作用描述 |
| :--- | :--- | :--- |
| **3D 图形渲染** | [Three.js](https://threejs.org/) (r174) | WebGL 场景建模、相机运动、材质 Shader、点光源与光影 |
| **视频编码封装** | [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) + [MediaBunny](https://github.com/) | 浏览器端原生硬解硬编 H.264，合成音频流输出 MP4 |
| **异步离线计算** | Web Workers | 独立线程拉取帧数据并编码，导出过程界面流畅不卡死 |
| **字体几何转换** | [opentype.js](https://opentype.js.org/) | 在线解析 TrueType / OpenType 字体曲线并挤出 3D 几何体 |
| **音频处理** | Web Audio API | 音频解码、裁剪重采样与 AAC 混流打包 |
| **UI 交互与图标** | 原生 HTML5 / CSS3 + [Remix Icon](https://remixicon.com/) | 现代无边框设计、深浅主题切换、响应式侧边栏 |

---

## 📁 目录结构

```text
├── index.html                   # 视频生成模式（极速定制文字与导出 MP4）
├── editor.html                  # 高级三维运动图形编辑器（Motion Studio）
└── static/                      # 静态核心源码与资产
    ├── generator-bootstrap.js   # 生成页启动脚本
    ├── generator.js             # 视频生成模式业务逻辑
    ├── generator.css            # 生成页现代样式表
    ├── bootstrap.js             # 编辑器启动与异常捕获
    ├── editor.js                # 3D 编辑器交互与时间轴逻辑
    ├── editor.css               # 编辑器专业暗色界面样式表
    ├── engine.js                # Three.js 核心场景渲染与关键帧插值引擎
    ├── export-worker.js         # Web Worker 离线视频渲染与 WebCodecs 编码器
    ├── earth-material.js        # 地球与大气层自发光材质 Shader
    ├── earth.jpg / earthCloud.png # 地球陆地表面与云层贴图
    ├── rgb-r.png / rgb-g.png / rgb-b.png # 经典红绿蓝光带纹理
    ├── default-project.json     # 官方标准片头默认工程参数文件 (18.917s, 24fps)
    ├── bgm.m4a                  # 经典片头开场配乐
    ├── editor-font.otf          # 默认内置高清黑体字库
    ├── window-controls.js       # 窗口控制与拖拽桥接模块
    ├── window-controls.css      # 窗口操作栏样式
    └── vendor/                  # 第三方核心依赖库
        ├── three/               # Three.js 核心及控制器插件
        ├── mediabunny/          # MP4 / AAC 封装复用库
        ├── opentype/            # 字体几何解析库
        └── remixicon/           # 矢量界面图标库
```

---

## 🚀 快速上手

由于本项目采用了现代原生的 **ES Modules (`import / export`)**、**Web Workers** 以及 **WebCodecs API**，**不能直接双击通过 `file://` 协议打开 HTML**，必须通过本地或远程的 HTTP/HTTPS 服务托管运行。

### 方式 1：使用 Python（无需安装额外依赖）
若电脑已安装 Python，进入本目录执行：
```bash
# Python 3
python -m http.server 8080
```
然后在浏览器访问：[http://localhost:8080](http://localhost:8080)

### 方式 2：使用 Node.js (`npx serve` 或 `http-server`)
```bash
npx serve .
# 或
npx http-server -p 8080
```
然后在浏览器访问控制台给出的本地链接。

### 方式 3：使用 VS Code Live Server 插件
1. 在 VS Code 中打开本工程目录。
2. 安装扩展 **Live Server**。
3. 右键点击 `index.html`，选择 **Open with Live Server** 即可。

### 方式 4：一键部署到 GitHub Pages
1. 将本仓库推送到 GitHub。
2. 进入仓库设置 **Settings -> Pages**。
3. 在 **Branch** 下选择 `main` 分支根目录 `/ (root)` 并点击 Save。
4. 稍等片刻即可通过 GitHub Pages 提供的 HTTPS 链接免安装在线使用！

---

## 🖥️ 运行环境与浏览器兼容性

为确保 3D 渲染与 WebCodecs 硬件导出正常工作，请使用以下环境：

| 平台 / 浏览器 | 支持状态 | 说明 |
| :--- | :---: | :--- |
| **Google Chrome** (>= 94) | 推荐 | 完全支持 WebCodecs、WebGL2 与 OffscreenCanvas |
| **Microsoft Edge** (>= 94) | 推荐 | 完全支持硬件加速导出 |
| **Firefox** | 部分支持 | 支持预览；离线硬编导出取决于实验性编码器支持 |
| **Safari** (macOS >= 15.4) | 兼容 | 支持 WebCodecs 视频编码，建议使用 HTTPS 协议 |

> **⚠️ 注意**：
> 根据 W3C 安全规范，`WebCodecs API` 仅在 **安全上下文（HTTPS）** 或本地回环地址（`localhost` / `127.0.0.1`）下开放使用。

---

## 📖 使用指南

### 1. 快速生成一个定制片头
1. 打开 `index.html`。
2. 在左侧面板的 **“文字”** 区域，输入自定义的栏目名、副标题或日期。
3. 在 **“分辨率”** 中选择目标视频规格（默认推荐 `1080p` 兼顾速度与画质）。
4. （可选）展开 **“音频”** 更换自己的背景音乐文件。
5. 点击上方导航栏的 **“生成视频”**，等待渲染进度条完成。
6. 点击 **“保存视频”**，即可将渲染出的 `.mp4` 文件保存到电脑。

### 2. 深度调整 3D 关键帧与运镜
1. 点击生成页顶部的 **“高级编辑”**，或直接进入 `editor.html`。
2. 左侧为场景元素清单，右侧视口可通过鼠标拖拽旋转、平移和缩放观察 3D 场景。
3. 在顶部可实时切换不同通道调整地球转速、光带公转轨迹或镜头推拉。
4. 调整满意后，点击顶部 **“生成 MP4 ↗”** 即可无缝将最新动画参数带入生成器并渲染。

---

## 📄 免责声明

1. 本项目所包含的片头背景音乐（`bgm.m4a`）及经典片头视觉元素创意归属原制作机构（中国中央电视台 CCTV）所有。
2. 本项目属于运动图形学与 Web 现代图形管线（Three.js + WebCodecs）的技术探索、教学演示与怀旧交流项目。
3. 请勿将本项目生成的带有特殊官方标志的视频用于欺诈、造谣、伪造官方新闻或侵犯他人合法权益的非法用途。

---

## 💡 致谢
- [Three.js](https://threejs.org/) - 伟大的 Web 3D 引擎
- [MediaBunny](https://github.com/) - 纯前端流式媒体混流器
- [opentype.js](https://opentype.js.org/) - 浏览器端字体解析利器
- [Remix Icon](https://remixicon.com/) - 优雅开源的图标库

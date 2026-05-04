# CLAUDE.md

## 项目概述

蛐蛐(QuQu) — 开源隐私优先的中文语音转文字桌面应用，两阶段架构：FunASR 本地语音识别 + LLM API 文本润色。

**技术栈**：Electron、React 19、Vite、Python 3.11(嵌入式)、FunASR、better-sqlite3、Tailwind CSS 4.x、shadcn/ui

## 开发命令

```bash
pnpm run dev                   # 同时启动 Vite 和 Electron
pnpm run build:renderer        # 构建 React（Electron 构建前必须执行）
pnpm run build:mac/win/linux   # 打包（自动准备 Python 环境）
pnpm run prepare:python        # 准备嵌入式 Python 环境
pnpm run test:python           # 测试 Python 环境
pnpm run clean                 # 清理构建产物和 Python 环境
```

> Vite 开发服务器必须从 `src/` 目录运行，Electron 连接 `localhost:5173`

## 架构

### 数据流
F2 双击 → 录音(WAV/临时目录) → FunASR 转录(raw_text) → LLM 润色(processed_text) → 自动粘贴 → 存入 SQLite

### 进程通信
- **主进程 ↔ Python**：stdin/stdout JSON 消息，由 `src/helpers/funasrManager.js` 管理生命周期
- **主进程 ↔ 渲染进程**：所有 IPC 处理器集中在 `src/helpers/ipcHandlers.js`
- **模型管理 IPC**：`check-model-files`、`download-models`、`get-download-progress`

### 窗口
三个独立 BrowserWindow：主窗口(`index.html`)、设置面板(`settings.html`)、历史记录(`history.html`)，均使用 `preload.js` 暴露 API。

### 文件结构
```
src/helpers/    # Manager 类（funasrManager, hotkeyManager, ipcHandlers, logManager 等）
src/hooks/      # React hooks（Electron IPC 集成）
src/components/ # React 组件 + shadcn/ui
main.js         # Electron 主进程入口
funasr_server.py / download_models.py  # Python 脚本（根目录）
scripts/        # 构建时脚本
```

### 数据库(better-sqlite3)
- **transcriptions**：`id`, `raw_text`, `processed_text`, `audio_path`, `created_at`
- **settings**：键值表，JSON 序列化存储 AI API 配置

## 关键约定

### 日志（重要）
**必须**使用 `src/helpers/logManager.js`，禁止使用 `console.log`。
```javascript
const logger = new LogManager();
logger.info('msg', { data });
logger.logFunASR('FunASR 专用日志');
```
日志存储在用户数据目录：`logs/app.log`、`logs/funasr_server.log`

### Python 嵌入式环境
- 开发：`./python/bin/python3.11`
- 生产：`process.resourcesPath/app.asar.unpacked/python/bin/python3.11`
- 依赖：`numpy<2, torch==2.0.1, torchaudio==2.0.2, librosa>=0.11.0, funasr>=1.2.7`
- 设置环境变量：`PYTHONHOME`, `PYTHONPATH`, `PYTHONDONTWRITEBYTECODE`
- 清除干扰变量：`PYTHONUSERBASE`, `PYTHONSTARTUP`, `VIRTUAL_ENV`

### FunASR 模型（下载到用户数据目录）
- ASR: `damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
- VAD: `damo/speech_fsmn_vad_zh-cn-16k-common-pytorch`
- PUNC: `damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch`

### 路径与构建
- Vite 以 `src/` 为基础目录，资源引用用 `../assets/`
- 生产构建引用 `app.asar.unpacked` 中的 Python 脚本
- `asarUnpack` 必须包含：Python 脚本、ffmpeg-static、better-sqlite3
- 构建产物含完整 Python 运行时（约 1GB+）

### CSS
- Tailwind 4.x，中文字体优化
- 自定义类：`.chinese-content`、`.chinese-title`、`.status-text`
- Electron 专用：`.draggable`、`.non-draggable`

### 状态管理
- 无外部状态库，使用 React hooks + Electron IPC
- 录音状态通过 `hotkeyManager.js` 在进程间手动同步

## 常见任务

```bash
# 首次运行
uv sync && uv run python download_models.py  # 推荐
pnpm run dev

# 调试 FunASR
# 1. 查看 logs/funasr_server.log
# 2. IPC 调用 check-model-files 验证模型
# 3. pnpm run test:python:info 检查 Python 环境
```

新增 IPC 处理器统一放在 `src/helpers/ipcHandlers.js`：
```javascript
ipcMain.handle("your-channel", async (event, ...args) => { return result; });
```


# pnpm run dev 如何调用到 Python（FunASR）

## 结论概览
执行 `pnpm run dev` 后，前端与 Electron 主进程并行启动。
真正调用 Python 的入口在主进程的 FunASR 管理器中，通过 `child_process.spawn` 拉起 `funasr_server.py`，后续转写请求通过 IPC + stdin/stdout 与该 Python 进程通信。

## 调用链路

1. 启动开发命令  
`pnpm run dev` 在 `package.json` 中定义为并行执行：
- `dev:renderer`：启动 Vite（渲染进程）
- `dev:main`：启动 Electron 主进程

2. Electron 主进程启动  
主进程启动后执行应用初始化逻辑，并调用：
- `funasrManager.initializeAtStartup()`

该步骤会：
- 查找可用 Python（优先嵌入式 Python）
- 检查 FunASR 可用性
- 触发 FunASR 服务器预启动

3. 确定 Python 与脚本路径  
FunASR 管理器中：
- 开发环境：优先使用项目内 `python/bin/python3.11`
- 生产环境：使用 `process.resourcesPath/app.asar.unpacked/python/bin/python3.11`

FunASR 服务脚本路径同理：
- 开发环境：项目根目录 `funasr_server.py`
- 生产环境：`process.resourcesPath/app.asar.unpacked/funasr_server.py`

这里的 `resourcesPath` 是 Electron 在打包运行时提供的资源根目录，开发模式通常不会走它。

4. 拉起 Python 进程（关键点）  
在 `_startFunASRServer()` 中执行：
- `spawn(pythonCmd, [serverPath, "--damo-root", cachePath], { ... })`

说明：
- `pythonCmd`：最终选中的 Python 可执行文件
- `serverPath`：`funasr_server.py`
- `--damo-root`：模型目录参数
- 通信方式：`stdio: ["pipe", "pipe", "pipe"]`，即通过 stdin/stdout 传 JSON 消息

5. 前端触发转写  
渲染层录音完成后调用：
- `window.electronAPI.transcribeAudio(...)`

通过 preload 暴露 API 并走 IPC：
- `ipcRenderer.invoke("transcribe-audio", audioData)`

主进程 IPC handler 接收后：
- `funasrManager.transcribeAudio(audioData, options)`

6. 与 Python 服务通信  
`transcribeAudio()` 会：
- 先把音频写入临时 wav 文件
- 调用 `_sendServerCommand({ action: "transcribe", ... })`
- 通过 Python 进程 stdin 发送 JSON
- 从 stdout 读取 JSON 结果并返回给前端

## 与 prepare-embedded-python 的关系

`scripts/prepare-embedded-python.js` 的作用是“准备嵌入式 Python 运行时和依赖”。
它通常用于构建流程或手动准备环境，不是 `pnpm run dev` 默认必经步骤。

因此开发态行为是：
- 若本地已有可用嵌入式 Python，则优先使用
- 否则在 development 下回退系统 Python（按现有逻辑）

## 为什么会看到 resourcesPath

在代码中出现 `process.resourcesPath` 是为了兼容打包后运行。
打包后 Python、脚本、模型等资源会被放到应用资源目录（含 `app.asar.unpacked`），所以必须通过 `resourcesPath` 定位。
开发模式一般走项目相对路径，不依赖 `resourcesPath`。

## 快速排查建议

1. 看日志里是否出现 `Using embedded Python`
2. 看 `FunASR server config` 中的 `pythonCmd` 与 `serverPath`
3. 若转写失败，优先检查：
- `serverPath` 是否存在
- 模型目录 `--damo-root` 是否正确
- `check-funasr-status` 返回的 `models_initialized/server_ready`

# FunASR 语言配置调查报告

日期：2026-04-12

## 调查目标

确认本应用中“首选语言/识别语言”的设置机制：

1. 是否通过固定配置文件或代码写死
2. 是否可以通过命令行参数传递

## 结论

当前实现是“中文模型 + 代码默认值”的固定方案，未实现通过命令行参数传入识别语言。

- Python 启动参数目前仅支持 `--damo-root`（模型目录）。
- 语音识别链路中没有完整的“语言配置透传并生效”机制。
- 前端当前调用转录时也未传 options。

## 证据与代码位置

### 1) Python 侧模型为固定中文模型

文件：`funasr_server.py`

- ASR 模型：`damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`
- VAD 模型：`damo/speech_fsmn_vad_zh-cn-16k-common-pytorch`
- PUNC 模型：`damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch`

以上模型名称均为 zh-cn 相关模型，属于固定中文模型组合。

### 2) Python 命令行参数仅有 damo-root

文件：`funasr_server.py`

- 参数定义：`parser.add_argument("--damo-root", ...)`

未发现 `--language` / `--lang` 等语言参数。

### 3) JS 启动 Python 时仅传 damo-root

文件：`src/helpers/funasrManager.js`

- 启动参数：`[serverPath, "--damo-root", cachePath]`

说明当前主进程只向 Python 传模型目录，不传语言参数。

### 4) Python 内存在 language 字段，但未形成可切换闭环

文件：`funasr_server.py`

- 默认选项有：`"language": "zh"`
- 返回结果里写：`"language": "zh-CN"`

但在 ASR 调用 `self.asr_model.generate(...)` 时，未将 language 参数显式传入 generate（仅传入 input、batch_size_s、hotword、cache），因此目前 language 更多是结果标签/默认字段，不是可靠的切换开关。

### 5) 前端当前未向转录接口传 options

文件：`preload.js`

- 暴露接口：`transcribeAudio: (audioData) => ipcRenderer.invoke("transcribe-audio", audioData)`

文件：`src/hooks/useRecording.js`

- 调用方式：`window.electronAPI.transcribeAudio(uint8Array)`

文件：`src/helpers/ipcHandlers.js`

- IPC 处理器签名支持 `options`：`ipcMain.handle("transcribe-audio", async (event, audioData, options) => { ... })`

即：主进程方法支持 options，但渲染层当前未传入。

## 额外观察

文件：`src/helpers/ipcHandlers.js`

- `detect-language` 当前是占位实现，固定返回 `zh-CN`，并非真实语言检测能力。

## 最终判断

本项目当前的“识别语言”属于固定实现（中文模型与默认返回），不是通过命令行参数动态配置。

如果需要实现“首选语言可配置”，建议新增完整链路：

1. 设置页增加语言项并存储（DB setting）
2. 渲染进程调用 `transcribe-audio` 时传 `options.language`
3. 主进程透传给 Python
4. Python 在 `generate()` 调用中显式使用该参数，并根据不同语言切换对应模型或配置

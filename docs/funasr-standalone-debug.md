# FunASR 单独运行与调试指南

本文档汇总了在 QuQu 项目中，如何脱离 Electron 主流程，单独启动并调试 FunASR 服务。

## 1. 适用场景

- 验证 Python/FunASR 环境是否可用
- 排查模型加载失败、推理超时、JSON 通信异常
- 复现转写问题并观察服务端日志

## 2. 前置准备

在项目根目录执行（Windows PowerShell）：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
. .\.venv\Scripts\Activate.ps1
```

可选检查：

```powershell
pnpm run test:python
pnpm run test:python:info
```

## 3. 单独启动 FunASR 服务

```powershell
python .\funasr_server.py
```

启动后服务会：

- 初始化 ASR/VAD/PUNC 三个模型
- 通过 stdin 读入 JSON 命令
- 通过 stdout 输出 JSON 结果

## 4. 日志与定位

服务日志默认写入：

- 优先：ELECTRON_USER_DATA/logs/funasr_server.log
- 回退：系统临时目录/ququ_logs/funasr_server.log

在 PowerShell 中实时查看：

```powershell
Get-Content "$env:TEMP\ququ_logs\funasr_server.log" -Wait -Tail 100
```

若已设置 ELECTRON_USER_DATA，可改为对应路径下的 logs 目录查看。

## 5. 通信协议（最小可用）

### 5.1 初始化

请求：

```json
{"command":"initialize"}
```

### 5.2 转写

请求：

```json
{"command":"transcribe","audio_file":"C:/path/to/test.wav","use_itn":true}
```

说明：

- audio_file 需为可访问的 WAV 文件路径
- Windows 路径建议使用正斜杠或双反斜杠

### 5.3 关闭服务

请求：

```json
{"command":"shutdown"}
```

## 6. Python 快速联调脚本

可用以下脚本验证端到端通信：

```python
import json
import subprocess

proc = subprocess.Popen(
    ["python", "funasr_server.py"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    bufsize=1,
)

# 1) initialize
proc.stdin.write(json.dumps({"command": "initialize"}, ensure_ascii=False) + "\n")
proc.stdin.flush()
print("initialize:", proc.stdout.readline().strip())

# 2) transcribe（替换为真实 wav 路径）
# proc.stdin.write(json.dumps({"command": "transcribe", "audio_file": "C:/path/to/test.wav", "use_itn": True}) + "\n")
# proc.stdin.flush()
# print("transcribe:", proc.stdout.readline().strip())

# 3) shutdown
proc.stdin.write(json.dumps({"command": "shutdown"}) + "\n")
proc.stdin.flush()
print("shutdown:", proc.stdout.readline().strip())
```

## 7. 常见问题

### 7.1 模型加载很慢或失败

- 首次运行会下载模型，耗时较长
- 检查网络与磁盘空间
- 查看 funasr_server.log 中具体异常堆栈

### 7.2 stdout 出现非 JSON 输出导致通信失败

- 服务端已通过 stdout 抑制逻辑减少库噪声
- 若二次开发后出现异常，请确保 stdout 仅返回协议 JSON

### 7.3 路径问题

- 音频文件建议用绝对路径
- 路径含空格时务必整体作为字符串传入 JSON

## 8. 建议排查顺序

1. 先跑 pnpm run test:python:info 确认 Python 与依赖
2. 再单独启动 funasr_server.py 看模型初始化
3. 用最小 JSON initialize 请求确认 IPC 正常
4. 最后用小体积 WAV 做 transcribe 验证

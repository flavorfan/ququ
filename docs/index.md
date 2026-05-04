# 文档索引 Documentation Index

本目录包含蛐蛐(QuQu)项目的技术文档与调查报告。

## 文档列表

| Path | Title | Summary | Tags | Updated |
|------|-------|---------|------|---------|
| [@docs/funasr-standalone-debug.md](funasr-standalone-debug.md) | FunASR 单独运行与调试指南 | 脱离 Electron 独立启动 FunASR 服务的完整流程，包括环境准备、通信协议、日志定位、联调脚本与常见问题排查 | FunASR, Debugging, Python, Standalone, Testing | 2026-04-12 |
| [@docs/dev-to-python-call-chain.md](dev-to-python-call-chain.md) | Dev 到 Python 调用链分析 | pnpm run dev 启动后前端如何通过 Electron 主进程调用嵌入式 Python/FunASR 的完整链路剖析，涵盖进程启动、路径解析、stdin/stdout 通信机制 | Development, Architecture, IPC, Process Communication, Call Chain | 2026-04-12 |
| [@docs/funasr-language-config-investigation.md](funasr-language-config-investigation.md) | FunASR 语言配置调查 | 调查报告：分析当前识别语言的固定实现（中文模型 + 默认值），验证命令行参数机制缺失，给出动态配置建议 | FunASR, Language, Configuration, Investigation, Model | 2026-04-12 |
| [@docs/windows-cmd-bootstrap-example.md](windows-cmd-bootstrap-example.md) | Windows 批命令脚本示例 | Windows 批处理脚本模板，用于自动激活虚拟环境并启动 pnpm run dev 开发服务器 | Windows, CMD, Bootstrap, Development, Script | 2026-04-12 |

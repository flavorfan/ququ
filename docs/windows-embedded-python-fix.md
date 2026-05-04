# Windows 嵌入式 Python 准备与测试修复复盘（2026-05-04）

## 背景

在 Windows 环境执行以下命令时出现失败：

```bash
pnpm run prepare:python
pnpm run test:python
```

目标是让项目在 Windows 上具备可重复、可验证的嵌入式 Python 准备与测试流程，并保持开发/打包链路一致。

## 问题现象

### 1) prepare 失败

- 报错：`pip is not recognized as an internal or external command`
- 触发点：脚本直接调用全局 `pip`

### 2) test 失败

- 报错：`spawn EFTYPE`
- 触发点：测试脚本尝试运行 `python/bin/python3.11`

## 根因分析

### 根因 A：命令入口依赖全局 pip

`prepare:python` 使用 `pip install ...`，在当前 Windows 环境中 `pip` 不在 PATH，但 `python -m pip` 或 `uv pip` 可用。

### 根因 B：嵌入式 Python 路径硬编码为类 Unix 结构

项目原始逻辑默认路径为 `python/bin/python3.11`。在 Windows 中有效路径应为：

- `python/Scripts/python.exe`（venv）
- 或 `python/python.exe`（某些布局）

### 根因 C：现有 python 目录中曾存在非 Windows 可执行文件

Windows 下检测到 `python/bin/python3.11` 为 Mach-O 头（`CF FA ED FE`），导致 `spawn EFTYPE`。

### 根因 D：Windows venv 与 PYTHONHOME/PYTHONPATH 的兼容策略

Windows venv 下强行注入 `PYTHONHOME/PYTHONPATH` 可能引发解释器行为异常；应在 Windows 使用 venv 默认隔离机制。

## 修复方案

### 1) 统一命令入口为嵌入式准备流程

在 `package.json` 中将 `prepare:python` 调整为调用构建脚本：

- `node scripts/prepare-embedded-python.js`

### 2) prepare 脚本做跨平台改造

文件：`scripts/prepare-embedded-python.js`

关键改动：

- 新增平台判断与路径解析：
  - Windows：优先 `python/Scripts/python.exe`
  - 非 Windows：`python/bin/python3.11`
- Windows 使用 `uv venv --python 3.11 --seed python` 创建本地隔离环境
- Windows 安装依赖使用 `uv pip install --python <exe> ...`
- 依赖验证包含 `modelscope`
- Windows 下不设置 `PYTHONHOME/PYTHONPATH`，仅保留通用变量

### 3) test 脚本做跨平台改造

文件：`scripts/test-embedded-python.js`

关键改动：

- 使用平台化 Python 可执行文件解析
- 使用平台化 site-packages 路径
- Windows 下跳过 Unix 执行权限检查逻辑
- `spawn` 增加 `windowsHide: true`
- Windows 下不强制注入 `PYTHONHOME/PYTHONPATH`

### 4) 运行时管理器同步修复

文件：`src/helpers/funasrManager.js`

关键改动：

- `getEmbeddedPythonPath()` 改为跨平台候选路径解析
- 新增嵌入式 home/site-packages 解析工具方法
- Windows 下环境变量策略与脚本保持一致
- 回退 Python 搜索列表增加 Windows 候选项（如 `.venv/Scripts/python.exe`、`python/Scripts/python.exe`、`py`）

## 验证结果

### 命令验证

执行结果：

1. `pnpm run prepare:python` 通过
2. `pnpm run test:python` 通过

### 关键验证项

- Python 版本检测通过：`Python 3.11.13`
- 依赖导入通过：`numpy`、`torch`、`librosa`、`modelscope`、`funasr`
- 环境隔离检测通过（路径命中本地 `python` 目录）

## 影响范围

- 直接影响：Windows 下 Python 环境准备与测试命令可用
- 间接影响：FunASR 主进程在开发/打包场景的 Python 路径解析更稳健
- 不影响：macOS/Linux 原有 `python/bin/python3.11` 逻辑仍保留

## 经验与建议

1. 跨平台脚本不要硬编码单一路径结构（`bin` vs `Scripts`）。
2. Windows 环境优先使用 `uv venv + uv pip`，避免 PATH 与 pip 变体差异。
3. 运行时与测试脚本必须共享一致的 Python 路径与环境策略。
4. 任何“嵌入式运行时”调整后，都应至少回归以下命令：
   - `pnpm run prepare:python`
   - `pnpm run test:python`
   - `pnpm run build:win`

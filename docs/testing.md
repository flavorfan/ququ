# 测试体系规范 Testing

本项目采用分层测试架构，将自动化测试、环境自检和手工验证明确隔离，确保在无真实模型、无麦克风、无系统权限的 CI 环境中也能稳定执行。

## 测试分类

### 1. 自动化 JavaScript 测试（Vitest）

**命令：** `pnpm run test:js` 或 `pnpm run test:js:run`

- **位置：** `tests/js/unit/` 和 `tests/js/integration/`
- **范围：** FunASRManager 的单元和集成测试，文本处理模式逻辑
- **依赖：** 无外部依赖（mocked Electron、fs、spawn）
- **运行时间：** ~1s
- **覆盖：**
  - Python 路径查找（Windows/Unix 差异）
  - 嵌入式环境变量隔离
  - 模型文件完整性检查
  - 文本处理模式自动选择

### 2. 自动化 Python 测试（pytest）

**命令：** `pnpm run test:py` 或直接 `pytest tests/python`

- **位置：** `tests/python/unit/` 和 `tests/python/protocol/`
- **范围：** FunASR 服务器协议、状态管理、性能统计
- **依赖：** 需要 FunASR 库（但不需要实际模型文件）
- **运行时间：** ~30s（包含 server 启动）
- **覆盖：**
  - JSON 协议异常处理
  - 模型缺失时的初始化返回
  - 状态查询和统计接口
  - 日志路径 fallback 逻辑

### 3. Python 环境自检

**命令：** `pnpm run test:python:env`

- **位置：** `scripts/test-embedded-python.js`
- **目的：** 验证嵌入式 Python 环境、依赖版本、隔离性
- **不算：** 单元测试套件，而是部署前的环境验证工具

### 4. 手工 Smoke 脚本

**位置：** `tests/manual/js/` 和 `tests/manual/python/`

- macOS 文本插入平台权限验证
- FunASR 模型加载性能基准测试
- 需要手工启动，通常用于本地开发调试

## 目录结构

```
tests/
├── js/
│   ├── unit/
│   │   └── text-processing-modes.test.js      # 模式选择逻辑
│   └── integration/
│       └── funasrManager.test.js               # FunASR manager 集成
├── python/
│   ├── conftest.py                             # pytest 配置和 fixtures
│   ├── unit/
│   │   └── test_funasr_server.py               # 服务状态和统计
│   └── protocol/
│       └── test_funasr_server_protocol.py      # JSON 行协议测试
└── manual/
    ├── js/
    │   └── text-insertion.smoke.js             # macOS 可访问性测试
    └── python/
        └── funasr-timing.smoke.py              # 模型加载性能
```

## 如何运行测试

### 快速验证（推荐 CI 用）

```bash
# 运行所有自动化测试
pnpm test

# 或分别运行
pnpm run test:js:run    # JS 单次运行
pnpm run test:py        # Python 单次运行
pnpm run test:ci        # CI 模式（等同于 test）
```

### 开发时的细粒度执行

**JavaScript 测试：**

```bash
# 启用 watch 模式（任何 .test.js 改动后自动重跑）
pnpm run test:js

# 只运行特定文件
pnpm run test:js:run -- tests/js/unit/text-processing-modes.test.js

# 只运行匹配某个关键词的测试
pnpm run test:js:run -- -t "embedded python"
```

**Python 测试：**

```bash
# 直接用 pytest（需要在虚拟环境内）
pytest tests/python

# 只运行单元测试
pytest tests/python/unit -v

# 只运行协议测试
pytest tests/python/protocol -v

# 只运行单个测试
pytest tests/python/unit/test_funasr_server.py::test_check_status_before_initialize_reports_not_ready

# 显示 print 和详细输出
pytest tests/python -v -s

# 按关键词过滤
pytest tests/python -k "initialize"
```

### 环境自检

```bash
# 验证嵌入式 Python 环境
pnpm run test:python:env

# 显示详细环境信息
pnpm run test:python:info
```

### 手工 Smoke（本地调试）

```bash
# macOS 文本插入（需要可访问性权限）
node tests/manual/js/text-insertion.smoke.js

# FunASR 加载性能（需要下载模型）
python tests/manual/python/funasr-timing.smoke.py
```

## 当前覆盖范围

### ✅ 已实现

- FunASR server JSON 协议（5 个测试）
  - 无效 JSON 异常处理
  - 未知命令拒绝
  - 模型缺失初始化返回
  - status / stats / exit 命令
  - 日志路径 ELECTRON_USER_DATA fallback

- FunASRManager 集成（4 个测试）
  - Windows 和 Unix 的 Python 路径选择
  - 嵌入式环境变量构造（PYTHONHOME/PYTHONPATH 隔离）
  - 模型文件完整性检查
  - 缺失模型的报告

- 文本处理（4 个测试）
  - 显式模式指定
  - 短文本默认 optimize
  - 长文本默认 optimize_long
  - 边界条件

### 🚧 规划中

- 真实模型并行加载测试（含超时/失败分支）
- 音频转录端到端测试（夹具 WAV + mock LLM）
- 数据库事务隔离
- 热键和 IPC 协议测试

## 设计原则

1. **隔离性：** 自动化测试不依赖网络、真实文件、真实权限
2. **可重现性：** 任何开发机和 CI 环境上结果一致
3. **速度：** 整套自动化测试应在 2 分钟内完成
4. **清晰职责：** 自动化（CI）vs 环境检查（部署前）vs 手工烟测（本地验证）
5. **易扩展：** 新测试遵循相同目录、命名、fixture 规范

## 常见问题

**Q: 为什么 JS 测试不依赖真实 Electron 和 FunASR？**  
A: 自动化测试的目的是快速反馈代码逻辑，不是验证部署。真实集成测试在 CI 的集成测试阶段（未来补），或在本地手工验证。

**Q: 可以在没有嵌入式 Python 的机器上跑测试吗？**  
A: JS 测试可以（完全 mocked）。Python 测试需要 FunASR 库，但不需要模型文件。

**Q: 如何调试失败的测试？**  
A: JS 用 `pnpm run test:js` 启动 watch，改动后自动重跑。Python 用 `pytest tests/python/unit/xxx.py -v -s` 查看详细输出和 print。

## 后续规划

1. **模型 fixture 化：** 用最小化 stub 模型代替真实模型下载，加速 Python 集成测试
2. **覆盖率报告：** `pytest-cov` + GitHub Actions 显示代码覆盖范围
3. **性能基准：** 为 server 初始化、转录延迟建立 baseline，检测性能回归
4. **跨平台 CI：** Windows、macOS、Linux 矩阵构建
5. **e2e 测试：** 用 Playwright 或类似工具测试完整 UI 流程（仅在功能稳定后）
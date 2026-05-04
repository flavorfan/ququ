

# Windows 批命令脚本示例

```sh ququ.cmd
@echo off
cd /d C:\Source\Repos\ququ

if exist ".venv\Scripts\activate.bat" (
call ".venv\Scripts\activate.bat"
) else (
echo [WARN] 未找到 .venv\Scripts\activate.bat，继续使用当前 Python 环境...
)


pnpm run dev
if errorlevel 1 pause
```


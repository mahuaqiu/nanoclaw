@echo off
REM NanoClaw Docker 部署脚本 (Windows)
REM 一键构建并启动 NanoClaw

setlocal enabledelayedexpansion

echo === NanoClaw Docker 部署 ===

REM 检查 Docker 是否可用
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误：Docker 未安装或不可用
    echo 请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop
    exit /b 1
)

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误：Docker 未运行，请先启动 Docker Desktop
    exit /b 1
)

REM 切换到脚本所在目录
cd /d "%~dp0"

REM 步骤 1：构建 Agent 容器镜像
echo.
echo [1/3] 构建 Agent 容器镜像...
cd container
docker build -t nanoclaw-agent:latest .
if %ERRORLEVEL% neq 0 (
    echo 错误：Agent 容器镜像构建失败
    cd ..
    exit /b 1
)
cd ..

REM 步骤 2：构建 NanoClaw 主镜像
echo.
echo [2/3] 构建 NanoClaw 主镜像...
docker build -t nanoclaw:latest .
if %ERRORLEVEL% neq 0 (
    echo 错误：NanoClaw 主镜像构建失败
    exit /b 1
)

REM 步骤 3：启动服务
echo.
echo [3/3] 启动 NanoClaw 服务...

REM 检查是否存在 .env.docker 文件
if exist ".env.docker" (
    echo 使用 .env.docker 配置文件
    docker compose --env-file .env.docker up -d
) else (
    echo 使用默认配置（建议创建 .env.docker 文件自定义配置）
    docker compose up -d
)

if %ERRORLEVEL% neq 0 (
    echo 错误：服务启动失败
    exit /b 1
)

echo.
echo === 部署完成 ===
echo.
echo 查看日志：
echo   docker compose logs -f nanoclaw
echo.
echo 停止服务：
echo   docker compose down
echo.
echo 重启服务：
echo   docker compose restart
echo.

endlocal
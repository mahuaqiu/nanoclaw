@echo off
chcp 65001 >nul 2>&1
REM NanoClaw Docker Deploy Script for Windows

echo === NanoClaw Docker Deploy ===

REM Check Docker
where docker >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not installed
    echo Please install Docker Desktop: https://www.docker.com/products/docker-desktop
    exit /b 1
)

REM Check Docker running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not running
    echo Please start Docker Desktop first
    exit /b 1
)

REM Change to script directory
cd /d "%~dp0"

REM Step 1: Build Agent container
echo.
echo [1/3] Building Agent container...
cd container
docker build -t nanoclaw-agent:latest .
if errorlevel 1 (
    echo ERROR: Agent container build failed
    cd ..
    exit /b 1
)
cd ..

REM Step 2: Build NanoClaw main container
echo.
echo [2/3] Building NanoClaw main container...
docker build -t nanoclaw:latest .
if errorlevel 1 (
    echo ERROR: NanoClaw main container build failed
    exit /b 1
)

REM Step 3: Start service
echo.
echo [3/3] Starting NanoClaw service...

if exist ".env.docker" (
    echo Using .env.docker config file
    docker compose --env-file .env.docker up -d
) else (
    echo Using default config (create .env.docker to customize)
    docker compose up -d
)

if errorlevel 1 (
    echo ERROR: Service start failed
    exit /b 1
)

echo.
echo === Deploy Complete ===
echo.
echo View logs:
echo   docker compose logs -f nanoclaw
echo.
echo Stop service:
echo   docker compose down
echo.
echo Restart service:
echo   docker compose restart
echo.
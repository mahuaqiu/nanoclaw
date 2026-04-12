#!/bin/bash
# NanoClaw Docker 部署脚本
# 一键构建并启动 NanoClaw

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== NanoClaw Docker 部署 ==="

# 检查 Docker 是否可用
if ! command -v docker &>/dev/null; then
    echo "错误：Docker 未安装或不可用"
    exit 1
fi

# 检查 Docker 是否运行
if ! docker info &>/dev/null; then
    echo "错误：Docker 未运行，请先启动 Docker"
    exit 1
fi

# 步骤 1：构建 Agent 容器镜像
echo ""
echo "[1/3] 构建 Agent 容器镜像..."
cd container
docker build -t nanoclaw-agent:latest .
cd ..

# 步骤 2：构建 NanoClaw 主镜像
echo ""
echo "[2/3] 构建 NanoClaw 主镜像..."
docker build -t nanoclaw:latest .

# 步骤 3：启动服务
echo ""
echo "[3/3] 启动 NanoClaw 服务..."

# 检查是否存在 .env.docker 文件
if [ -f ".env.docker" ]; then
    echo "使用 .env.docker 配置文件"
    docker compose --env-file .env.docker up -d
else
    echo "使用默认配置（建议创建 .env.docker 文件自定义配置）"
    docker compose up -d
fi

echo ""
echo "=== 部署完成 ==="
echo ""
echo "查看日志："
echo "  docker compose logs -f nanoclaw"
echo ""
echo "停止服务："
echo "  docker compose down"
echo ""
echo "重启服务："
echo "  docker compose restart"
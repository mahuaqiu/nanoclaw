# NanoClaw 主应用 Docker 镜像
# 用于运行 NanoClaw 服务，通过 Docker socket 启动 agent 容器

FROM node:20-alpine

# 安装构建工具（用于编译 better-sqlite3 原生模块）
# 安装 Docker CLI（用于在容器内构建和运行 agent 容器）
# 安装 git（用于 setup 流程中的 git 操作）
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    docker-cli \
    git \
    curl \
    bash

# 设置工作目录
WORKDIR /app

# 复制 package 文件（利用 Docker 缓存）
COPY package.json package-lock.json* ./

# 安装依赖（需要 --unsafe-perm 用于原生模块编译）
RUN npm ci --unsafe-perm

# 复制项目文件
COPY . .

# 构建 TypeScript
RUN npm run build

# 创建必要的目录
RUN mkdir -p logs store/groups store/auth data groups

# 构建 agent 容器镜像（需要 Docker socket）
# 注意：构建时需要挂载 Docker socket，或使用多阶段构建预先构建镜像
# 这里我们假设 Docker socket 在运行时可用，镜像需要预先构建
RUN echo "Agent container image needs to be built separately or pre-built"

# 设置环境变量默认值
ENV ASSISTANT_NAME=Andy
ENV TZ=Asia/Shanghai
ENV LOG_LEVEL=info
ENV CONTAINER_IMAGE=nanoclaw-agent:latest
ENV CONTAINER_TIMEOUT=1800000
ENV CONTAINER_MAX_OUTPUT_SIZE=10485760
ENV MAX_MESSAGES_PER_PROMPT=10
ENV IDLE_TIMEOUT=1800000
ENV MAX_CONCURRENT_CONTAINERS=5

# 启动命令
CMD ["node", "dist/index.js"]
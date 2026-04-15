# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Configure China mirrors for faster downloads
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser and claude-code globally (use China npm mirror)
RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g agent-browser @anthropic-ai/claude-code

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies (use China npm mirror)
RUN npm config set registry https://registry.npmmirror.com && npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Install gosu for proper user switching (fix permissions then drop to node user)
RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
#
# In Docker-in-Docker scenarios, /app/src mount may fail due to path resolution.
# Fall back to pre-built /app/dist/ if source files are not available.
#
# IMPORTANT: Fix permissions on mounted directories (Docker Desktop Windows issue)
# Bind mounts may have incorrect owner (root instead of node), causing write failures.
RUN printf '#!/bin/bash\nset -e\nif [ -d /home/node/.claude ]; then chown -R node:node /home/node/.claude 2>/dev/null || true; fi\nif [ -d /workspace/ipc ]; then chown -R node:node /workspace/ipc 2>/dev/null || true; fi\ncat > /tmp/input.json\nGROUP_FOLDER=$(grep groupFolder /tmp/input.json | sed "s/.*groupFolder\":\"//;s/\".*//")\nSRC_DIR="/app/data/sessions/$GROUP_FOLDER/agent-runner-src"\nif [ -d "$SRC_DIR" ]; then\n  cd "$SRC_DIR"\n  TS_FILES=$(ls *.ts 2>/dev/null)\n  if [ -n "$TS_FILES" ]; then\n    echo "Compiling agent-runner..." >&2\n    npx tsc --outDir /tmp/dist --rootDir . --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck *.ts >&2\n    ln -sf /app/node_modules /tmp/dist/node_modules\n    chmod -R a-w /tmp/dist\n    DIST_DIR=/tmp/dist\n  else\n    DIST_DIR=/app/dist\n  fi\nelse\n  DIST_DIR=/app/dist\nfi\nexec gosu node node $DIST_DIR/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Don't switch to node user here - entrypoint will use gosu to drop privileges
# This allows entrypoint to fix permissions first
USER root

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]

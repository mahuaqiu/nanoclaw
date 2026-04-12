# NanoClaw HTTP API 频道对接文档

## 概述

本文档描述 NanoClaw HTTP API 频道与对端服务的对接方式。

NanoClaw 作为 AI 助手服务端，提供 HTTP REST API 接口，供对端服务调用：
- 对端服务发送用户消息 → NanoClaw 处理 → NanoClaw 返回 AI 回复

**API 端点汇总**：

| 端点 | 方法 | 用途 | 认证 |
|------|------|------|------|
| `/api/message` | POST | 发送用户消息 | 需要 |
| `/api/outbox/{jid}` | GET | 获取 AI 回复（轮询） | 需要 |
| `/api/register` | POST | 注册聊天群组 | 需要 |
| `/api/groups` | GET | 查询已注册群组 | 需要 |
| `/api/clear` | POST | 清除会话上下文 | 需要 |
| `/api/session/{id}` | GET | 查询会话状态 | 需要 |
| `/api/health` | GET | 健康检查 | 无需 |

**两种对接模式**：
1. **轮询模式**：对端服务主动调用 NanoClaw API 发送消息，然后轮询获取回复
2. **回调模式**：对端服务提供回调接口，NanoClaw 主动推送 AI 回复

---

## 一、NanoClaw 提供的接口

### 基础信息

| 项目 | 值 |
|------|-----|
| 服务地址 | `http://{nanoclaw-host}:8080` |
| 认证方式 | Bearer Token（Header: `Authorization: Bearer <token>`） |
| 数据格式 | JSON |
| 编码 | UTF-8 |

### 1.1 发送消息接口

**用途**：对端服务将用户消息发送给 NanoClaw

```
POST /api/message
```

**请求头**：
```
Content-Type: application/json
Authorization: Bearer <token>  // 如果配置了 HTTP_API_TOKEN
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chat_id` | string | **必填** | 聊天唯一标识，对端服务自定义，如 `group-001` |
| `sender` | string | **必填** | 发送者唯一标识，如 `user-123` |
| `sender_name` | string | 可选 | 发送者显示名称，如 `张三`，默认使用 sender |
| `content` | string | **必填** | 消息内容，需包含触发词（如 `@Andy`） |
| `chat_name` | string | 可选 | 聊天名称，如 `技术讨论群` |
| `is_group` | boolean | 可选 | 是否群聊，默认 `false` |
| `id` | string | 可选 | 消息唯一 ID，不填则自动生成 |
| `timestamp` | string | 可选 | ISO 时间戳，不填则自动生成 |
| `reply_to_message_id` | string | 可选 | 回复的消息 ID |
| `reply_to_message_content` | string | 可选 | 回复的消息内容 |
| `reply_to_sender_name` | string | 可选 | 回复的发送者名称 |

**请求示例**：

```json
{
  "chat_id": "group-001",
  "sender": "user-123",
  "sender_name": "张三",
  "content": "@Andy 请帮我写一个 Python 快速排序函数",
  "chat_name": "技术讨论群",
  "is_group": true
}
```

**响应**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `ok` 表示成功 |
| `message_id` | string | 消息唯一 ID |

**响应示例**：

```json
{
  "status": "ok",
  "message_id": "1744335600000-abc123"
}
```

**错误响应**：

```json
{
  "error": "Missing required fields: chat_id, sender, content"
}
```

---

### 1.2 获取回复接口（轮询模式）

**用途**：对端服务轮询获取 NanoClaw 生成的 AI 回复

```
GET /api/outbox/{jid}
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天标识，格式为 `http:{chat_id}`，如 `http:group-001` |

**请求示例**：

```bash
GET /api/outbox/http:group-001
Authorization: Bearer <token>
```

**响应**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `jid` | string | 聊天 JID |
| `messages` | string[] | AI 回复消息列表（可能有多条） |
| `count` | number | 消息数量 |

**响应示例**：

```json
{
  "jid": "http:group-001",
  "messages": [
    "好的，这是一个 Python 快速排序函数的实现：\n\n```python\ndef quicksort(arr):\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quicksort(left) + middle + quicksort(right)\n```\n\n使用示例：`quicksort([3, 6, 8, 10, 1, 2, 1])` 返回 `[1, 1, 2, 3, 6, 8, 10]`"
  ],
  "count": 1
}
```

**重要说明**：
- 每次调用会清空该聊天的待发送消息队列
- 建议轮询间隔：2-5 秒
- AI 处理时间可能较长（通常 10-60 秒），需要持续轮询直到收到回复

---

### 1.3 注册聊天群组接口

**用途**：对端服务注册聊天群组，以便 NanoClaw 能处理该群的消息

```
POST /api/register
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chat_id` | string | **必填** | 聊天唯一标识 |
| `name` | string | **必填** | 聊天名称 |
| `folder` | string | **必填** | 群组文件夹名称，用于存储上下文和记忆 |
| `trigger` | string | **必填** | 触发词，如 `@Andy` |
| `is_group` | boolean | 可选 | 是否群聊，默认 `false` |
| `is_main` | boolean | 可选 | 是否主群组，默认 `false`。主群组无需触发词即可响应 |
| `requires_trigger` | boolean | 可选 | 是否需要触发词，默认 `true`。设为 `false` 时所有消息都会触发 AI |
| `container_config` | object | 可选 | 容器配置，如 `{ "additionalMounts": [...] }` |

**请求示例**：

注册主群组（无需触发词，所有消息都会响应）：

```json
{
  "chat_id": "main-group",
  "name": "主控制群",
  "folder": "http_main",
  "trigger": "@Andy",
  "is_main": true,
  "requires_trigger": false,
  "is_group": true
}
```

注册普通群组（需要触发词才能响应）：

```json
{
  "chat_id": "group-001",
  "name": "技术讨论群",
  "folder": "http_group-001",
  "trigger": "@Andy",
  "is_group": true
}
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "is_main": false,
  "requires_trigger": true
}
```

**重要说明**：
- `folder` 参数用于指定群组数据存储目录，建议格式为 `http_{chat_id}`
- `is_main` 设为 `true` 的群组无需触发词即可响应所有消息
- 每个 NanoClaw 实例通常只有一个主群组
```

---

### 1.4 查询已注册群组接口

```
GET /api/groups
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "groups": [
    {
      "jid": "http:group-001",
      "name": "技术讨论群",
      "folder": "group-001"
    }
  ],
  "count": 1
}
```

---

### 1.5 清除会话接口

**用途**：清除某个聊天的会话上下文，下次对话从头开始

```
POST /api/clear
Authorization: Bearer <token>
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chat_id` | string | **必填** | 要清除会话的聊天 ID |

**请求示例**：

```json
{
  "chat_id": "group-001"
}
```

**响应示例**：

```json
{
  "status": "ok",
  "message": "Session cleared, next conversation will start fresh",
  "chat_id": "group-001",
  "folder": "http_group-001"
}
```

**错误响应**：

```json
{
  "error": "Chat not registered",
  "chat_id": "group-001"
}
```

**重要说明**：
- 清除会话后，该聊天的所有对话历史将被重置
- 下次发送消息时，AI 将没有之前的上下文记忆
- 这不是压缩，而是完全重置

---

### 1.6 查询会话信息接口

**用途**：查询某个聊天的会话状态

```
GET /api/session/{chat_id}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `chat_id` | 聊天 ID |

**请求示例**：

```bash
GET /api/session/group-001
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "chat_id": "group-001",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "session_id": "abc-123-def",
  "has_session": true
}
```

**无会话时的响应**：

```json
{
  "chat_id": "group-001",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "session_id": null,
  "has_session": false
}
```

---

### 1.7 健康检查接口

```
GET /api/health
```

**无需认证**

**响应示例**：

```json
{
  "status": "ok",
  "channel": "http-api"
}
```

---

## 二、对端服务对接方式

### 2.1 轮询模式（推荐）

对端服务主动发送消息并轮询获取回复。

**流程**：

```
1. 用户发送消息 → 对端服务
2. 对端服务调用 POST /api/message 发送给 NanoClaw
3. NanoClaw 开始处理（调用 AI）
4. 对端服务每 2-5 秒调用 GET /api/outbox/{jid} 轮询
5. 收到回复后，对端服务展示给用户
```

**对端服务实现示例（伪代码）**：

```python
def handle_user_message(chat_id, sender_id, sender_name, content):
    # 1. 发送消息给 NanoClaw
    response = http_post(
        "http://nanoclaw:8080/api/message",
        headers={"Authorization": "Bearer <token>"},
        json={
            "chat_id": chat_id,
            "sender": sender_id,
            "sender_name": sender_name,
            "content": content
        }
    )
    
    if response["status"] != "ok":
        return "发送失败"
    
    # 2. 轮询获取回复
    jid = f"http:{chat_id}"
    for i in range(30):  # 最多等待 60 秒
        sleep(2)
        outbox = http_get(
            f"http://nanoclaw:8080/api/outbox/{jid}",
            headers={"Authorization": "Bearer <token>"}
        )
        
        if outbox["count"] > 0:
            # 3. 返回 AI 回复
            return outbox["messages"][0]
    
    return "AI 处理超时"
```

---

### 2.2 回调模式（可选）

如果对端服务希望 NanoClaw 主动推送回复，需要提供回调接口。

**对端服务需要提供的接口**：

```
POST /callback/message
```

**请求体（NanoClaw 发送给对端服务）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `chat_id` | string | 聊天 ID（去掉 `http:` 前缀） |
| `message` | string | AI 回复内容 |
| `timestamp` | string | ISO 时间戳 |

**请求示例**：

```json
{
  "chat_id": "group-001",
  "message": "这是 AI 的回复内容...",
  "timestamp": "2024-04-12T10:30:00Z"
}
```

**对端服务响应**：

```json
{
  "status": "ok"
}
```

**配置回调 URL**：

在 `.env.docker` 中配置：

```bash
HTTP_API_CALLBACK_URL=http://your-service:9000/callback/message
```

---

## 三、触发词机制

NanoClaw 使用触发词判断是否需要响应消息：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `ASSISTANT_NAME` | `Andy` | 助手名称 |
| 触发词 | `@Andy` | 消息需以触发词开头才会触发 AI |

**示例**：
- ✅ `@Andy 写一个 Python 函数` → 会触发 AI
- ✅ `@Andy 你好` → 会触发 AI
- ❌ `写一个 Python 函数` → 不会触发 AI（普通消息）

**注册群组时可以自定义触发词**：

```json
{
  "chat_id": "group-001",
  "name": "技术讨论群",
  "trigger": "@Bot"
}
```

---

## 四、上下文管理机制

### 4.1 上下文保持规则

**同一个 chat_id = 同一个上下文**

NanoClaw 自动为每个 chat_id 维护独立的对话历史：

| chat_id | 上下文 |
|---------|--------|
| `group-001` | 独立的会话历史，包含所有过往对话 |
| `group-002` | 另一个独立的会话历史，与 group-001 完全隔离 |
| `user-123` | 用户私聊的独立会话 |

### 4.2 上下文存储

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| session_id | SQLite `sessions` 表 | 会话标识，用于恢复对话 |
| 会话历史 | `data/sessions/{folder}/.claude/*.jsonl` | Claude Agent SDK 的对话记录 |
| 群组内存 | `groups/{folder}/CLAUDE.md` | 群组专属的长期记忆（CLAUDE.md） |

### 4.3 对话恢复流程

```
用户发送消息 (chat_id: "group-001")
    ↓
NanoClaw 查找该 chat_id 的 session_id
    ↓
启动容器，传入 session_id 和历史对话
    ↓
AI 看到完整上下文，继续之前的对话
    ↓
回复完成，更新 session_id（如有变化）
```

### 4.4 上下文限制

| 项目 | 默认值 | 说明 |
|------|--------|------|
| 最大上下文长度 | 200K tokens | Claude 模型的上下文窗口限制 |
| 自动压缩 | 165K tokens 时触发 | 超过阈值自动压缩旧对话 |
| 压缩后保留 | 摘要 + 最近对话 | 保留关键信息，丢弃详细历史 |

### 4.5 清除上下文

如果需要清除某个 chat_id 的对话历史（重新开始），调用清除会话接口：

```bash
curl -X POST http://nanoclaw-host:8080/api/clear \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"chat_id": "group-001"}'
```

**响应**：

```json
{
  "status": "ok",
  "message": "Session cleared, next conversation will start fresh",
  "chat_id": "group-001"
}
```

清除后：
- 该聊天的 session_id 被删除
- 下次发送消息时，AI 没有之前的上下文记忆
- 对话从头开始

---

### 4.6 查询会话状态

```bash
curl http://nanoclaw-host:8080/api/session/group-001 \
  -H "Authorization: Bearer your-token"
```

**响应**：

```json
{
  "chat_id": "group-001",
  "session_id": "abc-123",
  "has_session": true
}
```

---

## 五、消息格式规范

### 4.1 消息内容

- 支持 Markdown 格式（AI 回复通常包含代码块）
- 支持长消息（NanoClaw 会自动分割超长消息）
- 特殊字符需 JSON 转义

### 4.2 编码要求

- 所有字符串使用 UTF-8 编码
- 时间戳使用 ISO 8601 格式：`2024-04-12T10:30:00Z`

### 4.3 ID 格式

- `chat_id`：对端服务自定义，建议使用字母、数字、下划线、短横线，如 `group-001`
- `sender`：对端服务自定义，如 `user-123`

---

## 五、错误处理

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 认证失败（Token 无效或缺失） |
| 404 | 接口不存在或群组未注册 |
| 500 | 服务内部错误 |

**错误响应格式**：

```json
{
  "error": "错误描述信息"
}
```

---

## 六、对接测试流程

### 步骤 1：健康检查

```bash
curl http://nanoclaw-host:8080/api/health
```

预期响应：`{"status":"ok","channel":"http-api"}`

### 步骤 2：注册测试群组

```bash
curl -X POST http://nanoclaw-host:8080/api/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"chat_id":"test-001","name":"测试群","folder":"http_test-001","trigger":"@Andy","is_group":true}'
```

注册主群组（可选）：

```bash
curl -X POST http://nanoclaw-host:8080/api/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"chat_id":"main","name":"主控制群","folder":"http_main","trigger":"@Andy","is_main":true,"requires_trigger":false}'
```

### 步骤 3：发送测试消息

```bash
curl -X POST http://nanoclaw-host:8080/api/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"chat_id":"test-001","sender":"user-1","sender_name":"测试用户","content":"@Andy 你好"}'
```

### 步骤 4：轮询获取回复

```bash
# 每 2-5 秒执行一次，直到收到回复
curl http://nanoclaw-host:8080/api/outbox/http:test-001 \
  -H "Authorization: Bearer your-token"
```

---

## 七、常见问题

### Q1：消息发送后多久能收到回复？

AI 处理时间通常 10-60 秒，取决于消息复杂度和模型响应速度。建议轮询间隔 2-5 秒，最多等待 2 分钟。

### Q2：如何处理超长消息？

NanoClaw 会自动分割超长消息（超过 4000 字符）。对端服务需要处理多条消息的情况。

### Q3：如何处理代码块？

AI 回复可能包含 Markdown 代码块，如：

```
```python
def hello():
    print("Hello")
```
```

对端服务需要正确渲染 Markdown，或将代码块提取展示。

### Q4：群组未注册会怎样？

如果发送消息的 `chat_id` 未注册，消息会被存储但不会触发 AI 响应。需要先调用 `/api/register` 注册群组。

---

## 八、配置汇总

### NanoClaw 侧配置（.env.docker）

```bash
# HTTP API 频道配置
HTTP_API_ENABLED=true
HTTP_API_PORT=8080
HTTP_API_TOKEN=your-secret-token    # 认证 Token，可选

# 回调 URL（如果使用回调模式）
HTTP_API_CALLBACK_URL=http://your-service:9000/callback/message

# 助手配置
ASSISTANT_NAME=Andy
```

### 对端服务侧配置

```bash
# NanoClaw API 地址
NANOCLAW_API_URL=http://nanoclaw-host:8080
NANOCLAW_API_TOKEN=your-secret-token
```

---

## 九、完整对接示例（Python）

```python
import requests
import time

class NanoClawClient:
    def __init__(self, api_url, token=None):
        self.api_url = api_url
        self.headers = {"Content-Type": "application/json"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
    
    def health_check(self):
        """健康检查"""
        resp = requests.get(f"{self.api_url}/api/health")
        return resp.json()
    
    def register_group(self, chat_id, name, folder, trigger, is_group=True, 
                    is_main=False, requires_trigger=True):
        """注册群组"""
        data = {
            "chat_id": chat_id,
            "name": name,
            "folder": folder,
            "trigger": trigger,
            "is_group": is_group,
            "is_main": is_main,
            "requires_trigger": requires_trigger
        }
        resp = requests.post(f"{self.api_url}/api/register", 
                             headers=self.headers, json=data)
        return resp.json()
    
    def send_message(self, chat_id, sender, content, sender_name=None, 
                     chat_name=None, is_group=None):
        """发送消息"""
        data = {
            "chat_id": chat_id,
            "sender": sender,
            "content": content
        }
        if sender_name:
            data["sender_name"] = sender_name
        if chat_name:
            data["chat_name"] = chat_name
        if is_group:
            data["is_group"] = is_group
        
        resp = requests.post(f"{self.api_url}/api/message",
                             headers=self.headers, json=data)
        return resp.json()
    
    def get_reply(self, chat_id, max_wait=60, poll_interval=2):
        """轮询获取回复"""
        jid = f"http:{chat_id}"
        for _ in range(max_wait // poll_interval):
            time.sleep(poll_interval)
            resp = requests.get(f"{self.api_url}/api/outbox/{jid}",
                                 headers=self.headers)
            data = resp.json()
            if data["count"] > 0:
                return data["messages"]
        return None
    
    def chat(self, chat_id, sender, content, sender_name=None):
        """发送消息并等待回复"""
        self.send_message(chat_id, sender, content, sender_name)
        return self.get_reply(chat_id)


# 使用示例
client = NanoClawClient("http://localhost:8080", "your-token")

# 注册主群组（无需触发词）
client.register_group("main", "主控制群", "http_main", "@Andy", 
                      is_main=True, requires_trigger=False)

# 注册普通群组（需要触发词）
client.register_group("group-001", "技术讨论群", "http_group-001", "@Andy")

# 发送消息并获取回复
replies = client.chat("group-001", "user-123", "@Andy 写一个排序算法", "张三")
for reply in replies:
    print(f"AI: {reply}")
```

---

## 十、技术支持

如有问题，请联系：
- 查看日志：`docker compose logs -f nanoclaw`
- NanoClaw GitHub：https://github.com/qwibitai/nanoclaw
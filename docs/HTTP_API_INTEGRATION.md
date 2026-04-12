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
| `/api/register` | POST | 注册聊天群组（支持多角色） | 需要 |
| `/api/groups` | GET | 查询已注册群组列表 | 需要 |
| `/api/groups/{jid}` | GET | 查询群组详情 | 需要 |
| `/api/groups/{jid}` | PUT | 更新群组（支持多角色） | 需要 |
| `/api/groups/{jid}` | DELETE | 删除群组 | 需要 |
| `/api/clear` | POST | 清除会话上下文 | 需要 |
| `/api/session/{id}` | GET | 查询会话状态 | 需要 |
| `/api/profiles/{jid}` | GET | 查询群组所有角色 | 需要 |
| `/api/profiles/{jid}/{profileId}` | GET | 查询角色详情 | 需要 |
| `/api/profiles/{jid}` | POST | 添加新角色 | 需要 |
| `/api/profiles/{jid}/{profileId}` | PUT | 更新角色配置 | 需要 |
| `/api/profiles/{jid}/{profileId}` | DELETE | 删除角色 | 需要 |
| `/api/skills` | GET | 查询所有全局 skill | 需要 |
| `/api/skills/{skillId}` | GET | 查询 skill 详情 | 需要 |
| `/api/skills/{skillId}` | POST | 新增全局 skill | 需要 |
| `/api/skills/{skillId}` | PUT | 编辑全局 skill | 需要 |
| `/api/skills/{skillId}` | DELETE | 删除全局 skill | 需要 |
| `/api/profiles/{jid}/{profileId}/skills` | GET | 查询 profile 的 skill 列表 | 需要 |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | POST | 分配 skill 给 profile | 需要 |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | DELETE | 移除 profile 的 skill | 需要 |
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
| `callback_url` | string | 可选 | **回调模式**：NanoClaw 会主动推送 AI 回复到此 URL |

**两种模式**：

| 模式 | 参数 | 说明 |
|------|------|------|
| 轮询模式 | 不传 `callback_url` | AI 回复存入 outbox，调用方轮询 `GET /api/outbox/{jid}` 获取 |
| 回调模式 | 传入 `callback_url` | NanoClaw 处理完成后主动 POST 回复到指定的 URL |

**请求示例（轮询模式）**：

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

**用途**：对端服务注册聊天群组，以便 NanoClaw 能处理该群的消息。支持两种格式：单一角色（旧格式）和多角色（新格式）。

```
POST /api/register
```

#### 请求体（新格式：支持多角色）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chat_id` | string | **必填** | 聊天唯一标识 |
| `folder` | string | **必填** | 群组文件夹名称，用于存储上下文和记忆 |
| `profiles` | array | **必填** | 角色数组，每个角色有独立的触发词 |
| `default_profile` | string | 可选 | 默认角色 ID（无触发词时使用） |
| `is_group` | boolean | 可选 | 是否群聊，默认 `false` |
| `is_main` | boolean | 可选 | 是否主群组，默认 `false`。主群组无需触发词即可响应 |
| `requires_trigger` | boolean | 可选 | 是否需要触发词，默认 `true`。设为 `false` 时所有消息都会触发 AI |
| `container_config` | object | 可选 | 容器配置，如 `{ "additionalMounts": [...] }` |

**profiles 数组元素字段**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 可选 | 角色 ID，不填则自动生成 |
| `name` | string | **必填** | 角色显示名称 |
| `trigger` | string | **必填** | 触发词，如 `@Andy`，同一群内不能重复 |
| `description` | string | 可选 | 角色描述 |
| `containerConfig` | object | 可选 | 角色专属容器配置 |
| `isActive` | boolean | 可选 | 是否激活，默认 `true` |

#### 请求体（旧格式：单一角色）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `chat_id` | string | **必填** | 聊天唯一标识 |
| `name` | string | **必填** | 聊天名称 |
| `folder` | string | **必填** | 群组文件夹名称 |
| `trigger` | string | **必填** | 触发词，如 `@Andy` |
| `is_group` | boolean | 可选 | 是否群聊，默认 `false` |
| `is_main` | boolean | 可选 | 是否主群组，默认 `false` |
| `requires_trigger` | boolean | 可选 | 是否需要触发词，默认 `true` |
| `container_config` | object | 可选 | 容器配置 |

---

**请求示例（新格式：注册多角色群组）**：

```json
{
  "chat_id": "group-001",
  "folder": "http_group-001",
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": "日常问题助手"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题和代码实现"
    }
  ],
  "default_profile": "andy",
  "is_group": true
}
```

**请求示例（新格式：注册主群组）**：

```json
{
  "chat_id": "main-group",
  "folder": "http_main",
  "profiles": [
    {
      "id": "main",
      "name": "主控制群",
      "trigger": "@Andy"
    }
  ],
  "is_main": true,
  "requires_trigger": false,
  "is_group": true
}
```

**请求示例（旧格式：注册单一角色群组）**：

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

---

**响应示例（新格式）**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "is_main": false,
  "requires_trigger": true,
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": "日常问题助手",
      "isActive": true,
      "addedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题和代码实现",
      "isActive": true,
      "addedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "profiles_count": 2
}
```

**响应示例（旧格式）**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "is_main": false,
  "requires_trigger": true
}
```

---

**错误响应**：

缺少必要字段：

```json
{
  "error": "Missing required fields: chat_id, folder"
}
```

格式不正确（既没有 profiles 也没有 name+trigger）：

```json
{
  "error": "Must provide either profiles array or name+trigger fields"
}
```

触发词重复：

```json
{
  "error": "Duplicate triggers in profiles",
  "triggers": ["@Andy", "@Andy"]
}
```

---

**重要说明**：
- `folder` 参数用于指定群组数据存储目录，建议格式为 `http_{chat_id}`
- `is_main` 设为 `true` 的群组无需触发词即可响应所有消息
- 每个 NanoClaw 实例通常只有一个主群组
- 新格式支持一次性注册多个角色，旧格式只支持单一角色
- 两种格式兼容，旧格式的调用仍然有效

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

### 1.4.1 查询群组详情接口

**用途**：查询单个群组的详细信息，包括所有角色配置

```
GET /api/groups/{jid}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天 JID，格式为 `http:{chat_id}`，如 `http:group-001` |

**请求示例**：

```bash
GET /api/groups/http:group-001
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "jid": "http:group-001",
  "folder": "http_group-001",
  "is_main": false,
  "requires_trigger": true,
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": "日常问题助手",
      "isActive": true,
      "addedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题",
      "isActive": true,
      "addedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "profiles_count": 2
}
```

**群组不存在时**：

```json
{
  "error": "Group not found",
  "jid": "http:group-001"
}
```

---

### 1.4.2 更新群组接口

**用途**：更新群组配置，支持一次性更新多个角色。可以修改角色列表、默认角色、触发要求等。

```
PUT /api/groups/{jid}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天 JID，格式为 `http:{chat_id}` |

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `profiles` | array | 可选 | 角色数组，传入后会完全替换现有角色 |
| `default_profile` | string | 可选 | 默认角色 ID |
| `requires_trigger` | boolean | 可选 | 是否需要触发词 |
| `container_config` | object | 可选 | 容器配置 |
| `name` | string | 可选 | 群组名称（旧格式） |
| `trigger` | string | 可选 | 触发词（旧格式，仅更新第一个角色） |

**请求示例（新格式：更新多角色）**：

```json
{
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": "日常问题和一般咨询"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题、代码实现和架构设计"
    },
    {
      "id": "daily",
      "name": "日报助手",
      "trigger": "@Daily",
      "description": "帮助生成和整理日报"
    }
  ],
  "default_profile": "andy",
  "requires_trigger": true
}
```

**请求示例（旧格式：更新单一角色）**：

```json
{
  "name": "技术讨论群（已改名）",
  "trigger": "@Bot"
}
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "folder": "http_group-001",
  "is_main": false,
  "requires_trigger": true,
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": "日常问题和一般咨询",
      "isActive": true,
      "addedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题、代码实现和架构设计",
      "isActive": true,
      "addedAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "daily",
      "name": "日报助手",
      "trigger": "@Daily",
      "description": "帮助生成和整理日报",
      "isActive": true,
      "addedAt": "2024-01-20T08:00:00Z"
    }
  ],
  "profiles_count": 3
}
```

**错误响应**：

群组不存在：

```json
{
  "error": "Group not found",
  "jid": "http:group-001"
}
```

触发词重复：

```json
{
  "error": "Duplicate triggers in profiles",
  "triggers": ["@Andy", "@Andy"]
}
```

**重要说明**：
- `folder` 和 `is_main` 不能通过此接口修改
- 传入 `profiles` 数组会**完全替换**现有角色列表，不传则保留现有角色
- 新角色会自动生成 ID 和添加时间
- 如果新角色数组中有已存在的 ID，会更新该角色；否则创建新角色
- 触发词必须在群组内唯一

---

### 1.4.3 删除群组接口

**用途**：删除已注册的群组及其所有角色配置

```
DELETE /api/groups/{jid}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天 JID，格式为 `http:{chat_id}` |

**请求示例**：

```bash
DELETE /api/groups/http:group-001
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "folder": "http_group-001"
}
```

**错误响应**：

群组不存在：

```json
{
  "error": "Group not found",
  "jid": "http:group-001"
}
```

尝试删除主群组：

```json
{
  "error": "Cannot delete main group",
  "jid": "http:main"
}
```

**重要说明**：
- 删除群组时会同时删除所有角色配置
- 删除群组时会清除该群组的会话记录
- **主群组（is_main=true）不能删除**，需要先取消主群组状态
- 群组文件夹（groups/{folder}）不会被删除，保留历史数据

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

### 1.7 查询会话信息接口

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

### 1.9 角色管理接口（Profile）

NanoClaw 支持在一个群组中配置多个不同角色（Profile），每个角色有独立的触发词，但共享同一群组的记忆和上下文。

#### 1.9.1 查询群组所有角色

```
GET /api/profiles/{jid}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天 JID，格式为 `http:{chat_id}`，如 `http:group-001` |

**响应示例**：

```json
{
  "jid": "http:group-001",
  "profiles": [
    {
      "id": "andy",
      "name": "通用助手",
      "trigger": "@Andy",
      "description": null,
      "isActive": true,
      "addedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "tech",
      "name": "技术专家",
      "trigger": "@Tech",
      "description": "专注于技术问题",
      "isActive": true,
      "addedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "count": 2
}
```

---

#### 1.9.2 查询角色详情

```
GET /api/profiles/{jid}/{profileId}
Authorization: Bearer <token>
```

**路径参数**：

| 参数 | 说明 |
|------|------|
| `jid` | 聊天 JID |
| `profileId` | 角色 ID |

**响应示例**：

```json
{
  "jid": "http:group-001",
  "profile": {
    "id": "tech",
    "name": "技术专家",
    "trigger": "@Tech",
    "description": "专注于技术问题",
    "containerConfig": null,
    "isActive": true,
    "addedAt": "2024-01-15T10:30:00Z"
  }
}
```

**角色不存在时**：

```json
{
  "error": "Profile not found",
  "jid": "http:group-001",
  "profileId": "tech"
}
```

---

#### 1.9.3 添加新角色

```
POST /api/profiles/{jid}
Authorization: Bearer <token>
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 可选 | 角色 ID，不填则自动生成 |
| `name` | string | **必填** | 角色显示名称 |
| `trigger` | string | **必填** | 触发词，如 `@Tech` |
| `description` | string | 可选 | 角色描述 |
| `isActive` | boolean | 可选 | 是否激活，默认 `true` |

**请求示例**：

```json
{
  "id": "tech",
  "name": "技术专家",
  "trigger": "@Tech",
  "description": "专注于技术问题和代码实现"
}
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "profile": {
    "id": "tech",
    "name": "技术专家",
    "trigger": "@Tech",
    "description": "专注于技术问题和代码实现",
    "isActive": true,
    "addedAt": "2024-01-15T10:30:00Z"
  }
}
```

**触发词冲突时**：

```json
{
  "error": "Trigger already exists for another profile",
  "trigger": "@Tech"
}
```

---

#### 1.9.4 更新角色配置

```
PUT /api/profiles/{jid}/{profileId}
Authorization: Bearer <token>
```

**请求体**（只需传要更新的字段）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 更新显示名称 |
| `trigger` | string | 更新触发词 |
| `description` | string | 更新描述 |
| `isActive` | boolean | 更新激活状态 |

**请求示例**：

```json
{
  "description": "专注于技术问题、代码实现和架构设计"
}
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "profileId": "tech",
  "updates": {
    "description": "专注于技术问题、代码实现和架构设计"
  }
}
```

---

#### 1.9.5 删除角色

```
DELETE /api/profiles/{jid}/{profileId}
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "profileId": "tech"
}
```

**尝试删除最后一个角色时**：

```json
{
  "error": "Cannot remove last profile",
  "jid": "http:group-001"
}
```

---

#### 多角色使用说明

**触发词匹配规则**：

| 触发词 | 角色 | 说明 |
|--------|------|------|
| `@Andy` | 通用助手 | 默认角色 |
| `@Tech` | 技术专家 | 添加后可用 |
| `@Daily` | 日报助手 | 添加后可用 |

**示例场景**：

```
用户: @Andy 今天的天气怎么样？
→ 通用助手响应

用户: @Tech 请帮我优化这个 Python 代码
→ 技术专家响应

用户: @Daily 生成今天的日报
→ 日报助手响应
```

**记忆共享**：

所有角色共享同一群组的对话历史和记忆：
- 所有角色都能看到完整的对话上下文
- 角色专属指令通过 `profiles/{id}/CLAUDE.md` 配置

---

### 1.10 健康检查接口

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

### 1.11 Skill 管理接口

NanoClaw 的容器 skill 是可分配给角色的指令模块，存储在 `container/skills/` 目录。每个 skill 包含一个 `SKILL.md` 文件，定义了 skill 的名称、描述和使用指令。

#### 1.11.1 查询所有全局 skill

```
GET /api/skills
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "skills": [
    {
      "id": "agent-browser",
      "name": "agent-browser",
      "description": "Browse the web for any task — research topics, read articles, interact with web apps, fill forms, take screenshots, extract data, and test web pages."
    },
    {
      "id": "capabilities",
      "name": "capabilities",
      "description": "Show what this NanoClaw instance can do — installed skills, available tools, and system info."
    }
  ],
  "count": 2
}
```

---

#### 1.11.2 查询 skill 详情

```
GET /api/skills/{skillId}
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "id": "agent-browser",
  "name": "agent-browser",
  "description": "Browse the web for any task...",
  "content": "---\nname: agent-browser\ndescription: Browse the web...\n---\n\n# Browser Automation...\n\n## Quick start\n..."
}
```

**skill 不存在时**：

```json
{
  "error": "Skill not found",
  "skillId": "nonexistent"
}
```

---

#### 1.11.3 新增 skill

```
POST /api/skills/{skillId}
Authorization: Bearer <token>
```

**请求体**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | **必填** | 完整的 SKILL.md 文件内容（包含 YAML frontmatter） |

**请求示例**：

```json
{
  "content": "---\nname: my-skill\ndescription: A custom skill\n---\n\n# My Skill\n\nInstructions here..."
}
```

**响应示例**：

```json
{
  "status": "ok",
  "id": "my-skill"
}
```

**skill 已存在时**：

```json
{
  "error": "Skill already exists",
  "skillId": "my-skill"
}
```

---

#### 1.11.4 编辑 skill

```
PUT /api/skills/{skillId}
Authorization: Bearer <token>
```

**请求体**：同新增 skill

**响应示例**：

```json
{
  "status": "ok",
  "id": "my-skill"
}
```

---

#### 1.11.5 删除 skill

```
DELETE /api/skills/{skillId}
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "status": "ok",
  "id": "my-skill"
}
```

---

#### 1.11.6 查询 profile 的 skill 列表

```
GET /api/profiles/{jid}/{profileId}/skills
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "jid": "http:group-001",
  "profileId": "tech",
  "skills": [
    {
      "id": "agent-browser",
      "name": "agent-browser"
    }
  ],
  "count": 1
}
```

---

#### 1.11.7 分配 skill 给 profile

```
POST /api/profiles/{jid}/{profileId}/skills/{skillId}
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "profileId": "tech",
  "skillId": "agent-browser"
}
```

**Profile 不存在时**：

```json
{
  "error": "Profile not found",
  "jid": "http:group-001",
  "profileId": "tech"
}
```

**skill 已分配时**：

```json
{
  "error": "Skill already assigned",
  "skillId": "agent-browser"
}
```

---

#### 1.11.8 移除 profile 的 skill

```
DELETE /api/profiles/{jid}/{profileId}/skills/{skillId}
Authorization: Bearer <token>
```

**响应示例**：

```json
{
  "status": "ok",
  "jid": "http:group-001",
  "profileId": "tech",
  "skillId": "agent-browser"
}
```

**Profile 不存在时**：

```json
{
  "error": "Profile not found",
  "jid": "http:group-001",
  "profileId": "tech"
}
```

**skill 未分配时**：

```json
{
  "error": "Skill not assigned to profile",
  "skillId": "agent-browser"
}
```

---

#### Skill 与角色

每个 profile 只能访问已分配给它的 skill。容器启动时：
- 查询 profile 已分配的 skill 列表
- 将全局 skill 文件同步到 profile 专属目录
- 挂载到容器供 AI 代理使用

不同 profile 可以有不同的 skill 配置，实现精细化的能力管理。

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

### 2.2 回调模式（推荐）

对端服务在发送消息时提供 `callback_url`，NanoClaw 处理完成后主动推送回复。

**流程**：

```
1. 用户发送消息 → 对端服务
2. 对端服务调用 POST /api/message（带 callback_url 参数）
3. NanoClaw 开始处理（调用 AI）
4. NanoClaw 处理完成后，POST 回复到 callback_url
5. 对端服务收到回复，展示给用户
```

**发送消息时传入 callback_url**：

```json
POST /api/message
{
  "chat_id": "group-001",
  "sender": "user-123",
  "sender_name": "张三",
  "content": "@Andy 写一个排序算法",
  "callback_url": "http://your-service:9000/callback/message"
}
```

**响应示例**：

```json
{
  "status": "ok",
  "message_id": "1744335600000-abc123",
  "callback_mode": true,
  "callback_url": "http://your-service:9000/callback/message"
}
```

**对端服务需要提供的回调接口**：

```
POST /callback/message
```

**NanoClaw 发送给对端服务的请求体**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `chat_id` | string | 聊天 ID（去掉 `http:` 前缀） |
| `message` | string | AI 回复内容 |
| `timestamp` | string | ISO 时间戳 |
| `profile_id` | string | **角色 ID**（如 `xiaoma`、`小威`），多角色群组时有效 |
| `profile_name` | string | **角色显示名称**（如 `小马助手`、`小威`），多角色群组时有效 |
| `trigger_word` | string | **触发词**（如 `@xiaoma`、`@小威`），多角色群组时有效 |

**请求示例（单角色群组）**：

```json
{
  "chat_id": "group-001",
  "message": "这是 AI 的回复内容...",
  "timestamp": "2024-04-12T10:30:00Z",
  "profile_id": null,
  "profile_name": null,
  "trigger_word": null
}
```

**请求示例（多角色群组 - xiaoma 回复）**：

```json
{
  "chat_id": "group-001",
  "message": "你好！我是小马助手 🐴...",
  "timestamp": "2024-04-12T10:30:00Z",
  "profile_id": "xiaoma",
  "profile_name": "小马助手",
  "trigger_word": "@xiaoma"
}
```

**请求示例（多角色群组 - 小威 回复）**：

```json
{
  "chat_id": "group-001",
  "message": "在的！我是小威...",
  "timestamp": "2024-04-12T10:35:00Z",
  "profile_id": "B0jEB0PDSot8pjrAfoKqe",
  "profile_name": "小威",
  "trigger_word": "@小威"
}
```

**对端服务响应**：

```json
{
  "status": "ok"
}
```

**回调失败处理**：

如果 callback_url 调用失败（网络错误、超时、非 2xx 响应），NanoClaw 会将回复存入 outbox，调用方仍可通过轮询获取：

```bash
GET /api/outbox/http:group-001
```

**注意事项**：
- callback_url 必须是完整的 URL（包含协议和端口）
- 支持 HTTP 和 HTTPS
- 超时时间：10 秒
- 回调失败不会阻塞系统，回复仍可在 outbox 中获取
- **轮询模式不包含 profile 信息**，多角色群组建议使用回调模式

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

**注册单一角色群组（旧格式）**：

```bash
curl -X POST http://nanoclaw-host:8080/api/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"chat_id":"test-001","name":"测试群","folder":"http_test-001","trigger":"@Andy","is_group":true}'
```

**注册多角色群组（新格式）**：

```bash
curl -X POST http://nanoclaw-host:8080/api/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "chat_id":"test-002",
    "folder":"http_test-002",
    "profiles":[
      {"id":"andy","name":"通用助手","trigger":"@Andy"},
      {"id":"tech","name":"技术专家","trigger":"@Tech"}
    ],
    "is_group":true
  }'
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
    
    def register_group(self, chat_id, name=None, folder=None, trigger=None, 
                       profiles=None, default_profile=None, is_group=True, 
                       is_main=False, requires_trigger=True):
        """注册群组（支持新旧两种格式）"""
        data = {
            "chat_id": chat_id,
            "folder": folder,
            "is_group": is_group,
            "is_main": is_main,
            "requires_trigger": requires_trigger
        }
        
        # 新格式：profiles 数组
        if profiles:
            data["profiles"] = profiles
            if default_profile:
                data["default_profile"] = default_profile
        # 旧格式：name + trigger
        elif name and trigger:
            data["name"] = name
            data["trigger"] = trigger
        else:
            raise ValueError("Must provide either profiles or name+trigger")
        
        resp = requests.post(f"{self.api_url}/api/register", 
                             headers=self.headers, json=data)
        return resp.json()
    
    def register_multi_profile_group(self, chat_id, folder, profiles, 
                                      default_profile=None, is_group=True):
        """注册多角色群组"""
        return self.register_group(
            chat_id=chat_id,
            folder=folder,
            profiles=profiles,
            default_profile=default_profile,
            is_group=is_group
        )
    
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

# 注册多角色群组（新格式）
client.register_multi_profile_group(
    "group-001", 
    "http_group-001",
    [
        {"id": "andy", "name": "通用助手", "trigger": "@Andy"},
        {"id": "tech", "name": "技术专家", "trigger": "@Tech"}
    ],
    default_profile="andy"
)

# 注册单一角色群组（旧格式）
client.register_group("group-002", "技术讨论群", "http_group-002", "@Andy")

# 注册主群组（无需触发词）
client.register_group("main", "主控制群", "http_main", "@Andy", 
                      is_main=True, requires_trigger=False)

# 发送消息并获取回复（根据触发词匹配不同角色）
replies = client.chat("group-001", "user-123", "@Andy 介绍一下你自己", "张三")
for reply in replies:
    print(f"AI: {reply}")

# 发送消息给技术专家角色
replies = client.chat("group-001", "user-123", "@Tech 写一个排序算法", "张三")
for reply in replies:
    print(f"AI: {reply}")
```

---

## 十、技术支持

如有问题，请联系：
- 查看日志：`docker compose logs -f nanoclaw`
- NanoClaw GitHub：https://github.com/qwibitai/nanoclaw
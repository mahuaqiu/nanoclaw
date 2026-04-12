---
title: 容器 Skill 管理接口设计
date: 2026-04-12
status: draft
---

# 容器 Skill 管理接口设计

## 背景

NanoClaw 的容器 skill 存储在 `container/skills/{skill-name}/SKILL.md`，目前所有群组和角色共享同一份 skill 文件。需要增加 HTTP API 来管理 skill，并支持将 skill 分配给特定角色（profile），实现更精细的管理。

## 需求

1. **全局 skill 管理**：通过 HTTP API 管理 `container/skills/` 目录下的 skill 文件
2. **Profile skill 分配**：将 skill 分配给特定 profile，profile 只能访问已分配的 skill
3. **自动同步**：skill 内容统一从全局目录读取，修改全局 skill 后所有 profile 自动生效

## 设计

### 1. 数据存储

#### 数据库

新增 `profile_skills` 表，存储 profile 与 skill 的分配关系：

```sql
CREATE TABLE IF NOT EXISTS profile_skills (
  jid TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (jid, profile_id, skill_id),
  FOREIGN KEY (jid, profile_id) REFERENCES agent_profiles(jid, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_profile_skills_lookup ON profile_skills(jid, profile_id);
```

#### 文件系统

| 路径 | 说明 |
|------|------|
| `container/skills/{skillId}/SKILL.md` | 全局 skill 模板库（新增/编辑/删除操作目标） |
| `data/sessions/{groupFolder}/profiles/{profileId}/.claude/skills/` | Profile 专属 skill 目录（容器运行时加载） |

### 2. API 接口

#### 全局 skill 管理

| 端点 | 方法 | 用途 | 请求体 | 响应 |
|------|------|------|--------|------|
| `/api/skills` | GET | 查询所有全局 skill 列表 | - | `{skills: [{id, name, description}], count}` |
| `/api/skills/{skillId}` | GET | 查询 skill 内容 | - | `{id, name, description, content}` |
| `/api/skills/{skillId}` | POST | 新增 skill | `{content: string}` | `{status, id}` |
| `/api/skills/{skillId}` | PUT | 编辑 skill | `{content: string}` | `{status, id}` |
| `/api/skills/{skillId}` | DELETE | 删除 skill | - | `{status, id}` |

**skillId 规则**：
- 使用目录名作为 skillId，如 `agent-browser`
- POST/PUT 的 `content` 是完整的 SKILL.md 文件内容（包含 YAML frontmatter）

#### Profile skill 分配

| 端点 | 方法 | 用途 | 请求体 | 响应 |
|------|------|------|--------|------|
| `/api/profiles/{jid}/{profileId}/skills` | GET | 查询 profile 已分配的 skill 列表 | - | `{jid, profileId, skills: [{id, name}], count}` |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | POST | 分配 skill 给 profile | - | `{status, jid, profileId, skillId}` |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | DELETE | 移除 profile 的 skill | - | `{status, jid, profileId, skillId}` |

### 3. 容器运行时加载机制

#### 容器启动流程

每个容器实例只服务于一个 profile：
- 消息触发时根据 trigger 匹配对应的 profile
- `runContainerAgent()` 传入 `profileId`
- 容器使用 `--rm` 参数，运行完成后自动删除

#### Skill 加载流程

修改 `buildVolumeMounts()` 函数：

1. 从数据库查询 profile 已分配的 skill 列表（`profile_skills` 表）
2. 将全局 skill 文件同步到 profile 的 skill 目录：
   - 目标目录：`data/sessions/{groupFolder}/profiles/{profileId}/.claude/skills/{skillId}/SKILL.md`
   - 只同步已分配的 skill，确保 profile 只能访问已分配的内容
3. 挂载 profile skill 目录到容器：
   - 容器路径：`/home/node/.claude/skills/`

#### 目录结构示例

```
container/skills/                    # 全局 skill 模板库
├── agent-browser/SKILL.md
├── capabilities/SKILL.md
└── status/SKILL.md

data/sessions/                       # Profile 专属 skill
└── my_group/
    └── profiles/
        ├── andy/
        │   └── .claude/
        │       └── skills/
        │           ├── agent-browser/SKILL.md  # 已分配
        │           └── capabilities/SKILL.md   # 已分配
        └── tech/
            └── .claude/
                └── skills/
                    └── agent-browser/SKILL.md  # tech 只分配了这一个
```

### 4. 错误处理

| 场景 | HTTP 状态码 | 错误响应 |
|------|-------------|----------|
| skill 不存在 | 404 | `{error: "Skill not found", skillId}` |
| profile 不存在 | 404 | `{error: "Profile not found", jid, profileId}` |
| skill 已分配给 profile | 400 | `{error: "Skill already assigned", skillId}` |
| skill 未分配给 profile | 404 | `{error: "Skill not assigned to profile", skillId}` |
| 删除不存在的 skill | 404 | `{error: "Skill not found", skillId}` |

### 5. 认证

所有 skill 管理接口需要认证：
- Header: `Authorization: Bearer <token>`
- Token 配置：环境变量 `HTTP_API_TOKEN`

## 文件变更清单

| 文件 | 变更内容 |
|------|----------|
| `src/db.ts` | 1. 新增 `profile_skills` 表 schema<br>2. 新增 CRUD 函数：`getAssignedSkills`, `assignSkill`, `removeSkill`, `skillAssigned`<br>3. 新增全局 skill 辅助函数：`listSkills`, `getSkillContent`, `saveSkillContent`, `deleteSkill` |
| `src/channels/http-api.ts` | 新增 8 个端点的处理函数 |
| `src/container-runner.ts` | 修改 `buildVolumeMounts()`，实现按 profile 加载 skill |
| `docs/HTTP_API_INTEGRATION.md` | 新增 skill 管理接口文档 |

## 实现优先级

1. **数据库层**：schema + CRUD 函数
2. **全局 skill API**：列表、查询、新增、编辑、删除
3. **Profile skill API**：查询、分配、移除
4. **容器加载机制**：按 profile 同步和挂载 skill
5. **文档更新**：HTTP API 对接文档
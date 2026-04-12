# 容器 Skill 管理接口实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 HTTP API 管理容器 skill，支持全局 skill 的 CRUD 操作和 profile skill 分配。

**Architecture:** 数据库存储 profile-skill 分配关系，容器启动时按 profile 同步已分配的 skill 到专属目录并挂载。

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Node.js HTTP Server

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/db.ts` | 数据库 schema + skill CRUD 函数 |
| `src/skill-manager.ts` | 全局 skill 文件操作辅助函数（新建） |
| `src/channels/http-api.ts` | HTTP API 端点处理 |
| `src/container-runner.ts` | 容器启动时按 profile 同步 skill |
| `docs/HTTP_API_INTEGRATION.md` | API 文档更新 |

---

### Task 1: 数据库 Schema 和 Profile Skill CRUD

**Files:**
- Modify: `src/db.ts`

- [ ] **Step 1: 添加 profile_skills 表 schema**

在 `createSchema()` 函数中添加新表（约第 102 行后）：

```typescript
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

- [ ] **Step 2: 添加 getAssignedSkills 函数**

在文件末尾（约第 1030 行后）添加：

```typescript
// --- Profile Skills accessors ---

/**
 * Get all skills assigned to a profile
 */
export function getAssignedSkills(jid: string, profileId: string): string[] {
  const rows = db
    .prepare('SELECT skill_id FROM profile_skills WHERE jid = ? AND profile_id = ? ORDER BY assigned_at')
    .all(jid, profileId) as Array<{ skill_id: string }>;
  return rows.map((row) => row.skill_id);
}

/**
 * Check if a skill is assigned to a profile
 */
export function isSkillAssigned(jid: string, profileId: string, skillId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM profile_skills WHERE jid = ? AND profile_id = ? AND skill_id = ?')
    .get(jid, profileId, skillId) as { 1: number } | undefined;
  return !!row;
}

/**
 * Assign a skill to a profile
 */
export function assignSkill(jid: string, profileId: string, skillId: string): void {
  db.prepare(
    'INSERT INTO profile_skills (jid, profile_id, skill_id, assigned_at) VALUES (?, ?, ?, ?)',
  ).run(jid, profileId, skillId, new Date().toISOString());
}

/**
 * Remove a skill from a profile
 */
export function removeSkillAssignment(jid: string, profileId: string, skillId: string): void {
  db.prepare(
    'DELETE FROM profile_skills WHERE jid = ? AND profile_id = ? AND skill_id = ?',
  ).run(jid, profileId, skillId);
}
```

- [ ] **Step 3: 运行编译验证**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 4: Commit**

```bash
git add src/db.ts
git commit -m "feat(db): add profile_skills table and CRUD functions"
```

---

### Task 2: 全局 Skill 文件管理辅助函数

**Files:**
- Create: `src/skill-manager.ts`

- [ ] **Step 1: 创建 skill-manager.ts 文件**

```typescript
/**
 * Skill Manager - 文件系统层面的 skill 管理
 * 操作 container/skills/ 目录下的全局 skill 文件
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const SKILLS_DIR = path.join(process.cwd(), 'container', 'skills');

/**
 * Skill 元信息（从 SKILL.md frontmatter 解析）
 */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * Skill 详情（包含完整内容）
 */
export interface SkillDetail extends SkillInfo {
  content: string;
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch?.[1]?.trim() || '',
    description: descMatch?.[1]?.trim() || '',
  };
}

/**
 * 列出所有全局 skill
 */
export function listGlobalSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    logger.warn({ dir: SKILLS_DIR }, 'Skills directory not found');
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const skillId of fs.readdirSync(SKILLS_DIR)) {
    const skillDir = path.join(SKILLS_DIR, skillId);
    if (!fs.statSync(skillDir).isDirectory()) continue;

    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta) {
        skills.push({
          id: skillId,
          name: meta.name || skillId,
          description: meta.description || '',
        });
      }
    } catch (err) {
      logger.warn({ skillId, err }, 'Failed to read skill file');
    }
  }

  return skills;
}

/**
 * 获取指定 skill 的详情
 */
export function getGlobalSkill(skillId: string): SkillDetail | null {
  const skillDir = path.join(SKILLS_DIR, skillId);
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return null;
  }

  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillFile, 'utf-8');
    const meta = parseFrontmatter(content);
    if (!meta) {
      // 没有 frontmatter，使用默认值
      return {
        id: skillId,
        name: skillId,
        description: '',
        content,
      };
    }
    return {
      id: skillId,
      name: meta.name || skillId,
      description: meta.description || '',
      content,
    };
  } catch (err) {
    logger.warn({ skillId, err }, 'Failed to read skill file');
    return null;
  }
}

/**
 * 检查 skill 是否存在
 */
export function skillExists(skillId: string): boolean {
  const skillDir = path.join(SKILLS_DIR, skillId);
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    return false;
  }
  const skillFile = path.join(skillDir, 'SKILL.md');
  return fs.existsSync(skillFile);
}

/**
 * 创建新 skill
 */
export function createGlobalSkill(skillId: string, content: string): void {
  const skillDir = path.join(SKILLS_DIR, skillId);
  fs.mkdirSync(skillDir, { recursive: true });

  const skillFile = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillFile, content, 'utf-8');

  logger.info({ skillId }, 'Skill created');
}

/**
 * 更新 skill 内容
 */
export function updateGlobalSkill(skillId: string, content: string): void {
  const skillFile = path.join(SKILLS_DIR, skillId, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  fs.writeFileSync(skillFile, content, 'utf-8');
  logger.info({ skillId }, 'Skill updated');
}

/**
 * 删除 skill
 */
export function deleteGlobalSkill(skillId: string): void {
  const skillDir = path.join(SKILLS_DIR, skillId);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  logger.info({ skillId }, 'Skill deleted');
}
```

- [ ] **Step 2: 运行编译验证**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add src/skill-manager.ts
git commit -m "feat(skill-manager): add global skill file management functions"
```

---

### Task 3: HTTP API - 全局 Skill 端点

**Files:**
- Modify: `src/channels/http-api.ts`
- Modify: `src/types.ts` (新增 SkillInfo 类型导出)

- [ ] **Step 1: 导入 skill-manager 和 db 函数**

在文件顶部导入区（约第 24 行后）添加：

```typescript
import {
  getAssignedSkills,
  isSkillAssigned,
  assignSkill,
  removeSkillAssignment,
} from '../db.js';
import {
  listGlobalSkills,
  getGlobalSkill,
  createGlobalSkill,
  updateGlobalSkill,
  deleteGlobalSkill,
  skillExists,
} from '../skill-manager.js';
```

- [ ] **Step 2: 添加路由分发**

在 `handleRequest()` 函数的路由区（约第 232 行后）添加：

```typescript
    // --- Global skills management ---
    } else if (pathname === '/api/skills' && method === 'GET') {
      this.handleListSkills(res);
    } else if (pathname?.startsWith('/api/skills/') && method === 'GET') {
      this.handleGetSkill(pathname, res);
    } else if (pathname?.startsWith('/api/skills/') && method === 'POST') {
      this.handleCreateSkill(pathname, req, res);
    } else if (pathname?.startsWith('/api/skills/') && method === 'PUT') {
      this.handleUpdateSkill(pathname, req, res);
    } else if (pathname?.startsWith('/api/skills/') && method === 'DELETE') {
      this.handleDeleteSkill(pathname, res);
    // --- Profile skills assignment ---
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+\/skills$/) && method === 'GET') {
      this.handleListProfileSkills(pathname, res);
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+\/skills\/[^/]+$/) && method === 'POST') {
      this.handleAssignSkill(pathname, res);
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+\/skills\/[^/]+$/) && method === 'DELETE') {
      this.handleRemoveSkill(pathname, res);
```

- [ ] **Step 3: 实现 handleListSkills**

```typescript
  private handleListSkills(res: http.ServerResponse): void {
    const skills = listGlobalSkills();
    res.writeHead(200);
    res.end(JSON.stringify({ skills, count: skills.length }));
  }
```

- [ ] **Step 4: 实现 handleGetSkill**

```typescript
  private handleGetSkill(pathname: string, res: http.ServerResponse): void {
    const skillId = pathname.replace('/api/skills/', '');
    const skill = getGlobalSkill(skillId);

    if (!skill) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Skill not found', skillId }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify(skill));
  }
```

- [ ] **Step 5: 实现 handleCreateSkill**

```typescript
  private async handleCreateSkill(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const skillId = pathname.replace('/api/skills/', '');
      
      // 检查是否已存在
      if (skillExists(skillId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Skill already exists', skillId }));
        return;
      }

      const body = await this.readBody(req);
      const data = JSON.parse(body);

      if (!data.content) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing required field: content' }));
        return;
      }

      createGlobalSkill(skillId, data.content);

      logger.info({ channel: this.name, skillId }, 'Skill created');

      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', id: skillId }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to create skill');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }
```

- [ ] **Step 6: 实现 handleUpdateSkill**

```typescript
  private async handleUpdateSkill(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const skillId = pathname.replace('/api/skills/', '');
      
      if (!skillExists(skillId)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Skill not found', skillId }));
        return;
      }

      const body = await this.readBody(req);
      const data = JSON.parse(body);

      if (!data.content) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing required field: content' }));
        return;
      }

      updateGlobalSkill(skillId, data.content);

      logger.info({ channel: this.name, skillId }, 'Skill updated');

      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', id: skillId }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to update skill');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }
```

- [ ] **Step 7: 实现 handleDeleteSkill**

```typescript
  private handleDeleteSkill(pathname: string, res: http.ServerResponse): void {
    const skillId = pathname.replace('/api/skills/', '');

    if (!skillExists(skillId)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Skill not found', skillId }));
      return;
    }

    try {
      deleteGlobalSkill(skillId);
      logger.info({ channel: this.name, skillId }, 'Skill deleted');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', id: skillId }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }
```

- [ ] **Step 8: 运行编译验证**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 9: Commit**

```bash
git add src/channels/http-api.ts
git commit -m "feat(http-api): add global skills CRUD endpoints"
```

---

### Task 4: HTTP API - Profile Skill 分配端点

**Files:**
- Modify: `src/channels/http-api.ts`

- [ ] **Step 1: 实现 handleListProfileSkills**

```typescript
  private handleListProfileSkills(pathname: string, res: http.ServerResponse): void {
    const parts = pathname.replace('/api/profiles/', '').split('/');
    const jid = parts[0];
    const profileId = parts[1];

    const groups = this.opts.registeredGroups();
    const group = groups[jid];

    if (!group) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Chat not registered', jid }));
      return;
    }

    const existingProfile = getProfile(jid, profileId);
    if (!existingProfile) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Profile not found', jid, profileId }));
      return;
    }

    const assignedSkillIds = getAssignedSkills(jid, profileId);
    const skills = assignedSkillIds.map((skillId) => {
      const skill = getGlobalSkill(skillId);
      return {
        id: skillId,
        name: skill?.name || skillId,
      };
    });

    res.writeHead(200);
    res.end(JSON.stringify({ jid, profileId, skills, count: skills.length }));
  }
```

- [ ] **Step 2: 实现 handleAssignSkill**

```typescript
  private handleAssignSkill(pathname: string, res: http.ServerResponse): void {
    const parts = pathname.replace('/api/profiles/', '').split('/');
    const jid = parts[0];
    const profileId = parts[1];
    const skillId = parts[3]; // parts[2] is 'skills'

    const groups = this.opts.registeredGroups();
    const group = groups[jid];

    if (!group) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Chat not registered', jid }));
      return;
    }

    const existingProfile = getProfile(jid, profileId);
    if (!existingProfile) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Profile not found', jid, profileId }));
      return;
    }

    if (!skillExists(skillId)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Skill not found', skillId }));
      return;
    }

    if (isSkillAssigned(jid, profileId, skillId)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Skill already assigned', skillId }));
      return;
    }

    assignSkill(jid, profileId, skillId);

    logger.info({ channel: this.name, jid, profileId, skillId }, 'Skill assigned to profile');

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', jid, profileId, skillId }));
  }
```

- [ ] **Step 3: 实现 handleRemoveSkill**

```typescript
  private handleRemoveSkill(pathname: string, res: http.ServerResponse): void {
    const parts = pathname.replace('/api/profiles/', '').split('/');
    const jid = parts[0];
    const profileId = parts[1];
    const skillId = parts[3]; // parts[2] is 'skills'

    const groups = this.opts.registeredGroups();
    const group = groups[jid];

    if (!group) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Chat not registered', jid }));
      return;
    }

    const existingProfile = getProfile(jid, profileId);
    if (!existingProfile) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Profile not found', jid, profileId }));
      return;
    }

    if (!isSkillAssigned(jid, profileId, skillId)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Skill not assigned to profile', skillId }));
      return;
    }

    removeSkillAssignment(jid, profileId, skillId);

    logger.info({ channel: this.name, jid, profileId, skillId }, 'Skill removed from profile');

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', jid, profileId, skillId }));
  }
```

- [ ] **Step 4: 运行编译验证**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 5: Commit**

```bash
git add src/channels/http-api.ts
git commit -m "feat(http-api): add profile skills assignment endpoints"
```

---

### Task 5: 容器运行时按 Profile 加载 Skill

**Files:**
- Modify: `src/container-runner.ts`

- [ ] **Step 1: 导入 db 函数**

在文件顶部导入区添加：

```typescript
import { getAssignedSkills } from './db.js';
```

- [ ] **Step 2: 导入 skill-manager 函数**

```typescript
import { getGlobalSkill } from './skill-manager.js';
```

- [ ] **Step 3: 修改 buildVolumeMounts 函数**

找到现有的 skill 同步代码（约第 208-218 行），替换为按 profile 加载：

```typescript
  // Sync skills from global container/skills/ to profile-specific directory
  // Only sync skills that are assigned to this profile
  const profileSkillsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'profiles',
    profileId || 'default',
    '.claude',
    'skills',
  );
  
  // Get assigned skills from database
  const assignedSkillIds = profileId ? getAssignedSkills(group.jid || '', profileId) : [];
  
  // Sync assigned skills to profile directory
  if (assignedSkillIds.length > 0) {
    fs.mkdirSync(profileSkillsDir, { recursive: true });
    for (const skillId of assignedSkillIds) {
      const skill = getGlobalSkill(skillId);
      if (skill) {
        const skillDir = path.join(profileSkillsDir, skillId);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
      }
    }
  }
  
  // Mount profile skills directory to container
  mounts.push({
    hostPath: profileSkillsDir,
    containerPath: '/home/node/.claude/skills',
    readonly: false,
  });
```

- [ ] **Step 4: 移除旧的 skill 同步代码**

删除原来的全局 skill 同步代码：

```typescript
  // 删除这段旧代码（约第 208-218 行）
  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }
```

- [ ] **Step 5: 更新 groupSessionsDir 的用途说明**

原来的 `groupSessionsDir` 仍然用于存储 sessions，但不再用于 skills。更新挂载代码（约第 219-223 行）：

```typescript
  // Sessions directory (without skills - skills are now in profile-specific dir)
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });
```

实际上，需要更仔细处理：skills 应该挂载到 `/home/node/.claude/skills/`，而 sessions 在 `/home/node/.claude/` 下。所以需要：

1. 先创建 profile skills 目录
2. 将 groupSessionsDir 挂载到容器
3. 但 skills 不应该在 groupSessionsDir 里

让我重新设计这部分：

```typescript
  // Per-group Claude sessions directory (isolated from other groups)
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  fs.chmodSync(groupSessionsDir, 0o777);
  
  // ... settings.json 创建代码保持不变 ...
  
  // Profile-specific skills directory
  const profileSkillsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'profiles',
    profileId || 'default',
    '.claude',
    'skills',
  );
  
  // Get assigned skills from database (empty if no profileId)
  const assignedSkillIds = profileId ? getAssignedSkills(group.jid || '', profileId) : [];
  
  // Sync only assigned skills to profile directory
  if (assignedSkillIds.length > 0) {
    fs.mkdirSync(profileSkillsDir, { recursive: true });
    fs.chmodSync(profileSkillsDir, 0o777);
    for (const skillId of assignedSkillIds) {
      const skill = getGlobalSkill(skillId);
      if (skill) {
        const skillDir = path.join(profileSkillsDir, skillId);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.content, 'utf-8');
      }
    }
  }
  
  // Mount sessions directory
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });
  
  // Mount profile skills (if any assigned)
  if (assignedSkillIds.length > 0) {
    mounts.push({
      hostPath: profileSkillsDir,
      containerPath: '/home/node/.claude/skills',
      readonly: false,
    });
  }
```

- [ ] **Step 6: 运行编译验证**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 7: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat(container): load skills by profile assignment"
```

---

### Task 6: 更新 API 文档

**Files:**
- Modify: `docs/HTTP_API_INTEGRATION.md`

- [ ] **Step 1: 在端点汇总表中添加 skill 端点**

在端点汇总表（约第 12-25 行）后添加：

```markdown
| `/api/skills` | GET | 查询所有全局 skill | 需要 |
| `/api/skills/{skillId}` | GET | 查询 skill 详情 | 需要 |
| `/api/skills/{skillId}` | POST | 新增全局 skill | 需要 |
| `/api/skills/{skillId}` | PUT | 编辑全局 skill | 需要 |
| `/api/skills/{skillId}` | DELETE | 删除全局 skill | 需要 |
| `/api/profiles/{jid}/{profileId}/skills` | GET | 查询 profile 的 skill 列表 | 需要 |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | POST | 分配 skill 给 profile | 需要 |
| `/api/profiles/{jid}/{profileId}/skills/{skillId}` | DELETE | 移除 profile 的 skill | 需要 |
```

- [ ] **Step 2: 在文档末尾添加详细说明章节**

添加新章节：

```markdown
---

### 1.10 Skill 管理接口

NanoClaw 的容器 skill 是可分配给角色的指令模块，存储在 `container/skills/` 目录。每个 skill 包含一个 `SKILL.md` 文件，定义了 skill 的名称、描述和使用指令。

#### 1.10.1 查询所有全局 skill

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

#### 1.10.2 查询 skill 详情

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

#### 1.10.3 新增 skill

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

#### 1.10.4 编辑 skill

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

#### 1.10.5 删除 skill

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

#### 1.10.6 查询 profile 的 skill 列表

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

#### 1.10.7 分配 skill 给 profile

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

**skill 已分配时**：

```json
{
  "error": "Skill already assigned",
  "skillId": "agent-browser"
}
```

---

#### 1.10.8 移除 profile 的 skill

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
```

- [ ] **Step 3: Commit**

```bash
git add docs/HTTP_API_INTEGRATION.md
git commit -m "docs: add skill management API documentation"
```

---

### Task 7: 验证整体功能

- [ ] **Step 1: 编译项目**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 2: 启动服务测试**

Run: `npm run dev`
Expected: 服务启动，HTTP API 监听 8080 端口

- [ ] **Step 3: 测试全局 skill 列表**

Run: `curl http://localhost:8080/api/skills -H "Authorization: Bearer test"`
Expected: 返回 skill 列表 JSON

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete skill management API implementation"
```
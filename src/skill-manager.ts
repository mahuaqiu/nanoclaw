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
 * 验证 skillId 是否安全（防止路径遍历）
 */
function isValidSkillId(skillId: string): boolean {
  // 禁止路径遍历
  if (
    skillId.includes('..') ||
    skillId.includes('/') ||
    skillId.includes('\\')
  ) {
    return false;
  }
  // 禁止空字符串
  if (!skillId || skillId.trim() === '') {
    return false;
  }
  // 只允许安全字符：字母、数字、连字符、下划线
  return /^[a-zA-Z0-9_-]+$/.test(skillId);
}

/**
 * 解析 SKILL.md 的 YAML frontmatter
 */
function parseFrontmatter(
  content: string,
): { name: string; description: string } | null {
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
  if (!isValidSkillId(skillId)) return null;

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
  if (!isValidSkillId(skillId)) return false;

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
  if (!isValidSkillId(skillId)) throw new Error('Invalid skillId');
  if (skillExists(skillId)) throw new Error('Skill already exists');

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
  if (!isValidSkillId(skillId)) throw new Error('Invalid skillId');

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
  if (!isValidSkillId(skillId)) throw new Error('Invalid skillId');

  const skillDir = path.join(SKILLS_DIR, skillId);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  logger.info({ skillId }, 'Skill deleted');
}

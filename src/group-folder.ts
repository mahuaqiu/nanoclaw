import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';

const GROUP_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_FOLDERS = new Set(['global']);

export function isValidGroupFolder(folder: string): boolean {
  if (!folder) return false;
  if (folder !== folder.trim()) return false;
  if (!GROUP_FOLDER_PATTERN.test(folder)) return false;
  if (folder.includes('/') || folder.includes('\\')) return false;
  if (folder.includes('..')) return false;
  if (RESERVED_FOLDERS.has(folder.toLowerCase())) return false;
  return true;
}

export function assertValidGroupFolder(folder: string): void {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
}

function ensureWithinBase(baseDir: string, resolvedPath: string): void {
  const rel = path.relative(baseDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${resolvedPath}`);
  }
}

export function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);
  const groupPath = path.resolve(GROUPS_DIR, folder);
  ensureWithinBase(GROUPS_DIR, groupPath);
  return groupPath;
}

export function resolveGroupIpcPath(folder: string): string {
  assertValidGroupFolder(folder);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const ipcPath = path.resolve(ipcBaseDir, folder);
  ensureWithinBase(ipcBaseDir, ipcPath);
  return ipcPath;
}

// --- Profile-specific paths (multi-profile support) ---

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

/**
 * 验证 profile ID 格式
 * Profile ID 可以是字母、数字、下划线、短横线组成，但不能以短横线开头
 */
export function isValidProfileId(profileId: string): boolean {
  if (!profileId) return false;
  if (profileId !== profileId.trim()) return false;
  if (!PROFILE_ID_PATTERN.test(profileId)) return false;
  if (profileId.includes('/') || profileId.includes('\\')) return false;
  if (profileId.includes('..')) return false;
  return true;
}

export function assertValidProfileId(profileId: string): void {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Invalid profile ID "${profileId}"`);
  }
}

/**
 * 解析 profile 专属的 IPC 目录路径
 * 格式: DATA_DIR/ipc/{folder}/profiles/{profileId}/
 */
export function resolveProfileIpcPath(folder: string, profileId: string): string {
  assertValidGroupFolder(folder);
  assertValidProfileId(profileId);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const ipcPath = path.resolve(ipcBaseDir, folder, 'profiles', profileId);
  ensureWithinBase(ipcBaseDir, ipcPath);
  return ipcPath;
}

/**
 * 解析 profile 专属的 Session 目录路径
 * 格式: DATA_DIR/sessions/{folder}/profiles/{profileId}/.claude/
 */
export function resolveProfileSessionPath(folder: string, profileId: string): string {
  assertValidGroupFolder(folder);
  assertValidProfileId(profileId);
  const sessionBaseDir = path.resolve(DATA_DIR, 'sessions');
  const sessionPath = path.resolve(sessionBaseDir, folder, 'profiles', profileId, '.claude');
  ensureWithinBase(sessionBaseDir, sessionPath);
  return sessionPath;
}

/**
 * 解析 profile 专属的工作目录路径（用于 CLAUDE.md 等）
 * 格式: GROUPS_DIR/{folder}/profiles/{profileId}/
 */
export function resolveProfileFolderPath(folder: string, profileId: string): string {
  assertValidGroupFolder(folder);
  assertValidProfileId(profileId);
  const profilePath = path.resolve(GROUPS_DIR, folder, 'profiles', profileId);
  ensureWithinBase(GROUPS_DIR, profilePath);
  return profilePath;
}

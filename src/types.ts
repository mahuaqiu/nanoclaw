export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
}

/**
 * Agent Profile - 一个群可以有多个角色配置
 * 每个 Profile 有独立的 trigger，可选的专属 CLAUDE.md
 */
export interface AgentProfile {
  id: string; // Profile ID (e.g., "andy", "tech", "daily")
  name: string; // 显示名称
  trigger: string; // 触发词 (e.g., "@Andy", "@Tech")
  description?: string; // 角色描述
  systemPrompt?: string; // 角色专属系统提示词 (Markdown 格式)
  containerConfig?: ContainerConfig; // 可选的独立容器配置
  isActive?: boolean; // 是否激活 (默认 true)
  addedAt: string; // 添加时间
}

/**
 * Registered Group - 注册的群组配置
 * 现在支持多个 profiles (角色)，共享同一 folder (记忆)
 */
export interface RegisteredGroup {
  jid?: string; // 群 JID (主键) - 可选用于向后兼容
  folder: string; // 共享的群文件夹 (所有角色共享记忆)
  profiles?: AgentProfile[]; // 角色列表 - 可选用于向后兼容
  defaultProfile?: string; // 默认角色 ID (无触发词时使用)
  requiresTrigger?: boolean; // 群级触发要求 (默认 true)
  isMain?: boolean; // 是否是主群
  addedAt?: string; // 注册时间 - 新格式
  // 向后兼容：旧格式字段 (迁移后保留用于兼容层)
  name?: string; // @deprecated 使用 profiles[0].name
  trigger?: string; // @deprecated 使用 profiles[0].trigger
  added_at?: string; // @deprecated 使用 addedAt
  containerConfig?: ContainerConfig; // @deprecated 使用 profiles[0].containerConfig
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_id?: string;
  reply_to_message_id?: string;
  reply_to_message_content?: string;
  reply_to_sender_name?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script?: string | null;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Channel abstraction ---

export interface SendMessageOptions {
  profileId?: string; // Profile ID (如 "xiaoma", "小威")
  profileName?: string; // Profile 显示名称
  triggerWord?: string; // 匹配的触发词
}

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(
    jid: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Optional: sync group/chat names from the platform.
  syncGroups?(force: boolean): Promise<void>;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (via syncGroups) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

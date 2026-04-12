import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAX_CONCURRENT_CONTAINERS } from './config.js';
import { resolveProfileIpcPath } from './group-folder.js';
import { logger } from './logger.js';

interface QueuedTask {
  id: string;
  groupJid: string;
  profileId?: string; // Profile ID for task targeting
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  idleWaiting: boolean;
  isTaskContainer: boolean;
  runningTaskId: string | null;
  pendingMessages: boolean;
  pendingMessagesProfile?: string; // Which profile to process pending messages
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  profileId: string | null; // Which profile this container belongs to
  retryCount: number;
}

export class GroupQueue {
  // 使用复合键 groupJid:profileId 标识每个 profile 的容器状态
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  // 生成复合键
  private getKey(groupJid: string, profileId?: string): string {
    return `${groupJid}:${profileId || 'default'}`;
  }

  private getGroup(groupJid: string, profileId?: string): GroupState {
    const key = this.getKey(groupJid, profileId);
    let state = this.groups.get(key);
    if (!state) {
      state = {
        active: false,
        idleWaiting: false,
        isTaskContainer: false,
        runningTaskId: null,
        pendingMessages: false,
        pendingMessagesProfile: profileId,
        pendingTasks: [],
        process: null,
        containerName: null,
        groupFolder: null,
        profileId: profileId || null,
        retryCount: 0,
      };
      this.groups.set(key, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  /**
   * 检查是否有消息需要处理，如果容器活跃则排队，否则启动容器
   * @param groupJid 群组 JID
   * @param profileId 目标 profile ID（可选，默认为 'default'）
   */
  enqueueMessageCheck(groupJid: string, profileId?: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid, profileId);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ groupJid, profileId }, 'Container active, message queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      const key = this.getKey(groupJid, profileId);
      if (!this.waitingGroups.includes(key)) {
        this.waitingGroups.push(key);
      }
      logger.debug(
        { groupJid, profileId, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages', profileId).catch((err) =>
      logger.error({ groupJid, profileId, err }, 'Unhandled error in runForGroup'),
    );
  }

  enqueueTask(
    groupJid: string,
    taskId: string,
    fn: () => Promise<void>,
    profileId?: string,
  ): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid, profileId);

    // Prevent double-queuing: check both pending and currently-running task
    if (state.runningTaskId === taskId) {
      logger.debug({ groupJid, taskId, profileId }, 'Task already running, skipping');
      return;
    }
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupJid, taskId, profileId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, profileId, fn });
      if (state.idleWaiting) {
        this.closeStdin(groupJid, profileId);
      }
      logger.debug({ groupJid, taskId, profileId }, 'Container active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingTasks.push({ id: taskId, groupJid, profileId, fn });
      const key = this.getKey(groupJid, profileId);
      if (!this.waitingGroups.includes(key)) {
        this.waitingGroups.push(key);
      }
      logger.debug(
        { groupJid, taskId, profileId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(
      groupJid,
      {
        id: taskId,
        groupJid,
        profileId,
        fn,
      },
      profileId,
    ).catch((err) =>
      logger.error({ groupJid, taskId, profileId, err }, 'Unhandled error in runTask'),
    );
  }

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder?: string,
    profileId?: string,
  ): void {
    const state = this.getGroup(groupJid, profileId);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
    state.profileId = profileId || null;
  }

  /**
   * Mark the container as idle-waiting (finished work, waiting for IPC input).
   * If tasks are pending, preempt the idle container immediately.
   */
  notifyIdle(groupJid: string, profileId?: string): void {
    const state = this.getGroup(groupJid, profileId);
    state.idleWaiting = true;
    if (state.pendingTasks.length > 0) {
      this.closeStdin(groupJid, profileId);
    }
  }

  /**
   * Send a follow-up message to the active container via IPC file.
   * Returns true if the message was written, false if no active container.
   */
  sendMessage(groupJid: string, text: string, profileId?: string): boolean {
    const state = this.getGroup(groupJid, profileId);
    if (!state.active || !state.groupFolder || state.isTaskContainer)
      return false;
    state.idleWaiting = false; // Agent is about to receive work, no longer idle

    // 使用 profile 专属的 IPC 目录
    const ipcDir = resolveProfileIpcPath(state.groupFolder, state.profileId || 'default');
    const inputDir = path.join(ipcDir, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal the active container to wind down by writing a close sentinel.
   */
  closeStdin(groupJid: string, profileId?: string): void {
    const state = this.getGroup(groupJid, profileId);
    if (!state.active || !state.groupFolder) return;

    // 使用 profile 专属的 IPC 目录
    const ipcDir = resolveProfileIpcPath(state.groupFolder, state.profileId || 'default');
    const inputDir = path.join(ipcDir, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
    profileId?: string,
  ): Promise<void> {
    const state = this.getGroup(groupJid, profileId);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = false;
    state.pendingMessages = false;
    state.profileId = profileId || null;
    this.activeCount++;

    logger.debug(
      { groupJid, profileId, reason, activeCount: this.activeCount },
      'Starting container for group profile',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupJid, state, profileId);
        }
      }
    } catch (err) {
      logger.error({ groupJid, profileId, err }, 'Error processing messages for group');
      this.scheduleRetry(groupJid, state, profileId);
    } finally {
      state.active = false;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      state.profileId = null;
      this.activeCount--;
      this.drainGroup(groupJid, profileId);
    }
  }

  private async runTask(
    groupJid: string,
    task: QueuedTask,
    profileId?: string,
  ): Promise<void> {
    const state = this.getGroup(groupJid, profileId);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = true;
    state.runningTaskId = task.id;
    state.profileId = profileId || null;
    this.activeCount++;

    logger.debug(
      { groupJid, taskId: task.id, profileId, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, profileId, err }, 'Error running task');
    } finally {
      state.active = false;
      state.isTaskContainer = false;
      state.runningTaskId = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      state.profileId = null;
      this.activeCount--;
      this.drainGroup(groupJid, profileId);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState, profileId?: string): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, profileId, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, profileId, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid, profileId);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string, profileId?: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid, profileId);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task, task.profileId).catch((err) =>
        logger.error(
          { groupJid, taskId: task.id, profileId: task.profileId, err },
          'Unhandled error in runTask (drain)',
        ),
      );
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(groupJid, 'drain', state.pendingMessagesProfile).catch((err) =>
        logger.error(
          { groupJid, profileId: state.pendingMessagesProfile, err },
          'Unhandled error in runForGroup (drain)',
        ),
      );
      return;
    }

    // Nothing pending for this group profile; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_CONTAINERS
    ) {
      const key = this.waitingGroups.shift()!;
      // 解析复合键
      const [groupJid, profileId] = key.split(':');
      const state = this.getGroup(groupJid, profileId === 'undefined' ? undefined : profileId);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(groupJid, task, task.profileId).catch((err) =>
          logger.error(
            { groupJid, taskId: task.id, profileId: task.profileId, err },
            'Unhandled error in runTask (waiting)',
          ),
        );
      } else if (state.pendingMessages) {
        this.runForGroup(groupJid, 'drain', state.pendingMessagesProfile).catch((err) =>
          logger.error(
            { groupJid, profileId: state.pendingMessagesProfile, err },
            'Unhandled error in runForGroup (waiting)',
          ),
        );
      }
      // If neither pending, skip this group profile
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    // Count active containers but don't kill them — they'll finish on their own
    // via idle timeout or container timeout. The --rm flag cleans them up on exit.
    // This prevents WhatsApp reconnection restarts from killing working agents.
    const activeContainers: string[] = [];
    for (const [_jid, state] of this.groups) {
      if (state.process && !state.process.killed && state.containerName) {
        activeContainers.push(state.containerName);
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedContainers: activeContainers },
      'GroupQueue shutting down (containers detached, not killed)',
    );
  }
}

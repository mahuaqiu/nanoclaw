/**
 * HTTP API Channel for NanoClaw
 * Provides REST API endpoints for external systems to send/receive messages
 *
 * Endpoints:
 *   POST /api/message     - Receive message from external system (supports callback_url)
 *   GET  /api/outbox/:jid - Get pending outbound messages for a chat (polling mode)
 *   POST /api/register    - Register a new chat group
 *   GET  /api/groups      - List registered groups
 *   GET  /api/health      - Health check
 *   POST /api/clear       - Clear session (reset context)
 *   GET  /api/session/:id - Get session info
 *
 * Two modes:
 *   - Polling: caller fetches replies via GET /api/outbox/:jid
 *   - Callback: caller provides callback_url in POST /api/message, NanoClaw pushes replies
 */

import http from 'http';
import https from 'https';
import url from 'url';
import { registerChannel, ChannelOpts } from './registry.js';
import { Channel, NewMessage, RegisteredGroup, AgentProfile } from '../types.js';
import {
  addProfile,
  getProfiles,
  getProfile,
  updateProfile,
  removeProfile,
  triggerExists,
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
import { logger } from '../logger.js';

// Outbound message queue (in-memory, for polling mode)
const outbox: Map<string, string[]> = new Map();

// Callback URLs per chat (for callback mode)
const callbackUrls: Map<string, string> = new Map();

// API token for authentication
let apiToken: string | undefined;

class HttpApiChannel implements Channel {
  name = 'http-api';
  private opts: ChannelOpts;
  private connected = false;
  private server: http.Server | null = null;
  private port: number;

  constructor(opts: ChannelOpts, port: number) {
    this.opts = opts;
    this.port = port;
  }

  async connect(): Promise<void> {
    apiToken = process.env.HTTP_API_TOKEN;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, () => {
        logger.info({ channel: this.name, port: this.port }, 'HTTP API server started');
        resolve();
      });
      this.server!.on('error', reject);
    });

    this.connected = true;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = jid.replace('http:', '');
    const callbackUrl = callbackUrls.get(jid);

    // If callback URL is registered, push the message directly
    if (callbackUrl) {
      await this.pushToCallback(callbackUrl, chatId, text);
    } else {
      // Otherwise, add to outbox for polling mode
      if (!outbox.has(jid)) {
        outbox.set(jid, []);
      }
      outbox.get(jid)!.push(text);
      logger.debug({ channel: this.name, jid, length: text.length }, 'Message added to outbox');
    }
  }

  /**
   * Push message to caller's callback URL
   */
  private async pushToCallback(callbackUrl: string, chatId: string, message: string): Promise<void> {
    const parsedUrl = new URL(callbackUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = JSON.stringify({
      chat_id: chatId,
      message: message,
      timestamp: new Date().toISOString(),
    });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000, // 10 second timeout
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const req = client.request(options, (res) => {
          let body = '';
          const statusCode = res.statusCode || 0;
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (statusCode >= 200 && statusCode < 300) {
              logger.info(
                { channel: this.name, chatId, callbackUrl, status: statusCode },
                'Callback push succeeded'
              );
              resolve();
            } else {
              logger.warn(
                { channel: this.name, chatId, callbackUrl, status: statusCode, body },
                'Callback push failed with non-2xx status'
              );
              reject(new Error(`Callback returned ${statusCode}`));
            }
          });
        });

        req.on('error', (err) => {
          logger.error(
            { channel: this.name, chatId, callbackUrl, error: err.message },
            'Callback push failed'
          );
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          logger.error(
            { channel: this.name, chatId, callbackUrl },
            'Callback push timeout'
          );
          reject(new Error('Callback timeout'));
        });

        req.write(payload);
        req.end();
      });
    } catch (err) {
      // Log error but don't throw - message delivery should not block the system
      logger.error(
        { channel: this.name, chatId, callbackUrl, error: err instanceof Error ? err.message : String(err) },
        'Callback push error (message still available in outbox)'
      );
      // Fallback: add to outbox so caller can still poll if callback fails
      if (!outbox.has(`http:${chatId}`)) {
        outbox.set(`http:${chatId}`, []);
      }
      outbox.get(`http:${chatId}`)!.push(message);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('http:');
  }

  async disconnect(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          logger.info({ channel: this.name }, 'HTTP API server stopped');
          resolve();
        });
      });
    }
    this.connected = false;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = url.parse(req.url!, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // Set JSON content type
    res.setHeader('Content-Type', 'application/json');

    // Health check (no auth required)
    if (pathname === '/api/health' && method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', channel: this.name }));
      return;
    }

    // Check authentication for other endpoints
    if (!this.checkAuth(req)) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized', hint: 'Set Authorization: Bearer <token> header' }));
      return;
    }

    // Route handlers
    if (pathname === '/api/message' && method === 'POST') {
      this.handleReceiveMessage(req, res);
    } else if (pathname?.startsWith('/api/outbox/') && method === 'GET') {
      this.handleGetOutbox(pathname, res);
    } else if (pathname === '/api/register' && method === 'POST') {
      this.handleRegister(req, res);
    } else if (pathname === '/api/groups' && method === 'GET') {
      this.handleListGroups(res);
    } else if (pathname === '/api/clear' && method === 'POST') {
      this.handleClearSession(req, res);
    } else if (pathname?.startsWith('/api/session/') && method === 'GET') {
      this.handleGetSession(pathname, res);
    } else if (pathname?.startsWith('/api/profiles/') && method === 'GET') {
      this.handleProfiles(pathname, req, res);
    } else if (pathname?.startsWith('/api/profiles/') && method === 'POST') {
      this.handleAddProfile(pathname, req, res);
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+$/) && method === 'GET') {
      this.handleGetProfile(pathname, res);
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+$/) && method === 'PUT') {
      this.handleUpdateProfile(pathname, req, res);
    } else if (pathname?.match(/^\/api\/profiles\/[^/]+\/[^/]+$/) && method === 'DELETE') {
      this.handleRemoveProfile(pathname, res);
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
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    // If no token configured, allow all requests
    if (!apiToken) return true;

    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return false;

    return parts[1] === apiToken;
  }

  private async handleReceiveMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const data = JSON.parse(body);

      // Validate required fields
      if (!data.chat_id || !data.sender || !data.content) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing required fields: chat_id, sender, content' }));
        return;
      }

      // Build JID
      const chatJid = `http:${data.chat_id}`;

      // Register callback URL if provided (for callback mode)
      if (data.callback_url) {
        callbackUrls.set(chatJid, data.callback_url);
        logger.info(
          { channel: this.name, chat_id: data.chat_id, callback_url: data.callback_url },
          'Callback URL registered for chat'
        );
      }

      // Build NewMessage
      const message: NewMessage = {
        id: data.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        chat_jid: chatJid,
        sender: data.sender,
        sender_name: data.sender_name || data.sender,
        content: data.content,
        timestamp: data.timestamp || new Date().toISOString(),
        is_from_me: data.is_from_me || false,
        is_bot_message: data.is_bot_message || false,
        reply_to_message_id: data.reply_to_message_id,
        reply_to_message_content: data.reply_to_message_content,
        reply_to_sender_name: data.reply_to_sender_name,
      };

      // Call onMessage callback
      this.opts.onMessage(chatJid, message);

      // Report chat metadata if provided
      if (data.chat_name) {
        this.opts.onChatMetadata(
          chatJid,
          message.timestamp,
          data.chat_name,
          this.name,
          data.is_group || false,
        );
      }

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        message_id: message.id,
        callback_mode: !!data.callback_url,
        callback_url: data.callback_url || null,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to process message');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  private handleGetOutbox(pathname: string, res: http.ServerResponse): void {
    const jid = pathname.replace('/api/outbox/', '');

    // Add prefix if not present
    const fullJid = jid.startsWith('http:') ? jid : `http:${jid}`;

    const messages = outbox.get(fullJid) || [];

    // Clear outbox after fetching
    outbox.set(fullJid, []);

    res.writeHead(200);
    res.end(JSON.stringify({ jid: fullJid, messages, count: messages.length }));
  }

  private async handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const data = JSON.parse(body);

      // Required fields
      if (!data.chat_id || !data.name || !data.folder || !data.trigger) {
        res.writeHead(400);
        res.end(JSON.stringify({
          error: 'Missing required fields: chat_id, name, folder, trigger'
        }));
        return;
      }

      const chatJid = `http:${data.chat_id}`;

      // Build RegisteredGroup
      const group: RegisteredGroup = {
        name: data.name,
        folder: data.folder,
        trigger: data.trigger,
        added_at: new Date().toISOString(),
        requiresTrigger: data.requires_trigger !== false, // default true
        isMain: data.is_main === true, // default false
        containerConfig: data.container_config,
      };

      // Register group
      this.opts.registerGroup(chatJid, group);

      // Also store chat metadata
      this.opts.onChatMetadata(
        chatJid,
        new Date().toISOString(),
        data.name,
        this.name,
        data.is_group || false,
      );

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        jid: chatJid,
        folder: group.folder,
        is_main: group.isMain,
        requires_trigger: group.requiresTrigger,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  private handleListGroups(res: http.ServerResponse): void {
    const groups = this.opts.registeredGroups();
    const httpGroups = Object.entries(groups)
      .filter(([jid]) => jid.startsWith('http:'))
      .map(([jid, group]) => ({ jid, ...group }));

    res.writeHead(200);
    res.end(JSON.stringify({ groups: httpGroups, count: httpGroups.length }));
  }

  private async handleClearSession(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req);
      const data = JSON.parse(body);

      if (!data.chat_id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing required field: chat_id' }));
        return;
      }

      const chatJid = `http:${data.chat_id}`;
      const groups = this.opts.registeredGroups();
      const group = groups[chatJid];

      if (!group) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Chat not registered', chat_id: data.chat_id }));
        return;
      }

      // Check if deleteSession callback is available
      if (!this.opts.deleteSession) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Session management not available' }));
        return;
      }

      // Clear the session
      this.opts.deleteSession(group.folder);

      // Also clear callback URL
      callbackUrls.delete(chatJid);

      logger.info({ channel: this.name, chat_id: data.chat_id, folder: group.folder }, 'Session cleared');

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        message: 'Session cleared, next conversation will start fresh',
        chat_id: data.chat_id,
        folder: group.folder
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to clear session');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  private handleGetSession(pathname: string, res: http.ServerResponse): void {
    const chatId = pathname.replace('/api/session/', '');
    const chatJid = chatId.startsWith('http:') ? chatId : `http:${chatId}`;

    const groups = this.opts.registeredGroups();
    const group = groups[chatJid];

    if (!group) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Chat not registered', chat_id: chatId }));
      return;
    }

    // Check if getSession callback is available
    if (!this.opts.getSession) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Session management not available' }));
      return;
    }

    const sessionId = this.opts.getSession(group.folder);
    const callbackUrl = callbackUrls.get(chatJid);

    res.writeHead(200);
    res.end(JSON.stringify({
      chat_id: chatId,
      jid: chatJid,
      folder: group.folder,
      session_id: sessionId || null,
      has_session: sessionId !== undefined,
      callback_url: callbackUrl || null,
    }));
  }

  // --- Profile management handlers ---

  private handleProfiles(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    // Extract jid from pathname - could be /api/profiles/{jid} or /api/profiles/{jid}/{profileId}
    const parts = pathname.replace('/api/profiles/', '').split('/');
    const jid = parts[0];

    // If there's a second part, it's a profileId - redirect to handleGetProfile
    if (parts.length > 1) {
      this.handleGetProfile(pathname, res);
      return;
    }

    const groups = this.opts.registeredGroups();
    const group = groups[jid];

    if (!group) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Chat not registered', jid }));
      return;
    }

    const profiles = getProfiles(jid);

    res.writeHead(200);
    res.end(JSON.stringify({
      jid,
      profiles,
      count: profiles.length,
    }));
  }

  private handleGetProfile(pathname: string, res: http.ServerResponse): void {
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

    const profile = getProfile(jid, profileId);

    if (!profile) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Profile not found', jid, profileId }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      jid,
      profile,
    }));
  }

  private async handleAddProfile(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const jid = pathname.replace('/api/profiles/', '').split('/')[0];

      const groups = this.opts.registeredGroups();
      const group = groups[jid];

      if (!group) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Chat not registered', jid }));
        return;
      }

      const body = await this.readBody(req);
      const data = JSON.parse(body);

      if (!data.name || !data.trigger) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing required fields: name, trigger' }));
        return;
      }

      // Check if trigger already exists
      const profileId = data.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (triggerExists(jid, data.trigger, profileId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Trigger already exists for another profile', trigger: data.trigger }));
        return;
      }

      const profile: AgentProfile = {
        id: profileId,
        name: data.name,
        trigger: data.trigger,
        description: data.description,
        containerConfig: data.containerConfig,
        isActive: data.isActive !== false,
        addedAt: new Date().toISOString(),
      };

      addProfile(jid, profile);

      logger.info({ channel: this.name, jid, profileId: profile.id, trigger: profile.trigger }, 'Profile added');

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        jid,
        profile,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to add profile');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  private async handleUpdateProfile(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
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

      const body = await this.readBody(req);
      const data = JSON.parse(body);

      // Check trigger conflict if updating trigger
      if (data.trigger && triggerExists(jid, data.trigger, profileId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Trigger already exists for another profile', trigger: data.trigger }));
        return;
      }

      const updates: Partial<AgentProfile> = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.trigger !== undefined) updates.trigger = data.trigger;
      if (data.description !== undefined) updates.description = data.description;
      if (data.isActive !== undefined) updates.isActive = data.isActive;

      updateProfile(jid, profileId, updates);

      logger.info({ channel: this.name, jid, profileId, updates }, 'Profile updated');

      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        jid,
        profileId,
        updates,
      }));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ channel: this.name, error: errorMessage }, 'Failed to update profile');
      res.writeHead(500);
      res.end(JSON.stringify({ error: errorMessage }));
    }
  }

  private handleRemoveProfile(pathname: string, res: http.ServerResponse): void {
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

    // Check if this is the last profile
    const profiles = getProfiles(jid);
    if (profiles.length <= 1) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Cannot remove last profile', jid }));
      return;
    }

    const existingProfile = getProfile(jid, profileId);
    if (!existingProfile) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Profile not found', jid, profileId }));
      return;
    }

    removeProfile(jid, profileId);

    logger.info({ channel: this.name, jid, profileId }, 'Profile removed');

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      jid,
      profileId,
    }));
  }

  // --- Global skills management handlers ---

  private handleListSkills(res: http.ServerResponse): void {
    const skills = listGlobalSkills();
    res.writeHead(200);
    res.end(JSON.stringify({ skills, count: skills.length }));
  }

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

  private async handleCreateSkill(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const skillId = pathname.replace('/api/skills/', '');

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

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}

// Self-registration
registerChannel('http-api', (opts: ChannelOpts) => {
  // Check if HTTP API is enabled
  const enabled = process.env.HTTP_API_ENABLED === 'true';
  if (!enabled) {
    logger.debug('HTTP_API_ENABLED not set to true, skipping HTTP API channel');
    return null;
  }

  // Get port from config
  const port = parseInt(process.env.HTTP_API_PORT || '8080', 10);

  return new HttpApiChannel(opts, port);
});

// Export for testing
export { HttpApiChannel, outbox, callbackUrls };
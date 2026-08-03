import type { AppConfig } from "./config.js";
import type { InstagramInboundMessage, DirectLineActivity } from "./types.js";
import { ConversationStore } from "./store.js";
import { log } from "./logger.js";
import * as ig from "./instagram.js";
import * as dl from "./directline.js";

/**
 * Core relay orchestration. Bridges:
 *   Instagram inbound  -> Direct Line (so it reaches a D365 agent)
 *   Direct Line replies -> Instagram (so the customer sees the agent's answer)
 */
export class Relay {
  private store = new ConversationStore();
  private pollTimer?: NodeJS.Timeout;

  constructor(private config: AppConfig) {}

  /** Handle one inbound Instagram message: route it into Direct Line. */
  async handleInbound(message: InstagramInboundMessage): Promise<void> {
    if (message.isEcho) return; // ignore our own outbound echoes
    if (!message.senderId) return;

    const hasContent =
      (message.text && message.text.trim() !== "") ||
      message.attachmentUrls.length > 0;
    if (!hasContent) return;

    let link = this.store.get(message.senderId);
    if (!link) {
      const conversationId = await dl.startConversation(this.config);
      link = {
        igsid: message.senderId,
        conversationId,
        lastActivityAt: Date.now(),
      };
      this.store.set(link);
      log.info("Started Direct Line conversation", {
        igsid: message.senderId,
        conversationId,
      });
    }

    // Build the text we forward to the agent. Attachment URLs are appended so the
    // agent can still see what the customer shared even though Direct Line text is plain.
    const parts: string[] = [];
    if (message.text && message.text.trim() !== "") parts.push(message.text.trim());
    for (const url of message.attachmentUrls) parts.push(`[attachment] ${url}`);
    const text = parts.join("\n");

    await dl.sendUserMessage(
      this.config,
      link.conversationId,
      message.senderId,
      text,
      profile.name ?? profile.username
    );
    link.lastActivityAt = Date.now();
    this.store.set(link);
  }

  /** Start the background loop that pushes agent replies back to Instagram. */
  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollAll();
    }, this.config.pollIntervalMs);
    log.info("Relay polling started", { intervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  activeConversations(): number {
    return this.store.size();
  }

  private async pollAll(): Promise<void> {
    const now = Date.now();
    for (const link of this.store.all()) {
      // Drop conversations idle beyond the window to free memory.
      if (now - link.lastActivityAt > this.config.conversationIdleMs) {
        this.store.delete(link.igsid);
        continue;
      }
      try {
        await this.pollOne(link.conversationId);
      } catch (err) {
        log.warn("poll failed for conversation", {
          conversationId: link.conversationId,
          error: (err as Error).message,
        });
      }
    }
  }

  private async pollOne(conversationId: string): Promise<void> {
    const link = this.store.getByConversationId(conversationId);
    if (!link) return;

    const set = await dl.getActivities(this.config, conversationId, link.watermark);
    if (set.watermark) link.watermark = set.watermark;

    for (const activity of set.activities) {
      if (activity.type !== "message") continue;
      // Skip the customer's own activities echoed back by Direct Line.
      if (activity.from?.id === link.igsid) continue;

      await this.forwardToInstagram(link.igsid, activity);
      link.lastActivityAt = Date.now();
    }
    this.store.set(link);
  }

  private async forwardToInstagram(
    igsid: string,
    activity: DirectLineActivity
  ): Promise<void> {
    if (activity.text && activity.text.trim() !== "") {
      await ig.sendText(this.config, igsid, activity.text);
    }

    for (const att of activity.attachments ?? []) {
      if (!att.contentUrl) continue;
      const ct = att.contentType ?? "";
      let type: "image" | "audio" | "video" | "file" = "file";
      if (ct.startsWith("image/")) type = "image";
      else if (ct.startsWith("audio/")) type = "audio";
      else if (ct.startsWith("video/")) type = "video";
      await ig.sendAttachment(this.config, igsid, att.contentUrl, type);
    }
  }
}

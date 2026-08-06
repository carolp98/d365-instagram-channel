/**
 * Shared type definitions for the Instagram <-> Direct Line relay.
 */

/** A single Instagram messaging event extracted from a webhook payload. */
export interface InstagramInboundMessage {
  /** Instagram-scoped ID (IGSID) of the user who sent the message. */
  senderId: string;
  /** The Instagram professional account ID (IG_ID) that received the message. */
  recipientId: string;
  /** Message text, if any. */
  text?: string;
  /** Attachment URLs (image/video/audio/file/share), if any. */
  attachmentUrls: string[];
  /** Meta message id (mid). */
  messageId?: string;
  /** True when the event is an echo of a message the page itself sent. */
  isEcho: boolean;
}

/** State we keep for each active Instagram <-> Direct Line conversation. */
export interface ConversationLink {
  /** Instagram-scoped ID of the customer. */
  igsid: string;
  /** Direct Line conversation id. */
  conversationId: string;
  /** Direct Line watermark for incremental activity polling. */
  watermark?: string;
  /** Timestamp (ms) of the last inbound or outbound activity. */
  lastActivityAt: number;
   /** The customer's Instagram display name, fetched once when the conversation starts. */
  displayName?: string;
  username?: string;
}

/** A Direct Line activity (subset of fields we use). */
export interface DirectLineActivity {
  type: string;
  id?: string;
  from?: { id?: string; name?: string };
  text?: string;
  attachments?: Array<{
    contentType?: string;
    contentUrl?: string;
    content?: unknown;
    name?: string;
  }>;
}

export interface DirectLineActivitySet {
  activities: DirectLineActivity[];
  watermark?: string;
}

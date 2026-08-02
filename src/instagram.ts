import crypto from "node:crypto";
import type { AppConfig } from "./config.js";
import type { InstagramInboundMessage } from "./types.js";
import { log } from "./logger.js";

/**
 * Verify the X-Hub-Signature-256 header Meta sends with every webhook POST.
 * Returns true only when the signature matches the raw request body.
 */
export function verifySignature(
  config: AppConfig,
  rawBody: Buffer,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.instagramAppSecret)
      .update(rawBody)
      .digest("hex");

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Parse a raw Instagram webhook payload into a flat list of inbound messages.
 * Echo events (messages the page itself sent) are flagged so the relay can skip them.
 */
export function parseWebhook(payload: unknown): InstagramInboundMessage[] {
  const out: InstagramInboundMessage[] = [];
  const body = payload as {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        recipient?: { id?: string };
        message?: {
          mid?: string;
          text?: string;
          is_echo?: boolean;
          attachments?: Array<{ type?: string; payload?: { url?: string } }>;
        };
      }>;
    }>;
  };

  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) {
    return out;
  }

  for (const entry of body.entry) {
    for (const event of entry.messaging ?? []) {
      const msg = event.message;
      if (!msg) continue; // ignore reactions/seen/postbacks for v1

      const attachmentUrls: string[] = [];
      for (const att of msg.attachments ?? []) {
        if (att.payload?.url) attachmentUrls.push(att.payload.url);
      }

      out.push({
        senderId: event.sender?.id ?? "",
        recipientId: event.recipient?.id ?? entry.id ?? "",
        text: msg.text,
        attachmentUrls,
        messageId: msg.mid,
        isEcho: Boolean(msg.is_echo),
      });
    }
  }

  return out;
}

/** Send a plain text message to an Instagram user via the Graph Send API. */
export async function sendText(
  config: AppConfig,
  recipientIgsid: string,
  text: string
): Promise<void> {
  const url = `${config.graphBaseUrl}/${config.graphApiVersion}/${config.instagramAccountId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.instagramAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { text },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("Instagram sendText failed", {
      status: res.status,
      recipient: recipientIgsid,
      detail,
    });
    throw new Error(`Instagram sendText failed: ${res.status}`);
  }
}

/** Send a media attachment (image/audio/video/file) by URL to an Instagram user. */
export async function sendAttachment(
  config: AppConfig,
  recipientIgsid: string,
  attachmentUrl: string,
  type: "image" | "audio" | "video" | "file" = "image"
): Promise<void> {
  const url = `${config.graphBaseUrl}/${config.graphApiVersion}/${config.instagramAccountId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.instagramAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientIgsid },
      message: { attachment: { type, payload: { url: attachmentUrl } } },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("Instagram sendAttachment failed", {
      status: res.status,
      recipient: recipientIgsid,
      detail,
    });
    throw new Error(`Instagram sendAttachment failed: ${res.status}`);
  }
}

/** The Instagram profile behind an access token. */
export interface InstagramProfile {
  userId: string;
  username?: string;
}

/**
 * Confirm the access token works by reading the account profile.
 * Used by the Setup Assistant to give the user an instant green check.
 * Throws a friendly Error when the token is wrong/expired.
 */
export async function fetchProfile(config: AppConfig): Promise<InstagramProfile> {
  const url = `${config.graphBaseUrl}/${config.graphApiVersion}/me?fields=user_id,username`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.instagramAccessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn("Instagram fetchProfile failed", { status: res.status, detail });
    throw new Error(
      res.status === 401 || res.status === 400
        ? "The access token was rejected by Instagram. It may be wrong or expired."
        : `Instagram returned an error (HTTP ${res.status}).`
    );
  }

  const data = (await res.json()) as { user_id?: string; username?: string };
  return { userId: String(data.user_id ?? ""), username: data.username };
}

/** The Instagram profile of a user who sent a DM. */
export interface InstagramUserProfile {
  id: string;
  name?: string;
  username?: string;
}

/**
 * Fetch the Instagram profile of the user who sent a message.
 * Unlike fetchProfile(), this looks up the specific sender IGSID.
 */
export async function fetchUserProfile(
  config: AppConfig,
  igsid: string
): Promise<InstagramUserProfile> {
  const url =
    `${config.graphBaseUrl}/${config.graphApiVersion}/${igsid}` +
    `?fields=id,name,username`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.instagramAccessToken}`,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn("Instagram fetchUserProfile failed", {
      status: res.status,
      igsid,
      detail,
    });

    throw new Error(`Instagram user profile lookup failed (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as {
    id?: string;
    name?: string;
    username?: string;
  };

  return {
    id: String(data.id ?? igsid),
    name: data.name,
    username: data.username,
  };
}
/** Result of exchanging a short-lived token for a long-lived one. */
export interface LongLivedToken {
  accessToken: string;
  /** Seconds until the new token expires (typically ~60 days). */
  expiresIn?: number;
}

/**
 * Exchange a short-lived Instagram User token for a long-lived one (~60 days),
 * so the user never has to run a curl command. Requires the App Secret.
 */
export async function exchangeLongLivedToken(
  config: AppConfig,
  shortLivedToken: string
): Promise<LongLivedToken> {
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: config.instagramAppSecret,
    access_token: shortLivedToken,
  });
  const url = `${config.graphBaseUrl}/access_token?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn("Instagram token exchange failed", { status: res.status, detail });
    throw new Error(
      "Could not exchange the token. Check that the short-lived token is valid and the App Secret is correct."
    );
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Instagram did not return a long-lived token.");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * Subscribe this Instagram account to the app's `messages` webhook, so DMs
 * start flowing in without the user doing it by hand in the Meta dashboard.
 */
export async function subscribeWebhook(config: AppConfig): Promise<void> {
  const url = `${config.graphBaseUrl}/${config.graphApiVersion}/${config.instagramAccountId}/subscribed_apps?subscribed_fields=messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.instagramAccessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.warn("Instagram subscribeWebhook failed", { status: res.status, detail });
    throw new Error(
      `Could not subscribe the account to messages (HTTP ${res.status}). ` +
        "Make sure the Callback URL and verify token are saved in Meta first."
    );
  }
}

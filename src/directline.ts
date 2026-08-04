import type { AppConfig } from "./config.js";
import type { DirectLineActivitySet } from "./types.js";
import { log } from "./logger.js";

/**
 * Thin Direct Line 3.0 client.
 *
 * For simplicity and reliability we authenticate every call with the Direct Line
 * SECRET directly (Bearer), which avoids token-refresh bookkeeping. The secret
 * comes from the Dynamics 365 Omnichannel custom (Direct Line) channel registration.
 */

/** Start a new Direct Line conversation and return its id. */
export async function startConversation(config: AppConfig): Promise<string> {
  const res = await fetch(
    `${config.directLineBaseUrl}/v3/directline/conversations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.directLineSecret}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("Direct Line startConversation failed", { status: res.status, detail });
    throw new Error(`Direct Line startConversation failed: ${res.status}`);
  }

  const data = (await res.json()) as { conversationId?: string };
  if (!data.conversationId) {
    throw new Error("Direct Line startConversation returned no conversationId");
  }
  return data.conversationId;
}

/**
 * Confirm the Direct Line secret works by opening a throwaway conversation.
 * Used by the Setup Assistant to give the user an instant green check.
 * Throws a friendly Error when the secret is wrong.
 */
export async function validateSecret(config: AppConfig): Promise<string> {
  if (!config.directLineSecret || config.directLineSecret.trim() === "") {
    throw new Error("The Direct Line secret is not set yet.");
  }
  try {
    return await startConversation(config);
  } catch {
    throw new Error(
      "Dynamics 365 rejected the Direct Line secret. Copy it again from the custom messaging channel and make sure there are no extra spaces."
    );
  }
}

/** Post a user message activity into a Direct Line conversation. */
export async function sendUserMessage(
  config: AppConfig,
  conversationId: string,
  fromId: string,
  text: string,
  fromName?: string
): Promise<void> {
  const res = await fetch(
    `${config.directLineBaseUrl}/v3/directline/conversations/${conversationId}/activities`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.directLineSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "message",
        from: { id: fromId, name: fromName },
        text,
        channelData: {
          channeltype: "instagram",
          conversationcontext: {
            instagramid: fromId,
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("Direct Line sendUserMessage failed", {
      status: res.status,
      conversationId,
      detail,
    });
    throw new Error(`Direct Line sendUserMessage failed: ${res.status}`);
  }
}

/** Poll for new activities since the given watermark. */
export async function getActivities(
  config: AppConfig,
  conversationId: string,
  watermark?: string
): Promise<DirectLineActivitySet> {
  const qs = watermark ? `?watermark=${encodeURIComponent(watermark)}` : "";
  const res = await fetch(
    `${config.directLineBaseUrl}/v3/directline/conversations/${conversationId}/activities${qs}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${config.directLineSecret}` },
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("Direct Line getActivities failed", {
      status: res.status,
      conversationId,
      detail,
    });
    throw new Error(`Direct Line getActivities failed: ${res.status}`);
  }

  return (await res.json()) as DirectLineActivitySet;
}

export const display = (field: any): string => {
  if (typeof field === "string") {
    return field;
  }
  return field?.display_value || "";
};

export const value = (field: any): string => {
  if (typeof field === "string") {
    return field;
  }
  return field?.value || "";
};

export type MessageSender = "user" | "assistant" | "assistant-thinking" | "assistant-tool";

export interface ToolDetails {
  toolActualName: string;
  toolInput: Record<string, any>;
  toolUseId: string;
  success: boolean;
  duration: number;
  result: string;
}

export interface FileAttachment {
  url: string;
  name: string;
  type?: string;
  size?: number;
}

export interface ParsedMessage {
  id: string;
  sender: MessageSender;
  text: string;
  toolName?: string;
  complete?: boolean;
  toolDetails?: ToolDetails;
  images?: Array<{ url: string }>;
  files?: FileAttachment[];
}

/**
 * Parse the content JSON from a message record to extract sender info.
 * For tool messages, extracts full tool details (input, output, duration, success).
 */
export function parseMessageContent(contentField: any): ParsedMessage | null {
  const raw = value(contentField);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const msg: ParsedMessage = {
      id: parsed.id || "",
      sender: parsed.sender || "assistant",
      text: parsed.text || "",
      toolName: parsed.toolName,
      complete: parsed.complete,
      images: Array.isArray(parsed.images) ? parsed.images : undefined,
      files: Array.isArray(parsed.files) ? parsed.files : undefined,
    };

    // Extract full tool details for tool messages
    if (parsed.sender === "assistant-tool" && parsed.toolActualName) {
      msg.toolDetails = {
        toolActualName: parsed.toolActualName || "",
        toolInput: parsed.toolInput || {},
        toolUseId: parsed.toolUseId || "",
        success: parsed.success ?? true,
        duration: parsed.duration || 0,
        result: parsed.result || "",
      };
    }

    return msg;
  } catch {
    return null;
  }
}

/**
 * Determines if a sender type is from the human user.
 */
export function isUserMessage(sender: MessageSender): boolean {
  return sender === "user";
}

/**
 * Counts messages by sender type from an array of message records.
 */
export function countMessagesBySender(messages: any[]): { user: number; assistant: number; total: number } {
  let user = 0;
  let assistant = 0;
  for (const msg of messages) {
    const parsed = parseMessageContent(msg.content);
    if (!parsed) continue;
    if (isUserMessage(parsed.sender)) {
      user++;
    } else {
      assistant++;
    }
  }
  return { user, assistant, total: user + assistant };
}

// ─── NAU Breakdown ─────────────────────────────────────────────────────────────

export interface NauBreakdown {
  userMessages: number;      // Regular typed prompts
  installs: number;          // install/build_install tool calls
  planning: number;          // planning tool calls
  appCreations: number;      // create_new_servicenow_app tool calls
  interviews: number;        // interview tool calls
  totalInteractions: number; // sum of all above
  nauPerUnit: number;        // 25
  totalNau: number;          // totalInteractions * 25
}

/**
 * Compute NAU breakdown from an array of message records (raw API results with content field).
 */
export function computeNauBreakdown(messages: any[]): NauBreakdown {
  let userMessages = 0;
  let installs = 0;
  let planning = 0;
  let appCreations = 0;
  let interviews = 0;

  for (const msg of messages) {
    const raw = typeof msg.content === "string" ? msg.content : msg.content?.value || "";
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.sender === "user") {
        userMessages++;
      } else if (parsed.sender === "assistant-tool") {
        const toolName = parsed.toolActualName || "";
        if (toolName === "install" || toolName === "build_install") installs++;
        else if (toolName === "planning") planning++;
        else if (toolName === "create_new_servicenow_app") appCreations++;
        else if (toolName === "interview") interviews++;
      }
    } catch { /* skip */ }
  }

  const totalInteractions = userMessages + installs + planning + appCreations + interviews;
  return {
    userMessages,
    installs,
    planning,
    appCreations,
    interviews,
    totalInteractions,
    nauPerUnit: 25,
    totalNau: totalInteractions * 25,
  };
}

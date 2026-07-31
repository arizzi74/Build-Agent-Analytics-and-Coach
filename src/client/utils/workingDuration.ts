/**
 * Implementation duration utilities.
 *
 * Primary metric: sum of per-turn working time.
 * A "turn" starts with a user message and ends with the last Build Agent
 * (assistant) message before the next user message. The duration of each turn
 * is: last_assistant_timestamp − user_message_timestamp.
 *
 * This avoids counting idle time between sessions — if a user reopens an old
 * conversation hours later, that gap is not included.
 */

import { parseMessageContent, isUserMessage } from "./fields.ts";

// ─── Date Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a ServiceNow date string into a Date object.
 * Accepts "YYYY-MM-DD HH:mm:ss" or ISO format.
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const normalized = dateStr.replace(" ", "T");
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Implementation Duration (Turn-based) ───────────────────────────────────

/**
 * Extract the value from a ServiceNow display_value/value field.
 */
function fieldValue(field: any): string {
  if (typeof field === "string") return field;
  return field?.value || "";
}

interface TimestampedMessage {
  sender: "user" | "assistant";
  timestamp: number;
}

/**
 * Given an array of message records (with `content` and `sys_created_on` fields),
 * compute the implementation duration as the sum of per-turn working intervals,
 * in milliseconds.
 *
 * Algorithm:
 * 1. Parse all messages extracting sender and timestamp
 * 2. Sort chronologically
 * 3. Identify "turns": each turn starts with a user message
 * 4. For each turn, find the last assistant message before the next user message
 * 5. Turn duration = last_assistant_timestamp − user_message_timestamp
 * 6. Sum all turn durations
 */
export function calculateImplDurationMs(messages: any[]): number {
  // Collect all messages with their sender type and timestamp
  const parsed: TimestampedMessage[] = [];

  for (const msg of messages) {
    const content = parseMessageContent(msg.content);
    if (!content) continue;

    const dateStr = fieldValue(msg.sys_created_on);
    const date = parseDate(dateStr);
    if (!date) continue;

    if (isUserMessage(content.sender)) {
      parsed.push({ sender: "user", timestamp: date.getTime() });
    } else {
      parsed.push({ sender: "assistant", timestamp: date.getTime() });
    }
  }

  // Sort chronologically
  parsed.sort((a, b) => a.timestamp - b.timestamp);

  // Walk through messages and compute per-turn duration
  let totalMs = 0;
  let currentTurnStart: number | null = null;
  let lastAssistantInTurn: number | null = null;

  for (const entry of parsed) {
    if (entry.sender === "user") {
      // Close the previous turn if we had one with an assistant response
      if (currentTurnStart !== null && lastAssistantInTurn !== null) {
        totalMs += lastAssistantInTurn - currentTurnStart;
      }
      // Start a new turn
      currentTurnStart = entry.timestamp;
      lastAssistantInTurn = null;
    } else {
      // Assistant message — track as latest response in the current turn
      if (currentTurnStart !== null) {
        lastAssistantInTurn = entry.timestamp;
      }
    }
  }

  // Close the last turn if it ended with an assistant response
  if (currentTurnStart !== null && lastAssistantInTurn !== null) {
    totalMs += lastAssistantInTurn - currentTurnStart;
  }

  return totalMs;
}

/**
 * Format milliseconds as a human-readable duration string (hours and minutes only).
 * Examples: "3h 45m", "0h 12m", "< 1m"
 */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return "—";

  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return "< 1m";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Calculate impl duration from an array of message arrays (one per conversation),
 * returning a formatted string.
 */
export function formatImplDuration(allMessages: any[][]): string {
  let totalMs = 0;
  for (const msgs of allMessages) {
    totalMs += calculateImplDurationMs(msgs);
  }
  return formatDurationMs(totalMs);
}

/**
 * Calculate total implementation minutes from an array of message arrays.
 * Used for ROI calculations where raw numeric value is needed.
 */
export function getImplMinutes(allMessages: any[][]): number {
  let totalMs = 0;
  for (const msgs of allMessages) {
    totalMs += calculateImplDurationMs(msgs);
  }
  return Math.round(totalMs / 60000);
}

// ─── Wall-Clock Duration ─────────────────────────────────────────────────────

/**
 * Calculate wall-clock duration for a single conversation: elapsed time from
 * the first message to the last message regardless of sender.
 */
export function calculateWallClockMs(messages: any[]): number {
  const timestamps: number[] = [];

  for (const msg of messages) {
    const dateStr = fieldValue(msg.sys_created_on);
    const date = parseDate(dateStr);
    if (date) timestamps.push(date.getTime());
  }

  if (timestamps.length < 2) return 0;

  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return max - min;
}

/**
 * Format total wall-clock from an array of message arrays.
 */
export function formatWallClock(allMessages: any[][]): string {
  let totalMs = 0;
  for (const msgs of allMessages) {
    totalMs += calculateWallClockMs(msgs);
  }
  return formatDurationMs(totalMs);
}

// ─── Average Interaction Time & Average Pause Time ───────────────────────────

export interface DurationMetrics {
  /** Total implementation time (sum of turn durations) in ms */
  implMs: number;
  /** Total wall-clock time (first→last message per conversation) in ms */
  wallClockMs: number;
  /** Average duration of a single turn (user msg → last assistant response) in ms */
  avgInteractionMs: number;
  /** Average pause between turns (end of one turn → start of next user msg) in ms */
  avgPauseMs: number;
  /** Number of turns used in calculation */
  turnCount: number;
}

/**
 * Compute all duration metrics in a single pass over one conversation's messages.
 */
function computeConversationMetrics(messages: any[]): {
  implMs: number;
  wallClockMs: number;
  turnDurations: number[];
  pauseDurations: number[];
} {
  const parsed: TimestampedMessage[] = [];

  for (const msg of messages) {
    const content = parseMessageContent(msg.content);
    if (!content) continue;

    const dateStr = fieldValue(msg.sys_created_on);
    const date = parseDate(dateStr);
    if (!date) continue;

    if (isUserMessage(content.sender)) {
      parsed.push({ sender: "user", timestamp: date.getTime() });
    } else {
      parsed.push({ sender: "assistant", timestamp: date.getTime() });
    }
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);

  // Wall-clock: first to last timestamp
  let wallClockMs = 0;
  if (parsed.length >= 2) {
    wallClockMs = parsed[parsed.length - 1].timestamp - parsed[0].timestamp;
  }

  // Per-turn durations & pauses
  let implMs = 0;
  const turnDurations: number[] = [];
  const pauseDurations: number[] = [];

  let currentTurnStart: number | null = null;
  let lastAssistantInTurn: number | null = null;
  let previousTurnEnd: number | null = null;

  for (const entry of parsed) {
    if (entry.sender === "user") {
      // Close previous turn
      if (currentTurnStart !== null && lastAssistantInTurn !== null) {
        const turnDuration = lastAssistantInTurn - currentTurnStart;
        implMs += turnDuration;
        turnDurations.push(turnDuration);
        previousTurnEnd = lastAssistantInTurn;
      }
      // Compute pause (gap between previous turn end and this user message)
      if (previousTurnEnd !== null) {
        const pause = entry.timestamp - previousTurnEnd;
        if (pause > 0) pauseDurations.push(pause);
      }
      // Start new turn
      currentTurnStart = entry.timestamp;
      lastAssistantInTurn = null;
    } else {
      if (currentTurnStart !== null) {
        lastAssistantInTurn = entry.timestamp;
      }
    }
  }

  // Close last turn
  if (currentTurnStart !== null && lastAssistantInTurn !== null) {
    const turnDuration = lastAssistantInTurn - currentTurnStart;
    implMs += turnDuration;
    turnDurations.push(turnDuration);
  }

  return { implMs, wallClockMs, turnDurations, pauseDurations };
}

/**
 * Calculate all duration metrics across multiple conversations.
 * Returns a unified metrics object with totals and averages.
 */
export function calculateDurationMetrics(allMessages: any[][]): DurationMetrics {
  let totalImplMs = 0;
  let totalWallClockMs = 0;
  const allTurnDurations: number[] = [];
  const allPauseDurations: number[] = [];

  for (const msgs of allMessages) {
    const m = computeConversationMetrics(msgs);
    totalImplMs += m.implMs;
    totalWallClockMs += m.wallClockMs;
    allTurnDurations.push(...m.turnDurations);
    allPauseDurations.push(...m.pauseDurations);
  }

  const avgInteractionMs = allTurnDurations.length > 0
    ? allTurnDurations.reduce((s, v) => s + v, 0) / allTurnDurations.length
    : 0;

  const avgPauseMs = allPauseDurations.length > 0
    ? allPauseDurations.reduce((s, v) => s + v, 0) / allPauseDurations.length
    : 0;

  return {
    implMs: totalImplMs,
    wallClockMs: totalWallClockMs,
    avgInteractionMs,
    avgPauseMs,
    turnCount: allTurnDurations.length,
  };
}

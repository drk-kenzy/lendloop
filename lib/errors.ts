import { ConvexError } from "convex/values";

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in again.",
  USER_NOT_INITIALIZED: "Your account is still being set up. Try again.",
  FORBIDDEN: "You are not allowed to do that.",
  NOT_FOUND: "That item no longer exists.",
  TOOL_ON_LOAN: "This tool is on loan. Mark it as returned first.",
  OWN_TOOL: "You cannot borrow your own tool.",
  ALREADY_REQUESTED: "You already have a pending request for this tool.",
  DATES_UNAVAILABLE: "Those dates overlap with an approved loan.",
  START_IN_PAST: "The start date cannot be in the past.",
  INVALID_RANGE: "The end date must be on or after the start date.",
  RANGE_TOO_LONG: "Loans are limited to 30 days.",
  NOT_PENDING: "This request was already handled.",
  NOT_APPROVED: "Only approved loans can be marked as returned.",
};

/** Turns a Convex error into a short message that is safe to show. */
export function friendlyError(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return MESSAGES[error.data] ?? "Something went wrong. Please check your input.";
  }
  return "Something went wrong. Please try again.";
}

"use client";

type Activity = {
  kind: "notification" | "reminder";
  status: "pending" | "sent" | "failed";
  updatedAt: number;
} | null;

function ago(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Bonus: latest automation activity shown on each loan. */
export default function ActivityBadge({ activity }: { activity: Activity }) {
  if (!activity) return null;
  const what = activity.kind === "reminder" ? "Reminder" : "Notification";
  if (activity.status === "failed") {
    return <span className="tag bad">{what} failed {ago(activity.updatedAt)}</span>;
  }
  if (activity.status === "pending") {
    return <span className="tag warn">{what} pending</span>;
  }
  return <span className="tag ok">{what} sent {ago(activity.updatedAt)}</span>;
}

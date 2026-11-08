"use client";

import { useMutation, useQuery } from "convex/react";
import { MailOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/ui";
import { useToast } from "../Toast";
import ActivityBadge from "./ActivityBadge";
import { Empty, SectionHead, Skeletons, statusLabel } from "./Ui";

export default function IncomingRequests() {
  const loans = useQuery(api.loans.incomingRequests);
  const respond = useMutation(api.loans.respond);
  const markReturned = useMutation(api.loans.markReturned);
  const notify = useToast();

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      notify(success);
    } catch (err) {
      notify(friendlyError(err), "error");
    }
  }

  return (
    <section>
      <SectionHead title="Incoming requests" count={loans?.length} />
      {loans === undefined ? (
        <Skeletons count={2} />
      ) : loans.length === 0 ? (
        <Empty icon={MailOpen}>No one has requested your tools yet.</Empty>
      ) : (
        <ul className="grid">
          {loans.map((loan) => {
            const id = loan._id as Id<"loans">;
            const status = statusLabel(loan.status, loan.overdue);
            return (
              <li className="card" key={loan._id}>
                <div className="row">
                  <strong>{loan.toolName}</strong>
                  <span className={`tag ${status}`}>{status}</span>
                </div>
                <div className="dates">
                  {formatDate(loan.startDate)} <i>to</i> {formatDate(loan.endDate)}
                </div>
                <div className="muted">Requested by {loan.borrowerName}</div>
                <ActivityBadge activity={loan.activity} />
                {loan.status === "pending" && (
                  <div className="actions">
                    <button className="btn primary small" onClick={() => run(() => respond({ loanId: id, decision: "approve" }), "Request approved.")}>
                      Approve
                    </button>
                    <button className="btn danger small" onClick={() => run(() => respond({ loanId: id, decision: "decline" }), "Request declined.")}>
                      Decline
                    </button>
                  </div>
                )}
                {loan.status === "approved" && (
                  <div className="actions">
                    <button className="btn primary small" onClick={() => run(() => markReturned({ loanId: id }), "Marked as returned.")}>
                      Mark as returned
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { Inbox, Wrench } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { friendlyError } from "@/lib/errors";
import { CategoryIcon, formatDate } from "@/lib/ui";
import { useToast } from "../Toast";
import ActivityBadge from "./ActivityBadge";
import { Empty, TrustedBadge, SectionHead, Skeletons, statusLabel } from "./Ui";

/** Rendered only for admins; every call below is re-checked server side. */
export default function AdminPanel() {
  const users = useQuery(api.users.listForAdmin);
  const loans = useQuery(api.loans.listAll);
  const tools = useQuery(api.tools.listAll, {});
  const setTrusted = useMutation(api.users.setTrustedLender);
  const removeTool = useMutation(api.tools.remove);
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
      <SectionHead title="Members" count={users?.length} />
      {users === undefined ? (
        <Skeletons count={2} />
      ) : (
        <ul className="grid">
          {users.map((u) => (
            <li className="card" key={u._id}>
              <div className="row">
                <strong>{u.name}</strong>
                <span className="tag plain">{u.role}</span>
              </div>
              <div className="muted">{u.email ?? "no email"}</div>
              <div className="row">
                {u.trustedLender ? <TrustedBadge /> : <span />}
                <button
                  className="btn small"
                  onClick={() =>
                    run(
                      () => setTrusted({ userId: u._id, trusted: !u.trustedLender }),
                      u.trustedLender ? "Trusted Lender removed." : "Marked as Trusted Lender.",
                    )
                  }
                >
                  {u.trustedLender ? "Remove badge" : "Mark as Trusted Lender"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionHead title="All listings" count={tools?.length} />
      {tools === undefined ? (
        <Skeletons count={2} />
      ) : tools.length === 0 ? (
        <Empty icon={Wrench}>No listings.</Empty>
      ) : (
        <ul className="grid">
          {tools.map((t) => (
            <li className="card" key={t._id}>
              <div className="card-title">
                <span className="icon" aria-hidden><CategoryIcon category={t.category} /></span>
                <div>
                  <strong>{t.name}</strong>
                  <div className="meta">
                    <span className={t.available ? "tag ok" : "tag warn"}>{t.available ? "Available" : "On loan"}</span>
                  </div>
                </div>
              </div>
              <div className="actions">
                <button className="btn danger small" onClick={() => run(() => removeTool({ toolId: t._id }), "Listing removed.")}>
                  Remove listing
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SectionHead title="All loans" count={loans?.length} />
      {loans === undefined ? (
        <Skeletons count={2} />
      ) : loans.length === 0 ? (
        <Empty icon={Inbox}>No loans yet.</Empty>
      ) : (
        <ul className="grid">
          {loans.map((loan) => {
            const status = statusLabel(loan.status, loan.overdue);
            return (
              <li className="card" key={loan._id}>
                <div className="row">
                  <strong>{loan.toolName}</strong>
                  <span className={`tag ${status}`}>{status}</span>
                </div>
                <div className="muted">
                  {loan.lenderName} to {loan.borrowerName}
                </div>
                <div className="dates">
                  {formatDate(loan.startDate)} <i>to</i> {formatDate(loan.endDate)}
                </div>
                <ActivityBadge activity={loan.activity} />
                {loan.status === "approved" && (
                  <div className="actions">
                    <button
                      className="btn small"
                      onClick={() => run(() => markReturned({ loanId: loan._id as Id<"loans"> }), "Marked as returned.")}
                    >
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

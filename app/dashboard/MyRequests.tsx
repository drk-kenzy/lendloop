"use client";

import { useQuery } from "convex/react";
import { Inbox } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/ui";
import ActivityBadge from "./ActivityBadge";
import { Empty, SectionHead, Skeletons, statusLabel } from "./Ui";

export default function MyRequests() {
  const loans = useQuery(api.loans.myRequests);

  return (
    <section>
      <SectionHead title="My requests" count={loans?.length} />
      {loans === undefined ? (
        <Skeletons count={2} />
      ) : loans.length === 0 ? (
        <Empty icon={Inbox}>You have not requested any tool yet. Browse the tools to get started.</Empty>
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
                <div className="dates">
                  {formatDate(loan.startDate)} <i>to</i> {formatDate(loan.endDate)}
                </div>
                <div className="muted">Lender: {loan.lenderName}</div>
                <ActivityBadge activity={loan.activity} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

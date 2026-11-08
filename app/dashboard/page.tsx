"use client";

import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import AdminPanel from "./AdminPanel";
import BrowseTools from "./BrowseTools";
import IncomingRequests from "./IncomingRequests";
import MyListings from "./MyListings";
import MyRequests from "./MyRequests";
import { Skeletons, TrustedBadge } from "./Ui";

type Tab = "browse" | "listings" | "requests" | "incoming" | "admin";

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const storeUser = useMutation(api.users.store);
  const skip = isAuthenticated ? {} : "skip";
  const me = useQuery(api.users.me, skip);
  const allTools = useQuery(api.tools.listAll, isAuthenticated ? {} : "skip");
  const myListings = useQuery(api.tools.myListings, skip);
  const myRequests = useQuery(api.loans.myRequests, skip);
  const incoming = useQuery(api.loans.incomingRequests, skip);
  const [tab, setTab] = useState<Tab>("browse");

  // First login creates the user row (always as role "user", server side).
  useEffect(() => {
    if (isAuthenticated) void storeUser();
  }, [isAuthenticated, storeUser]);

  if (isLoading || (isAuthenticated && !me)) {
    return (
      <main className="container">
        <Skeletons count={3} />
      </main>
    );
  }
  if (!isAuthenticated) {
    return (
      <main className="container">
        <div className="empty">
          <span className="big" aria-hidden><Lock size={30} strokeWidth={1.5} /></span>
          You need to sign in to see your dashboard.
          <div style={{ marginTop: 16 }}>
            <Link className="btn primary" href="/">
              Back to home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const pendingIncoming = incoming?.filter((l) => l.status === "pending").length ?? 0;
  const activeLoans = myRequests?.filter((l) => l.status === "approved").length ?? 0;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "browse", label: "Browse tools" },
    { id: "listings", label: "My listings" },
    { id: "requests", label: "My requests" },
    { id: "incoming", label: "Incoming requests", badge: pendingIncoming },
  ];
  if (me?.role === "admin") tabs.push({ id: "admin", label: "Admin" });

  return (
    <main className="container">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden>L</span>
          LendLoop
        </Link>
        <nav>
          <span className="user-chip">
            {me?.name}
            {me?.role === "admin" && <span className="tag trusted plain">admin</span>}
            {me?.trustedLender && <TrustedBadge />}
          </span>
          <UserButton />
        </nav>
      </header>

      <div className="stats">
        <div className="stat">
          <b>{allTools?.length ?? "-"}</b>
          <span>Tools in the neighborhood</span>
        </div>
        <div className="stat">
          <b>{myListings?.length ?? "-"}</b>
          <span>My listings</span>
        </div>
        <div className="stat">
          <b>{pendingIncoming}</b>
          <span>Requests to review</span>
        </div>
        <div className="stat">
          <b>{activeLoans}</b>
          <span>Tools I am borrowing</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "browse" && <BrowseTools />}
      {tab === "listings" && <MyListings />}
      {tab === "requests" && <MyRequests />}
      {tab === "incoming" && <IncomingRequests />}
      {tab === "admin" && me?.role === "admin" && <AdminPanel />}
    </main>
  );
}

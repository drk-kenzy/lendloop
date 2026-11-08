"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { Wrench } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { CategoryIcon } from "@/lib/ui";

export default function HomePage() {
  // Public query: only name + category of available tools, no owner details.
  const tools = useQuery(api.tools.listPublic);

  return (
    <main className="container">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden>L</span>
          LendLoop
        </span>
        <nav>
          <Authenticated>
            <Link className="btn" href="/dashboard">
              Open dashboard
            </Link>
            <UserButton />
          </Authenticated>
          <Unauthenticated>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn primary">Sign in to lend or borrow</button>
            </SignInButton>
          </Unauthenticated>
        </nav>
      </header>

      <section className="hero">
        <span className="eyebrow">Your neighborhood tool library</span>
        <h1>
          Borrow what you need. <span>Lend what you don&apos;t.</span>
        </h1>
        <p>
          Neighbors share tools instead of buying them for a single weekend.
          List what you can spare, ask for what you need, and get reminded
          automatically.
        </p>
        <div className="hero-actions">
          <Unauthenticated>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn primary">Sign in to lend or borrow</button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <Link className="btn primary" href="/dashboard">
              Go to my dashboard
            </Link>
          </Authenticated>
        </div>
      </section>

      <section className="steps" aria-label="How it works">
        <div className="step">
          <span className="n">01</span>
          <b>List a tool</b>
          <p>Add what you are happy to lend, with its condition.</p>
        </div>
        <div className="step">
          <span className="n">02</span>
          <b>Request dates</b>
          <p>Neighbors ask to borrow it for the days they need.</p>
        </div>
        <div className="step">
          <span className="n">03</span>
          <b>Stay in the loop</b>
          <p>Automatic notifications and reminders keep everyone on track.</p>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>
            Available tools
            {tools && <span className="count">{tools.length}</span>}
          </h2>
          <span className="muted">Name and category only. Owners stay private.</span>
        </div>

        {tools === undefined ? (
          <ul className="grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="skeleton" />
            ))}
          </ul>
        ) : tools.length === 0 ? (
          <div className="empty">
            <span className="big" aria-hidden><Wrench size={30} strokeWidth={1.5} /></span>
            Nothing is listed yet. Be the first to lend a tool.
          </div>
        ) : (
          <ul className="grid">
            {tools.map((tool, index) => (
              <li className="card" key={`${tool.name}-${index}`}>
                <div className="card-title">
                  <span className="icon" aria-hidden><CategoryIcon category={tool.category} /></span>
                  <div>
                    <strong>{tool.name}</strong>
                    <div className="meta">
                      <span className="tag plain">{tool.category}</span>
                      <span className="tag ok">Available</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

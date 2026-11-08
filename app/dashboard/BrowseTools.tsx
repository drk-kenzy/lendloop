"use client";

import { useMutation, useQuery } from "convex/react";
import { SearchX } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, type Category } from "@/convex/lib/constants";
import { friendlyError } from "@/lib/errors";
import { CategoryIcon } from "@/lib/ui";
import { useToast } from "../Toast";
import { Empty, TrustedBadge, SectionHead, Skeletons } from "./Ui";

export default function BrowseTools() {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listAll, category ? { category } : {});
  const [requesting, setRequesting] = useState<Id<"tools"> | null>(null);

  return (
    <section>
      <SectionHead title="All tools" count={tools?.length}>
        <div className="chips" role="group" aria-label="Filter by category">
          <button
            className={category === "" ? "chip active" : "chip"}
            onClick={() => setCategory("")}
          >
            All
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={category === c ? "chip active" : "chip"}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </SectionHead>

      {tools === undefined ? (
        <Skeletons />
      ) : tools.length === 0 ? (
        <Empty icon={SearchX}>No tools in this category yet.</Empty>
      ) : (
        <ul className="grid">
          {tools.map((tool) => (
            <li className="card" key={tool._id}>
              <div className="card-title">
                <span className="icon" aria-hidden><CategoryIcon category={tool.category} /></span>
                <div>
                  <strong>{tool.name}</strong>
                  <div className="meta">
                    <span className="tag plain">{tool.category}</span>
                    <span className="tag plain">{tool.condition}</span>
                    {tool.ownerTrusted && <TrustedBadge />}
                  </div>
                </div>
              </div>
              {tool.description && <p>{tool.description}</p>}
              <div className="row">
                <span className={tool.available ? "tag ok" : "tag warn"}>
                  {tool.available ? "Available" : "On loan"}
                </span>
                {tool.isMine && <span className="muted">Your listing</span>}
              </div>
              {!tool.isMine &&
                (requesting === tool._id ? (
                  <RequestForm toolId={tool._id} onDone={() => setRequesting(null)} />
                ) : (
                  <div className="actions">
                    <button className="btn primary small" onClick={() => setRequesting(tool._id)}>
                      Request to borrow
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const notify = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request({ toolId, startDate, endDate });
      notify("Request sent. The lender has been notified.");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="inline-form">
      <div className="pair">
        <label className="muted">
          From
          <input type="date" min={today} value={startDate} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="muted">
          To
          <input type="date" min={startDate} value={endDate} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn primary small" disabled={busy}>Send request</button>
        <button type="button" className="btn small" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

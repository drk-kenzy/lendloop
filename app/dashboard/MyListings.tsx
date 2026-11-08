"use client";

import { useMutation, useQuery } from "convex/react";
import { Wrench } from "lucide-react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  CONDITIONS,
  type Category,
  type Condition,
} from "@/convex/lib/constants";
import { friendlyError } from "@/lib/errors";
import { CategoryIcon } from "@/lib/ui";
import { useToast } from "../Toast";
import { Empty, SectionHead, Skeletons } from "./Ui";

export default function MyListings() {
  const listings = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const remove = useMutation(api.tools.remove);
  const update = useMutation(api.tools.update);
  const notify = useToast();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("power tools");
  const [condition, setCondition] = useState<Condition>("good");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create({ name, category, condition, description });
      setName("");
      setDescription("");
      notify("Listing added.");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  type Listing = NonNullable<typeof listings>[number];
  const [editingId, setEditingId] = useState<Listing["_id"] | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    category: "power tools" as Category,
    condition: "good" as Condition,
    description: "",
  });

  function startEdit(tool: Listing) {
    setEditingId(tool._id);
    setDraft({
      name: tool.name,
      category: tool.category as Category,
      condition: tool.condition as Condition,
      description: tool.description ?? "",
    });
  }

  async function saveEdit(e: React.FormEvent, toolId: Listing["_id"]) {
    e.preventDefault();
    setBusy(true);
    try {
      await update({ toolId, ...draft });
      setEditingId(null);
      notify("Listing updated.");
    } catch (err) {
      notify(friendlyError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(toolId: NonNullable<typeof listings>[number]["_id"]) {
    try {
      await remove({ toolId });
      notify("Listing deleted.");
    } catch (err) {
      notify(friendlyError(err), "error");
    }
  }

  return (
    <section>
      <SectionHead title="List a tool" />
      <form onSubmit={submit} className="panel form cols">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} placeholder="Cordless drill" required />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Condition
          <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="full">
          Short description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} placeholder="18V, two batteries and a charger." />
        </label>
        {error && <p className="error full" role="alert">{error}</p>}
        <div className="full">
          <button className="btn primary" disabled={busy}>Add listing</button>
        </div>
      </form>

      <SectionHead title="My listings" count={listings?.length} />
      {listings === undefined ? (
        <Skeletons count={2} />
      ) : listings.length === 0 ? (
        <Empty icon={Wrench}>You have not listed anything yet.</Empty>
      ) : (
        <ul className="grid">
          {listings.map((tool) => (
            <li className="card" key={tool._id}>
              <div className="card-title">
                <span className="icon" aria-hidden><CategoryIcon category={tool.category} /></span>
                <div>
                  <strong>{tool.name}</strong>
                  <div className="meta">
                    <span className="tag plain">{tool.category}</span>
                    <span className="tag plain">{tool.condition}</span>
                  </div>
                </div>
              </div>
              {editingId === tool._id ? (
                <form className="form" onSubmit={(e) => saveEdit(e, tool._id)}>
                  <label>
                    Name
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} minLength={2} maxLength={80} required />
                  </label>
                  <label>
                    Category
                    <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>
                    Condition
                    <select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value as Condition })}>
                      {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>
                    Short description
                    <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={500} rows={2} />
                  </label>
                  <div className="actions">
                    <button className="btn primary small" disabled={busy}>Save</button>
                    <button type="button" className="btn small" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  {tool.description && <p>{tool.description}</p>}
                  <div className="row">
                    <span className={tool.available ? "tag ok" : "tag warn"}>
                      {tool.available ? "Available" : "On loan"}
                    </span>
                    <span className="actions">
                      <button className="btn small" onClick={() => startEdit(tool)}>Edit</button>
                      <button className="btn danger small" onClick={() => onRemove(tool._id)}>Delete</button>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

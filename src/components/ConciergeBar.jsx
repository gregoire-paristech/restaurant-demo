import { useState } from "react";
import { dishes } from "../data";

const dishById = Object.fromEntries(dishes.map((d) => [d.id, d]));

/**
 * Appelle le serveur Express qui interroge GPT pour des recommandations.
 * @param {string} prompt
 * @returns {Promise<{ dish_ids: number[], persons: number, split_order: boolean, message: string }>}
 */
async function fetchRecommendations(prompt) {
  const res = await fetch("/api/concierge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erreur serveur (${res.status})`);
  }

  return res.json();
}

export default function ConciergeBar({ onFillCart }) {
  const [prompt,  setPrompt]  = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const { dish_ids, persons, split_order, message } = await fetchRecommendations(prompt);

      const items  = dish_ids.map((id) => dishById[id]).filter(Boolean);
      const qty    = split_order || items.length > 1 ? 1 : persons;
      const qtyMap = Object.fromEntries(items.map((d) => [d.id, qty]));

      setPreview({ items, qtyMap, persons, message });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleConfirm() {
    if (!preview) return;
    onFillCart(preview.items.map((d) => ({ ...d, quantity: preview.qtyMap[d.id] ?? 1 })));
    setPreview(null);
    setPrompt("");
  }

  function handleCancel() {
    setPreview(null);
    setError(null);
    setPrompt("");
  }

  const total = preview
    ? preview.items.reduce((sum, d) => sum + d.price * (preview.qtyMap[d.id] ?? 1), 0)
    : 0;

  return (
    <div className="concierge-wrap">
      <form className="concierge-bar" onSubmit={handleSubmit}>
        <span className="concierge-icon">✦</span>
        <input
          className="concierge-input"
          type="text"
          placeholder="Commande-moi un truc léger pour ce soir, j'ai Pilates après…"
          value={prompt}
          disabled={loading}
          onChange={(e) => { setPrompt(e.target.value); setPreview(null); setError(null); }}
        />
        <button className="concierge-btn" type="submit" disabled={loading || !prompt.trim()}>
          {loading ? "…" : "Commander"}
        </button>
      </form>

      {loading && (
        <div className="concierge-empty">Je cherche les meilleurs plats pour toi…</div>
      )}

      {error && (
        <div className="concierge-error">{error}</div>
      )}

      {preview && (
        <div className="concierge-preview">
          {preview.message && (
            <p className="concierge-preview-title">{preview.message}</p>
          )}
          <ul className="concierge-preview-list">
            {preview.items.map((d) => {
              const qty = preview.qtyMap[d.id] ?? 1;
              return (
                <li key={d.id} className="concierge-preview-item">
                  <span>{d.emoji} {d.name}</span>
                  <span className="concierge-preview-price">
                    €{(d.price * qty).toFixed(2)}
                    {qty > 1 && <span className="concierge-qty"> ×{qty}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="concierge-preview-total">
            Total : <strong>€{total.toFixed(2)}</strong>
          </div>
          <div className="concierge-preview-actions">
            <button className="concierge-cancel"  onClick={handleCancel}>Annuler</button>
            <button className="concierge-confirm" onClick={handleConfirm}>Confirmer la commande</button>
          </div>
        </div>
      )}
    </div>
  );
}

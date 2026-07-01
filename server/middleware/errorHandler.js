export function errorHandler(err, req, res, next) {
  // Erreur LLM structurée
  if (err.name === "LLMError") {
    const status  = err.status ?? 500;
    const message = mapLLMError(err);
    console.error(`[LLM] ${status} ${err.code ?? ""} — ${err.message}`);
    return res.status(status).json({ error: message, code: err.code ?? "llm_error" });
  }

  // Timeout réseau
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
    console.error("[LLM] Timeout :", err.message);
    return res.status(504).json({ error: "La requête a expiré. Réessaie.", code: "timeout" });
  }

  // Erreur de validation (body malformé, champs manquants)
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: err.message, code: "validation_error" });
  }

  // Fallback générique
  console.error("[Server]", err);
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({
    error: "Erreur interne du serveur.",
    ...(isDev && { detail: err.message }),
  });
}

function mapLLMError(err) {
  switch (err.code) {
    case "invalid_api_key":
      return "Clé API invalide ou expirée.";
    case "rate_limit_exceeded":
      return "Limite de débit atteinte. Réessaie dans quelques secondes.";
    case "insufficient_quota":
      return "Quota épuisé. Vérifie ta facturation.";
    case "context_length_exceeded":
      return "Le contexte est trop long pour ce modèle.";
    case "content_policy_violation":
      return "Le contenu a été refusé par le modèle.";
    default:
      return err.status === 503
        ? "Le service IA est temporairement indisponible. Réessaie."
        : err.message ?? "Erreur LLM inconnue.";
  }
}

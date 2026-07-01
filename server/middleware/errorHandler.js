/**
 * Middleware Express de gestion centralisée des erreurs.
 * Toujours enregistrer en dernier dans app.use().
 *
 * @param {Error}                          err
 * @param {import("express").Request}      req
 * @param {import("express").Response}     res
 * @param {import("express").NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  // Erreur OpenAI structurée
  if (err.name === "OpenAIError") {
    const status = err.status ?? 500;
    const message = mapOpenAIError(err);
    console.error(`[OpenAI] ${status} ${err.code ?? ""} — ${err.message}`);
    return res.status(status).json({ error: message, code: err.code ?? "openai_error" });
  }

  // Timeout
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
    console.error("[Timeout]", err.message);
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
    ...(isDev && { detail: err.message, stack: err.stack }),
  });
}

/**
 * Traduit les codes d'erreur OpenAI en messages lisibles.
 * @param {Error & { code?: string; status?: number }} err
 * @returns {string}
 */
function mapOpenAIError(err) {
  switch (err.code) {
    case "invalid_api_key":
      return "Clé API OpenAI invalide ou expirée.";
    case "rate_limit_exceeded":
      return "Limite de débit OpenAI atteinte. Réessaie dans quelques secondes.";
    case "insufficient_quota":
      return "Quota OpenAI épuisé. Vérifie ta facturation.";
    case "context_length_exceeded":
      return "Le contexte est trop long pour ce modèle.";
    case "content_policy_violation":
      return "Le contenu a été refusé par la politique OpenAI.";
    default:
      return err.status === 503
        ? "OpenAI est temporairement indisponible. Réessaie."
        : err.message ?? "Erreur OpenAI inconnue.";
  }
}

import { Router } from "express";
import { dishes } from "../../src/data.js";
import { getLLMService } from "../services/llmService.js";

const router = Router();

// ─── Catalogue formaté pour le prompt système ────────────────────────────────

const MENU_TEXT = dishes
  .map((d) => `[${d.id}] ${d.emoji} ${d.name} (${d.category}, ${d.price}€) — ${d.description}`)
  .join("\n");

const SYSTEM_PROMPT = `\
Tu es un assistant de commande pour un restaurant de livraison. \
Tu aides les clients à choisir les meilleurs plats en fonction de leur demande en langage naturel.

## Menu disponible
${MENU_TEXT}

## Règles
- Réponds UNIQUEMENT en appelant l'outil "recommend_dishes". Ne génère jamais de texte libre.
- Sélectionne 1 à 5 plats pertinents parmi les IDs du menu ci-dessus.
- Détecte le nombre de personnes dans la demande (mots-clés : "pour X", "ma meuf", "mon pote", "on est X", etc.). Par défaut : 1.
- Si plusieurs personnes ont des préférences différentes ("pour moi X et pour Y Z"), sélectionne un plat par intention distincte et mets split_order à true.
- Détecte un budget ("max X€", "budget X€", "X€/pers") et ne dépasse jamais ce budget par plat.
- message doit être en français, chaleureux, 1-2 phrases max. Explique brièvement pourquoi ces plats.
- Si la demande est ambiguë, choisis les plats les plus populaires qui correspondent au mieux.
`;

// ─── Définition de l'outil (tool calling) ────────────────────────────────────

const RECOMMEND_TOOL = {
  type: "function",
  function: {
    name: "recommend_dishes",
    description: "Retourne les plats recommandés pour la commande du client",
    parameters: {
      type: "object",
      required: ["dish_ids", "message"],
      properties: {
        dish_ids: {
          type: "array",
          items: { type: "integer" },
          description: "IDs des plats recommandés (de 1 à 5 plats)",
        },
        persons: {
          type: "integer",
          minimum: 1,
          description: "Nombre de personnes détecté dans la demande",
        },
        split_order: {
          type: "boolean",
          description: "True si des personnes différentes veulent des plats différents",
        },
        budget_per_person: {
          type: "number",
          description: "Budget par personne en euros si détecté, sinon null",
        },
        message: {
          type: "string",
          description: "Message de confirmation chaleureux en français (1-2 phrases)",
        },
      },
    },
  },
};

// ─── POST /api/concierge ─────────────────────────────────────────────────────

/**
 * Body   : { prompt: string }
 * Réponse: { dish_ids: number[], persons: number, split_order: boolean, message: string }
 */
router.post("/", async (req, res, next) => {
  try {
    // En environnement serverless, localhost n'est pas accessible
    const baseURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
    if (process.env.VERCEL && (baseURL.includes("localhost") || baseURL.includes("127.0.0.1"))) {
      return res.status(503).json({
        error: "Le Concierge IA n'est pas encore configuré sur ce serveur. Configure LLM_BASE_URL dans les variables d'environnement Vercel.",
        code: "llm_not_configured",
      });
    }

    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      const err = new Error("prompt est requis");
      err.name = "ValidationError";
      throw err;
    }

    const service = getLLMService();

    const response = await service.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: prompt.trim() },
      ],
      {
        temperature: 0.3, // Faible pour des recommandations cohérentes
        tools:       [RECOMMEND_TOOL],
        toolChoice:  { type: "function", function: { name: "recommend_dishes" } },
      }
    );

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error("Le modèle n'a pas retourné de recommandation structurée");
    }

    const args = JSON.parse(toolCall.function.arguments);

    // Valider que les IDs existent dans le catalogue
    const validIds = new Set(dishes.map((d) => d.id));
    const dish_ids = (args.dish_ids ?? []).filter((id) => validIds.has(id));

    if (dish_ids.length === 0) {
      return res.status(422).json({
        error: "Aucun plat du catalogue ne correspond à ta demande.",
        code: "no_match",
      });
    }

    res.json({
      dish_ids,
      persons:           args.persons           ?? 1,
      split_order:       args.split_order        ?? false,
      budget_per_person: args.budget_per_person  ?? null,
      message:           args.message            ?? "",
    });
  } catch (err) {
    next(err);
  }
});

export default router;

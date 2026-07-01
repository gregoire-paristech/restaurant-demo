import { Router } from "express";
import { getLLMService } from "../services/llmService.js";

const router = Router();

// ─── Validation utilitaire ───────────────────────────────────────────────────

/**
 * Lance une ValidationError si la condition est fausse.
 * @param {boolean} condition
 * @param {string}  message
 */
function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.name = "ValidationError";
    throw err;
  }
}

// ─── POST /api/ai/chat ───────────────────────────────────────────────────────
/**
 * Complétion de chat standard (réponse JSON complète).
 *
 * Body : { messages: ChatMessage[], model?, temperature?, maxTokens? }
 * Réponse : { content: string, usage: {...} }
 */
router.post("/chat", async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens } = req.body;

    assert(Array.isArray(messages) && messages.length > 0, "messages doit être un tableau non vide");
    assert(
      messages.every((m) => m.role && typeof m.content === "string"),
      "Chaque message doit avoir un role et un content string"
    );

    const service = getLLMService();
    const response = await service.chat(messages, { model, temperature, maxTokens });

    res.json({
      content: response.choices[0].message.content,
      usage: response.usage,
      model: response.model,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/ai/chat/stream ────────────────────────────────────────────────
/**
 * Complétion de chat en streaming (Server-Sent Events).
 *
 * Body : { messages: ChatMessage[], model?, temperature?, maxTokens? }
 * Réponse : flux SSE `data: {"delta": "..."}` + `data: [DONE]`
 */
router.post("/chat/stream", async (req, res, next) => {
  try {
    const { messages, model, temperature, maxTokens } = req.body;

    assert(Array.isArray(messages) && messages.length > 0, "messages doit être un tableau non vide");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const service = getLLMService();
    const stream  = await service.chatStream(messages, { model, temperature, maxTokens });

    let usage = null;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      if (chunk.usage) usage = chunk.usage;
    }

    if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    // En SSE on ne peut plus changer le status code — on envoie l'erreur dans le flux
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      next(err);
    }
  }
});

// ─── POST /api/ai/image ──────────────────────────────────────────────────────
/**
 * Génération d'images.
 *
 * Body : { prompt: string, size?, quality?, style?, n? }
 * Réponse : { images: [{ url: string, revisedPrompt?: string }] }
 */
router.post("/image", async (req, res, next) => {
  try {
    const { prompt, size, quality, style, n } = req.body;

    assert(typeof prompt === "string" && prompt.trim().length > 0, "prompt est requis");
    assert(!n || (Number.isInteger(n) && n >= 1 && n <= 10), "n doit être entre 1 et 10");

    const service  = getLLMService();
    const response = await service.generateImage(prompt.trim(), { size, quality, style, n });

    res.json({
      images: response.data.map((img) => ({
        url: img.url,
        revisedPrompt: img.revised_prompt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/ai/embed ──────────────────────────────────────────────────────
/**
 * Calcul d'embeddings.
 *
 * Body : { input: string | string[], model? }
 * Réponse : { embeddings: number[][], dimensions: number }
 */
router.post("/embed", async (req, res, next) => {
  try {
    const { input, model } = req.body;

    assert(
      (typeof input === "string" && input.trim()) ||
        (Array.isArray(input) && input.length > 0 && input.every((s) => typeof s === "string")),
      "input doit être une string ou un tableau de strings"
    );

    const service    = getLLMService();
    const embeddings = await service.embed(input, { model });

    res.json({ embeddings, dimensions: embeddings[0]?.length ?? 0 });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/ai/tools ──────────────────────────────────────────────────────
/**
 * Tool calling : exécute un cycle complet messages → outils → réponse finale.
 *
 * Body : {
 *   messages: ChatMessage[],
 *   tools: ToolDefinition[],
 *   toolResults: { [toolName]: (args) => string }  // non sérialisable → voir note
 * }
 *
 * Note : les fonctions JS ne passent pas en JSON. Ce endpoint attend `toolResults`
 * comme un objet { toolName: resultString } pré-calculé côté client,
 * ou utilise `runToolLoop` directement côté serveur avec des outils internes.
 *
 * Réponse : { content: string }
 */
router.post("/tools", async (req, res, next) => {
  try {
    const { messages, tools, toolResults } = req.body;

    assert(Array.isArray(messages) && messages.length > 0, "messages est requis");
    assert(Array.isArray(tools) && tools.length > 0, "tools est requis");

    const service = getLLMService();

    // Exécuteur d'outil : cherche le résultat dans toolResults fourni par le client
    const result = await service.runToolLoop(
      messages,
      tools,
      async (name, args) => {
        if (toolResults && name in toolResults) return toolResults[name];
        throw new Error(`Outil inconnu : ${name}`);
      }
    );

    res.json({ content: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/ai/models ──────────────────────────────────────────────────────
/**
 * Liste les modèles disponibles (utile pour le debug / la config).
 */
router.get("/models", async (req, res, next) => {
  try {
    const models = await getLLMService().listModels();
    res.json({ models });
  } catch (err) {
    next(err);
  }
});

export default router;

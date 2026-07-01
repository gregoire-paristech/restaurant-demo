import OpenAI from "openai";

/**
 * Délai de base pour les retries (ms) — exponentiel : 1s, 2s, 4s
 * @type {number}
 */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Nombre max de tentatives sur erreur récupérable (429, 500, 503)
 * @type {number}
 */
const MAX_RETRIES = 3;

/**
 * Codes d'erreur OpenAI considérés comme récupérables (retry automatique)
 * @type {Set<number>}
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * @typedef {Object} ChatMessage
 * @property {"system"|"user"|"assistant"} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatOptions
 * @property {string}        [model]       - Modèle à utiliser (défaut : OPENAI_CHAT_MODEL)
 * @property {number}        [temperature] - 0–2, défaut 0.7
 * @property {number}        [maxTokens]   - Limite de tokens en sortie
 * @property {Object[]}      [tools]       - Définitions d'outils pour le tool calling
 * @property {"auto"|"none"} [toolChoice]  - Stratégie de sélection d'outil
 * @property {number}        [timeoutMs]   - Timeout de la requête (défaut : 30 000)
 */

/**
 * @typedef {Object} ImageOptions
 * @property {"1024x1024"|"1792x1024"|"1024x1792"} [size]    - Résolution (défaut : 1024x1024)
 * @property {"vivid"|"natural"}                   [style]   - Style de génération
 * @property {"standard"|"hd"}                     [quality] - Qualité
 * @property {number}                              [n]       - Nombre d'images (1–10)
 */

/**
 * @typedef {Object} EmbeddingOptions
 * @property {string} [model]      - Modèle d'embedding (défaut : OPENAI_EMBED_MODEL)
 * @property {"float"|"base64"} [encodingFormat]
 */

class OpenAIService {
  /** @type {OpenAI} */
  #client;

  /** @type {string} */
  #chatModel;

  /** @type {string} */
  #imageModel;

  /** @type {string} */
  #embedModel;

  constructor() {
    // LLM_BASE_URL pointe vers n'importe quel backend compatible OpenAI
    // (Ollama local : http://localhost:11434/v1, Together AI, Groq, etc.)
    const baseURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";

    // Ollama n'exige pas de clé — on utilise "ollama" comme placeholder.
    // Pour les API hébergées (Together AI, Groq…) mettre la vraie clé dans LLM_API_KEY.
    const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "ollama";

    this.#client = new OpenAI({
      baseURL,
      apiKey,
      timeout: parseInt(process.env.LLM_TIMEOUT_MS ?? process.env.OPENAI_TIMEOUT_MS ?? "60000", 10),
      maxRetries: 0,
    });

    this.#chatModel  = process.env.LLM_CHAT_MODEL  ?? "qwen2.5:7b";
    this.#imageModel = process.env.LLM_IMAGE_MODEL ?? "qwen2.5:7b";
    this.#embedModel = process.env.LLM_EMBED_MODEL ?? "nomic-embed-text";
  }

  // ─── Utilitaires internes ───────────────────────────────────────────────────

  /**
   * Exécute `fn` avec retry exponentiel sur les erreurs récupérables.
   * @template T
   * @param {() => Promise<T>} fn
   * @param {number} attempt
   * @returns {Promise<T>}
   */
  async #withRetry(fn, attempt = 0) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      const isRetryable = RETRYABLE_STATUS.has(status);

      if (!isRetryable || attempt >= MAX_RETRIES) {
        throw this.#normalizeError(err);
      }

      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      const jitter = Math.random() * 200;
      console.warn(`[OpenAIService] Retry ${attempt + 1}/${MAX_RETRIES} dans ${Math.round(delay + jitter)}ms (HTTP ${status})`);
      await new Promise((r) => setTimeout(r, delay + jitter));

      return this.#withRetry(fn, attempt + 1);
    }
  }

  /**
   * Normalise les erreurs OpenAI SDK en objets structurés.
   * @param {unknown} err
   * @returns {Error}
   */
  #normalizeError(err) {
    if (err instanceof OpenAI.APIError) {
      const e = new Error(err.message);
      e.name  = "OpenAIError";
      e.status = err.status;
      e.code   = err.code;
      e.type   = err.type;
      return e;
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // ─── Chat / Complétion ──────────────────────────────────────────────────────

  /**
   * Envoie une conversation et retourne la réponse complète.
   * @param {ChatMessage[]} messages
   * @param {ChatOptions}   [opts]
   * @returns {Promise<import("openai").OpenAI.Chat.ChatCompletion>}
   */
  async chat(messages, opts = {}) {
    const {
      model       = this.#chatModel,
      temperature = 0.7,
      maxTokens,
      tools,
      toolChoice,
      timeoutMs,
    } = opts;

    return this.#withRetry(() =>
      this.#client.chat.completions.create(
        {
          model,
          messages,
          temperature,
          ...(maxTokens   && { max_completion_tokens: maxTokens }),
          ...(tools       && { tools }),
          ...(toolChoice  && { tool_choice: toolChoice }),
        },
        { timeout: timeoutMs }
      )
    );
  }

  /**
   * Streaming SSE — retourne un `Stream` itérable asynchrone.
   * Utilisation : `for await (const chunk of service.chatStream(messages)) { ... }`
   * @param {ChatMessage[]} messages
   * @param {ChatOptions}   [opts]
   * @returns {Promise<import("openai").Stream<import("openai").OpenAI.Chat.ChatCompletionChunk>>}
   */
  async chatStream(messages, opts = {}) {
    const { model = this.#chatModel, temperature = 0.7, maxTokens, tools, toolChoice } = opts;

    return this.#client.chat.completions.create({
      model,
      messages,
      temperature,
      stream: true,
      ...(maxTokens  && { max_completion_tokens: maxTokens }),
      ...(tools      && { tools }),
      ...(toolChoice && { tool_choice: toolChoice }),
    });
  }

  // ─── Génération d'images ────────────────────────────────────────────────────

  /**
   * Génère une ou plusieurs images à partir d'un prompt.
   * @param {string}       prompt
   * @param {ImageOptions} [opts]
   * @returns {Promise<import("openai").OpenAI.Images.ImagesResponse>}
   */
  async generateImage(prompt, opts = {}) {
    const {
      size    = "1024x1024",
      quality = "standard",
      style   = "vivid",
      n       = 1,
    } = opts;

    return this.#withRetry(() =>
      this.#client.images.generate({
        model: this.#imageModel,
        prompt,
        size,
        quality,
        style,
        n,
        response_format: "url",
      })
    );
  }

  // ─── Embeddings ─────────────────────────────────────────────────────────────

  /**
   * Calcule les embeddings d'un ou plusieurs textes.
   * @param {string|string[]} input
   * @param {EmbeddingOptions} [opts]
   * @returns {Promise<number[][]>} Vecteurs d'embeddings
   */
  async embed(input, opts = {}) {
    const { model = this.#embedModel, encodingFormat = "float" } = opts;

    const response = await this.#withRetry(() =>
      this.#client.embeddings.create({
        model,
        input: Array.isArray(input) ? input : [input],
        encoding_format: encodingFormat,
      })
    );

    return response.data.map((d) => d.embedding);
  }

  /**
   * Calcule la similarité cosinus entre deux vecteurs.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} Score entre -1 et 1
   */
  static cosineSimilarity(a, b) {
    const dot  = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
    return dot / (magA * magB);
  }

  // ─── Tool calling helpers ───────────────────────────────────────────────────

  /**
   * Exécute un cycle complet de tool calling :
   * 1. Premier appel → le modèle choisit un outil
   * 2. Tu fournis les résultats des outils
   * 3. Appel final → réponse finale
   *
   * @param {ChatMessage[]} messages
   * @param {Object[]}      tools         - Définitions d'outils (JSON Schema)
   * @param {Function}      toolExecutor  - (name, args) => Promise<string>
   * @param {ChatOptions}   [opts]
   * @returns {Promise<string>} Réponse textuelle finale
   */
  async runToolLoop(messages, tools, toolExecutor, opts = {}) {
    const history = [...messages];

    while (true) {
      const response = await this.chat(history, { ...opts, tools, toolChoice: "auto" });
      const choice = response.choices[0];

      // Le modèle a terminé sans appeler d'outil
      if (choice.finish_reason === "stop") {
        return choice.message.content ?? "";
      }

      // Le modèle veut appeler des outils
      if (choice.finish_reason === "tool_calls") {
        history.push(choice.message);

        const toolResults = await Promise.all(
          choice.message.tool_calls.map(async (tc) => {
            const args = JSON.parse(tc.function.arguments);
            const result = await toolExecutor(tc.function.name, args);
            return {
              role: "tool",
              tool_call_id: tc.id,
              content: typeof result === "string" ? result : JSON.stringify(result),
            };
          })
        );

        history.push(...toolResults);
        continue;
      }

      // Cas inattendu
      throw new Error(`finish_reason inattendu : ${choice.finish_reason}`);
    }
  }

  // ─── Santé / modèles disponibles ────────────────────────────────────────────

  /**
   * Vérifie que la clé API est valide et retourne les modèles actifs.
   * @returns {Promise<string[]>}
   */
  async listModels() {
    const response = await this.#client.models.list();
    return response.data.map((m) => m.id).sort();
  }
}

// Singleton — une seule instance partagée dans le process serveur
let _instance = null;

/**
 * Retourne le singleton OpenAIService.
 * @returns {OpenAIService}
 */
export function getOpenAIService() {
  if (!_instance) _instance = new OpenAIService();
  return _instance;
}

export default OpenAIService;

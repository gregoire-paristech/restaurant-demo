import OpenAI from "openai"; // client HTTP compatible avec tout backend OpenAI-like

const RETRY_BASE_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * @typedef {Object} ChatMessage
 * @property {"system"|"user"|"assistant"} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatOptions
 * @property {string}        [model]
 * @property {number}        [temperature]
 * @property {number}        [maxTokens]
 * @property {Object[]}      [tools]
 * @property {string|Object} [toolChoice]
 * @property {number}        [timeoutMs]
 */

class LLMService {
  #client;
  #chatModel;
  #embedModel;

  constructor() {
    const baseURL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
    const apiKey  = process.env.LLM_API_KEY  ?? "ollama";

    this.#client = new OpenAI({
      baseURL,
      apiKey,
      timeout:    parseInt(process.env.LLM_TIMEOUT_MS ?? "60000", 10),
      maxRetries: 0,
    });

    this.#chatModel  = process.env.LLM_CHAT_MODEL  ?? "qwen2.5:7b";
    this.#embedModel = process.env.LLM_EMBED_MODEL ?? "nomic-embed-text";
  }

  async #withRetry(fn, attempt = 0) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      if (!RETRYABLE_STATUS.has(status) || attempt >= MAX_RETRIES) {
        throw this.#normalizeError(err);
      }
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 200;
      console.warn(`[LLM] Retry ${attempt + 1}/${MAX_RETRIES} dans ${Math.round(delay)}ms (HTTP ${status})`);
      await new Promise((r) => setTimeout(r, delay));
      return this.#withRetry(fn, attempt + 1);
    }
  }

  #normalizeError(err) {
    if (err instanceof OpenAI.APIError) {
      const e    = new Error(err.message);
      e.name     = "LLMError";
      e.status   = err.status;
      e.code     = err.code;
      e.type     = err.type;
      return e;
    }
    return err instanceof Error ? err : new Error(String(err));
  }

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
          ...(maxTokens  && { max_completion_tokens: maxTokens }),
          ...(tools      && { tools }),
          ...(toolChoice && { tool_choice: toolChoice }),
        },
        timeoutMs != null ? { timeout: timeoutMs } : undefined
      )
    );
  }

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

  static cosineSimilarity(a, b) {
    const dot  = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
    return dot / (magA * magB);
  }

  async listModels() {
    const response = await this.#client.models.list();
    return response.data.map((m) => m.id).sort();
  }
}

let _instance = null;

export function getLLMService() {
  if (!_instance) _instance = new LLMService();
  return _instance;
}

export default LLMService;

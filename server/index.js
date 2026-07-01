import "dotenv/config";
import express from "express";
import cors from "cors";
import aiRoutes from "./routes/ai.js";
import conciergeRoutes from "./routes/concierge.js";
import { errorHandler } from "./middleware/errorHandler.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const isDev = process.env.NODE_ENV !== "production";

const app = express();

// ─── Middleware globaux ──────────────────────────────────────────────────────

app.use(
  cors({
    origin: isDev
      ? ["http://localhost:5173", "http://localhost:4173"]
      : process.env.ALLOWED_ORIGIN?.split(",") ?? [],
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "1mb" }));

// Log minimaliste en dev
if (isDev) {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/api/ai", aiRoutes);
app.use("/api/concierge", conciergeRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// 404 sur les routes inconnues
app.use((_req, res) => {
  res.status(404).json({ error: "Route inconnue." });
});

// ─── Gestion d'erreurs (toujours en dernier) ─────────────────────────────────

app.use(errorHandler);

// ─── Démarrage ───────────────────────────────────────────────────────────────

// En mode serverless (Vercel), on n'écoute pas sur un port — l'app est exportée directement
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Server] ✓ Express démarré sur http://localhost:${PORT}`);
    console.log(`[Server] Backend LLM  : ${process.env.LLM_BASE_URL ?? "http://localhost:11434/v1"}`);
    console.log(`[Server] Modèle chat  : ${process.env.LLM_CHAT_MODEL  ?? "qwen2.5:7b"}`);
    console.log(`[Server] Modèle embed : ${process.env.LLM_EMBED_MODEL ?? "nomic-embed-text"}`);
  });
}

export default app;

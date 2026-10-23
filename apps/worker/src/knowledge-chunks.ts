import { createHash } from "node:crypto";
import type { KnowledgeDocument } from "./knowledge-loaders.ts";

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export function knowledgeContentHash(documents: KnowledgeDocument[]) {
  return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
}

function validateChunkSizes(maxChars: number, overlapChars: number) {
  if (
    !(Number.isInteger(maxChars) && Number.isInteger(overlapChars)) ||
    maxChars < 1 ||
    overlapChars < 0 ||
    overlapChars >= maxChars
  ) {
    throw new Error("Chunk sizes must be integers with 0 <= overlap < maxChars");
  }
}

export function chunkKnowledge(documents: KnowledgeDocument[], options: ChunkOptions = {}) {
  const maxChars = options.maxChars ?? 1600;
  const overlapChars = options.overlapChars ?? 240;
  validateChunkSizes(maxChars, overlapChars);
  const chunks: { content: string; metadata: Record<string, unknown>; seq: number }[] = [];
  for (const document of documents) {
    const text = document.text.replace(/\r\n?/g, "\n").trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + Math.max(overlapChars, maxChars * 0.6)) {
          end = boundary;
        }
      }
      const content = text.slice(start, end).trim();
      if (content) {
        chunks.push({
          content,
          metadata: { ...document.metadata, charEnd: end, charStart: start },
          seq: chunks.length,
        });
      }
      if (end === text.length) {
        break;
      }
      start = end - overlapChars;
    }
  }
  return chunks;
}

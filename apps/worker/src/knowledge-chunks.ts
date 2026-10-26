import { createHash } from "node:crypto";
import type { KnowledgeDocument } from "./knowledge-loaders.ts";

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export const DEFAULT_CHUNK_OPTIONS = { maxChars: 1600, overlapChars: 240 } as const;

export function knowledgeContentHash(
  documents: KnowledgeDocument[],
  embeddingModel: string,
  options: ChunkOptions = {}
) {
  const sizes = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  return createHash("sha256")
    .update(JSON.stringify({ documents, embeddingModel, sizes }))
    .digest("hex");
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

function splitsSurrogatePair(text: string, index: number) {
  const low = text.charCodeAt(index);
  const high = text.charCodeAt(index - 1);
  return low >= 0xdc_00 && low <= 0xdf_ff && high >= 0xd8_00 && high <= 0xdb_ff;
}

function alignToCodePoint(text: string, index: number, floor: number) {
  if (index <= floor || index >= text.length || !splitsSurrogatePair(text, index)) {
    return index;
  }
  return index - 1 > floor ? index - 1 : index + 1;
}

export function chunkKnowledge(documents: KnowledgeDocument[], options: ChunkOptions = {}) {
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_OPTIONS.maxChars;
  const overlapChars = options.overlapChars ?? DEFAULT_CHUNK_OPTIONS.overlapChars;
  validateChunkSizes(maxChars, overlapChars);
  const chunks: { content: string; metadata: Record<string, unknown>; seq: number }[] = [];
  for (const document of documents) {
    const text = document.text.normalize("NFC").replace(/\r\n?/g, "\n").trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + Math.max(overlapChars, maxChars * 0.6)) {
          end = boundary;
        }
      }
      end = alignToCodePoint(text, end, start);
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
      start = alignToCodePoint(text, end - overlapChars, start);
    }
  }
  return chunks;
}

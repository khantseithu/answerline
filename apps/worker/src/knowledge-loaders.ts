import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { knowledgeSources } from "@answerline/db";
import { questionAnswerPairs } from "@answerline/shared";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { fetchKnowledgePage } from "./knowledge-url.ts";

export interface KnowledgeDocument {
  metadata: Record<string, unknown>;
  text: string;
}

type Source = typeof knowledgeSources.$inferSelect;

export interface LoaderOptions {
  fetchPage?: typeof fetchKnowledgePage;
  filesDir?: string;
}

const requiredText = z.string().trim().min(1);
const MAX_BYTES = 20 * 1024 * 1024;

async function resolveExisting(path: string, missing: string) {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(missing, { cause: error });
    }
    throw error;
  }
}

async function readSourceFile(uri: string, tenantId: string, filesDir: string | undefined) {
  if (!filesDir) {
    throw new Error("KNOWLEDGE_FILES_DIR is not configured");
  }
  const requested = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
  if (!isAbsolute(requested)) {
    throw new Error("Knowledge file paths must be absolute");
  }
  const tenantDir = await resolveExisting(
    join(filesDir, tenantId),
    "Knowledge files directory for this tenant does not exist"
  );
  const path = await resolveExisting(requested, "Knowledge file not found");
  const inside = relative(tenantDir, path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error("Knowledge file must be inside the tenant knowledge files directory");
  }
  if ((await stat(path)).size > MAX_BYTES) {
    throw new Error("Knowledge file exceeds 20 MiB");
  }
  const data = await readFile(path);
  if (data.length > MAX_BYTES) {
    throw new Error("Knowledge file exceeds 20 MiB");
  }
  return { data, path };
}

export async function loadKnowledgeSource(
  source: Source,
  options: LoaderOptions = {}
): Promise<KnowledgeDocument[]> {
  const metadata = { sourceId: source.id, title: source.title, type: source.type, uri: source.uri };
  switch (source.type) {
    case "text":
      return [{ metadata, text: requiredText.parse(source.content) }];
    case "qa":
      return questionAnswerPairs.parse(source.content).map((pair, qaIndex) => ({
        metadata: { ...metadata, qaIndex, question: pair.question },
        text: `Question: ${pair.question}\nAnswer: ${pair.answer}`,
      }));
    case "url": {
      const page = await (options.fetchPage ?? fetchKnowledgePage)(requiredText.parse(source.uri));
      if (page.contentType.toLowerCase().startsWith("text/plain")) {
        return [{ metadata: { ...metadata, uri: page.uri }, text: requiredText.parse(page.body) }];
      }
      const dom = new JSDOM(page.body, { url: page.uri });
      try {
        const article = new Readability(dom.window.document).parse();
        return [
          {
            metadata: { ...metadata, title: source.title ?? article?.title, uri: page.uri },
            text: requiredText.parse(article?.textContent),
          },
        ];
      } finally {
        dom.window.close();
      }
    }
    case "file": {
      const { data, path } = await readSourceFile(
        requiredText.parse(source.uri),
        source.tenantId,
        options.filesDir
      );
      const extension = extname(path).toLowerCase();
      if ([".txt", ".md", ".markdown"].includes(extension)) {
        return [{ metadata, text: requiredText.parse(data.toString("utf8")) }];
      }
      if (extension !== ".pdf") {
        throw new Error("Knowledge files must be PDF, plain text or Markdown");
      }
      const parser = new PDFParse({ data });
      try {
        const result = await parser.getText();
        const documents = result.pages
          .filter((page) => page.text.trim())
          .map((page) => ({ metadata: { ...metadata, page: page.num }, text: page.text.trim() }));
        if (!documents.length) {
          throw new Error("PDF contains no extractable text (OCR is not supported)");
        }
        return documents;
      } finally {
        await parser.destroy();
      }
    }
    default:
      throw new Error("Unsupported knowledge source type");
  }
}

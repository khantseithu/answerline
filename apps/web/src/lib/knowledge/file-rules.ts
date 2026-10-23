export const MAX_KNOWLEDGE_FILE_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_FILE_EXTENSIONS = [".pdf", ".txt", ".md", ".markdown"] as const;

export function knowledgeFileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return KNOWLEDGE_FILE_EXTENSIONS.find((allowed) => allowed === extension);
}

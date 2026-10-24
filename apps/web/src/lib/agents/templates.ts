import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { agentTemplateSchema, parseAgentConfig, templateSlugSchema } from "@answerline/shared";

export async function listAgentTemplates() {
  const directory = resolve(process.cwd(), "../../agents");
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith(".yaml"));
  const templates = await Promise.all(
    filenames.map(async (filename) => {
      const slug = templateSlugSchema.parse(filename.slice(0, -".yaml".length));
      const source = await readFile(resolve(directory, filename), "utf8");
      return agentTemplateSchema.parse({ config: parseAgentConfig(source), slug });
    })
  );
  return templates.sort((a, b) => a.config.name.localeCompare(b.config.name));
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchKnowledgeSources } from "@/lib/knowledge/client";
import { isInFlight, type KnowledgeSourceView } from "@/lib/knowledge/types";
import { AddSource } from "./add-source";
import { SourceList } from "./source-list";

const POLL_INTERVAL_MS = 2000;

export function KnowledgeManager({
  initialSources,
  readOnly = false,
}: {
  initialSources: KnowledgeSourceView[];
  readOnly?: boolean;
}) {
  const [sources, setSources] = useState(initialSources);
  const inFlight = sources.some((source) => isInFlight(source.status));

  const refresh = useCallback(async () => {
    const next = await fetchKnowledgeSources().catch(() => null);
    if (next) {
      setSources(next);
    }
  }, []);

  useEffect(() => {
    if (!inFlight) {
      return;
    }
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  return (
    <div className="flex flex-col gap-8">
      {readOnly ? null : <AddSource onChange={refresh} />}
      <SourceList onChange={refresh} readOnly={readOnly} sources={sources} />
    </div>
  );
}

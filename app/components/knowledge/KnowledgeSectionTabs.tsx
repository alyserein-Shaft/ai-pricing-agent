"use client";

import { KNOWLEDGE_SECTIONS } from "../../domain/knowledge-section-model.mjs";

// Target Knowledge IA tab bar. Presentational only: it reports selection upward
// and never mutates backend state, so it can be mounted beside (not inside)
// the existing section switcher during migration.
export function KnowledgeSectionTabs({ active, counts, onSelect }: {
  active: string;
  counts?: Record<string, number>;
  onSelect: (section: string) => void;
}) {
  return <nav className="knowledge-section-tabs" aria-label="Knowledge sections">
    {KNOWLEDGE_SECTIONS.map((section) => (
      <button
        key={section}
        type="button"
        aria-current={active === section ? "page" : undefined}
        className={active === section ? "selected" : ""}
        onClick={() => onSelect(section)}
      >
        {section}
        {counts != null && counts[section] != null && <small>{counts[section]}</small>}
      </button>
    ))}
  </nav>;
}

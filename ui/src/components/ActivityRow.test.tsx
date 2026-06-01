// @vitest-environment jsdom

import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "@paperclipai/shared";
import { ActivityRow } from "./ActivityRow";
import { JYLHIS_DESIGN_CONTRACT_VERSION } from "../lib/jylhis-design";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("./IssueReferenceActivitySummary", () => ({
  IssueReferenceActivitySummary: () => <div data-testid="activity-summary">summary</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReactNode, container: HTMLDivElement) {
  const root = createRoot(container);
  flushSync(() => {
    root.render(node);
  });
  return root;
}

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "activity-1",
    createdAt: "2026-06-01T12:00:00.000Z",
    actorId: "agent-1",
    actorType: "agent",
    action: "updated",
    entityId: "issue-1",
    entityType: "issue",
    details: {
      identifier: "JYL-49",
      issueTitle: "Integrate design tokens",
    },
    ...overrides,
  } as ActivityEvent;
}

describe("ActivityRow", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("marks link-backed activity rows with the vendored design contract", () => {
    const root = render(
      <ActivityRow
        event={makeEvent()}
        agentMap={new Map([["agent-1", { id: "agent-1", name: "CodexEngineer" }]])}
        entityNameMap={new Map([["issue:issue-1", "JYL-49"]])}
        entityTitleMap={new Map([["issue:issue-1", "Integrate design tokens"]])}
      />,
      container,
    );

    const row = container.querySelector('a[href="/issues/JYL-49"]');
    expect(row?.getAttribute("data-jylhis-design-contract")).toBe(JYLHIS_DESIGN_CONTRACT_VERSION);
    expect(row?.className).toContain("jylhis-activity-row");

    flushSync(() => {
      root.unmount();
    });
  });
});

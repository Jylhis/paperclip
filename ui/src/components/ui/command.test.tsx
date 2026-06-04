// @vitest-environment jsdom

import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandKeycap, CommandList } from "./command";
import { JYLHIS_DESIGN_CONTRACT_VERSION } from "@/lib/jylhis-design";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView ??= () => {};

function render(node: ReactNode, container: HTMLDivElement) {
  const root = createRoot(container);
  flushSync(() => {
    root.render(node);
  });
  return root;
}

describe("command primitives", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("applies tokenized keycap classes", () => {
    const root = render(<CommandKeycap>↵</CommandKeycap>, container);

    const keycap = container.querySelector('[data-slot="command-keycap"]');
    expect(keycap?.className).toContain("border-[var(--command-keycap-border)]");
    expect(keycap?.className).toContain("bg-[var(--command-keycap-bg)]");
    expect(keycap?.className).toContain("font-mono");

    flushSync(() => {
      root.unmount();
    });
  });

  it("applies tokenized selection and focus-visible classes to command items", () => {
    const root = render(
      <Command>
        <CommandInput value="" onValueChange={() => {}} />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem>Open command palette</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
      container,
    );

    const command = container.querySelector('[data-slot="command"]');
    const item = container.querySelector('[data-slot="command-item"]');
    expect(command?.getAttribute("data-jylhis-design-contract")).toBe(JYLHIS_DESIGN_CONTRACT_VERSION);
    expect(item?.getAttribute("data-jylhis-design-contract")).toBe(JYLHIS_DESIGN_CONTRACT_VERSION);
    expect(item?.className).toContain("jylhis-command-item");
    expect(item?.className).toContain("focus-visible:ring-[3px]");
    expect(item?.className).toContain("data-[selected=true]:bg-[var(--command-item-selected-bg)]");
    expect(item?.className).toContain("data-[selected=true]:border-[var(--command-item-selected-border)]");
    expect(item?.className).toContain("motion-reduce:transition-none");

    flushSync(() => {
      root.unmount();
    });
  });
});

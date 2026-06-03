import { describe, expect, it } from "vitest";
import { describeToolInput, summarizeToolInput } from "./transcriptPresentation";

describe("summarizeToolInput", () => {
  it("prefers raw commands for command tools when both command and intent exist", () => {
    expect(
      summarizeToolInput("command_execution", {
        description: "Inspect the issue chat thread layout classes",
        command: "zsh -lc 'sed -n \"1,220p\" ui/src/components/IssueChatThread.tsx'",
      }),
    ).toBe('sed -n "1,220p" ui/src/components/IssueChatThread.tsx');
  });
});

describe("describeToolInput", () => {
  it("always includes command details for command tools", () => {
    expect(
      describeToolInput("command_execution", {
        description: "Inspect the issue chat thread layout classes",
        command: "zsh -lc 'sed -n \"1,220p\" ui/src/components/IssueChatThread.tsx'",
        cwd: "/workspace/paperclip",
      }),
    ).toEqual([
      { label: "Intent", value: "Inspect the issue chat thread layout classes", tone: "default" },
      { label: "Directory", value: "/workspace/paperclip", tone: "default" },
      { label: "Command", value: 'sed -n "1,220p" ui/src/components/IssueChatThread.tsx', tone: "code" },
    ]);
  });

  it("surfaces concise structured details for file tools", () => {
    expect(
      describeToolInput("read_file", {
        path: "ui/src/lib/issue-chat-messages.ts",
      }),
    ).toEqual([
      { label: "Path", value: "ui/src/lib/issue-chat-messages.ts", tone: "default" },
    ]);
  });
});

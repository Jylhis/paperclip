import { describe, expect, it } from "vitest";
import { resolveSafeChatImageOpenUrl } from "./chatImageUrl";

const BASE_URL = "https://paperclip.example.test/issues/PAP-1";

describe("resolveSafeChatImageOpenUrl", () => {
  it("rejects dangerous and non-web URL schemes", () => {
    expect(resolveSafeChatImageOpenUrl("javascript:alert(document.cookie)", BASE_URL)).toBeNull();
    expect(resolveSafeChatImageOpenUrl("data:image/svg+xml,<svg onload=alert(1)>", BASE_URL)).toBeNull();
    expect(resolveSafeChatImageOpenUrl("file:///etc/passwd", BASE_URL)).toBeNull();
    expect(resolveSafeChatImageOpenUrl("http://[", BASE_URL)).toBeNull();
  });

  it("allows external HTTP and HTTPS URLs", () => {
    expect(resolveSafeChatImageOpenUrl("https://images.example.test/pic.png", BASE_URL)).toBe(
      "https://images.example.test/pic.png",
    );
    expect(resolveSafeChatImageOpenUrl("http://images.example.test/pic.png", BASE_URL)).toBe(
      "http://images.example.test/pic.png",
    );
  });

  it("allows same-origin Paperclip image content URLs", () => {
    expect(resolveSafeChatImageOpenUrl("/api/assets/asset-1/content", BASE_URL)).toBe(
      "https://paperclip.example.test/api/assets/asset-1/content",
    );
    expect(resolveSafeChatImageOpenUrl("/api/attachments/attachment-1/content?download=1#preview", BASE_URL)).toBe(
      "https://paperclip.example.test/api/attachments/attachment-1/content?download=1#preview",
    );
  });

  it("rejects same-origin non-asset paths", () => {
    expect(resolveSafeChatImageOpenUrl("/issues/PAP-2", BASE_URL)).toBeNull();
    expect(resolveSafeChatImageOpenUrl("/api/companies", BASE_URL)).toBeNull();
    expect(resolveSafeChatImageOpenUrl("https://paperclip.example.test/settings", BASE_URL)).toBeNull();
  });
});

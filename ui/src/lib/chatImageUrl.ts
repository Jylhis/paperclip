const PAPERCLIP_IMAGE_CONTENT_PATH_PATTERN = /^\/api\/(?:assets|attachments)\/[^/?#]+\/content\/?$/;

function defaultChatImageBaseHref(): string {
  return typeof window !== "undefined" ? window.location.href : "http://localhost/";
}

export function resolveSafeChatImageOpenUrl(src: string, baseHref = defaultChatImageBaseHref()): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;

  let baseUrl: URL;
  let url: URL;
  try {
    baseUrl = new URL(baseHref);
    url = new URL(trimmed, baseUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (url.origin === baseUrl.origin && !PAPERCLIP_IMAGE_CONTENT_PATH_PATTERN.test(url.pathname)) {
    return null;
  }

  return url.href;
}

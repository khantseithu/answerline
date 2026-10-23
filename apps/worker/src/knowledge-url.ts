import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/i;
const IPV6_BRACKETS = /^\[|\]$/g;

export function assertPublicAddress(address: string) {
  if (ipaddr.process(address).range() !== "unicast") {
    throw new Error("Knowledge URLs must resolve to public IP addresses");
  }
}

function requestPage(url: URL, address: { address: string; family: number }, signal: AbortSignal) {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<{ body: string; contentType?: string; location?: string; status: number }>(
    (resolve, reject) => {
      const req = request(
        url,
        {
          family: address.family,
          headers: { accept: "text/html,text/plain", "user-agent": "Answerline/0.1" },
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          signal,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.destroy();
            resolve({ body: "", location: response.headers.location, status });
            return;
          }
          if (status < 200 || status >= 300) {
            response.destroy();
            reject(new Error(`Knowledge URL returned HTTP ${status}`));
            return;
          }
          const contentType = response.headers["content-type"] ?? "";
          if (!ALLOWED_CONTENT_TYPE.test(contentType)) {
            response.destroy();
            reject(new Error("Knowledge URL must return HTML or plain text"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_BYTES) {
              req.destroy(new Error("Knowledge URL exceeds 10 MiB"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({ body: Buffer.concat(chunks).toString("utf8"), contentType, status })
          );
        }
      );
      req.on("error", reject);
      req.end();
    }
  );
}

export async function fetchKnowledgePage(
  uri: string,
  redirects = 0,
  signal = AbortSignal.timeout(15_000)
): Promise<{ body: string; contentType: string; uri: string }> {
  const url = new URL(uri);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Knowledge URL must be HTTP(S) without credentials");
  }
  if (redirects > 4) {
    throw new Error("Knowledge URL exceeded redirect limit");
  }
  const hostname = url.hostname.replace(IPV6_BRACKETS, "");
  const addresses = await lookup(hostname, { all: true });
  for (const address of addresses) {
    assertPublicAddress(address.address);
  }
  const [address] = addresses;
  if (!address) {
    throw new Error("Knowledge URL has no IP address");
  }
  signal.throwIfAborted();
  const response = await requestPage(url, address, signal);
  if (response.status >= 300 && response.status < 400) {
    if (!response.location) {
      throw new Error("Knowledge URL redirect has no location");
    }
    return fetchKnowledgePage(new URL(response.location, url).href, redirects + 1, signal);
  }
  return { body: response.body, contentType: response.contentType ?? "", uri: url.href };
}

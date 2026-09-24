/** Offline SDK boundary: forwards synthetic fixtures to the test's fetch mock only. */
export class MockImageAnnotatorClient {
  static lastOptions: { apiKey: string; fallback: boolean };
  static lastCallOptions: { timeout: number; retry: null };
  constructor(public options: { apiKey: string; fallback: boolean }) { MockImageAnnotatorClient.lastOptions = options; }
  close() { return Promise.resolve(); }
  initialize() { return Promise.resolve({}); }
  batchAnnotateImages(body: unknown, options: { timeout: number; retry: null }) {
    MockImageAnnotatorClient.lastCallOptions = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout);
    const pending = fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST", body: JSON.stringify(body), signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw Object.assign(new Error(`Synthetic upstream ${response.status}`), { httpStatusCode: response.status, code: 14 });
      try { return [await response.json(), body, {}]; }
      catch { throw new Error("Synthetic malformed provider JSON"); }
    }).finally(() => clearTimeout(timer));
    Object.assign(pending, { cancel: () => controller.abort(), callOptions: options });
    return pending;
  }
}

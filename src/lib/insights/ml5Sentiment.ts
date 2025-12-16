/*
  Client-side ml5 sentiment wrapper.
  - Loads the movieReviews sentiment model once.
  - Provides a simple score (0..1).

  Note: ml5's movieReviews model is English-centric, but we use it for instant UI feedback.
*/

export type Ml5SentimentModel = {
  predict: (text: string) => { score: number };
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

let modelPromise: Promise<Ml5SentimentModel> | null = null;

export async function getMl5SentimentModel(): Promise<Ml5SentimentModel> {
  if (typeof window === "undefined") {
    throw new Error("ml5 sentiment model can only be loaded in the browser");
  }

  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    const mod = (await import("ml5")) as unknown;

    const ml5Maybe = mod as {
      default?: {
        sentiment?: (name: string, cb: (model: Ml5SentimentModel) => void) => void;
      };
      sentiment?: (name: string, cb: (model: Ml5SentimentModel) => void) => void;
    };

    const ml5 = ml5Maybe.default ?? ml5Maybe;
    const sentimentFn = ml5?.sentiment;
    if (typeof sentimentFn !== "function") {
      throw new Error("ml5.sentiment is not available");
    }

    return await new Promise<Ml5SentimentModel>((resolve, reject) => {
      try {
        sentimentFn("movieReviews", (m: Ml5SentimentModel) => resolve(m));
      } catch (e) {
        reject(e);
      }
    });
  })();

  return modelPromise;
}

export async function ml5SentimentScore(text: string): Promise<number> {
  const model = await getMl5SentimentModel();
  const result = model.predict(text);
  const score = typeof result?.score === "number" ? result.score : 0.5;
  return clamp(score, 0, 1);
}

interface Bucket {
  all: number[];
  heavy: number[];
}

export class ChatRateLimiter {
  private readonly allLimitPerHour: number;
  private readonly heavyLimitPer10Min: number;
  private readonly buckets = new Map<number, Bucket>();

  constructor(allLimitPerHour: number, heavyLimitPer10Min: number) {
    this.allLimitPerHour = allLimitPerHour;
    this.heavyLimitPer10Min = heavyLimitPer10Min;
  }

  allow(chatId: number, isHeavy: boolean): { ok: true } | { ok: false; reason: string } {
    const now = Date.now();
    const bucket = this.buckets.get(chatId) ?? { all: [], heavy: [] };

    bucket.all = bucket.all.filter((ts) => now - ts <= 60 * 60 * 1000);
    bucket.heavy = bucket.heavy.filter((ts) => now - ts <= 10 * 60 * 1000);

    if (bucket.all.length >= this.allLimitPerHour) {
      this.buckets.set(chatId, bucket);
      return { ok: false, reason: "Лимит запросов: максимум в час исчерпан." };
    }

    if (isHeavy && bucket.heavy.length >= this.heavyLimitPer10Min) {
      this.buckets.set(chatId, bucket);
      return { ok: false, reason: "Лимит тяжёлых команд: попробуйте через несколько минут." };
    }

    bucket.all.push(now);
    if (isHeavy) {
      bucket.heavy.push(now);
    }

    this.buckets.set(chatId, bucket);
    return { ok: true };
  }
}

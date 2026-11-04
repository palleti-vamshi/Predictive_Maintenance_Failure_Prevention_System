/**
 * Lightweight, zero-dependency in-memory sliding window rate limiter.
 * Enforces rate limiting on sensitive authentication and resource-intensive endpoints.
 */
export function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 100,
  message = 'Too many requests from this IP address. Please try again later.',
  keyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || 'default'
} = {}) {
  const store = new Map();

  // Periodic garbage collection of expired tracking entries every 60s
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetTime) {
        store.delete(key);
      }
    }
  }, 60 * 1000);
  if (timer.unref) {
    timer.unref();
  }

  return (req, res, next) => {
    // Skip in automated test environment unless explicitly testing rate limits
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > max) {
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: 'TooManyRequests',
        message,
        retryAfterSeconds: retryAfterSec
      });
    }

    next();
  };
}

// 1. Auth Login Rate Limiter: max 20 login attempts per 15 minutes per IP
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please wait 15 minutes before trying again.'
});

// 2. OTP / Password Recovery Limiter: max 5 attempts per 15 minutes per IP
export const otpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many recovery attempts. Please try again later.'
});

// 3. Dataset Upload Rate Limiter: max 30 uploads per 15 minutes per IP
export const uploadRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Dataset upload rate limit exceeded. Please wait a few minutes before uploading additional files.'
});

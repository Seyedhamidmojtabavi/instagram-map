import { randomUUID } from "node:crypto";

// The Android app's public identifiers. Requests made with an app bearer token
// must look like the app or Instagram rejects them as an unknown client.
const APP_USER_AGENT =
  "Instagram 361.0.0.46.88 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; en_US; 674675155)";
const APP_ID = "567067343352427";

export class InstagramError extends Error {
  constructor(message, { kind = "unknown", status = null } = {}) {
    super(message);
    this.name = "InstagramError";
    this.kind = kind; // "auth" | "rate-limit" | "challenge" | "restricted" | "not-found" | "unknown"
    this.status = status;
  }
}

/** Reads the account id out of an "IGT:2:<base64 json>" bearer token or a sessionid cookie. */
export function ownerIdFromCredentials({ authorization, sessionId }) {
  if (authorization) {
    const match = authorization.match(/IGT:2:([A-Za-z0-9+/=_-]+)/);
    if (match) {
      try {
        const payload = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
        if (payload.ds_user_id) return String(payload.ds_user_id);
        if (payload.sessionid) return decodeURIComponent(payload.sessionid).split(":")[0];
      } catch {
        // Fall through to the session cookie.
      }
    }
  }
  if (sessionId) {
    const id = decodeURIComponent(sessionId).split(":")[0];
    if (/^\d+$/.test(id)) return id;
  }
  return null;
}

function isUsableAuthorization(value) {
  const match = value?.match(/IGT:2:([A-Za-z0-9+/=_-]+)/);
  if (!match) return false;
  try {
    const payload = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    return Boolean(payload.sessionid);
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function classifyFailure(status, body) {
  const message = String(body?.message ?? "");
  if (status === 429 || /please wait a few minutes|feedback_required|spam/i.test(message)) {
    return new InstagramError(`Instagram rate limit: ${message || `HTTP ${status}`}`, { kind: "rate-limit", status });
  }
  if (/checkpoint|challenge/i.test(message) || body?.checkpoint_url || body?.challenge) {
    return new InstagramError(
      "Instagram wants the account to confirm a security check. Open the app, approve the login, then sync again.",
      { kind: "challenge", status },
    );
  }
  if (status === 401 || status === 403 || /login_required|user_has_logged_out|invalid.*(token|session)/i.test(message)) {
    return new InstagramError(
      "The Instagram session is no longer valid. Copy a fresh IG_AUTHORIZATION token and update the service variable.",
      { kind: "auth", status },
    );
  }
  if (status === 404 || /user not found/i.test(message)) {
    return new InstagramError(`Not found: ${message || status}`, { kind: "not-found", status });
  }
  return new InstagramError(`Instagram request failed: ${message || `HTTP ${status}`}`, { status });
}

export function createInstagramClient({
  authorization = "",
  sessionId = "",
  baseUrl = "https://i.instagram.com",
  requestDelayMs = 2_500,
  onAuthorizationRefresh,
  fetchImpl = fetch,
} = {}) {
  if (!authorization && !sessionId) {
    throw new InstagramError(
      "No Instagram credentials. Set IG_AUTHORIZATION (app bearer token) or IG_SESSIONID.",
      { kind: "auth" },
    );
  }
  let currentAuthorization = authorization;
  const ownerId = ownerIdFromCredentials({ authorization, sessionId });
  const deviceId = randomUUID();
  let lastRequestAt = 0;
  let requestCount = 0;

  async function request(path, { attempt = 0 } = {}) {
    const wait = lastRequestAt + requestDelayMs * (0.7 + Math.random() * 0.6) - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    requestCount += 1;

    const headers = {
      "User-Agent": APP_USER_AGENT,
      "X-IG-App-ID": APP_ID,
      "X-IG-Device-ID": deviceId,
      "Accept-Language": "en-US",
      Accept: "application/json",
    };
    if (currentAuthorization) headers.Authorization = currentAuthorization;
    if (sessionId) {
      headers.Cookie = `sessionid=${sessionId}${ownerId ? `; ds_user_id=${ownerId}` : ""}`;
    }

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt < 2) {
        await sleep(3_000 * (attempt + 1));
        return request(path, { attempt: attempt + 1 });
      }
      throw new InstagramError(`Network error reaching Instagram: ${error.message}`);
    }

    const refreshed = response.headers.get("ig-set-authorization");
    if (refreshed && refreshed !== currentAuthorization && isUsableAuthorization(refreshed)) {
      currentAuthorization = refreshed;
      await onAuthorizationRefresh?.(refreshed);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new InstagramError("Instagram redirected to the login page.", { kind: "auth", status: response.status });
    }
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok || !body || body.status === "fail") {
      if (response.status >= 500 && attempt < 2) {
        await sleep(5_000 * (attempt + 1));
        return request(path, { attempt: attempt + 1 });
      }
      throw classifyFailure(response.status, body);
    }
    return body;
  }

  return {
    ownerId,
    get requestCount() {
      return requestCount;
    },

    async currentUser() {
      const body = await request("/api/v1/accounts/current_user/?edit=true");
      return { pk: String(body.user.pk), username: body.user.username };
    },

    async lookupUser(username) {
      try {
        const body = await request(`/api/v1/users/${encodeURIComponent(username)}/usernameinfo/`);
        return { pk: String(body.user.pk), username: body.user.username, isPrivate: Boolean(body.user.is_private) };
      } catch (error) {
        if (error.kind === "rate-limit" || error.kind === "auth" || error.kind === "challenge") throw error;
      }
      const body = await request(`/api/v1/users/search/?q=${encodeURIComponent(username)}&count=10`);
      const match = (body.users ?? []).find(
        (user) => user.username?.toLowerCase() === username.toLowerCase(),
      );
      if (!match) throw new InstagramError(`No Instagram account named @${username}.`, { kind: "not-found" });
      return { pk: String(match.pk), username: match.username, isPrivate: Boolean(match.is_private) };
    },

    /** Returns the complete following list, or throws. Never returns a partial list. */
    async following(pk) {
      const rankToken = `${pk}_${randomUUID()}`;
      const users = new Map();
      let maxId = null;
      for (let page = 0; page < 200; page += 1) {
        const params = new URLSearchParams({ count: "200", rank_token: rankToken });
        if (maxId) params.set("max_id", maxId);
        const body = await request(`/api/v1/friendships/${pk}/following/?${params}`);
        // Instagram hides some lists and says so with an "empty state" instead of an error.
        // Treat it as a failure so a hidden list never wipes the map.
        if (body.special_empty_state && !(body.users ?? []).length) {
          throw new InstagramError(
            `Instagram is hiding this following list from the signed-in account ("${body.special_empty_state.body ?? body.special_empty_state.title}"). Use a token from the account itself.`,
            { kind: "restricted" },
          );
        }
        for (const user of body.users ?? []) {
          users.set(String(user.pk), {
            pk: String(user.pk),
            username: user.username,
            fullName: user.full_name ?? "",
            isPrivate: Boolean(user.is_private),
            isVerified: Boolean(user.is_verified),
          });
        }
        maxId = body.next_max_id ? String(body.next_max_id) : null;
        if (!maxId) return [...users.values()];
      }
      throw new InstagramError("Following list pagination did not finish.");
    },

    async userInfo(pk) {
      const body = await request(`/api/v1/users/${pk}/info/`);
      return normalizeProfile(body.user);
    },

    async postLocations(pk) {
      const body = await request(`/api/v1/feed/user/${pk}/?count=12`);
      return (body.items ?? [])
        .map((item) => item.location)
        .filter(Boolean)
        .map((location) => ({
          name: String(location.name ?? "").trim(),
          address: location.address ?? "",
          city: location.city ?? "",
          lat: Number(location.lat),
          lng: Number(location.lng),
        }))
        .filter((location) => location.name);
    },
  };
}

export function normalizeProfile(user) {
  const links = [
    user.external_url,
    ...(user.bio_links ?? []).map((link) => link?.url),
  ].filter(Boolean);
  const phone = user.public_phone_number
    ? `${user.public_phone_country_code ? `+${user.public_phone_country_code}` : ""}${user.public_phone_number}`
    : "";
  return {
    pk: String(user.pk),
    username: user.username,
    fullName: user.full_name ?? "",
    biography: user.biography ?? "",
    externalUrls: [...new Set(links)],
    category: user.category ?? user.business_category_name ?? null,
    isBusiness: Boolean(user.is_business || user.is_business_account || user.account_type === 2),
    isProfessional: Boolean(user.account_type === 2 || user.account_type === 3 || user.is_business),
    isPrivate: Boolean(user.is_private),
    isVerified: Boolean(user.is_verified),
    followerCount: Number(user.follower_count ?? 0),
    business: {
      street: String(user.address_street ?? "").trim(),
      city: String(user.city_name ?? "").trim(),
      zip: String(user.zip ?? "").trim(),
      lat: Number(user.latitude ?? 0),
      lng: Number(user.longitude ?? 0),
      phone,
    },
  };
}

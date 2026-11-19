import {
  coordinatesFromMapUrl,
  isAllowedPublicMapUrl,
  isInIran,
  isPlausibleCoordinate,
  distanceMeters,
} from "./evidence.mjs";
import { isCertainMatch, nameMatchScore, resolveMapLink, scoreMatch } from "./neshan.mjs";

function searchTermFor(profile) {
  return String(profile.fullName || profile.username)
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[|/•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function located(method, coordinates, { address = "", title = "", confidence = 1, details = {} } = {}) {
  return {
    status: "located",
    method,
    coordinates: coordinates.map((value) => Number(Number(value).toFixed(7))),
    address,
    title,
    confidence: Number(confidence.toFixed(3)),
    details,
  };
}

/**
 * Finds a pin for one account, strongest evidence first:
 *   1. a human approval
 *   2. the address the business published on its Instagram profile
 *   3. a map link in the bio
 *   4. a post tag whose venue name matches the account
 *   5. a confident Neshan search match
 *   6. a venue the business tags repeatedly
 * Anything weaker goes to the review queue with its best proposals.
 */
export async function locateProfile({ profile, primaryCategory, evidence, approval, neshan, cache, fetchImpl }) {
  if (approval?.hidden) {
    return { status: "hidden", method: "manual-review", details: { reason: approval.reason ?? "" } };
  }
  let approvedCoordinates = approval?.coordinates;
  if (approval && !isPlausibleCoordinate(approvedCoordinates) && approval.mapLink) {
    approvedCoordinates = await resolveMapLink(approval.mapLink, {
      isAllowed: isAllowedPublicMapUrl,
      extract: coordinatesFromMapUrl,
      cache,
      fetchImpl,
    });
  }
  if (approval && isPlausibleCoordinate(approvedCoordinates)) {
    return located("manual-review", approvedCoordinates, {
      address: approval.address ?? evidence.locationText,
      title: approval.title ?? profile.fullName,
      confidence: 1,
      details: { reviewed: true, reason: approval.reason ?? "" },
    });
  }
  if (!evidence.eligible) return { status: "not-eligible", reason: evidence.reason };

  if (evidence.businessPin) {
    return located("instagram-business-address", evidence.businessPin, {
      address: evidence.businessAddress,
      title: profile.fullName,
      confidence: 0.97,
    });
  }

  if (evidence.mapLink) {
    const coordinates = await resolveMapLink(evidence.mapLink, {
      isAllowed: isAllowedPublicMapUrl,
      extract: coordinatesFromMapUrl,
      cache,
      fetchImpl,
    });
    if (coordinates) {
      return located("direct-map-link", coordinates, {
        address: evidence.locationText,
        title: profile.fullName,
        confidence: 1,
        details: { mapLink: evidence.mapLink },
      });
    }
  }

  const namedTag = evidence.tags
    .filter((tag) => tag.coordinates)
    .map((tag) => ({ tag, name: nameMatchScore(profile, tag.name) }))
    .filter(({ name }) => name.distinctive && (name.exactPhrase || name.score >= 0.75))
    .sort((a, b) => b.name.score - a.name.score || b.tag.count - a.tag.count)[0];
  if (namedTag) {
    return located("instagram-place-tag", namedTag.tag.coordinates, {
      address: namedTag.tag.address || evidence.locationText,
      title: namedTag.tag.name,
      confidence: 0.9,
      details: { tagName: namedTag.tag.name, tagCount: namedTag.tag.count },
    });
  }

  let ranked = [];
  if (neshan) {
    const items = await neshan.search(searchTermFor(profile), evidence.cityHint);
    ranked = (items ?? [])
      .map((item) => ({ item, score: scoreMatch({ profile, evidence, primaryCategory }, item) }))
      .sort((left, right) => right.score.total - left.score.total);
    const [best, runnerUp] = ranked;
    const coordinates = best ? [best.item.location.x, best.item.location.y] : null;
    if (coordinates && isInIran(coordinates) && isCertainMatch(best, runnerUp)) {
      return located("neshan-search", coordinates, {
        address: best.item.subtitle || evidence.locationText,
        title: best.item.title,
        confidence: best.score.total,
        details: {
          nameScore: Number(best.score.nameScore.toFixed(3)),
          locationScore: Number(best.score.locationScore.toFixed(3)),
          phoneMatch: best.score.phoneMatch,
        },
      });
    }
  }

  // A business that keeps tagging the same venue is almost always tagging itself.
  const taggedPosts = evidence.tags.reduce((sum, tag) => sum + tag.count, 0);
  const repeated = evidence.tags.find(
    (tag) => tag.coordinates && tag.count >= 3 && tag.count / Math.max(taggedPosts, 1) >= 0.5,
  );
  if (evidence.allowsRepeatedTags && repeated) {
    const conflictsWithSearch = ranked[0] &&
      ranked[0].score.nameScore >= 0.85 &&
      distanceMeters(repeated.coordinates, [ranked[0].item.location.x, ranked[0].item.location.y]) > 1_500;
    if (!conflictsWithSearch) {
      return located("instagram-repeated-tag", repeated.coordinates, {
        address: repeated.address || evidence.locationText,
        title: repeated.name,
        confidence: 0.75,
        details: { tagName: repeated.name, tagCount: repeated.count, taggedPosts },
      });
    }
  }

  const proposals = [
    ...ranked.slice(0, 3).map(({ item, score }) => ({
      source: "neshan",
      title: item.title,
      address: item.subtitle,
      coordinates: [item.location.x, item.location.y],
      confidence: Number(score.total.toFixed(3)),
    })),
    ...evidence.tags
      .filter((tag) => tag.coordinates)
      .slice(0, 3)
      .map((tag) => ({
        source: "instagram-tag",
        title: tag.name,
        address: tag.address,
        coordinates: tag.coordinates,
        confidence: Number(Math.min(0.2 + tag.count * 0.1, 0.6).toFixed(3)),
      })),
  ];
  return {
    status: "review",
    reason: proposals.length ? "needs-human-review" : "no-match-found",
    searchUnavailable: neshan ? !neshan.available : true,
    proposals,
  };
}

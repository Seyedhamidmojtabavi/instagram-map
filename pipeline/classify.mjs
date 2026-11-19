import taxonomy from "../lib/categories.json" with { type: "json" };
import { fingerprint } from "./evidence.mjs";

export const CATEGORY_IDS = taxonomy.categories.map((category) => category.id);
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const descriptions = {
  Restaurants: "restaurants, kebab houses, fast food, sushi, food courts",
  Cafes_and_Coffee_Shops: "cafés, coffee shops, roasters, tea houses",
  Bakeries_Desserts_and_Sweets: "bakeries, pastry, confectionery, ice cream, chocolate",
  Food_Products_Catering_and_Grocery: "grocery, butchers, food brands, catering, spices, nuts, dried fruit",
  Fashion_Beauty_Jewelry_and_Accessories: "clothing, shoes, bags, cosmetics, beauty salons, hair, nails, jewelry, gold, watches",
  Electronics_Automotive_and_Gadgets: "phones, computers, electronics shops, cars, dealerships, auto services, gadgets",
  Home_Books_Gifts_and_Other_Retail: "furniture, home decor, books, stationery, flowers, gifts, toys, general retail, online shops",
  Education_and_Language: "schools, language institutes, courses, tutors, universities, educational pages",
  Immigration_Legal_and_Finance: "immigration consultants, lawyers, accountants, insurance, banks, crypto, investing",
  Technology_and_Software: "software companies, apps, startups, IT services, developers, AI",
  Marketing_Design_and_Business_Services: "marketing, advertising, branding, graphic design, printing, photography studios, consulting",
  Health_Medical_and_Wellness: "doctors, clinics, dentists, pharmacies, psychologists, nutrition, beauty clinics",
  Travel_Hotels_and_Events: "travel agencies, hotels, eco-lodges, tours, wedding and event venues, event organizers",
  Media_News_and_Publishing: "news outlets, magazines, publishers, podcasts, TV, film, media pages",
  Arts_Music_and_Entertainment: "artists, musicians, bands, galleries, theaters, cinemas, games, entertainment",
  Creators_Public_Figures_and_Personal_Brands: "influencers, bloggers, celebrities, athletes, actors, personal brands",
  Sports_and_Fitness: "gyms, sports clubs, trainers, sportswear, fitness",
  Community_Nonprofit_and_Government: "charities, NGOs, associations, government, religious organizations, embassies",
  Personal_and_Noncommercial: "private individuals: friends, family, personal accounts with no public role",
  Other_Businesses_and_Services: "any other business or service: cleaning, construction, real estate, repair, pets, logistics",
  Unclear: "not enough information to tell",
};

// Instagram's own category labels map well onto ours; this is the offline fallback.
const rules = [
  [/restaurant|kebab|burger|pizza|sushi|fast food|diner|steakhouse|food truck|رستوران|کباب|فست ?فود|پیتزا|سوشی/iu, "Restaurants"],
  [/caf[eé]|coffee|tea room|roaster|کافه|قهوه/iu, "Cafes_and_Coffee_Shops"],
  [/bakery|pastry|dessert|sweet|ice cream|chocolate|confection|cake|نانوایی|شیرینی|بستنی|کیک|شکلات/iu, "Bakeries_Desserts_and_Sweets"],
  [/grocery|butcher|food (?:&|and) beverage|food product|catering|supermarket|spice|nuts|قصابی|سوپرمارکت|آجیل|ادویه|کترینگ|پروتئین/iu, "Food_Products_Catering_and_Grocery"],
  [/clothing|fashion|apparel|shoe|bag|jewel|gold|watch|beauty|cosmetic|salon|hair|nail|makeup|perfume|پوشاک|لباس|کفش|کیف|طلا|جواهر|زیورآلات|آرایش|سالن زیبایی|عطر|ناخن/iu, "Fashion_Beauty_Jewelry_and_Accessories"],
  [/electronic|mobile phone|computer|car dealer|automotive|motor vehicle|auto repair|gadget|موبایل|لپ ?تاپ|خودرو|ماشین|الکترونیک/iu, "Electronics_Automotive_and_Gadgets"],
  [/book|furniture|home decor|gift|flower|florist|toy|stationery|shopping|retail|kitchen|کتاب|مبل|دکوراسیون|گل فروشی|هدیه|اسباب ?بازی|لوازم خانگی/iu, "Home_Books_Gifts_and_Other_Retail"],
  [/education|school|language|academy|tutor|university|college|course|آموزش|آموزشگاه|زبان|مدرسه|دانشگاه|آکادمی|دوره/iu, "Education_and_Language"],
  [/lawyer|law firm|legal|immigration|visa|accountant|insurance|bank|finance|financial|crypto|invest|وکیل|حقوقی|مهاجرت|ویزا|بیمه|بانک|سرمایه|کریپتو|بورس/iu, "Immigration_Legal_and_Finance"],
  [/software|app page|tech|internet company|it service|developer|web ?site|startup|ai\b|نرم ?افزار|استارتاپ|برنامه ?نویسی|فناوری|هوش مصنوعی/iu, "Technology_and_Software"],
  [/marketing|advertis|agency|design|graphic|branding|printing|consult|photograph|business service|بازاریابی|تبلیغات|دیزاین|طراحی|گرافیک|برندینگ|چاپ|مشاوره/iu, "Marketing_Design_and_Business_Services"],
  [/doctor|clinic|dentist|medical|hospital|pharmacy|health|psycholog|nutrition|physio|wellness|پزشک|دکتر|کلینیک|دندان|بیمارستان|داروخانه|سلامت|روانشناس|تغذیه/iu, "Health_Medical_and_Wellness"],
  [/travel|tour|hotel|hostel|lodge|resort|event|wedding|venue|سفر|تور|هتل|اقامتگاه|رویداد|عروسی|تالار|گردشگری/iu, "Travel_Hotels_and_Events"],
  [/news|media|magazine|publisher|podcast|tv|radio|journalist|خبر|رسانه|مجله|نشر|پادکست/iu, "Media_News_and_Publishing"],
  [/artist|musician|band|music|gallery|theat|cinema|film|actor|comedian|game|entertainment|هنر|موسیقی|نوازنده|خواننده|گالری|تئاتر|سینما|فیلم/iu, "Arts_Music_and_Entertainment"],
  [/creator|blogger|influencer|public figure|personal blog|athlete|video creator|بلاگر|اینفلوئنسر/iu, "Creators_Public_Figures_and_Personal_Brands"],
  [/gym|fitness|sport|yoga|trainer|martial|باشگاه|ورزش|بدنسازی|یوگا|مربی/iu, "Sports_and_Fitness"],
  [/non-?profit|charity|ngo|community|government|religious|embassy|association|خیریه|انجمن|سازمان|دولت/iu, "Community_Nonprofit_and_Government"],
  [/real estate|construction|cleaning|repair|pet|logistic|service|املاک|ساختمان|نظافت|تعمیر|حیوانات/iu, "Other_Businesses_and_Services"],
];

export function classificationFingerprint(profile) {
  return fingerprint({
    v: 2,
    fullName: profile.fullName,
    biography: profile.biography,
    category: profile.category,
    isBusiness: profile.isBusiness,
  });
}

export function classifyByRules(profile) {
  const categoryLabel = String(profile.category ?? "");
  const text = `${categoryLabel}\n${profile.fullName}\n${profile.username.replace(/[._]/g, " ")}\n${profile.biography}`;
  const fromCategory = rules.filter(([pattern]) => pattern.test(categoryLabel)).map(([, id]) => id);
  const fromText = rules.filter(([pattern]) => pattern.test(text)).map(([, id]) => id);
  let categories = [...new Set([...fromCategory, ...fromText])].slice(0, 3);
  if (!categories.length) {
    categories = profile.isBusiness || profile.isProfessional
      ? ["Other_Businesses_and_Services"]
      : profile.isVerified || profile.followerCount > 50_000
        ? ["Creators_Public_Figures_and_Personal_Brands"]
        : ["Personal_and_Noncommercial"];
  }
  return { categories, method: "rules" };
}

function sleep(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

const systemInstruction = `You classify Instagram accounts that one person follows so they can be shown on a map and in a directory of public places in Iran.

Assign each account 1 to 3 categories from this list (use the ids exactly):
${CATEGORY_IDS.map((id) => `- ${id}: ${descriptions[id]}`).join("\n")}

Rules:
- Put the category that best describes what the account is first.
- A business that is also run by a known person gets both the business category and Creators_Public_Figures_and_Personal_Brands only if the person is the main subject.
- Use Personal_and_Noncommercial only for private individuals with no public, professional, or creative role. Never guess that a business is personal.
- Use Unclear only when the name, bio, and category give no signal.
- Bios are often Persian. Read them in the original language.`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          username: { type: "STRING" },
          categories: {
            type: "ARRAY",
            items: { type: "STRING", enum: CATEGORY_IDS },
          },
        },
        required: ["username", "categories"],
      },
    },
  },
  required: ["results"],
};

async function callGemini({ apiKey, model, profiles, fetchImpl }) {
  const payload = profiles.map((profile) => ({
    username: profile.username,
    name: profile.fullName,
    instagramCategory: profile.category ?? null,
    business: profile.isBusiness,
    verified: profile.isVerified,
    followers: profile.followerCount,
    bio: String(profile.biography ?? "").slice(0, 600),
    links: (profile.externalUrls ?? []).slice(0, 3),
  }));
  const response = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: `Classify these accounts:\n${JSON.stringify(payload)}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `Gemini returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const candidate = body?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text || (candidate.finishReason && candidate.finishReason !== "STOP")) {
    throw new Error(`Gemini returned no usable answer (${candidate?.finishReason ?? "empty"}).`);
  }
  return JSON.parse(text).results ?? [];
}

/**
 * Classifies profiles in batches. Each profile always gets a result: Gemini when
 * it is configured and answering, keyword rules otherwise.
 */
export async function classifyProfiles(profiles, { apiKey, models = ["gemini-2.5-flash"], batchSize = 25, fetchImpl = fetch, log = () => {} } = {}) {
  const results = new Map();
  const validIds = new Set(CATEGORY_IDS);
  const demoted = new Set();
  for (let start = 0; start < profiles.length; start += batchSize) {
    const batch = profiles.slice(start, start + batchSize);
    let answers = null;
    let usedModel = null;
    if (apiKey) {
      outer: for (const model of models) {
        if (demoted.has(model) && model !== models.at(-1)) continue;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            answers = await callGemini({ apiKey, model, profiles: batch, fetchImpl });
            usedModel = model;
            break outer;
          } catch (error) {
            const retryable = error.status === 429 || error.status >= 500 || error.name === "TimeoutError";
            log(`Gemini ${model} failed (${error.message})${retryable && attempt < 2 ? ", retrying" : ""}`);
            if (!retryable || attempt === 2) {
              // Skip a model that keeps failing for the rest of this run.
              demoted.add(model);
              break;
            }
            await sleep(4_000 * 2 ** attempt);
          }
        }
      }
    }
    const byUsername = new Map((answers ?? []).map((answer) => [String(answer.username).toLowerCase(), answer]));
    for (const profile of batch) {
      const answer = byUsername.get(profile.username.toLowerCase());
      const categories = [...new Set((answer?.categories ?? []).filter((id) => validIds.has(id)))].slice(0, 3);
      results.set(
        profile.pk,
        categories.length
          ? { categories, method: `gemini:${usedModel}` }
          : classifyByRules(profile),
      );
    }
  }
  return results;
}

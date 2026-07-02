// PropertyIQ v5 — Cloudflare Worker
// Domain API integration + bookmarklet data ingestion + full extraction pipeline

const SYSTEM_PROMPT = `You are PropertyIQ, the most thorough property analyst in Australia. You combine the knowledge of a senior buyer's agent, a property valuer, a financial analyst, a town planner, and a behavioural psychologist. You have deep knowledge of every Australian suburb — demographics, infrastructure, school catchments, flood/bushfire overlays, development applications, transport corridors, and community sentiment.

Your job: take a property listing and deliver an analysis so thorough that no buyer's agent in the country could match it. Be specific. Use real suburb data. Name real streets, schools, train stations, and infrastructure projects. Don't be vague.

CRITICAL: You must return ONLY a valid JSON object. No markdown, no backticks, no explanation. Just the JSON.

Return this exact structure:

{
  "listing": {
    "address": "Full street address including suburb, state, postcode",
    "price": "Listed price, price guide, or auction estimate. If 'Contact Agent' or 'Offers Over', include that with your best estimate based on comparables",
    "type": "House / Apartment / Townhouse / Villa / Duplex / Land / Rural",
    "beds": 3,
    "baths": 1,
    "parking": 1,
    "land": "Land size with sqm",
    "daysOnMarket": null,
    "agent": "Agency name and agent name if available",
    "description": "2-3 sentence summary of the property from the listing"
  },
  "analysis": {
    "scores": {
      "overall": 65,
      "value": 70,
      "growth": 55,
      "livability": 75,
      "risk": 60
    },
    "summary": "4-5 sentence hard-hitting bottom line. Be direct. Would you buy this property? At what price? What's the single biggest opportunity and single biggest risk? What should the buyer do RIGHT NOW?",
    "priceAssessment": {
      "verdict": "Likely Overpriced / Fair Value / Potential Deal / Below Market / Insufficient Data",
      "confidence": "Low / Medium / High",
      "detail": "3-4 sentences. Be specific with dollar figures. Compare to median suburb price. Calculate price per sqm vs suburb average. If Contact Agent, estimate the likely range based on comparables.",
      "stampDuty": "Estimated stamp duty in this state for this price (e.g. 'Approx $18,500 in WA')"
    },
    "comparativeValuation": {
      "pricePerSqm": "This property: $X/sqm vs suburb median: $Y/sqm",
      "recentComparables": [
        {
          "address": "Real or approximate nearby address",
          "price": "$XXX,000",
          "date": "Month Year",
          "notes": "How it compares — size, condition, features"
        }
      ],
      "detail": "2-3 sentences. Reference specific recent sales."
    },
    "capitalGrowth": {
      "fiveYear": "e.g. 15-25%",
      "tenYear": "e.g. 35-55%",
      "rentalYield": "Estimated gross rental yield (e.g. '4.2% — $X/week')",
      "confidence": "Low / Medium / High",
      "drivers": ["Specific driver 1 with detail", "Specific driver 2", "Specific driver 3"],
      "detail": "3-4 sentences. Reference historical suburb growth rates. Name specific infrastructure projects with completion dates. Population growth data. Supply constraints."
    },
    "benefits": [
      {
        "category": "Category name",
        "detail": "2-3 sentences with dollar estimates where possible."
      }
    ],
    "suburbIntelligence": {
      "overview": "3-4 sentences painting a vivid picture of what it's actually like to live in this suburb.",
      "demographics": "2-3 sentences — median age, household types, income levels, owner-occupier vs renter ratio.",
      "infrastructure": "2-3 sentences on current and planned infrastructure. Name specific projects with dates.",
      "communitysentiment": "2-3 sentences on what residents and online commentators say about this area.",
      "schools": "2-3 sentences naming specific primary and secondary schools. NAPLAN/ATAR if notable.",
      "transport": "2-3 sentences naming stations, bus routes, freeway access, commute times to CBD."
    },
    "risks": [
      {
        "category": "Specific risk name",
        "level": "Low / Low-Medium / Medium / High",
        "detail": "2-3 sentences with cost implications where relevant."
      }
    ],
    "negotiation": {
      "strategy": "Strategy name",
      "openingOffer": "Specific dollar range",
      "detail": "4-5 sentences. Detailed tactical playbook.",
      "psychologyNotes": ["Tactic 1", "Tactic 2", "Tactic 3"],
      "whatToAsk": ["Strategic question 1", "Question 2", "Question 3"]
    },
    "timeOnMarket": {
      "signal": "Just Listed / Normal Range / Seller Pressure Building / Stale Listing / Unknown",
      "detail": "2-3 sentences."
    },
    "areaOutlook": {
      "trajectory": "Strong Growth / Moderate Growth / Stable / Declining / Mixed Signals",
      "detail": "3-4 sentences."
    },
    "buyerPsychology": {
      "flags": [
        {
          "bias": "Specific cognitive bias name",
          "warning": "2-3 sentences specific to THIS property."
        }
      ]
    },
    "dueDiligence": [
      "Specific action item 1",
      "Action item 2",
      "Action item 3",
      "Action item 4",
      "Action item 5"
    ]
  }
}

SCORING GUIDE (0-100):
- Overall: Weighted composite. Would you recommend this purchase?
- Value: Price fair relative to comparables? 80+ = deal, 50 = fair, <40 = overpriced
- Growth: Capital growth potential over 10 years. 80+ = strong, 50 = average, <40 = declining
- Livability: Schools, transport, amenities, safety, community. 80+ = excellent, 50 = average
- Risk: INVERTED — higher = LESS risky. 80+ = very safe, 50 = moderate risk, <40 = high risk

MANDATORY:
- Australian English spelling
- ALL dollar amounts in AUD
- BALANCED: 4-6 benefits AND 4-6 risks
- 3+ buyer psychology flags
- Name REAL schools, stations, roads, shopping centres, infrastructure projects
- Estimate rental yield, stamp duty
- 5-8 due diligence items
- Be SPECIFIC and DIRECT`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://sainttdog.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── Parse URL to extract property info ───

function parseListingUrl(url) {
  const info = { platform: null, suburb: null, state: null, propertyType: null, listingId: null };
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes("realestate.com.au")) {
      info.platform = "realestate.com.au";
      const m = path.match(/\/property-([a-z]+)-([a-z]{2,3})-([a-z0-9-]+?)-(\d+)/);
      if (m) {
        info.propertyType = m[1].charAt(0).toUpperCase() + m[1].slice(1);
        info.state = m[2].toUpperCase();
        info.suburb = m[3].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        info.listingId = m[4];
      }
    } else if (host.includes("domain.com.au")) {
      info.platform = "domain.com.au";
      const m = path.match(/\/([a-z-]+?)-([a-z]{2,3})-(\d{4})\/(\d+)/);
      if (m) {
        info.suburb = m[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        info.state = m[2].toUpperCase();
        info.postcode = m[3];
        info.listingId = m[4];
      }
    }
  } catch (e) {}
  return info;
}

// ─── Domain API Integration ───

async function getDomainApiToken(env) {
  const clientId = env.DOMAIN_CLIENT_ID;
  const clientSecret = env.DOMAIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch("https://auth.domain.com.au/v1/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&scope=api_listings_read%20api_agencies_read`,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.access_token || null;
  } catch (e) {
    return null;
  }
}

async function searchDomainListing(token, suburb, state, propertyType, beds) {
  if (!token) return null;
  try {
    const searchBody = {
      listingType: "Sale",
      locations: [{ suburb: suburb, state: state }],
    };
    if (propertyType) {
      const typeMap = { house: "House", apartment: "ApartmentUnitFlat", townhouse: "Townhouse", villa: "Villa", duplex: "Duplex", land: "VacantLand" };
      const mapped = typeMap[(propertyType || "").toLowerCase()];
      if (mapped) searchBody.propertyTypes = [mapped];
    }
    if (beds) { searchBody.minBedrooms = beds; searchBody.maxBedrooms = beds; }

    const resp = await fetch("https://api.domain.com.au/v1/listings/residential/_search", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchBody),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

async function getDomainListingById(token, listingId) {
  if (!token || !listingId) return null;
  try {
    const resp = await fetch(`https://api.domain.com.au/v1/listings/${listingId}`, {
      headers: { "Authorization": "Bearer " + token },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

function parseDomainApiListing(data) {
  if (!data) return null;
  const result = { source: "domain_api" };
  try {
    // Handle single listing
    const listing = Array.isArray(data) ? data[0]?.listing || data[0] : data;
    if (!listing) return null;

    result.address = listing.addressParts
      ? [listing.addressParts.streetNumber, listing.addressParts.street, listing.addressParts.suburb, listing.addressParts.stateAbbreviation, listing.addressParts.postcode].filter(Boolean).join(" ")
      : listing.displayableAddress || null;
    result.suburb = listing.addressParts?.suburb || null;
    result.state = listing.addressParts?.stateAbbreviation || null;
    result.postcode = listing.addressParts?.postcode || null;
    result.price = listing.priceDetails?.displayPrice || listing.price || null;
    result.beds = listing.bedrooms || null;
    result.baths = listing.bathrooms || null;
    result.parking = listing.carspaces || null;
    result.land = listing.landAreaSqm ? listing.landAreaSqm + " sqm" : null;
    result.type = listing.propertyTypes?.[0] || listing.propertyType || null;
    result.description = listing.description ? (listing.description.length > 500 ? listing.description.substring(0, 500) + "..." : listing.description) : null;

    const agents = listing.advertiser?.contacts || listing.agents || [];
    const agencyName = listing.advertiser?.name || "";
    const agentNames = agents.map(a => a.name || a.displayName).filter(Boolean).join(", ");
    result.agent = [agentNames, agencyName].filter(Boolean).join(" — ") || null;

    if (listing.geoLocation) {
      result.lat = listing.geoLocation.latitude;
      result.lng = listing.geoLocation.longitude;
    }

    const features = listing.features || [];
    if (features.length > 0) result.features = features;

    result.daysOnMarket = listing.dateListed
      ? Math.floor((Date.now() - new Date(listing.dateListed).getTime()) / 86400000)
      : null;

  } catch (e) {
    result.parseError = e.message;
  }
  return Object.keys(result).length > 2 ? result : null;
}

// ─── HTMLRewriter extraction (for Domain URLs which don't block workers) ───

async function extractStructuredData(url) {
  const debug = { fetchStatus: null, contentLength: 0, hasJsonLd: false, hasNextData: false, hasArgonaut: false, scriptCount: 0, ogTagCount: 0 };
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    debug.fetchStatus = response.status;
    if (!response.ok) return { ok: false, error: "HTTP " + response.status, debug };

    const collected = { jsonLd: [], nextData: "", ogTags: {}, title: "", scriptContents: [] };
    let jsonLdBuf = "", nextDataBuf = "", titleBuf = "", scriptBuf = "";
    let isJsonLd = false, isNextData = false, isTitle = false, isScript = false;

    const rewriter = new HTMLRewriter()
      .on('script[type="application/ld+json"]', {
        element() { isJsonLd = true; jsonLdBuf = ""; },
        text(t) { if (isJsonLd) { jsonLdBuf += t.text; if (t.lastInTextNode) { try { collected.jsonLd.push(JSON.parse(jsonLdBuf)); } catch(e){} jsonLdBuf = ""; isJsonLd = false; } } }
      })
      .on('script#__NEXT_DATA__', {
        element() { isNextData = true; nextDataBuf = ""; },
        text(t) { if (isNextData) { nextDataBuf += t.text; if (t.lastInTextNode) { collected.nextData = nextDataBuf; isNextData = false; } } }
      })
      .on('meta[property^="og:"]', {
        element(el) { const p = el.getAttribute("property"), c = el.getAttribute("content"); if (p && c) collected.ogTags[p] = c; }
      })
      .on('meta[name]', {
        element(el) { const n = (el.getAttribute("name")||"").toLowerCase(), c = el.getAttribute("content"); if (c && (n.includes("description") || n.includes("price"))) collected.ogTags["meta:" + n] = c; }
      })
      .on('title', {
        element() { isTitle = true; titleBuf = ""; },
        text(t) { if (isTitle) { titleBuf += t.text; if (t.lastInTextNode) { collected.title = titleBuf.trim(); isTitle = false; } } }
      })
      .on('script:not([type]):not([src]), script[type="text/javascript"]:not([src])', {
        element() { isScript = true; scriptBuf = ""; },
        text(t) { if (isScript) { scriptBuf += t.text; if (t.lastInTextNode) { if (scriptBuf.includes("ArgonautExchange") || scriptBuf.includes("listingData") || scriptBuf.includes("propertyData")) collected.scriptContents.push(scriptBuf); scriptBuf = ""; isScript = false; } } }
      });

    const buf = await rewriter.transform(response).arrayBuffer();
    debug.contentLength = buf.byteLength;
    debug.hasJsonLd = collected.jsonLd.length > 0;
    debug.hasNextData = !!collected.nextData;
    debug.hasArgonaut = collected.scriptContents.some(s => s.includes("ArgonautExchange"));
    debug.scriptCount = collected.scriptContents.length;
    debug.ogTagCount = Object.keys(collected.ogTags).length;
    return { ok: true, ...collected, debug };
  } catch (e) {
    debug.error = e.message;
    return { ok: false, error: e.message, debug };
  }
}

// ─── Argonaut / NextData / JSON-LD parsers (unchanged) ───

function parseArgonautExchange(scripts) {
  for (const s of scripts) {
    const m = s.match(/window\.ArgonautExchange\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|$)/);
    if (m) { try { return extractArgonaut(JSON.parse(m[1])); } catch(e){} }
    // Brace-matching fallback
    const start = s.indexOf('window.ArgonautExchange');
    if (start === -1) continue;
    const eq = s.indexOf('=', start), bs = s.indexOf('{', eq);
    if (bs === -1) continue;
    let d = 0, end = bs;
    for (let i = bs; i < s.length; i++) { if (s[i]==='{') d++; if (s[i]==='}') d--; if (d===0) { end = i+1; break; } }
    try { return extractArgonaut(JSON.parse(s.substring(bs, end))); } catch(e){}
  }
  return null;
}

function extractArgonaut(data) {
  const r = { source: "rea_argonaut" }, s = JSON.stringify(data);
  r.price = (s.match(/"displayPrice":\s*"([^"]+)"/) || s.match(/"priceDisplay":\s*"([^"]+)"/) || s.match(/"price":\s*"([^"]+)"/))?.[1] || null;
  r.address = (s.match(/"displayAddress":\s*"([^"]+)"/)||[])[1] || [s.match(/"streetAddress":\s*"([^"]+)"/)?.[1], s.match(/"suburb":\s*"([^"]+)"/)?.[1], s.match(/"state":\s*"([^"]+)"/)?.[1], s.match(/"postcode":\s*"([^"]+)"/)?.[1]].filter(Boolean).join(", ");
  r.suburb = s.match(/"suburb":\s*"([^"]+)"/)?.[1] || null;
  r.state = s.match(/"state":\s*"([^"]+)"/)?.[1] || null;
  r.postcode = s.match(/"postcode":\s*"([^"]+)"/)?.[1] || null;
  r.beds = s.match(/"bedrooms?":\s*(\d+)/i)?.[1] ? parseInt(s.match(/"bedrooms?":\s*(\d+)/i)[1]) : null;
  r.baths = s.match(/"bathrooms?":\s*(\d+)/i)?.[1] ? parseInt(s.match(/"bathrooms?":\s*(\d+)/i)[1]) : null;
  r.parking = (s.match(/"parking(?:Spaces)?":\s*(\d+)/i) || s.match(/"carSpaces?":\s*(\d+)/i))?.[1] ? parseInt((s.match(/"parking(?:Spaces)?":\s*(\d+)/i) || s.match(/"carSpaces?":\s*(\d+)/i))[1]) : null;
  const lm = s.match(/"landSize":\s*(\d+)/i) || s.match(/"landArea(?:Sqm)?":\s*(\d+(?:\.\d+)?)/i);
  r.land = lm ? lm[1] + " sqm" : null;
  r.type = s.match(/"propertyType":\s*"([^"]+)"/)?.[1] || null;
  const dm = s.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
  if (dm) { let d = dm[1].replace(/\\n/g," ").replace(/\\"/g,'"'); r.description = d.length > 500 ? d.substring(0,500)+"..." : d; }
  r.agent = [s.match(/"agentName":\s*"([^"]+)"/)?.[1], (s.match(/"agencyName":\s*"([^"]+)"/) || s.match(/"brandName":\s*"([^"]+)"/))?.[1]].filter(Boolean).join(" — ") || null;
  r.lat = s.match(/"latitude":\s*(-?\d+\.\d+)/)?.[1] ? parseFloat(s.match(/"latitude":\s*(-?\d+\.\d+)/)[1]) : null;
  r.lng = s.match(/"longitude":\s*(-?\d+\.\d+)/)?.[1] ? parseFloat(s.match(/"longitude":\s*(-?\d+\.\d+)/)[1]) : null;
  r.daysOnMarket = (s.match(/"daysOnMarket":\s*(\d+)/i) || s.match(/"listedDays?":\s*(\d+)/i))?.[1] ? parseInt((s.match(/"daysOnMarket":\s*(\d+)/i) || s.match(/"listedDays?":\s*(\d+)/i))[1]) : null;
  return r;
}

function parseNextData(str) {
  try {
    const data = JSON.parse(str), s = JSON.stringify(data), r = { source: "domain_nextdata" };
    r.price = (s.match(/"price":\s*"([^"]+)"/) || s.match(/"displayPrice":\s*"([^"]+)"/))?.[1] || null;
    r.address = s.match(/"displayAddress":\s*"([^"]+)"/)?.[1] || [s.match(/"streetAddress":\s*"([^"]+)"/)?.[1], s.match(/"suburb":\s*"([^"]+)"/)?.[1], s.match(/"state":\s*"([^"]+)"/)?.[1]].filter(Boolean).join(", ");
    r.suburb = s.match(/"suburb":\s*"([^"]+)"/)?.[1] || null;
    r.state = s.match(/"state":\s*"([^"]+)"/)?.[1] || null;
    r.beds = s.match(/"bedrooms?":\s*(\d+)/i)?.[1] ? parseInt(s.match(/"bedrooms?":\s*(\d+)/i)[1]) : null;
    r.baths = s.match(/"bathrooms?":\s*(\d+)/i)?.[1] ? parseInt(s.match(/"bathrooms?":\s*(\d+)/i)[1]) : null;
    r.parking = (s.match(/"carSpaces?":\s*(\d+)/i) || s.match(/"parking(?:Spaces)?":\s*(\d+)/i))?.[1] ? parseInt((s.match(/"carSpaces?":\s*(\d+)/i) || s.match(/"parking(?:Spaces)?":\s*(\d+)/i))[1]) : null;
    const lm = s.match(/"landArea(?:Sqm)?":\s*(\d+(?:\.\d+)?)/i) || s.match(/"landSize":\s*(\d+)/i);
    r.land = lm ? lm[1] + " sqm" : null;
    r.type = s.match(/"propertyType":\s*"([^"]+)"/)?.[1] || null;
    const dm = s.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
    if (dm) { let d = dm[1].replace(/\\n/g," ").replace(/\\"/g,'"'); r.description = d.length > 500 ? d.substring(0,500)+"..." : d; }
    r.agent = [s.match(/"agentName":\s*"([^"]+)"/)?.[1], (s.match(/"agencyName":\s*"([^"]+)"/) || s.match(/"name":\s*"([^"]+?)(?:\s+-)?\s*(?:Real Estate|Property|Realty)/i))?.[1]].filter(Boolean).join(" — ") || null;
    return r;
  } catch(e) { return null; }
}

function parseJsonLd(arr) {
  const r = { source: "json_ld" };
  for (const item of arr) {
    const t = item["@type"]||"", s = JSON.stringify(item);
    if (t.includes("Residence") || t.includes("RealEstateListing") || t.includes("Product") || s.includes("bedrooms")) {
      if (item.address) { const a = item.address; r.address = a.streetAddress ? [a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode].filter(Boolean).join(", ") : null; r.suburb = a.addressLocality; r.state = a.addressRegion; r.postcode = a.postalCode; }
      if (item.offers?.price) r.price = "$" + Number(item.offers.price).toLocaleString();
      if (item.numberOfBedrooms) r.beds = parseInt(item.numberOfBedrooms);
      if (item.numberOfBathroomsTotal) r.baths = parseInt(item.numberOfBathroomsTotal);
      if (item.geo) { r.lat = parseFloat(item.geo.latitude); r.lng = parseFloat(item.geo.longitude); }
      if (item.description) r.description = item.description.length > 500 ? item.description.substring(0,500)+"..." : item.description;
      if (item.name) r.title = item.name;
    }
  }
  return Object.keys(r).length > 1 ? r : null;
}

// ─── Merge listing data ───

function mergeListingData(sources, urlInfo) {
  const valid = sources.filter(Boolean), merged = {};
  const fields = ["address","suburb","state","postcode","price","type","beds","baths","parking","land","description","agent","lat","lng","daysOnMarket","features"];
  for (const f of fields) { for (const src of valid) { if (src[f] != null && src[f] !== "") { merged[f] = src[f]; break; } } }
  if (!merged.suburb && urlInfo?.suburb) merged.suburb = urlInfo.suburb;
  if (!merged.state && urlInfo?.state) merged.state = urlInfo.state;
  if (!merged.type && urlInfo?.propertyType) merged.type = urlInfo.propertyType;
  merged.dataSources = valid.map(s => s.source).join(", ");
  return merged;
}

// ─── Build Claude prompt ───

function buildPrompt(listing, listingUrl, urlInfo, extractionMeta) {
  if (listing && Object.keys(listing).length > 2) {
    extractionMeta.method = listing.dataSources?.includes("bookmarklet") ? "bookmarklet" : listing.dataSources?.includes("domain_api") ? "domain_api" : "structured_extraction";
    extractionMeta.sources = (listing.dataSources || "").split(", ").filter(Boolean);
    let msg = "Analyse this Australian property listing. I've extracted the structured data for you.\n\n";
    msg += "=== EXTRACTED LISTING DATA ===\n" + JSON.stringify(listing, null, 2) + "\n\n";
    msg += "URL: " + (listingUrl || "N/A") + "\n";
    msg += "Data sources: " + (listing.dataSources || "extraction") + "\n\n";
    msg += "Use this extracted data as the foundation. Fill in the listing fields from this data. Combine with your deep knowledge of " + (listing.suburb || urlInfo?.suburb || "this suburb") + " to deliver the complete analysis with all sections.";
    return msg;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  DAILY NEW-LISTING → X POST PIPELINE
// ═══════════════════════════════════════════════════════════════

// "thebuyersgrail" persona — turns a full PropertyIQ analysis into a post.
const X_POST_SYSTEM = `You are "thebuyersgrail", a sharp, credible Australian buyer's agent who posts a daily new-listing breakdown on X (Twitter). You cut through agent spin and give buyers genuine analytical value.

You will be given a full property analysis as JSON. Write the post from that analysis ONLY — never invent facts, prices, or features that aren't in the data.

Voice: confident, specific, useful. Plain Australian English. No hype, no clickbait, minimal emoji (0–1 max). Always name the suburb. Lead with the single most interesting insight (a value call, a risk, or a growth driver). Include at least one concrete number from the analysis (price, $/sqm, yield, or a score). Close the lead with a light hook, not a hard sell.

Return ONLY valid JSON. No markdown, no backticks:
{
  "single": "A self-contained tweet, MAX 270 characters, including 2-3 relevant hashtags (e.g. #property #realestate + suburb or state).",
  "thread": [
    "Tweet 1 — the hook: suburb, property in one line, the headline verdict + one number.",
    "Tweet 2 — value / price read.",
    "Tweet 3 — growth or livability angle.",
    "Tweet 4 — the biggest risk to check + a soft CTA.",
    "Not financial advice. Always do your own due diligence. #property #realestate"
  ]
}
Every element of "thread" must be MAX 270 characters. Keep the single tweet genuinely standalone.`;

// Thin wrapper around the Claude messages API. Returns raw text.
async function callClaude(env, system, userMessage, maxTokens = 8192) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || ("Claude API " + resp.status));
  }
  const data = await resp.json();
  return data.content[0].text;
}

// Parse a JSON object out of a Claude response that may be fenced.
function parseClaudeJson(text) {
  let jsonStr = text;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1];
  return JSON.parse(jsonStr.trim());
}

// "Bondi:NSW,Southbank:VIC" → [{suburb, state}, ...]
function parseTargets(env) {
  const raw = env.TARGET_SUBURBS || "";
  const targets = raw.split(",").map(s => s.trim()).filter(Boolean).map(pair => {
    const [suburb, state] = pair.split(":").map(x => (x || "").trim());
    return suburb && state ? { suburb, state: state.toUpperCase() } : null;
  }).filter(Boolean);
  return targets.length ? targets : [{ suburb: "Bondi", state: "NSW" }];
}

// Newest Sale listings in a suburb, sorted most-recently-updated first.
async function searchNewestListings(token, suburb, state) {
  try {
    const resp = await fetch("https://api.domain.com.au/v1/listings/residential/_search", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        listingType: "Sale",
        locations: [{ suburb, state, includeSurroundingSuburbs: false }],
        sort: { sortKey: "DateUpdated", direction: "Descending" },
        pageSize: 20,
      }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

// Walk every target suburb and return the first genuinely-new listing we
// haven't already posted. Newness = listed within NEW_LISTING_WINDOW_HOURS.
async function findFreshListing(env, token) {
  const targets = parseTargets(env);
  const windowMs = (parseInt(env.NEW_LISTING_WINDOW_HOURS || "48", 10) || 48) * 3600000;
  const now = Date.now();

  for (const { suburb, state } of targets) {
    const results = await searchNewestListings(token, suburb, state);
    for (const item of results) {
      const listing = item.listing || item;
      const id = listing.id || listing.listingId;
      if (!id) continue;

      const listedAt = listing.dateListed ? new Date(listing.dateListed).getTime() : null;
      if (listedAt && (now - listedAt) > windowMs) continue; // too old to count as "new"

      const alreadyPosted = env.POST_STORE ? await env.POST_STORE.get("posted:" + id) : null;
      if (alreadyPosted) continue;

      // Fetch full detail for the richest analysis.
      const detail = await getDomainListingById(token, id);
      const parsed = parseDomainApiListing(detail) || parseDomainApiListing(listing);
      if (!parsed || (!parsed.address && !parsed.suburb)) continue;

      const merged = mergeListingData([parsed], { suburb, state });
      merged.id = id;
      merged.seoUrl = detail?.seoUrl || listing.seoUrl || null;
      merged.link = merged.seoUrl
        ? (merged.seoUrl.startsWith("http") ? merged.seoUrl : "https://www.domain.com.au/" + merged.seoUrl.replace(/^\//, ""))
        : ("https://www.domain.com.au/" + id);
      return merged;
    }
  }
  return null;
}

// Run a fresh listing through the full PropertyIQ analysis prompt.
async function analyseListing(env, listing) {
  let msg = "Analyse this Australian property listing. I've pulled the structured data from the Domain API for you.\n\n";
  msg += "=== EXTRACTED LISTING DATA ===\n" + JSON.stringify(listing, null, 2) + "\n\n";
  if (listing.link) msg += "URL: " + listing.link + "\n";
  msg += "Use this as the foundation and combine it with your deep knowledge of " + (listing.suburb || "this suburb") + " to deliver the complete analysis with all sections.";
  const text = await callClaude(env, SYSTEM_PROMPT, msg);
  return parseClaudeJson(text);
}

// Turn the analysis into thebuyersgrail post variants (single + thread).
async function composePost(env, analysis, listing) {
  let msg = "Write today's new-listing post from this analysis.\n\n";
  msg += "=== ANALYSIS ===\n" + JSON.stringify(analysis, null, 2) + "\n\n";
  if (listing.link) msg += "Listing link (optional to include, counts toward length): " + listing.link + "\n";
  const text = await callClaude(env, X_POST_SYSTEM, msg, 1500);
  const post = parseClaudeJson(text);
  // Hard safety clamp so we never exceed X's limit even if the model overshoots.
  const clamp = t => (typeof t === "string" && t.length > 280) ? t.slice(0, 277).trimEnd() + "…" : t;
  post.single = clamp(post.single);
  post.thread = Array.isArray(post.thread) ? post.thread.map(clamp) : [];
  return post;
}

// ─── X (Twitter) API v2 — OAuth 1.0a user-context posting ───

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function genNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

async function buildOAuthHeader(method, url, env) {
  const oauth = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: genNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauth).sort()
    .map(k => percentEncode(k) + "=" + percentEncode(oauth[k])).join("&");
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = percentEncode(env.X_API_SECRET) + "&" + percentEncode(env.X_ACCESS_TOKEN_SECRET);
  oauth.oauth_signature = await hmacSha1Base64(signingKey, baseString);
  return "OAuth " + Object.keys(oauth).sort()
    .map(k => percentEncode(k) + '="' + percentEncode(oauth[k]) + '"').join(", ");
}

async function postTweet(env, text, inReplyToId = null) {
  const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].filter(k => !env[k]);
  if (missing.length) throw new Error("Missing X credentials: " + missing.join(", "));
  const url = "https://api.twitter.com/2/tweets";
  const auth = await buildOAuthHeader("POST", url, env);
  const body = { text };
  if (inReplyToId) body.reply = { in_reply_to_tweet_id: inReplyToId };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Authorization": auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error("X API " + resp.status + ": " + JSON.stringify(data));
  return data.data; // { id, text }
}

// Publish a stored post per POST_FORMAT. Returns tweet ids.
async function publishPost(env, post) {
  const format = (env.POST_FORMAT || "single").toLowerCase();
  if (format === "thread" && Array.isArray(post.thread) && post.thread.length) {
    const ids = [];
    let lastId = null;
    for (const t of post.thread) {
      if (!t) continue;
      const res = await postTweet(env, t, lastId);
      lastId = res.id;
      ids.push(res.id);
    }
    return ids;
  }
  const res = await postTweet(env, post.single);
  return [res.id];
}

// ─── Orchestration ───

async function runDailyPost(env) {
  const log = { ranAt: new Date().toISOString(), steps: [] };
  try {
    const token = await getDomainApiToken(env);
    if (!token) { log.error = "No Domain API token (check DOMAIN_CLIENT_ID/SECRET)"; return log; }
    log.steps.push("domain_token_ok");

    const listing = await findFreshListing(env, token);
    if (!listing) { log.result = "no_new_listing"; return log; }
    log.listingId = listing.id;
    log.address = listing.address;
    log.steps.push("found_listing");

    const analysis = await analyseListing(env, listing);
    log.steps.push("analysed");

    const post = await composePost(env, analysis, listing);
    log.steps.push("composed");

    const record = {
      id: listing.id,
      date: log.ranAt,
      listing: { address: listing.address, suburb: listing.suburb, state: listing.state, price: listing.price, link: listing.link },
      scores: analysis?.analysis?.scores || null,
      post,
    };

    if ((env.POST_MODE || "draft").toLowerCase() === "auto") {
      const tweetIds = await publishPost(env, post);
      record.published = true;
      record.tweetIds = tweetIds;
      if (env.POST_STORE) await env.POST_STORE.put("posted:" + listing.id, "1", { expirationTtl: 60 * 60 * 24 * 90 });
      log.result = "published";
      log.tweetIds = tweetIds;
    } else {
      // Draft mode: store for review. Publishing is a manual, token-gated action.
      record.published = false;
      if (env.POST_STORE) {
        await env.POST_STORE.put("draft:latest", JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 7 });
      }
      log.result = "drafted";
    }
    return log;
  } catch (e) {
    log.error = e.message;
    return log;
  }
}

// ─── Review UI (draft mode) ───

function reviewPageHtml(record) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const l = record?.listing || {};
  const p = record?.post || {};
  const threadHtml = (p.thread || []).map((t, i) =>
    `<div class="tw"><span class="n">${i + 1}</span><p>${esc(t)}</p><span class="c">${(t || "").length}/280</span></div>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>thebuyersgrail — daily post review</title>
<style>body{font-family:-apple-system,Inter,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#111}
h1{font-size:20px}.meta{color:#666;font-size:13px;margin-bottom:20px}
.tw{border:1px solid #e5e5e5;border-radius:12px;padding:14px;margin:10px 0;position:relative}
.tw p{margin:0;white-space:pre-wrap}.n{position:absolute;top:-9px;left:12px;background:#111;color:#fff;font-size:11px;border-radius:9px;padding:1px 7px}
.c{color:#999;font-size:11px}.card{background:#f7f7f5;border-radius:12px;padding:14px;margin:16px 0}
button{background:#1d9bf0;color:#fff;border:0;border-radius:999px;padding:10px 22px;font-size:15px;font-weight:600;cursor:pointer}
button.thread{background:#111}label{font-size:13px;color:#444}#out{margin-top:14px;font-size:14px}</style></head>
<body>
<h1>thebuyersgrail — daily post review</h1>
<div class="meta">${record ? esc(l.address || "") + " · " + esc(l.price || "") + (l.link ? ' · <a href="' + esc(l.link) + '" target="_blank">listing</a>' : "") + " · drafted " + esc(record.date) : "No draft yet. The daily job hasn't produced one, or POST_MODE is 'auto'."}</div>
${record ? `
<div class="card"><strong>Single tweet</strong>
<div class="tw"><p>${esc(p.single)}</p><span class="c">${(p.single || "").length}/280</span></div></div>
<div class="card"><strong>Thread</strong>${threadHtml}</div>
<p>
  <button onclick="publish('single')">Publish single tweet</button>
  <button class="thread" onclick="publish('thread')">Publish thread</button>
</p>
<div id="out"></div>
<script>
async function publish(format){
  document.getElementById('out').textContent='Publishing…';
  const t=new URLSearchParams(location.search).get('review');
  const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'publish',token:t,format})});
  const d=await r.json();
  document.getElementById('out').textContent=r.ok?('Published: '+JSON.stringify(d.tweetIds)):('Error: '+(d.error||r.status));
}
</script>` : ""}
</body></html>`;
}

// ─── Main Worker ───

export default {
  // Daily cron entry point.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyPost(env).then(log => console.log("daily-post:", JSON.stringify(log))));
  },

  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ─── Draft review page (GET /?review=<REVIEW_TOKEN>) ───
    if (request.method === "GET") {
      const token = url.searchParams.get("review");
      if (token && env.REVIEW_TOKEN && token === env.REVIEW_TOKEN) {
        const raw = env.POST_STORE ? await env.POST_STORE.get("draft:latest") : null;
        const record = raw ? JSON.parse(raw) : null;
        return new Response(reviewPageHtml(record), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.json();
      const { listingUrl, manualDetails, bookmarkletData, action } = body;

      // ─── Token-gated actions (manual run / publish a draft) ───
      if (action) {
        if (!env.REVIEW_TOKEN || body.token !== env.REVIEW_TOKEN) {
          return new Response(JSON.stringify({ error: "Unauthorised" }), {
            status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        if (action === "run") {
          // Trigger the daily pipeline on demand (useful for testing the cron logic).
          const log = await runDailyPost(env);
          return new Response(JSON.stringify(log), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
        }
        if (action === "publish") {
          const raw = env.POST_STORE ? await env.POST_STORE.get("draft:latest") : null;
          if (!raw) return new Response(JSON.stringify({ error: "No draft to publish" }), {
            status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
          const record = JSON.parse(raw);
          const pubEnv = body.format ? { ...env, POST_FORMAT: body.format } : env;
          const tweetIds = await publishPost(pubEnv, record.post);
          if (env.POST_STORE) {
            await env.POST_STORE.put("posted:" + record.id, "1", { expirationTtl: 60 * 60 * 24 * 90 });
            await env.POST_STORE.delete("draft:latest");
          }
          return new Response(JSON.stringify({ result: "published", tweetIds }), {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      let userMessage;
      let extractionMeta = { method: "unknown", sources: [], debug: {} };

      // ═══════════════════════════════════════════════════
      // PATH 1: Bookmarklet data (highest quality — client-side extraction)
      // ═══════════════════════════════════════════════════
      if (bookmarkletData && typeof bookmarkletData === "object") {
        const bkData = { source: "bookmarklet", ...bookmarkletData };
        const urlInfo = listingUrl ? parseListingUrl(listingUrl) : {};
        const listing = mergeListingData([bkData], urlInfo);
        extractionMeta.method = "bookmarklet";
        extractionMeta.sources = ["bookmarklet"];
        extractionMeta.debug.bookmarklet = true;

        userMessage = "Analyse this Australian property listing. The data was extracted directly from the listing page by the user's browser — this is high-quality, verified data.\n\n";
        userMessage += "=== EXTRACTED LISTING DATA ===\n" + JSON.stringify(listing, null, 2) + "\n\n";
        if (listingUrl) userMessage += "URL: " + listingUrl + "\n";
        userMessage += "Use this extracted data as the foundation. Combine with your deep knowledge of " + (listing.suburb || "this suburb") + " to deliver the complete analysis with all sections.";
      }

      // ═══════════════════════════════════════════════════
      // PATH 2: Manual entry (with optional URL for context)
      // ═══════════════════════════════════════════════════
      else if (manualDetails && (manualDetails.address || manualDetails.suburb)) {
        extractionMeta.method = "manual_entry";
        userMessage = "Analyse this Australian property. The buyer has provided these details directly from the listing:\n\n";
        const manualFields = [['address','Address'],['suburb','Suburb'],['state','State'],['price','Price'],['type','Type'],['beds','Beds'],['baths','Baths'],['parking','Parking'],['land','Land'],['daysOnMarket','Days on Market'],['agent','Agent'],['notes','Buyer Notes']];
        for (const [k,l] of manualFields) { if (manualDetails[k]) userMessage += l + ": " + manualDetails[k] + "\n"; }
        if (listingUrl) userMessage += "Listing URL: " + listingUrl + "\n";
        userMessage += "\nThis is user-provided data — treat it as accurate. Use your deep knowledge of " + (manualDetails.suburb || manualDetails.address || "this area") + " to deliver the complete analysis with all sections. Be specific about this exact suburb.";
      }

      // ═══════════════════════════════════════════════════
      // PATH 3: URL-based analysis
      // ═══════════════════════════════════════════════════
      else if (listingUrl) {
        const urlInfo = parseListingUrl(listingUrl);
        extractionMeta.urlInfo = urlInfo;
        let listing = null;

        // STEP 1: Try HTMLRewriter (works well for Domain, usually blocked by REA)
        const extracted = await extractStructuredData(listingUrl);
        extractionMeta.debug.htmlRewriter = extracted.debug || {};

        if (extracted.ok) {
          const argonaut = parseArgonautExchange(extracted.scriptContents || []);
          const nextData = extracted.nextData ? parseNextData(extracted.nextData) : null;
          const jsonLd = extracted.jsonLd.length > 0 ? parseJsonLd(extracted.jsonLd) : null;
          extractionMeta.debug.foundArgonaut = !!argonaut;
          extractionMeta.debug.foundNextData = !!nextData;
          extractionMeta.debug.foundJsonLd = !!jsonLd;

          let ogSource = null;
          if (Object.keys(extracted.ogTags).length > 0) {
            ogSource = { source: "og_meta" };
            if (extracted.ogTags["og:title"]) ogSource.address = extracted.ogTags["og:title"].split("|")[0].trim();
            if (extracted.ogTags["og:description"]) ogSource.description = extracted.ogTags["og:description"];
          }

          const allSources = [argonaut, nextData, jsonLd, ogSource].filter(Boolean);
          listing = mergeListingData(allSources, urlInfo);
          if (listing && (listing.address || listing.suburb || listing.price)) {
            extractionMeta.method = "structured_extraction";
            extractionMeta.sources = allSources.map(s => s.source);
          } else {
            listing = null;
          }
        }

        // STEP 2: Domain API cross-reference (for REA URLs we can search Domain)
        if (!listing || !listing.price) {
          const token = await getDomainApiToken(env);
          extractionMeta.debug.hasDomainCreds = !!(env.DOMAIN_CLIENT_ID && env.DOMAIN_CLIENT_SECRET);
          extractionMeta.debug.gotDomainToken = !!token;

          if (token) {
            let domainResult = null;

            // If it's a Domain URL with listing ID, get directly
            if (urlInfo.platform === "domain.com.au" && urlInfo.listingId) {
              domainResult = await getDomainListingById(token, urlInfo.listingId);
            }
            // Otherwise search by suburb + type
            else if (urlInfo.suburb && urlInfo.state) {
              const searchResults = await searchDomainListing(token, urlInfo.suburb, urlInfo.state, urlInfo.propertyType);
              if (searchResults && Array.isArray(searchResults) && searchResults.length > 0) {
                domainResult = searchResults; // Array of listings
              }
            }

            const domainParsed = parseDomainApiListing(domainResult);
            extractionMeta.debug.domainApiResult = !!domainParsed;

            if (domainParsed) {
              if (!listing) {
                listing = mergeListingData([domainParsed], urlInfo);
              } else {
                // Merge Domain data into existing listing to fill gaps
                const fields = ["price","beds","baths","parking","land","description","agent","lat","lng","daysOnMarket","features"];
                for (const f of fields) {
                  if (!listing[f] && domainParsed[f]) listing[f] = domainParsed[f];
                }
                listing.dataSources = (listing.dataSources || "") + ", domain_api";
              }
              extractionMeta.method = listing ? "domain_api_enriched" : "domain_api";
              if (!extractionMeta.sources.includes("domain_api")) extractionMeta.sources.push("domain_api");
            }
          }
        }

        // Build Claude prompt
        if (listing && Object.keys(listing).length > 2 && (listing.address || listing.suburb)) {
          userMessage = buildPrompt(listing, listingUrl, urlInfo, extractionMeta) ||
            "Analyse this Australian property listing.\n\n=== EXTRACTED DATA ===\n" + JSON.stringify(listing, null, 2) + "\n\nURL: " + listingUrl;
        } else {
          // URL inference fallback
          extractionMeta.method = "url_inference";
          userMessage = "Analyse this Australian property listing: " + listingUrl + "\n\n";
          if (urlInfo.suburb) {
            userMessage += "From the URL I can tell this is a " + urlInfo.propertyType + " in " + urlInfo.suburb + ", " + urlInfo.state + ".\n";
            userMessage += "Listing ID: " + urlInfo.listingId + " on " + urlInfo.platform + "\n\n";
          }
          userMessage += "I couldn't fetch the page directly. Use your comprehensive knowledge of " + (urlInfo.suburb || "this area") + " to deliver the full analysis. ";
          userMessage += "Be upfront about confidence levels. Still deliver ALL sections.";
        }
      }

      else {
        return new Response(JSON.stringify({ error: "Provide a listing URL, bookmarklet data, or property details" }), {
          status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      // ─── Send to Claude ───
      const apiKey = env.ANTHROPIC_API_KEY;
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!anthropicResponse.ok) {
        const err = await anthropicResponse.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: err.error?.message || "API request failed", _meta: extractionMeta }), {
          status: anthropicResponse.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const data = await anthropicResponse.json();
      const text = data.content[0].text;
      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      jsonStr = jsonStr.trim();

      const result = JSON.parse(jsonStr);
      result._meta = extractionMeta;

      return new Response(JSON.stringify(result), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  },
};

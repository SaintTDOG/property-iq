// PropertyIQ v4 — Cloudflare Worker
// Improved extraction with REA API fallback, debug metadata, and smarter URL parsing

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

// ─── Parse URL to extract property info from the URL path ───

function parseListingUrl(url) {
  const info = { platform: null, suburb: null, state: null, propertyType: null, listingId: null };

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (host.includes("realestate.com.au")) {
      info.platform = "realestate.com.au";
      // URL pattern: /property-{type}-{state}-{suburb}-{id}
      const reaMatch = path.match(/\/property-([a-z]+)-([a-z]{2,3})-([a-z0-9-]+?)-(\d+)/);
      if (reaMatch) {
        info.propertyType = reaMatch[1].charAt(0).toUpperCase() + reaMatch[1].slice(1);
        info.state = reaMatch[2].toUpperCase();
        info.suburb = reaMatch[3].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        info.listingId = reaMatch[4];
      }
    } else if (host.includes("domain.com.au")) {
      info.platform = "domain.com.au";
      // URL pattern: /{suburb}-{state}-{postcode}/{id}
      const domainMatch = path.match(/\/([a-z-]+?)-([a-z]{2,3})-(\d{4})\/(\d+)/);
      if (domainMatch) {
        info.suburb = domainMatch[1].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        info.state = domainMatch[2].toUpperCase();
        info.postcode = domainMatch[3];
        info.listingId = domainMatch[4];
      }
    }
  } catch (e) {}

  return info;
}

// ─── Try REA's GraphQL/API endpoints ───

async function tryReaApi(listingId) {
  if (!listingId) return null;

  // Try the residential listing API endpoint
  const endpoints = [
    `https://www.realestate.com.au/graph-ql`,
    `https://lexa.realestate.com.au/graphql`,
  ];

  // Try the simpler JSON endpoint first
  try {
    const resp = await fetch(`https://www.realestate.com.au/property/${listingId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
    });
    if (resp.ok) {
      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        if (data && typeof data === "object") {
          return { source: "rea_json_endpoint", data };
        }
      } catch (e) {}
    }
  } catch (e) {}

  // Try GraphQL endpoint
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          query: `query GetListing($listingId: String!) {
            listing(id: $listingId) {
              id address { displayAddress suburb state postcode streetAddress }
              price { displayPrice }
              propertyType bedrooms bathrooms carSpaces
              landSize { displayValue value unit }
              description
              listedDate
              agency { name }
              agents { name }
              features { general }
            }
          }`,
          variables: { listingId },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.data?.listing) {
          return { source: "rea_graphql", data: data.data.listing };
        }
      }
    } catch (e) {}
  }

  return null;
}

// ─── HTMLRewriter-based extraction for REA and Domain ───

async function extractStructuredData(url) {
  const debug = { fetchStatus: null, contentLength: 0, hasJsonLd: false, hasNextData: false, hasArgonaut: false, scriptCount: 0, ogTagCount: 0 };

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });

    debug.fetchStatus = response.status;

    if (!response.ok) return { ok: false, error: "HTTP " + response.status, debug };

    // Collect data from HTMLRewriter
    const collected = {
      jsonLd: [],
      nextData: "",
      ogTags: {},
      title: "",
      scriptContents: [],
    };

    let jsonLdBuffer = "";
    let nextDataBuffer = "";
    let isJsonLd = false;
    let isNextData = false;
    let titleBuffer = "";
    let isTitle = false;
    let scriptBuffer = "";
    let isScriptCapture = false;

    const rewriter = new HTMLRewriter()
      .on('script[type="application/ld+json"]', {
        element() { isJsonLd = true; jsonLdBuffer = ""; },
        text(text) {
          if (isJsonLd) {
            jsonLdBuffer += text.text;
            if (text.lastInTextNode) {
              try { collected.jsonLd.push(JSON.parse(jsonLdBuffer)); } catch (e) {}
              jsonLdBuffer = "";
              isJsonLd = false;
            }
          }
        }
      })
      .on('script#__NEXT_DATA__', {
        element() { isNextData = true; nextDataBuffer = ""; },
        text(text) {
          if (isNextData) {
            nextDataBuffer += text.text;
            if (text.lastInTextNode) {
              collected.nextData = nextDataBuffer;
              isNextData = false;
            }
          }
        }
      })
      .on('meta[property^="og:"]', {
        element(el) {
          const prop = el.getAttribute("property");
          const content = el.getAttribute("content");
          if (prop && content) collected.ogTags[prop] = content;
        }
      })
      .on('meta[name]', {
        element(el) {
          const name = (el.getAttribute("name") || "").toLowerCase();
          const content = el.getAttribute("content");
          if (content && (name.includes("description") || name.includes("price") ||
              name.includes("address") || name.includes("geo"))) {
            collected.ogTags["meta:" + name] = content;
          }
        }
      })
      .on('title', {
        element() { isTitle = true; titleBuffer = ""; },
        text(text) {
          if (isTitle) {
            titleBuffer += text.text;
            if (text.lastInTextNode) {
              collected.title = titleBuffer.trim();
              isTitle = false;
            }
          }
        }
      })
      .on('script:not([type]):not([src]), script[type="text/javascript"]:not([src])', {
        element() { isScriptCapture = true; scriptBuffer = ""; },
        text(text) {
          if (isScriptCapture) {
            scriptBuffer += text.text;
            if (text.lastInTextNode) {
              if (scriptBuffer.includes("ArgonautExchange") ||
                  scriptBuffer.includes("listingData") ||
                  scriptBuffer.includes("propertyData") ||
                  scriptBuffer.includes("__data__")) {
                collected.scriptContents.push(scriptBuffer);
              }
              scriptBuffer = "";
              isScriptCapture = false;
            }
          }
        }
      });

    const transformed = rewriter.transform(response);
    const buffer = await transformed.arrayBuffer();
    debug.contentLength = buffer.byteLength;
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

// ─── Parse REA ArgonautExchange data ───

function parseArgonautExchange(scriptContents) {
  for (const script of scriptContents) {
    const match = script.match(/window\.ArgonautExchange\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script|$)/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        return extractREAListingFromArgonaut(data);
      } catch (e) {
        try {
          const start = script.indexOf('window.ArgonautExchange');
          if (start === -1) continue;
          const eqSign = script.indexOf('=', start);
          const braceStart = script.indexOf('{', eqSign);
          if (braceStart === -1) continue;
          let depth = 0;
          let end = braceStart;
          for (let i = braceStart; i < script.length; i++) {
            if (script[i] === '{') depth++;
            if (script[i] === '}') depth--;
            if (depth === 0) { end = i + 1; break; }
          }
          const jsonStr = script.substring(braceStart, end);
          const data = JSON.parse(jsonStr);
          return extractREAListingFromArgonaut(data);
        } catch (e2) {}
      }
    }
  }
  return null;
}

function extractREAListingFromArgonaut(data) {
  const result = { source: "rea_argonaut" };
  try {
    const str = JSON.stringify(data);
    const priceMatch = str.match(/"price":\s*"([^"]+)"/);
    const displayPriceMatch = str.match(/"displayPrice":\s*"([^"]+)"/);
    const priceDisplayMatch = str.match(/"priceDisplay":\s*"([^"]+)"/);
    result.price = displayPriceMatch?.[1] || priceDisplayMatch?.[1] || priceMatch?.[1] || null;

    const streetMatch = str.match(/"streetAddress":\s*"([^"]+)"/);
    const suburbMatch = str.match(/"suburb":\s*"([^"]+)"/);
    const stateMatch = str.match(/"state":\s*"([^"]+)"/);
    const postcodeMatch = str.match(/"postcode":\s*"([^"]+)"/);
    const displayAddrMatch = str.match(/"displayAddress":\s*"([^"]+)"/);
    result.address = displayAddrMatch?.[1] || [streetMatch?.[1], suburbMatch?.[1], stateMatch?.[1], postcodeMatch?.[1]].filter(Boolean).join(", ");
    result.suburb = suburbMatch?.[1] || null;
    result.state = stateMatch?.[1] || null;
    result.postcode = postcodeMatch?.[1] || null;

    const bedsMatch = str.match(/"bedrooms?":\s*(\d+)/i);
    const bathsMatch = str.match(/"bathrooms?":\s*(\d+)/i);
    const parkingMatch = str.match(/"parking(?:Spaces)?":\s*(\d+)/i) || str.match(/"carSpaces?":\s*(\d+)/i);
    result.beds = bedsMatch ? parseInt(bedsMatch[1]) : null;
    result.baths = bathsMatch ? parseInt(bathsMatch[1]) : null;
    result.parking = parkingMatch ? parseInt(parkingMatch[1]) : null;

    const landMatch = str.match(/"landSize":\s*(\d+)/i) || str.match(/"landArea(?:Sqm)?":\s*(\d+(?:\.\d+)?)/i);
    result.land = landMatch ? landMatch[1] + " sqm" : null;

    const typeMatch = str.match(/"propertyType":\s*"([^"]+)"/);
    result.type = typeMatch?.[1] || null;

    const descMatch = str.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
    if (descMatch) {
      let desc = descMatch[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      if (desc.length > 500) desc = desc.substring(0, 500) + "...";
      result.description = desc;
    }

    const agentNameMatch = str.match(/"agentName":\s*"([^"]+)"/) || str.match(/"agent(?:Display)?Name":\s*"([^"]+)"/);
    const agencyMatch = str.match(/"agencyName":\s*"([^"]+)"/) || str.match(/"brandName":\s*"([^"]+)"/);
    result.agent = [agentNameMatch?.[1], agencyMatch?.[1]].filter(Boolean).join(" — ") || null;

    const latMatch = str.match(/"latitude":\s*(-?\d+\.\d+)/);
    const lngMatch = str.match(/"longitude":\s*(-?\d+\.\d+)/);
    result.lat = latMatch ? parseFloat(latMatch[1]) : null;
    result.lng = lngMatch ? parseFloat(lngMatch[1]) : null;

    const featuresMatches = str.matchAll(/"features?":\s*\[([^\]]*)\]/gi);
    const features = [];
    for (const fm of featuresMatches) {
      const items = fm[1].match(/"([^"]+)"/g);
      if (items) items.forEach(i => features.push(i.replace(/"/g, '')));
    }
    if (features.length > 0) result.features = [...new Set(features)];

    const domMatch = str.match(/"daysOnMarket":\s*(\d+)/i) || str.match(/"listedDays?":\s*(\d+)/i);
    result.daysOnMarket = domMatch ? parseInt(domMatch[1]) : null;

  } catch (e) {
    result.parseError = e.message;
  }
  return result;
}

// ─── Parse Domain __NEXT_DATA__ ───

function parseNextData(nextDataStr) {
  try {
    const data = JSON.parse(nextDataStr);
    const result = { source: "domain_nextdata" };
    const str = JSON.stringify(data);

    const displayPriceMatch = str.match(/"price":\s*"([^"]+)"/) || str.match(/"displayPrice":\s*"([^"]+)"/);
    result.price = displayPriceMatch?.[1] || null;

    const displayAddrMatch = str.match(/"displayAddress":\s*"([^"]+)"/);
    const streetMatch = str.match(/"streetAddress":\s*"([^"]+)"/);
    const suburbMatch = str.match(/"suburb":\s*"([^"]+)"/);
    const stateMatch = str.match(/"state":\s*"([^"]+)"/);
    const postcodeMatch = str.match(/"postcode":\s*"([^"]+)"/);
    result.address = displayAddrMatch?.[1] || [streetMatch?.[1], suburbMatch?.[1], stateMatch?.[1], postcodeMatch?.[1]].filter(Boolean).join(", ");
    result.suburb = suburbMatch?.[1] || null;
    result.state = stateMatch?.[1] || null;

    const bedsMatch = str.match(/"bedrooms?":\s*(\d+)/i);
    const bathsMatch = str.match(/"bathrooms?":\s*(\d+)/i);
    const parkingMatch = str.match(/"carSpaces?":\s*(\d+)/i) || str.match(/"parking(?:Spaces)?":\s*(\d+)/i);
    result.beds = bedsMatch ? parseInt(bedsMatch[1]) : null;
    result.baths = bathsMatch ? parseInt(bathsMatch[1]) : null;
    result.parking = parkingMatch ? parseInt(parkingMatch[1]) : null;

    const landMatch = str.match(/"landArea(?:Sqm)?":\s*(\d+(?:\.\d+)?)/i) || str.match(/"landSize":\s*(\d+)/i);
    result.land = landMatch ? landMatch[1] + " sqm" : null;

    const typeMatch = str.match(/"propertyType":\s*"([^"]+)"/);
    result.type = typeMatch?.[1] || null;

    const descMatch = str.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
    if (descMatch) {
      let desc = descMatch[1].replace(/\\n/g, " ").replace(/\\"/g, '"');
      if (desc.length > 500) desc = desc.substring(0, 500) + "...";
      result.description = desc;
    }

    const agentMatch = str.match(/"agentName":\s*"([^"]+)"/);
    const agencyMatch = str.match(/"agencyName":\s*"([^"]+)"/) || str.match(/"name":\s*"([^"]+?)(?:\s+-)?\s*(?:Real Estate|Property|Realty)/i);
    result.agent = [agentMatch?.[1], agencyMatch?.[1]].filter(Boolean).join(" — ") || null;

    const latMatch = str.match(/"latitude":\s*(-?\d+\.\d+)/);
    const lngMatch = str.match(/"longitude":\s*(-?\d+\.\d+)/);
    result.lat = latMatch ? parseFloat(latMatch[1]) : null;
    result.lng = lngMatch ? parseFloat(lngMatch[1]) : null;

    return result;
  } catch (e) {
    return null;
  }
}

// ─── Parse JSON-LD ───

function parseJsonLd(jsonLdArray) {
  const result = { source: "json_ld" };
  for (const item of jsonLdArray) {
    const type = item["@type"] || "";
    const str = JSON.stringify(item);
    if (type.includes("Residence") || type.includes("RealEstateListing") ||
        type.includes("Product") || type.includes("SingleFamilyResidence") ||
        str.includes("bedrooms") || str.includes("numberOfRooms")) {
      if (item.address) {
        const addr = item.address;
        result.address = addr.streetAddress ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(", ") : null;
        result.suburb = addr.addressLocality || null;
        result.state = addr.addressRegion || null;
        result.postcode = addr.postalCode || null;
      }
      if (item.offers?.price) result.price = "$" + Number(item.offers.price).toLocaleString();
      if (item.numberOfBedrooms) result.beds = parseInt(item.numberOfBedrooms);
      if (item.numberOfBathroomsTotal) result.baths = parseInt(item.numberOfBathroomsTotal);
      if (item.geo) {
        result.lat = parseFloat(item.geo.latitude);
        result.lng = parseFloat(item.geo.longitude);
      }
      if (item.description) {
        result.description = item.description.length > 500 ? item.description.substring(0, 500) + "..." : item.description;
      }
      if (item.name) result.title = item.name;
    }
  }
  return Object.keys(result).length > 1 ? result : null;
}

// ─── Merge listing data from all sources ───

function mergeListingData(sources, urlInfo) {
  const validSources = sources.filter(Boolean);
  const merged = {};
  const fields = ["address", "suburb", "state", "postcode", "price", "type", "beds", "baths",
                  "parking", "land", "description", "agent", "lat", "lng", "daysOnMarket", "features"];

  for (const field of fields) {
    for (const source of validSources) {
      if (source[field] != null && source[field] !== "") {
        merged[field] = source[field];
        break;
      }
    }
  }

  // Fill from URL parsing if still missing
  if (!merged.suburb && urlInfo.suburb) merged.suburb = urlInfo.suburb;
  if (!merged.state && urlInfo.state) merged.state = urlInfo.state;
  if (!merged.type && urlInfo.propertyType) merged.type = urlInfo.propertyType;

  merged.dataSources = validSources.map(s => s.source).join(", ");
  return merged;
}

// ─── Fallback: clean HTML text ───

function cleanHtmlForClaude(html) {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 8000) text = text.substring(0, 8000) + "... [truncated]";
  return text;
}

// ─── Main Worker ───

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.json();
      const { listingUrl, manualDetails } = body;

      let userMessage;
      let extractionMeta = { method: "unknown", sources: [], debug: {} };

      if (listingUrl) {
        const urlInfo = parseListingUrl(listingUrl);
        extractionMeta.urlInfo = urlInfo;

        // ─── STEP 1: Try HTMLRewriter extraction ───
        const extracted = await extractStructuredData(listingUrl);
        extractionMeta.debug.htmlRewriter = extracted.debug || {};

        let listing = null;

        if (extracted.ok) {
          const argonaut = parseArgonautExchange(extracted.scriptContents || []);
          const nextData = extracted.nextData ? parseNextData(extracted.nextData) : null;
          const jsonLd = extracted.jsonLd.length > 0 ? parseJsonLd(extracted.jsonLd) : null;

          extractionMeta.debug.foundArgonaut = !!argonaut;
          extractionMeta.debug.foundNextData = !!nextData;
          extractionMeta.debug.foundJsonLd = !!jsonLd;

          // Build OG-tags-based source
          let ogSource = null;
          if (Object.keys(extracted.ogTags).length > 0) {
            ogSource = { source: "og_meta" };
            if (extracted.ogTags["og:title"]) ogSource.address = extracted.ogTags["og:title"].split("|")[0].trim();
            if (extracted.ogTags["og:description"]) ogSource.description = extracted.ogTags["og:description"];
            if (extracted.ogTags["meta:description"]) ogSource.description = ogSource.description || extracted.ogTags["meta:description"];
          }

          // Merge all sources (priority order)
          const allSources = [argonaut, nextData, jsonLd, ogSource].filter(Boolean);
          listing = mergeListingData(allSources, urlInfo);

          if (listing && (listing.address || listing.suburb || listing.price)) {
            extractionMeta.method = "structured_extraction";
            extractionMeta.sources = allSources.map(s => s.source);
          } else {
            listing = null;
          }
        }

        // ─── STEP 2: If no structured data, try REA API ───
        if (!listing && urlInfo.platform === "realestate.com.au" && urlInfo.listingId) {
          const apiResult = await tryReaApi(urlInfo.listingId);
          extractionMeta.debug.triedReaApi = true;
          extractionMeta.debug.reaApiResult = !!apiResult;

          if (apiResult) {
            // Try to parse the API response
            const str = JSON.stringify(apiResult.data);
            const apiParsed = { source: apiResult.source };

            const priceMatch = str.match(/"displayPrice":\s*"([^"]+)"/) || str.match(/"price":\s*"([^"]+)"/);
            if (priceMatch) apiParsed.price = priceMatch[1];

            const addrMatch = str.match(/"displayAddress":\s*"([^"]+)"/);
            if (addrMatch) apiParsed.address = addrMatch[1];

            const suburbMatch = str.match(/"suburb":\s*"([^"]+)"/);
            if (suburbMatch) apiParsed.suburb = suburbMatch[1];

            const bedsMatch = str.match(/"bedrooms?":\s*(\d+)/i);
            if (bedsMatch) apiParsed.beds = parseInt(bedsMatch[1]);

            const bathsMatch = str.match(/"bathrooms?":\s*(\d+)/i);
            if (bathsMatch) apiParsed.baths = parseInt(bathsMatch[1]);

            listing = mergeListingData([apiParsed], urlInfo);
            if (listing && (listing.address || listing.suburb)) {
              extractionMeta.method = "rea_api";
              extractionMeta.sources = [apiResult.source];
            } else {
              listing = null;
            }
          }
        }

        // ─── Build the Claude prompt based on what we got ───

        if (listing && Object.keys(listing).length > 2) {
          // Good structured data
          userMessage = "Analyse this Australian property listing. I've extracted the structured data for you.\n\n";
          userMessage += "=== EXTRACTED LISTING DATA ===\n";
          userMessage += JSON.stringify(listing, null, 2) + "\n\n";
          userMessage += "URL: " + listingUrl + "\n";
          userMessage += "Data sources: " + (listing.dataSources || "extraction") + "\n\n";
          userMessage += "Use this extracted data as the foundation. Fill in the listing fields from this data. Combine with your deep knowledge of " + (listing.suburb || urlInfo.suburb || "this suburb") + " to deliver the complete analysis with all sections.";
        } else if (extracted?.ok) {
          // Page fetched but no structured data — send cleaned HTML + OG tags
          extractionMeta.method = "cleaned_html";

          // Re-fetch for raw HTML (HTMLRewriter consumed the stream)
          let cleanText = "";
          try {
            const rawResponse = await fetch(listingUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html",
              },
              redirect: "follow",
            });
            const rawHtml = await rawResponse.text();
            cleanText = cleanHtmlForClaude(rawHtml);
          } catch (e) {
            cleanText = "(Could not re-fetch page content)";
          }

          userMessage = "Analyse this Australian property listing.\n\n";
          userMessage += "URL: " + listingUrl + "\n";
          if (urlInfo.suburb) userMessage += "FROM URL: " + urlInfo.propertyType + " in " + urlInfo.suburb + ", " + urlInfo.state + "\n";
          if (extracted.title) userMessage += "PAGE TITLE: " + extracted.title + "\n";
          if (Object.keys(extracted.ogTags).length > 0) {
            userMessage += "\n=== META TAGS ===\n";
            for (const [k, v] of Object.entries(extracted.ogTags)) {
              userMessage += k + ": " + v + "\n";
            }
          }
          if (extracted.jsonLd.length > 0) {
            let jsonLdStr = JSON.stringify(extracted.jsonLd, null, 2);
            if (jsonLdStr.length > 3000) jsonLdStr = jsonLdStr.substring(0, 3000) + "... [truncated]";
            userMessage += "\n=== JSON-LD ===\n" + jsonLdStr + "\n";
          }
          userMessage += "\n=== PAGE CONTENT ===\n" + cleanText + "\n\n";
          userMessage += "Extract all property details from the above and deliver the complete analysis.";
        } else {
          // Couldn't fetch at all — URL inference only
          extractionMeta.method = "url_inference";

          userMessage = "Analyse this Australian property listing: " + listingUrl + "\n\n";
          if (urlInfo.suburb) {
            userMessage += "From the URL I can tell this is a " + urlInfo.propertyType + " in " + urlInfo.suburb + ", " + urlInfo.state + ".\n";
            userMessage += "Listing ID: " + urlInfo.listingId + " on " + urlInfo.platform + "\n\n";
          }
          userMessage += "I couldn't fetch the page (error: " + (extracted?.error || "unknown") + "). ";
          userMessage += "Use your comprehensive knowledge of " + (urlInfo.suburb || "this area") + " to deliver the full analysis. ";
          userMessage += "Be upfront about confidence levels given limited listing data. Still deliver ALL sections with your best analysis.";
        }
      } else if (manualDetails) {
        extractionMeta.method = "manual_entry";
        userMessage = "Analyse this Australian property:\n\n";
        const fields = [
          ['address', 'Address'], ['suburb', 'Suburb'], ['state', 'State'],
          ['price', 'Price'], ['type', 'Type'], ['beds', 'Beds'], ['baths', 'Baths'],
          ['parking', 'Parking'], ['land', 'Land'], ['daysOnMarket', 'Days on Market'],
          ['agent', 'Agent'], ['notes', 'Buyer Notes']
        ];
        for (const [key, label] of fields) {
          if (manualDetails[key]) userMessage += label + ": " + manualDetails[key] + "\n";
        }
        userMessage += "\nDeliver the full analysis with all sections.";
      } else {
        return new Response(JSON.stringify({ error: "Provide a listing URL or property details" }), {
          status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      // ─── STEP 3: Send to Claude ───
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
          status: anthropicResponse.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const data = await anthropicResponse.json();
      const text = data.content[0].text;

      let jsonStr = text;
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1];
      jsonStr = jsonStr.trim();

      const result = JSON.parse(jsonStr);

      // Attach extraction metadata to the response
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

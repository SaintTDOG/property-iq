// PropertyIQ v3 — Cloudflare Worker
// Phase 1: Proper structured data extraction via HTMLRewriter
// Extracts ArgonautExchange (REA) and __NEXT_DATA__ (Domain) before touching Claude

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

// ─── HTMLRewriter-based extraction for REA and Domain ───

async function extractStructuredData(url) {
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

    if (!response.ok) return { ok: false, error: "HTTP " + response.status };

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
      // JSON-LD structured data (both REA and Domain use this)
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
      // Domain.com.au __NEXT_DATA__
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
      // Open Graph meta tags
      .on('meta[property^="og:"]', {
        element(el) {
          const prop = el.getAttribute("property");
          const content = el.getAttribute("content");
          if (prop && content) collected.ogTags[prop] = content;
        }
      })
      // Other useful meta tags
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
      // Title
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
      // Capture all script tags to find ArgonautExchange
      .on('script:not([type]):not([src]), script[type="text/javascript"]:not([src])', {
        element() { isScriptCapture = true; scriptBuffer = ""; },
        text(text) {
          if (isScriptCapture) {
            scriptBuffer += text.text;
            if (text.lastInTextNode) {
              // Only keep scripts that look like they contain property data
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

    // Run HTMLRewriter
    await rewriter.transform(response).arrayBuffer();

    return { ok: true, ...collected };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Parse REA ArgonautExchange data ───

function parseArgonautExchange(scriptContents) {
  for (const script of scriptContents) {
    // Look for the ArgonautExchange assignment
    const match = script.match(/window\.ArgonautExchange\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script|$)/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        return extractREAListingFromArgonaut(data);
      } catch (e) {
        // Try a more lenient extraction - find the JSON blob
        try {
          const start = script.indexOf('window.ArgonautExchange');
          if (start === -1) continue;
          const eqSign = script.indexOf('=', start);
          const braceStart = script.indexOf('{', eqSign);
          if (braceStart === -1) continue;

          // Find matching closing brace
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
  // ArgonautExchange has a complex ID-keyed structure
  // We need to traverse it to find listing details
  const result = { source: "rea_argonaut" };

  try {
    // Stringify and search for key patterns
    const str = JSON.stringify(data);

    // Extract price
    const priceMatch = str.match(/"price":\s*"([^"]+)"/);
    const displayPriceMatch = str.match(/"displayPrice":\s*"([^"]+)"/);
    const priceDisplayMatch = str.match(/"priceDisplay":\s*"([^"]+)"/);
    result.price = displayPriceMatch?.[1] || priceDisplayMatch?.[1] || priceMatch?.[1] || null;

    // Extract address parts
    const streetMatch = str.match(/"streetAddress":\s*"([^"]+)"/);
    const suburbMatch = str.match(/"suburb":\s*"([^"]+)"/);
    const stateMatch = str.match(/"state":\s*"([^"]+)"/);
    const postcodeMatch = str.match(/"postcode":\s*"([^"]+)"/);
    const displayAddrMatch = str.match(/"displayAddress":\s*"([^"]+)"/);
    result.address = displayAddrMatch?.[1] || [streetMatch?.[1], suburbMatch?.[1], stateMatch?.[1], postcodeMatch?.[1]].filter(Boolean).join(", ");
    result.suburb = suburbMatch?.[1] || null;
    result.state = stateMatch?.[1] || null;
    result.postcode = postcodeMatch?.[1] || null;

    // Extract features
    const bedsMatch = str.match(/"bedrooms?":\s*(\d+)/i);
    const bathsMatch = str.match(/"bathrooms?":\s*(\d+)/i);
    const parkingMatch = str.match(/"parking(?:Spaces)?":\s*(\d+)/i) || str.match(/"carSpaces?":\s*(\d+)/i);
    result.beds = bedsMatch ? parseInt(bedsMatch[1]) : null;
    result.baths = bathsMatch ? parseInt(bathsMatch[1]) : null;
    result.parking = parkingMatch ? parseInt(parkingMatch[1]) : null;

    // Extract land size
    const landMatch = str.match(/"landSize":\s*(\d+)/i) || str.match(/"landArea(?:Sqm)?":\s*(\d+(?:\.\d+)?)/i);
    result.land = landMatch ? landMatch[1] + " sqm" : null;

    // Extract property type
    const typeMatch = str.match(/"propertyType":\s*"([^"]+)"/);
    result.type = typeMatch?.[1] || null;

    // Extract description
    const descMatch = str.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
    if (descMatch) {
      let desc = descMatch[1].replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      if (desc.length > 500) desc = desc.substring(0, 500) + "...";
      result.description = desc;
    }

    // Extract agent
    const agentNameMatch = str.match(/"agentName":\s*"([^"]+)"/) || str.match(/"agent(?:Display)?Name":\s*"([^"]+)"/);
    const agencyMatch = str.match(/"agencyName":\s*"([^"]+)"/) || str.match(/"brandName":\s*"([^"]+)"/);
    result.agent = [agentNameMatch?.[1], agencyMatch?.[1]].filter(Boolean).join(" — ") || null;

    // Extract coordinates
    const latMatch = str.match(/"latitude":\s*(-?\d+\.\d+)/);
    const lngMatch = str.match(/"longitude":\s*(-?\d+\.\d+)/);
    result.lat = latMatch ? parseFloat(latMatch[1]) : null;
    result.lng = lngMatch ? parseFloat(lngMatch[1]) : null;

    // Extract features list
    const featuresMatches = str.matchAll(/"features?":\s*\[([^\]]*)\]/gi);
    const features = [];
    for (const fm of featuresMatches) {
      const items = fm[1].match(/"([^"]+)"/g);
      if (items) items.forEach(i => features.push(i.replace(/"/g, '')));
    }
    if (features.length > 0) result.features = [...new Set(features)];

    // Days on market
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

    // Extract from the stringified blob using same pattern matching
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

// ─── Parse JSON-LD (both platforms use this) ───

function parseJsonLd(jsonLdArray) {
  const result = { source: "json_ld" };

  for (const item of jsonLdArray) {
    // Look for RealEstateListing, Product, or Residence types
    const type = item["@type"] || "";
    const str = JSON.stringify(item);

    if (type.includes("Residence") || type.includes("RealEstateListing") ||
        type.includes("Product") || type.includes("SingleFamilyResidence") ||
        str.includes("bedrooms") || str.includes("numberOfRooms")) {

      // Address
      if (item.address) {
        const addr = item.address;
        result.address = addr.streetAddress ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(", ") : null;
        result.suburb = addr.addressLocality || null;
        result.state = addr.addressRegion || null;
        result.postcode = addr.postalCode || null;
      }

      // Price
      if (item.offers?.price) result.price = "$" + Number(item.offers.price).toLocaleString();
      if (item.offers?.priceCurrency && item.offers?.price) result.priceCurrency = item.offers.priceCurrency;

      // Rooms
      if (item.numberOfBedrooms) result.beds = parseInt(item.numberOfBedrooms);
      if (item.numberOfBathroomsTotal) result.baths = parseInt(item.numberOfBathroomsTotal);
      if (item.numberOfRooms) result.rooms = parseInt(item.numberOfRooms);

      // Geo
      if (item.geo) {
        result.lat = parseFloat(item.geo.latitude);
        result.lng = parseFloat(item.geo.longitude);
      }

      // Description
      if (item.description) {
        result.description = item.description.length > 500 ? item.description.substring(0, 500) + "..." : item.description;
      }

      // Name/title
      if (item.name) result.title = item.name;
    }
  }

  return Object.keys(result).length > 1 ? result : null;
}

// ─── Build the best listing data from all sources ───

function mergeListingData(argonaut, nextData, jsonLd, ogTags, title) {
  // Priority: argonaut > nextData > jsonLd > ogTags
  const sources = [argonaut, nextData, jsonLd].filter(Boolean);

  if (sources.length === 0) return null;

  const merged = {};
  const fields = ["address", "suburb", "state", "postcode", "price", "type", "beds", "baths",
                  "parking", "land", "description", "agent", "lat", "lng", "daysOnMarket", "features"];

  for (const field of fields) {
    for (const source of sources) {
      if (source[field] != null && source[field] !== "") {
        merged[field] = source[field];
        break;
      }
    }
  }

  // Fill from OG tags if still missing
  if (!merged.address && ogTags["og:title"]) merged.address = ogTags["og:title"];
  if (!merged.description && ogTags["og:description"]) merged.description = ogTags["og:description"];
  if (!merged.price && ogTags["meta:price"]) merged.price = ogTags["meta:price"];

  // Fill from page title if still missing address
  if (!merged.address && title) merged.address = title.split("|")[0].trim();

  merged.dataSources = sources.map(s => s.source).join(", ");

  return merged;
}

// ─── Fallback: clean HTML text for Claude ───

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

      if (listingUrl) {
        // ─── STEP 1: Fetch and extract structured data ───
        const extracted = await extractStructuredData(listingUrl);

        if (extracted.ok) {
          // Try to parse structured sources
          const argonaut = parseArgonautExchange(extracted.scriptContents || []);
          const nextData = extracted.nextData ? parseNextData(extracted.nextData) : null;
          const jsonLd = extracted.jsonLd.length > 0 ? parseJsonLd(extracted.jsonLd) : null;

          // Merge all sources into best-available listing data
          const listing = mergeListingData(argonaut, nextData, jsonLd, extracted.ogTags, extracted.title);

          if (listing && (listing.address || listing.suburb)) {
            // ─── SUCCESS: We have structured listing data ───
            userMessage = "Analyse this Australian property listing. I've extracted the structured data for you.\n\n";
            userMessage += "=== EXTRACTED LISTING DATA ===\n";
            userMessage += JSON.stringify(listing, null, 2) + "\n\n";
            userMessage += "URL: " + listingUrl + "\n";
            userMessage += "Data sources: " + (listing.dataSources || "structured extraction") + "\n\n";
            userMessage += "Use this extracted data as the foundation. Fill in the listing fields from this data. Combine with your deep knowledge of " + (listing.suburb || "this suburb") + " to deliver the complete analysis with all sections.";
          } else {
            // ─── PARTIAL: HTMLRewriter worked but no structured data found ───
            // Fall back to sending cleaned HTML text
            // Re-fetch for raw text since HTMLRewriter consumed the response
            const rawResponse = await fetch(listingUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-AU,en;q=0.9",
              },
              redirect: "follow",
            });
            const rawHtml = await rawResponse.text();
            const cleanText = cleanHtmlForClaude(rawHtml);

            userMessage = "Analyse this Australian property listing. I couldn't extract structured data, so here's the page content.\n\n";
            userMessage += "URL: " + listingUrl + "\n";
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
          }
        } else {
          // ─── FAILED: Couldn't fetch the page at all ───
          userMessage = "Analyse this Australian property listing: " + listingUrl + "\n\n";
          userMessage += "I couldn't fetch the page (error: " + (extracted.error || "unknown") + "). ";
          userMessage += "Extract what you can from the URL (suburb, property type, platform) and use your comprehensive knowledge of that area. ";
          userMessage += "Be upfront that you're working from URL inference. Still deliver the full analysis.";
        }
      } else if (manualDetails) {
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

      // ─── STEP 2: Send to Claude for analysis ───
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
        return new Response(JSON.stringify({ error: err.error?.message || "API request failed" }), {
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

# PropertyIQ

AI property analysis for Australian listings, plus an automated **daily new-listing post to X** written as the **@thebuyersgrail** buyer's-agent persona.

- `index.html` — React single-page app (hosted on GitHub Pages) for on-demand analysis of a listing.
- `worker.js` — Cloudflare Worker: the analysis API **and** the daily X-post pipeline (cron).
- `wrangler.toml` — Worker config: cron schedule, tuning vars, and the KV binding.

---

## Daily new-listing X post

Every day the Worker's cron trigger:

1. **Finds a fresh listing** — searches the Domain API for the newest *Sale* listings across your `TARGET_SUBURBS`, keeping only ones first listed within `NEW_LISTING_WINDOW_HOURS` that haven't been posted before (dedup via KV).
2. **Analyses it** — runs the full PropertyIQ analyst prompt over the listing (value read, growth, risks, negotiation, suburb intelligence).
3. **Writes the post** — a second pass in the `@thebuyersgrail` voice produces both a **single tweet** and a **thread**, each clamped to ≤280 characters.
4. **Publishes or drafts** — depending on `POST_MODE`.

### Publish modes (`POST_MODE`)

- `draft` *(default, safest)* — the post is stored in KV. You review it on a token-gated page and publish with one click. Nothing goes public without you.
- `auto` — the post is published to X automatically each day, no human in the loop.

### Reviewing / publishing a draft

Open the review page (draft mode):

```
https://<your-worker-domain>/?review=<REVIEW_TOKEN>
```

It shows the drafted single tweet and thread with live character counts and **Publish** buttons. Publishing posts to X and marks the listing as done so it won't be reused.

You can also drive the pipeline over HTTP (all require `token` = `REVIEW_TOKEN`):

```bash
# Run the daily pipeline right now (useful for testing the cron path)
curl -X POST https://<worker>/ -H 'Content-Type: application/json' \
  -d '{"action":"run","token":"<REVIEW_TOKEN>"}'

# Publish the latest stored draft ("single" or "thread")
curl -X POST https://<worker>/ -H 'Content-Type: application/json' \
  -d '{"action":"publish","token":"<REVIEW_TOKEN>","format":"single"}'
```

---

## Configuration

### Vars (`wrangler.toml` `[vars]`, or the Cloudflare dashboard)

| Var | Meaning | Default |
| --- | --- | --- |
| `TARGET_SUBURBS` | Comma-separated `Suburb:STATE` pairs to scan | `Bondi:NSW,Southbank:VIC,New Farm:QLD,Fremantle:WA,Norwood:SA` |
| `POST_MODE` | `draft` or `auto` | `draft` |
| `POST_FORMAT` | `single` or `thread` | `single` |
| `X_HANDLE` | Persona/handle the post is written as | `thebuyersgrail` |
| `NEW_LISTING_WINDOW_HOURS` | Max age (hours) for a listing to count as "new" | `48` |

Cron schedule lives in `[triggers]` — default `30 21 * * *` (≈ 7:30am AEST). Adjust to taste.

### Secrets (`wrangler secret put <NAME>` — never commit these)

| Secret | Used for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude analysis + post generation |
| `DOMAIN_CLIENT_ID` / `DOMAIN_CLIENT_SECRET` | Domain API (listing search + detail) |
| `X_API_KEY` / `X_API_SECRET` | X app consumer key/secret |
| `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | X user tokens for @thebuyersgrail |
| `REVIEW_TOKEN` | Guards the review page and the `run`/`publish` actions |

### X (Twitter) app setup

1. In the X Developer Portal, create an app with **Read and Write** permissions.
2. Under **User authentication settings**, enable OAuth 1.0a.
3. Generate the **Access Token & Secret** for the @thebuyersgrail account (the tokens must belong to the account you want to post as).
4. Store the four values as the `X_*` secrets above.

The Worker signs requests with OAuth 1.0a (HMAC-SHA1) and posts via `POST /2/tweets`; threads are chained with `in_reply_to_tweet_id`.

### KV namespace

```bash
wrangler kv:namespace create POST_STORE
```

Paste the returned `id` into the `[[kv_namespaces]]` block in `wrangler.toml`. KV holds `posted:<listingId>` dedup markers and the `draft:latest` pending post.

---

## Deploy

```bash
wrangler deploy
```

## Notes & caveats

- **Data source:** the daily job uses the Domain API (already wired into the analysis endpoint). REA scraping is only used by the on-demand analysis path.
- **X API tier:** posting works on the free tier's write allowance, but daily-thread posting consumes more of your monthly write cap than a single tweet. Start with `POST_FORMAT=single`.
- **Accuracy:** posts are AI-generated from listing data and general suburb knowledge. The thread appends a "not financial advice / do your own due diligence" tweet; the single-tweet format relies on your review before publishing. Keep `POST_MODE=draft` until you're happy with the output quality.

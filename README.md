# Cluster Tiers

Snap a photo of an instrument cluster (or its part-number label) → Claude Haiku
looks it up on the web → the app checks it against your Supabase database.

- **Found:** shows the tier (A Green · B Yellow · C Orange · D Red · E Purple).
- **Not found:** adds it to the database as **E — Purple — Unknown**.
- **Could be two bins** (e.g. Ranger 4WD vs Base): asks you to pick.
- Part numbers get remembered on the matching bin, so the next scan of the
  same number (typed) is instant and free.
- **Model picker:** Haiku (fast, default), Sonnet (harder), Opus (hardest).
  If a lookup comes back Unknown or unsure, tap *Search harder with Sonnet/Opus*
  to re-run the same photo; it replaces the Unknown entry instead of adding a
  duplicate. The phone remembers your last choice.
- **Clusters** tab: search, filter by color, tap a cluster to change its tier,
  part numbers, years or notes, or add one by hand.
- **Unknown counts:** every time a scan lands on an Unknown, its count goes up.
  The Purple filter ranks unknowns most-seen first, so you know which to
  research and tier first.

```
web/                      phone web app (plain HTML/JS, no build step)
supabase/migrations/      tables, security rules, your 11 bins pre-loaded
supabase/functions/lookup-cluster/   photo → Haiku + web search → match / add
```

## Setup (about 15 minutes)

You need: a Supabase project, an Anthropic API key, and the Supabase CLI
(`npm i -g supabase`, or `paru -S supabase-bin` on Arch/CachyOS).

1. **Link the project**
   ```bash
   cd cluster-tier-app
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   ```

2. **Create the tables and load the 11 bins**
   ```bash
   supabase db push
   ```

3. **Give the function your Anthropic key and deploy it**
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy lookup-cluster
   ```
   Web search must be allowed for your org in the Claude Console
   (Settings → Privacy) or lookups will fail.

4. **Point the app at Supabase** — edit `web/config.js` with your project URL
   and anon key (Project Settings → API).

5. **Host `web/` over HTTPS** (phones only allow the camera on HTTPS).
   Any static host works: GitHub Pages, Netlify, Cloudflare Pages.
   For a quick local test: `npx serve web` (camera works on `localhost`).

6. **Accounts** — open the app, tap *Create account*. Once everyone who needs
   access has an account, turn off new sign-ups in Supabase
   (Authentication → Sign In / Providers → *Allow new users to sign up*), so
   nobody else can get in. Only signed-in users can see or change tiers.

On the phone, use *Add to Home Screen* and it opens like an app.

## How a lookup works

1. The phone shrinks the photo to ≤1568 px JPEG and sends it to the
   `lookup-cluster` function along with any typed part number.
2. If the typed part number is already saved on a bin, it answers right away.
3. Otherwise the chosen model (`claude-haiku-5-5`, `claude-sonnet-5-5` or
   `claude-opus-5-5`) reads the photo, runs up to 4 / 6 / 8 web searches, and compares it to every bin in the database
   (make + model + year range + variant). It returns a match, a short list of
   possible bins, or nothing.
4. No match → a new row is created with tier **E** and `source = 'scan'`,
   counted as seen once.
5. Every later scan that lands on a cluster that's still Unknown adds one to
   its count (`unknown_seen`) and updates `last_seen_at`.

## Which unknowns to research first

Clusters tab → tap the **E Purple** filter. Unknowns are listed most-seen
first, each with how many times it's come through and when it was last seen.
Research the top ones and give them a tier; once a cluster has a real tier its
count is no longer shown.

Every lookup is also logged in the `scans` table.

## Cost

Haiku 5.5 is $0.10 / M input and $0.50 / M output tokens, plus Anthropic's
per-search web search fee. Sonnet and Opus cost more per lookup and allow more
searches, so keep Haiku as the default and step up only for hard ones. A lookup is one photo plus a few searches, so it's
mostly the search fee. Typed part numbers you've seen before cost nothing.

## Changing tiers or colors

- A single cluster's tier: Clusters tab → tap it → pick a color → Save.
  Or right from a scan result.
- The tier definitions themselves (colors, wording) live in the `tiers`
  table; edit them in the Supabase table editor and the app picks them up.

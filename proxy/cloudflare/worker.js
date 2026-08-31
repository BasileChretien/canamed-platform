/* Cloudflare Workers adapter.
 *
 * Thin on purpose: everything testable lives in ../src/handler.js, which uses
 * only Web-standard APIs, so the same core also runs on Scaleway Functions,
 * Deno Deploy, Vercel or plain Node ≥18 behind a different adapter.
 *
 * ⚠ DATA RESIDENCY — READ BEFORE DEPLOYING HERE. Cloudflare's free plan runs a
 * Worker at whichever edge PoP is nearest the visitor, anywhere in the world.
 * Restricting execution to the EU needs Regional Services / the Data
 * Localization Suite, which is an ENTERPRISE add-on. That conflicts with the
 * decision recorded in functions/index.js and modA-llm-init.js to keep
 * participants' free-text chat inside the EEA — a decision taken partly
 * because Japan's APPI Art. 28 equivalent-protection list covers only the EEA
 * and the UK. If that commitment still stands, deploy to an EEA-pinnable host
 * instead (Scaleway Serverless Functions, fr-par/Paris, has a free tier) and
 * keep this adapter for local development only. See README.md.
 */

import { handleRequest } from "../src/handler.js";
import { kvStore } from "../src/stores.js";

export default {
  async fetch(request, env, _ctx) {
    /* env.RATE_LIMIT is the OPTIONAL KV namespace binding from wrangler.toml.
     * When it is absent the handler falls back to its RTDB-backed store, which
     * is the better default anyway: KV is eventually consistent with no atomic
     * increment and can silently lose one, while the RTDB counters are made
     * atomic by the increment-only database rule. See ../src/stores.js. */
    const store = env.RATE_LIMIT ? kvStore(env.RATE_LIMIT) : null;
    return handleRequest(request, env, { store });
  }
};

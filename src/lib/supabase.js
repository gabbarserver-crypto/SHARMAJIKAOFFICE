// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

// TODO: move to environment variables (.env + Vite's import.meta.env) before deploying.
const SUPABASE_URL = "https://kxusesmymrlbjsbppikm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_T8sMx32GuOd8V5tvtb3gPg_RQHhrQ1h";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

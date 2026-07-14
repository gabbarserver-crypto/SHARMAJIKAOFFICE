// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

// TODO: move to environment variables (.env + Vite's import.meta.env) before deploying.
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

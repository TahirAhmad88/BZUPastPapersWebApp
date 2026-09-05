// ============================================================
// supabase-config.js
// ------------------------------------------------------------
// Fill in the two values below from your Supabase project:
// Project Settings → API → "Project URL" and "anon public" key.
//
// SECURITY NOTE: the anon key is safe to ship in client code —
// that's how every Supabase web app works. What actually keeps
// your data secure is Row Level Security (see supabase-schema.sql
// in this folder) — the anon key on its own can only do what your
// RLS policies allow, nothing more.
// ============================================================

// supabase-config.js
export const SUPABASE_URL = "https://dmqqsmtyvubhdlrwzqhd.supabase.co";
export const SUPABASE_ANON_KEY =
  "sb_publishable_LaEBK4opRqUQOue2PRKrgA_zpoJgZ-1";
// Name of the Storage bucket used for paper files (created in
// supabase-schema.sql). Change here if you rename the bucket.
export const STORAGE_BUCKET = "papers";

// Only this email can create other admin accounts. Must match the
// value used in supabase-schema.sql's RLS policy on the `admins` table.
export const PRIMARY_ADMIN_EMAIL = "tahir@admin.com";

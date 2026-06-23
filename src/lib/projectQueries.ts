import { supabase } from "./supabase";

export function activeProjectsQuery() {
  return supabase
    .from("projects")
    .select("*")
    .is("deleted_at", null)
    .order("name");
}

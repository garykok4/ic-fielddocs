import { supabase } from "./supabase";

export async function requireActiveStaff() {
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    window.location.href = "/login";
    return null;
  }

  const { data: profile, error } = await supabase
    .from("staff_profiles")
    .select("*")
    .eq("id", userData.user.id)
    .eq("active", true)
    .single();

  if (error || !profile) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    return null;
  }

  return profile;
}
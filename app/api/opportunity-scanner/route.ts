import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { supabase } from "@/lib/supabase";

const parser = new Parser();

const feeds = [
  "https://news.google.com/rss/search?q=food+processing+expansion+Ontario",
  "https://news.google.com/rss/search?q=food+manufacturing+facility+Ontario",
  "https://news.google.com/rss/search?q=cold+storage+expansion+Ontario",
  "https://news.google.com/rss/search?q=new+food+plant+Ontario",
  "https://news.google.com/rss/search?q=manufacturing+expansion+Southwestern+Ontario",
];

function scoreOpportunity(title: string, content: string) {
  const text = (title + " " + content).toLowerCase();
  let score = 0;

  if (text.includes("market report")) score -= 50;
  if (text.includes("market size")) score -= 50;
  if (text.includes("forecast")) score -= 40;
  if (text.includes("analysis")) score -= 25;

  if (text.includes("food processing")) score += 40;
  if (text.includes("food manufacturing")) score += 40;
  if (text.includes("processing facility")) score += 40;
  if (text.includes("food packaging")) score += 35;
  if (text.includes("cold storage")) score += 35;
  if (text.includes("new plant")) score += 40;
  if (text.includes("new facility")) score += 35;
  if (text.includes("expansion")) score += 25;
  if (text.includes("investment")) score += 20;

  if (text.includes("woodstock")) score += 35;
  if (text.includes("oxford")) score += 30;
  if (text.includes("brantford")) score += 25;
  if (text.includes("london")) score += 25;
  if (text.includes("cambridge")) score += 20;
  if (text.includes("kitchener")) score += 20;

  if (text.includes("sunrise farms")) score += 40;
  if (text.includes("sofina")) score += 40;
  if (text.includes("conestoga")) score += 40;
  if (text.includes("lactalis")) score += 40;
  if (text.includes("maple leaf")) score += 40;

  return Math.max(0, Math.min(score, 100));
}

function detectMunicipality(text: string) {
  const lower = text.toLowerCase();

  const places = [
    "Woodstock",
    "Oxford County",
    "Ingersoll",
    "Tillsonburg",
    "Norwich",
    "London",
    "Brantford",
    "Cambridge",
    "Kitchener",
    "Waterloo",
    "Stratford",
    "Guelph",
  ];

  return places.find((place) => lower.includes(place.toLowerCase())) || null;
}

function detectCompany(text: string) {
  const lower = text.toLowerCase();

  const companies = [
    "Sunrise Farms",
    "Conestoga Cold Storage",
    "Conestoga",
    "Sofina",
    "Lactalis",
    "Maple Leaf",
    "Andriani",
    "Massilly",
    "Lee Li Holdings",
    "Propower",
  ];

  return companies.find((company) => lower.includes(company.toLowerCase())) || null;
}

function createProjectKey(
  title: string,
  company: string | null,
  municipality: string | null
) {
  const text = (title + " " + (company || "") + " " + (municipality || "")).toLowerCase();

  if (text.includes("sunrise farms") && text.includes("woodstock")) {
    return "sunrise-farms-woodstock-poultry-processing";
  }

  if (text.includes("poultry processing") && text.includes("woodstock")) {
    return "sunrise-farms-woodstock-poultry-processing";
  }

  if (text.includes("conestoga") && text.includes("cold storage")) {
    return "conestoga-cold-storage-expansion";
  }

  if ((text.includes("massilly") || text.includes("brantford")) && text.includes("packaging")) {
    return "massilly-brantford-packaging-plant";
  }

  if (text.includes("andriani") && text.includes("london")) {
    return "andriani-london-production-plant";
  }

  if (company && municipality) {
    return (company + "-" + municipality)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  return title
    .toLowerCase()
    .replace(/ - .*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function GET() {
  const found = [];

  for (const feedUrl of feeds) {
    const feed = await parser.parseURL(feedUrl);

    for (const item of feed.items.slice(0, 15)) {
      const title = item.title || "Untitled Opportunity";
      const link = item.link || "";
      const description = item.contentSnippet || item.content || "";
      const combinedText = title + " " + description;

      const score = scoreOpportunity(title, description);

      if (score < 30) continue;

      const municipality = detectMunicipality(combinedText);
      const company = detectCompany(combinedText);
      const projectKey = createProjectKey(title, company, municipality);

      const { error } = await supabase.from("opportunities").upsert(
        {
          project_key: projectKey,
          title,
          description,
          source: "News RSS",
          source_url: link,
          project_type: "Food Processing / Manufacturing",
          municipality,
          company,
          status: "Lead",
          confidence: 70,
          opportunity_score: score,
          notes: "Auto-imported from RSS/news scanner.",
        },
        { onConflict: "project_key" }
      );

    if (!error) {
  await supabase.from("opportunity_sources").upsert(
    {
      project_key: projectKey,
      source_url: link,
      article_title: title,
      source_name: "Google News RSS",
    },
    { onConflict: "source_url" }
  );

  found.push({ title, company, municipality, score, projectKey });
} else {
  console.error("Insert error:", error.message);
}
    }
  }

  return NextResponse.json({
    message: "Opportunity scanner complete",
    found,
  });
}

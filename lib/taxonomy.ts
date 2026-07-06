/**
 * URL → structured tags, using the embedded Intelligence Hub catalog.
 *
 * Data sources (extracted by scripts/extract-taxonomy.py):
 *   data/taxonomy/courses.json    — 1,698 courses with type/category/subcategory
 *   data/taxonomy/blogs.json      — 500 blog posts with category + matched course
 *   data/taxonomy/course-types.json
 *
 * Anything that doesn't match a known pattern is content_type='static'
 * (the user's explicit fallback for "everything else").
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PageTags {
  contentType:
    | "course"
    | "blog"
    | "category"
    | "subcategory"
    | "location"
    | "excellence-program"
    | "pillar"
    | "static";
  courseType: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
}

interface CourseRow {
  name: string;
  link: string;
  category?: string;
  subcategory?: string;
  type?: string;
}
interface BlogRow {
  url: string;
  title: string;
  category?: string | null;
  matchedCourse?: string | null;
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(process.cwd(), "data", "taxonomy", file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

let courseByUrl: Map<string, CourseRow> | null = null;
let blogByUrl: Map<string, BlogRow> | null = null;

function loadIndex() {
  if (!courseByUrl) {
    const courses = readJson<CourseRow[]>("courses.json", []);
    courseByUrl = new Map(courses.map((c) => [normalize(c.link), c]));
  }
  if (!blogByUrl) {
    const blogs = readJson<BlogRow[]>("blogs.json", []);
    blogByUrl = new Map(blogs.map((b) => [normalize(b.url), b]));
  }
}

function normalize(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Strip "-training" / "-course" / "-in-{city}" suffix noise to get a clean topic tag.
function cleanSlug(slug: string): string {
  return slug
    .replace(/-training-in-[a-z-]+$/, "")
    .replace(/-training$/, "")
    .replace(/-course$/, "")
    .replace(/-program$/, "");
}

const INDUSTRY_PATTERNS = [
  "/who-we-serve",
  "/industries",
  "/industry-",
  "/corporate/",
];

// Slugs Edstellar uses for industry segments under who-we-serve/industries.
const INDUSTRY_KEYWORDS = [
  "manufacturing", "healthcare", "finance", "banking", "retail", "education",
  "technology", "telecom", "energy", "government", "hospitality", "logistics",
  "construction", "insurance", "media", "pharma", "automotive", "aerospace",
];

const CITY_MATCH = /\/corporate-(?:[a-z-]+-)?training-in-([a-z-]+)$/;

export function tagUrl(url: string, title?: string | null): PageTags {
  loadIndex();
  const norm = normalize(url);
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();

  // 1. Home — classified as a static page (one-off tile in the corpus UI
  //    wasn't useful at N=1). The "home" tag is kept so it's still
  //    distinguishable in tag filters.
  if (path === "/" || path === "") {
    return base("static", ["home"]);
  }

  // 2. Course detail page (exact catalog match)
  const course = courseByUrl!.get(norm);
  if (course) {
    const tags = uniq([
      course.type,
      course.category,
      course.subcategory,
      "course",
    ]);
    return {
      contentType: "course",
      courseType: course.type ?? null,
      category: course.category ?? null,
      subcategory: course.subcategory ?? null,
      tags,
    };
  }

  // 3. Blog post
  const blog = blogByUrl!.get(norm);
  if (blog) {
    return {
      contentType: "blog",
      courseType: null,
      category: blog.category ?? null,
      subcategory: null,
      tags: uniq([blog.category, "blog"]),
    };
  }

  // 4. Category landing  /category/<slug>-training
  if (path.startsWith("/category/")) {
    const slug = path.replace("/category/", "").replace(/\/$/, "");
    const label = titleCase(cleanSlug(slug));
    return {
      contentType: "category",
      courseType: null,
      category: label,
      subcategory: null,
      tags: uniq([label, "category"]),
    };
  }

  // 5. Subcategory / topic landing  /topic/<slug>
  if (path.startsWith("/topic/") || path.startsWith("/topics/")) {
    const slug = path.replace(/^\/topics?\//, "").replace(/\/$/, "");
    const label = titleCase(cleanSlug(slug));
    return {
      contentType: "subcategory",
      courseType: null,
      category: null,
      subcategory: label,
      tags: uniq([label, "subcategory"]),
    };
  }

  // 5b. Excellence-program landing pages
  //     /quality-management-excellence-programs, /sales-excellence-program, etc.
  //     Plus the umbrella /excellence-programs.
  const excellence = path.match(/^\/([a-z-]+)-excellence-programs?\/?$/);
  if (excellence) {
    const pillar = titleCase(excellence[1]);
    return {
      contentType: "excellence-program",
      courseType: null,
      category: pillar,
      subcategory: null,
      tags: uniq([pillar, "excellence-program", "pillar"]),
    };
  }
  if (path === "/excellence-programs" || path === "/excellence-programs/") {
    return {
      contentType: "excellence-program",
      courseType: null,
      category: null,
      subcategory: null,
      tags: uniq(["Excellence Programs", "pillar", "umbrella"]),
    };
  }

  // 6. Blog index (/blog without slug)
  if (path === "/blog" || path === "/blog/") {
    return base("static", ["blog-index"]);
  }

  // 7. Locationized corporate-training-in-city
  const cityMatch = path.match(CITY_MATCH);
  if (cityMatch) {
    const city = titleCase(cityMatch[1]);
    return {
      contentType: "location",
      courseType: null,
      category: null,
      subcategory: null,
      tags: uniq([city, "corporate-training", "location"]),
    };
  }

  // 8. Industry / who-we-serve pages — classified as static per current policy,
  //    but we keep the industry slug as a tag so they can still be filtered.
  if (INDUSTRY_PATTERNS.some((p) => path.includes(p))) {
    const seg = path.split("/").filter(Boolean).pop() || "";
    const label = titleCase(cleanSlug(seg));
    return base("static", [label, "industry", "static"]);
  }
  for (const kw of INDUSTRY_KEYWORDS) {
    if (path.includes(kw)) {
      return base("static", [titleCase(kw), "industry", "static"]);
    }
  }

  // 9. Heuristic course/blog that isn't in the catalog yet (newer pages)
  if (path.startsWith("/course/")) {
    const slug = path.replace("/course/", "").replace(/\/$/, "");
    const label = title || titleCase(cleanSlug(slug));
    return {
      contentType: "course",
      courseType: null,
      category: null,
      subcategory: null,
      tags: uniq([label, "course", "uncatalogued"]),
    };
  }
  if (path.startsWith("/blog/")) {
    const slug = path.replace("/blog/", "").replace(/\/$/, "");
    const label = title || titleCase(cleanSlug(slug));
    return {
      contentType: "blog",
      courseType: null,
      category: null,
      subcategory: null,
      tags: uniq([label, "blog", "uncatalogued"]),
    };
  }

  // 10. Fallback — everything else is a static marketing page.
  const seg = path.split("/").filter(Boolean).pop() || "";
  return base("static", seg ? [titleCase(cleanSlug(seg)), "static"] : ["static"]);
}

function base(contentType: PageTags["contentType"], tags: string[]): PageTags {
  return {
    contentType,
    courseType: null,
    category: null,
    subcategory: null,
    tags: uniq(tags),
  };
}

function uniq(arr: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(
      arr
        .filter((s): s is string => !!s && s.trim().length > 0)
        .map((s) => s.trim()),
    ),
  );
}
